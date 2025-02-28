import { Knex } from 'knex';
import EventEmitter from 'events';
import metricsHelper from '../../util/metrics-helper';
import { DB_TIME } from '../../metric-events';
import NotFoundError from '../../error/notfound-error';
import { Logger, LogProvider } from '../../logger';
import {
    FeatureToggle,
    FeatureToggleDTO,
    IFeatureToggleQuery,
    IVariant,
} from '../../types/model';
import { IFeatureToggleStore } from './types/feature-toggle-store-type';
import { Db } from '../../db/db';
import { LastSeenInput } from '../../services/client-metrics/last-seen/last-seen-service';
import { NameExistsError } from '../../error';
import { DEFAULT_ENV, ensureStringValue, mapValues } from '../../../lib/util';
import {
    IFeatureToggleClient,
    IStrategyConfig,
    ITag,
    PartialDeep,
} from '../../../lib/types';
import { FeatureToggleListBuilder } from './query-builders/feature-toggle-list-builder';

export type EnvironmentFeatureNames = { [key: string]: string[] };

const FEATURE_COLUMNS = [
    'name',
    'description',
    'type',
    'project',
    'stale',
    'created_at',
    'impression_data',
    'last_seen_at',
    'archived_at',
];

export interface FeaturesTable {
    name: string;
    description: string;
    type: string;
    stale: boolean;
    project: string;
    last_seen_at?: Date;
    created_at?: Date;
    impression_data: boolean;
    archived?: boolean;
    archived_at?: Date;
}

interface VariantDTO {
    variants: IVariant[];
}

const TABLE = 'features';
const FEATURE_ENVIRONMENTS_TABLE = 'feature_environments';

const isUnseenStrategyRow = (
    feature: PartialDeep<IFeatureToggleClient>,
    row: Record<string, any>,
): boolean => {
    return (
        row.strategy_id &&
        !feature.strategies?.find((s) => s?.id === row.strategy_id)
    );
};

const isNewTag = (
    feature: PartialDeep<IFeatureToggleClient>,
    row: Record<string, any>,
): boolean => {
    return (
        row.tag_type &&
        row.tag_value &&
        !feature.tags?.some(
            (tag) => tag?.type === row.tag_type && tag?.value === row.tag_value,
        )
    );
};

const addSegmentToStrategy = (
    feature: PartialDeep<IFeatureToggleClient>,
    row: Record<string, any>,
) => {
    feature.strategies
        ?.find((s) => s?.id === row.strategy_id)
        ?.constraints?.push(...row.segment_constraints);
};

const addSegmentIdsToStrategy = (
    feature: PartialDeep<IFeatureToggleClient>,
    row: Record<string, any>,
) => {
    const strategy = feature.strategies?.find((s) => s?.id === row.strategy_id);
    if (!strategy) {
        return;
    }
    if (!strategy.segments) {
        strategy.segments = [];
    }
    strategy.segments.push(row.segment_id);
};

const rowToStrategy = (row: Record<string, any>): IStrategyConfig => {
    const strategy: IStrategyConfig = {
        id: row.strategy_id,
        name: row.strategy_name,
        title: row.strategy_title,
        constraints: row.constraints || [],
        parameters: mapValues(row.parameters || {}, ensureStringValue),
        sortOrder: row.sort_order,
    };
    strategy.variants = row.strategy_variants || [];
    return strategy;
};

const addTag = (
    feature: Record<string, any>,
    row: Record<string, any>,
): void => {
    const tags = feature.tags || [];
    const newTag = rowToTag(row);
    feature.tags = [...tags, newTag];
};

const rowToTag = (row: Record<string, any>): ITag => {
    return {
        value: row.tag_value,
        type: row.tag_type,
    };
};

const buildFeatureToggleListFromRows = (
    rows: any[],
    featureQuery?: IFeatureToggleQuery,
): FeatureToggle[] => {
    const result = rows.reduce((acc, r) => {
        const feature: PartialDeep<IFeatureToggleClient> = acc[r.name] ?? {
            strategies: [],
        };
        if (isUnseenStrategyRow(feature, r) && !r.strategy_disabled) {
            feature.strategies?.push(rowToStrategy(r));
        }
        if (isNewTag(feature, r)) {
            addTag(feature, r);
        }
        if (featureQuery?.inlineSegmentConstraints && r.segment_id) {
            addSegmentToStrategy(feature, r);
        } else if (!featureQuery?.inlineSegmentConstraints && r.segment_id) {
            addSegmentIdsToStrategy(feature, r);
        }

        feature.impressionData = r.impression_data;
        feature.enabled = !!r.enabled;
        feature.name = r.name;
        feature.description = r.description;
        feature.project = r.project;
        feature.stale = r.stale;
        feature.type = r.type;
        feature.lastSeenAt = r.last_seen_at;
        feature.variants = r.variants || [];
        feature.project = r.project;

        feature.favorite = r.favorite;
        feature.lastSeenAt = r.last_seen_at;
        feature.createdAt = r.created_at;

        acc[r.name] = feature;
        return acc;
    }, {});

    return Object.values(result);
};

