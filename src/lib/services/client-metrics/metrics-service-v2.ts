import { Logger } from '../../logger';
import { IFlagResolver, IUnleashConfig } from '../../types';
import { IUnleashStores } from '../../types';
import { ToggleMetricsSummary } from '../../types/models/metrics';
import {
    IClientMetricsEnv,
    IClientMetricsStoreV2,
} from '../../types/stores/client-metrics-store-v2';
import { clientMetricsSchema } from './schema';
import {
    compareAsc,
    hoursToMilliseconds,
    secondsToMilliseconds,
} from 'date-fns';
import { CLIENT_METRICS } from '../../types/events';
import ApiUser from '../../types/api-user';
import { ALL } from '../../types/models/api-token';
import User from '../../types/user';
import { collapseHourlyMetrics } from '../../util/collapseHourlyMetrics';
import { LastSeenService } from './last-seen/last-seen-service';
import { generateHourBuckets } from '../../util/time-utils';
import { ClientMetricsSchema } from 'lib/openapi';
import { nameSchema } from '../../schema/feature-schema';

export default class ClientMetricsServiceV2 {
    private config: IUnleashConfig;

    private timers: NodeJS.Timeout[] = [];

    private unsavedMetrics: IClientMetricsEnv[] = [];

    private clientMetricsStoreV2: IClientMetricsStoreV2;

    private lastSeenService: LastSeenService;

    private flagResolver: Pick<IFlagResolver, 'isEnabled'>;

    private logger: Logger;

    constructor(
        { clientMetricsStoreV2 }: Pick<IUnleashStores, 'clientMetricsStoreV2'>,
        config: IUnleashConfig,
        lastSeenService: LastSeenService,
        bulkInterval = secondsToMilliseconds(5),
    ) {
        this.clientMetricsStoreV2 = clientMetricsStoreV2;
        this.lastSeenService = lastSeenService;
        this.config = config;
        this.logger = config.getLogger(
            '/services/client-metrics/client-metrics-service-v2.ts',
        );
        this.flagResolver = config.flagResolver;

        this.timers.push(
            setInterval(() => {
                this.bulkAdd().catch(console.error);
            }, bulkInterval).unref(),
        );

        this.timers.push(
            setInterval(() => {
                this.clientMetricsStoreV2.clearMetrics(48).catch(console.error);
            }, hoursToMilliseconds(12)).unref(),
        );
    }

    async filterValidToggleNames(toggleNames: string[]): Promise<string[]> {
        const nameValidations: Promise<
            PromiseFulfilledResult<{ name: string }> | PromiseRejectedResult
        >[] = toggleNames.map((toggleName) =>
            nameSchema.validateAsync({ name: toggleName }),
        );
        const badNames = (await Promise.allSettled(nameValidations)).filter(
            (r) => r.status === 'rejected',
        );
        if (badNames.length > 0) {
            this.logger.warn(
                `Got a few toggles with invalid names: ${JSON.stringify(
                    badNames,
                )}`,
            );

            if (this.flagResolver.isEnabled('filterInvalidClientMetrics')) {
                const justNames = badNames.map(
                    (r: PromiseRejectedResult) => r.reason._original.name,
                );
                return toggleNames.filter((name) => !justNames.includes(name));
            }
        }
        return toggleNames;
    }

    async registerBulkMetrics(metrics: IClientMetricsEnv[]): Promise<void> {
        this.unsavedMetrics = collapseHourlyMetrics([
            ...this.unsavedMetrics,
            ...metrics,
        ]);
        this.lastSeenService.updateLastSeen(metrics);
    }