export default class FeatureToggleStore implements IFeatureToggleStore {
    private db: Db;

    private logger: Logger;

    private timer: Function;

    constructor(db: Db, eventBus: EventEmitter, getLogger: LogProvider) {
        this.db = db;
        this.logger = getLogger('feature-toggle-store.ts');
        this.timer = (action) =>
            metricsHelper.wrapTimer(eventBus, DB_TIME, {
                store: 'feature-toggle',
                action,
            });
    }

    async count(
        query: {
            archived?: boolean;
            project?: string;
            stale?: boolean;
        } = { archived: false },
    ): Promise<number> {
        const { archived, ...rest } = query;
        return this.db
            .from(TABLE)
            .count('*')
            .where(rest)
            .modify(FeatureToggleStore.filterByArchived, archived)
            .then((res) => Number(res[0].count));
    }

    async deleteAll(): Promise<void> {
        await this.db(TABLE).del();
    }

    destroy(): void {}

    async get(name: string): Promise<FeatureToggle> {
        return this.db
            .first(FEATURE_COLUMNS)
            .from(TABLE)
            .where({ name })
            .then(this.rowToFeature);
    }

    async getFeatureToggleList(
        featureQuery?: IFeatureToggleQuery,
        userId?: number,
        archived: boolean = false,
    ): Promise<FeatureToggle[]> {
        const environment = featureQuery?.environment || DEFAULT_ENV;

        const builder = new FeatureToggleListBuilder(this.db);

        builder
            .query('features')
            .withArchived(archived)
            .withStrategies(environment)
            .withFeatureEnvironments(environment)
            .withFeatureStrategySegments()
            .withSegments()
            .withDependentFeatureToggles()
            .withFeatureTags();

        if (userId) {
            builder.withFavorites(userId);

            builder.addSelectColumn(
                this.db.raw(
                    'favorite_features.feature is not null as favorite',
                ),
            );
        }

        const rows = await builder.internalQuery.select(
            builder.getSelectColumns(),
        );

        return buildFeatureToggleListFromRows(rows, featureQuery);
    }

    async getAll(
        query: {
            archived?: boolean;
            project?: string;
            stale?: boolean;
        } = { archived: false },
    ): Promise<FeatureToggle[]> {
        const { archived, ...rest } = query;
        const rows = await this.db
            .select(FEATURE_COLUMNS)
            .from(TABLE)
            .where(rest)
            .modify(FeatureToggleStore.filterByArchived, archived);
        return rows.map(this.rowToFeature);
    }

    async getAllByNames(names: string[]): Promise<FeatureToggle[]> {
        const query = this.db<FeaturesTable>(TABLE).orderBy('name', 'asc');
        query.whereIn('name', names);
        const rows = await query;
        return rows.map(this.rowToFeature);
    }

    async countByDate(queryModifiers: {
        archived?: boolean;
        project?: string;
        date?: string;
        range?: string[];
        dateAccessor: string;
    }): Promise<number> {
        const { project, archived, dateAccessor } = queryModifiers;
        const query = this.db
            .count()
            .from(TABLE)
            .where({ project })
            .modify(FeatureToggleStore.filterByArchived, archived);

        if (queryModifiers.date) {
            query.andWhere(dateAccessor, '>=', queryModifiers.date);
        }

        if (queryModifiers.range && queryModifiers.range.length === 2) {
            query.andWhereBetween(dateAccessor, [
                queryModifiers.range[0],
                queryModifiers.range[1],
            ]);
        }

        const queryResult = await query.first();
        return parseInt(queryResult.count || 0);
    }

    /**
     * Get projectId from feature filtered by name. Used by Rbac middleware
     * @deprecated
     * @param name
     */
    async getProjectId(name: string): Promise<string> {
        return this.db
            .first(['project'])
            .from(TABLE)
            .where({ name })
            .then((r) => (r ? r.project : undefined))
            .catch((e) => {
                this.logger.error(e);
                return undefined;
            });
    }

    async exists(name: string): Promise<boolean> {
        const result = await this.db.raw(
            'SELECT EXISTS (SELECT 1 FROM features WHERE name = ?) AS present',
            [name],
        );
        const { present } = result.rows[0];
        return present;
    }

    async setLastSeen(data: LastSeenInput[]): Promise<void> {
        const now = new Date();
        const environmentArrays = this.mapMetricDataToEnvBuckets(data);
        try {
            for (const env of Object.keys(environmentArrays)) {
                const toggleNames = environmentArrays[env].sort();
                await this.db(FEATURE_ENVIRONMENTS_TABLE)
                    .update({ last_seen_at: now })
                    .where('environment', env)
                    .whereIn(
                        'feature_name',
                        this.db(FEATURE_ENVIRONMENTS_TABLE)
                            .select('feature_name')
                            .whereIn('feature_name', toggleNames)
                            .forUpdate()
                            .skipLocked(),
                    );

                // Updating the toggle's last_seen_at also for backwards compatibility
                await this.db(TABLE)
                    .update({ last_seen_at: now })
                    .whereIn(
                        'name',
                        this.db(TABLE)
                            .select('name')
                            .whereIn('name', toggleNames)
                            .forUpdate()
                            .skipLocked(),
                    );
            }
        } catch (err) {
            this.logger.error('Could not update lastSeen, error: ', err);
        }
    }

    private mapMetricDataToEnvBuckets(
        data: LastSeenInput[],
    ): EnvironmentFeatureNames {
        return data.reduce(
            (acc: EnvironmentFeatureNames, feature: LastSeenInput) => {
                const { environment, featureName } = feature;

                if (!acc[environment]) {
                    acc[environment] = [];
                }

                acc[environment].push(featureName);

                return acc;
            },
            {},
        );
    }

    static filterByArchived: Knex.QueryCallbackWithArgs = (
        queryBuilder: Knex.QueryBuilder,
        archived: boolean,
    ) => {
        return archived
            ? queryBuilder.whereNotNull('archived_at')
            : queryBuilder.whereNull('archived_at');
    };

    rowToFeature(row: FeaturesTable): FeatureToggle {
        if (!row) {
            throw new NotFoundError('No feature toggle found');
        }
        return {
            name: row.name,
            description: row.description,
            type: row.type,
            project: row.project,
            stale: row.stale,
            createdAt: row.created_at,
            lastSeenAt: row.last_seen_at,
            impressionData: row.impression_data,
            archivedAt: row.archived_at,
            archived: row.archived_at != null,
        };
    }

    rowToEnvVariants(variantRows: VariantDTO[]): IVariant[] {
        if (!variantRows.length) {
            return [];
        }

        const sortedVariants =
            (variantRows[0].variants as unknown as IVariant[]) || [];
        sortedVariants.sort((a, b) => a.name.localeCompare(b.name));
        return sortedVariants;
    }

    dtoToRow(project: string, data: FeatureToggleDTO): FeaturesTable {
        const row = {
            name: data.name,
            description: data.description,
            type: data.type,
            project,
            archived_at: data.archived ? new Date() : null,
            stale: data.stale,
            created_at: data.createdAt,
            impression_data: data.impressionData,
        };
        if (!row.created_at) {
            delete row.created_at;
        }
        return row;
    }

    async create(
        project: string,
        data: FeatureToggleDTO,
    ): Promise<FeatureToggle> {
        try {
            const row = await this.db(TABLE)
                .insert(this.dtoToRow(project, data))
                .returning(FEATURE_COLUMNS);

            return this.rowToFeature(row[0]);
        } catch (err) {
            this.logger.error('Could not insert feature, error: ', err);
            if (
                typeof err.detail === 'string' &&
                err.detail.includes('already exists')
            ) {
                throw new NameExistsError(
                    `Feature ${data.name} already exists`,
                );
            }
            throw err;
        }
    }

    async update(
        project: string,
        data: FeatureToggleDTO,
    ): Promise<FeatureToggle> {
        const row = await this.db(TABLE)
            .where({ name: data.name })
            .update(this.dtoToRow(project, data))
            .returning(FEATURE_COLUMNS);

        return this.rowToFeature(row[0]);
    }

    async archive(name: string): Promise<FeatureToggle> {
        const now = new Date();
        const row = await this.db(TABLE)
            .where({ name })
            .update({ archived_at: now })
            .returning(FEATURE_COLUMNS);
        return this.rowToFeature(row[0]);
    }

    async batchArchive(names: string[]): Promise<FeatureToggle[]> {
        const now = new Date();
        const rows = await this.db(TABLE)
            .whereIn('name', names)
            .update({ archived_at: now })
            .returning(FEATURE_COLUMNS);
        return rows.map((row) => this.rowToFeature(row));
    }