    async registerClientMetrics(
        data: ClientMetricsSchema,
        clientIp: string,
    ): Promise<void> {
        const value = await clientMetricsSchema.validateAsync(data);
        const toggleNames = Object.keys(value.bucket.toggles).filter(
            (name) =>
                !(
                    value.bucket.toggles[name].yes === 0 &&
                    value.bucket.toggles[name].no === 0
                ),
        );

        const validatedToggleNames = await this.filterValidToggleNames(
            toggleNames,
        );

        this.logger.debug(
            `Got ${toggleNames.length} (${validatedToggleNames.length} valid) metrics from ${clientIp}`,
        );

        if (validatedToggleNames.length > 0) {
            const clientMetrics: IClientMetricsEnv[] = validatedToggleNames.map(
                (name) => ({
                    featureName: name,
                    appName: value.appName,
                    environment: value.environment ?? 'default',
                    timestamp: value.bucket.start, //we might need to approximate between start/stop...
                    yes: value.bucket.toggles[name].yes ?? 0,
                    no: value.bucket.toggles[name].no ?? 0,
                    variants: value.bucket.toggles[name].variants,
                }),
            );
            await this.registerBulkMetrics(clientMetrics);

            this.config.eventBus.emit(CLIENT_METRICS, value);
        }
    }

    async bulkAdd(): Promise<void> {
        if (this.unsavedMetrics.length > 0) {
            // Make a copy of `unsavedMetrics` in case new metrics
            // arrive while awaiting `batchInsertMetrics`.
            const copy = [...this.unsavedMetrics];
            this.unsavedMetrics = [];
            await this.clientMetricsStoreV2.batchInsertMetrics(copy);
        }
    }

    // Overview over usage last "hour" bucket and all applications using the toggle
    async getFeatureToggleMetricsSummary(
        featureName: string,
    ): Promise<ToggleMetricsSummary> {
        const metrics =
            await this.clientMetricsStoreV2.getMetricsForFeatureToggle(
                featureName,
                1,
            );
        const seenApplications =
            await this.clientMetricsStoreV2.getSeenAppsForFeatureToggle(
                featureName,
            );

        const groupedMetrics = metrics.reduce((prev, curr) => {
            if (prev[curr.environment]) {
                prev[curr.environment].yes += curr.yes;
                prev[curr.environment].no += curr.no;
            } else {
                prev[curr.environment] = {
                    environment: curr.environment,
                    timestamp: curr.timestamp,
                    yes: curr.yes,
                    no: curr.no,
                };
            }
            return prev;
        }, {});

        return {
            featureName,
            lastHourUsage: Object.values(groupedMetrics),
            seenApplications,
        };
    }

    async getClientMetricsForToggle(
        featureName: string,
        hoursBack: number = 24,
    ): Promise<IClientMetricsEnv[]> {
        const metrics =
            await this.clientMetricsStoreV2.getMetricsForFeatureToggle(
                featureName,
                hoursBack,
            );

        const hours = generateHourBuckets(hoursBack);

        const environments = [...new Set(metrics.map((x) => x.environment))];

        const applications = [...new Set(metrics.map((x) => x.appName))].slice(
            0,
            100,
        );

        const result = environments.flatMap((environment) => {
            const environmentMetrics = metrics.filter(
                (metric) => metric.environment === environment,
            );
            return applications.flatMap((appName) => {
                const applicationMetrics = environmentMetrics.filter(
                    (metric) => metric.appName === appName,
                );
                return hours.flatMap((hourBucket) => {
                    const metric = applicationMetrics.find(
                        (item) =>
                            compareAsc(hourBucket.timestamp, item.timestamp) ===
                            0,
                    );
                    return (
                        metric || {
                            timestamp: hourBucket.timestamp,
                            no: 0,
                            yes: 0,
                            appName,
                            environment,
                            featureName,
                        }
                    );
                });
            });
        });
        return result.sort((a, b) => compareAsc(a.timestamp, b.timestamp));
    }

    resolveMetricsEnvironment(
        user: User | ApiUser,
        data: { environment?: string },
    ): string {
        if (user instanceof ApiUser) {
            if (user.environment !== ALL) {
                return user.environment;
            } else if (user.environment === ALL && data.environment) {
                return data.environment;
            }
        }
        return 'default';
    }

    destroy(): void {
        this.timers.forEach(clearInterval);
        this.lastSeenService.destroy();
    }
}