    async batchStale(
        names: string[],
        stale: boolean,
    ): Promise<FeatureToggle[]> {
        const rows = await this.db(TABLE)
            .whereIn('name', names)
            .update({ stale })
            .returning(FEATURE_COLUMNS);
        return rows.map((row) => this.rowToFeature(row));
    }

    async delete(name: string): Promise<void> {
        await this.db(TABLE)
            .where({ name }) // Feature toggle must be archived to allow deletion
            .whereNotNull('archived_at')
            .del();
    }

    async batchDelete(names: string[]): Promise<void> {
        await this.db(TABLE)
            .whereIn('name', names)
            .whereNotNull('archived_at')
            .del();
    }

    async revive(name: string): Promise<FeatureToggle> {
        const row = await this.db(TABLE)
            .where({ name })
            .update({ archived_at: null })
            .returning(FEATURE_COLUMNS);

        return this.rowToFeature(row[0]);
    }

    async batchRevive(names: string[]): Promise<FeatureToggle[]> {
        const rows = await this.db(TABLE)
            .whereIn('name', names)
            .update({ archived_at: null })
            .returning(FEATURE_COLUMNS);

        return rows.map((row) => this.rowToFeature(row));
    }

    async disableAllEnvironmentsForFeatures(names: string[]): Promise<void> {
        await this.db(FEATURE_ENVIRONMENTS_TABLE)
            .whereIn('feature_name', names)
            .update({ enabled: false });
    }

    async getVariants(featureName: string): Promise<IVariant[]> {
        if (!(await this.exists(featureName))) {
            throw new NotFoundError('No feature toggle found');
        }
        const row = await this.db(`${TABLE} as f`)
            .select('fe.variants')
            .join(
                `${FEATURE_ENVIRONMENTS_TABLE} as fe`,
                'fe.feature_name',
                'f.name',
            )
            .where({ name: featureName })
            .limit(1);

        return this.rowToEnvVariants(row);
    }

    async getVariantsForEnv(
        featureName: string,
        environment: string,
    ): Promise<IVariant[]> {
        const row = await this.db(`${TABLE} as f`)
            .select('fev.variants')
            .join(
                `${FEATURE_ENVIRONMENTS_TABLE} as fev`,
                'fev.feature_name',
                'f.name',
            )
            .where({ name: featureName })
            .andWhere({ environment });

        return this.rowToEnvVariants(row);
    }

    async saveVariants(
        project: string,
        featureName: string,
        newVariants: IVariant[],
    ): Promise<FeatureToggle> {
        const variantsString = JSON.stringify(newVariants);
        await this.db('feature_environments')
            .update('variants', variantsString)
            .where('feature_name', featureName);

        const row = await this.db(TABLE)
            .select(FEATURE_COLUMNS)
            .where({ project: project, name: featureName });

        const toggle = this.rowToFeature(row[0]);
        toggle.variants = newVariants;

        return toggle;
    }

    async updatePotentiallyStaleFeatures(
        currentTime?: string,
    ): Promise<{ name: string; potentiallyStale: boolean; project: string }[]> {
        const query = this.db.raw(
            `SELECT name, project, potentially_stale, (? > (features.created_at + ((
                            SELECT feature_types.lifetime_days
                            FROM feature_types
                            WHERE feature_types.id = features.type
                        ) * INTERVAL '1 day'))) as current_staleness
            FROM features
            WHERE NOT stale = true`,
            [currentTime || this.db.fn.now()],
        );

        const featuresToUpdate = (await query).rows
            .filter(
                ({ potentially_stale, current_staleness }) =>
                    (potentially_stale ?? false) !==
                    (current_staleness ?? false),
            )
            .map(({ current_staleness, name, project }) => ({
                potentiallyStale: current_staleness ?? false,
                name,
                project,
            }));

        await this.db(TABLE)
            .update('potentially_stale', true)
            .whereIn(
                'name',
                featuresToUpdate
                    .filter((feature) => feature.potentiallyStale === true)
                    .map((feature) => feature.name),
            );

        await this.db(TABLE)
            .update('potentially_stale', false)
            .whereIn(
                'name',
                featuresToUpdate
                    .filter((feature) => feature.potentiallyStale !== true)
                    .map((feature) => feature.name),
            );

        return featuresToUpdate;
    }

    async isPotentiallyStale(featureName: string): Promise<boolean> {
        const result = await this.db(TABLE)
            .first(['potentially_stale'])
            .from(TABLE)
            .where({ name: featureName });

        return result?.potentially_stale ?? false;
    }
}

module.exports = FeatureToggleStore;
