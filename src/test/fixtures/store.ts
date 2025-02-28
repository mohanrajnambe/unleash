import FakeFeatureStrategiesStore from '../../lib/features/feature-toggle/fakes/fake-feature-strategies-store';
import FakeClientInstanceStore from './fake-client-instance-store';
import FakeClientApplicationsStore from './fake-client-applications-store';
import FakeFeatureToggleStore from '../../lib/features/feature-toggle/fakes/fake-feature-toggle-store';
import FakeTagStore from './fake-tag-store';
import FakeTagTypeStore from './fake-tag-type-store';
import FakeEventStore from './fake-event-store';
import FakeContextFieldStore from './fake-context-field-store';
import FakeSettingStore from './fake-setting-store';
import FakeAddonStore from './fake-addon-store';
import FakeProjectStore from './fake-project-store';
import FakeUserStore from './fake-user-store';
import FakeAccessStore from './fake-access-store';
import FakeUserFeedbackStore from './fake-user-feedback-store';
import FakeFeatureTagStore from './fake-feature-tag-store';
import FakeEnvironmentStore from './fake-environment-store';
import FakeStrategiesStore from './fake-strategies-store';
import {
    IImportTogglesStore,
    IPrivateProjectStore,
    IUnleashStores,
} from '../../lib/types';
import FakeSessionStore from './fake-session-store';
import FakeFeatureEnvironmentStore from './fake-feature-environment-store';
import FakeApiTokenStore from './fake-api-token-store';
import FakeFeatureTypeStore from './fake-feature-type-store';
import FakeResetTokenStore from './fake-reset-token-store';
import FakeClientFeatureToggleStore from '../../lib/features/client-feature-toggles/fakes/fake-client-feature-toggle-store';
import FakeClientMetricsStoreV2 from './fake-client-metrics-store-v2';
import FakeUserSplashStore from './fake-user-splash-store';
import FakeRoleStore from './fake-role-store';
import FakeSegmentStore from './fake-segment-store';
import FakeGroupStore from './fake-group-store';
import FakePatStore from './fake-pat-store';
import FakePublicSignupStore from './fake-public-signup-store';
import FakeFavoriteFeaturesStore from './fake-favorite-features-store';
import FakeFavoriteProjectsStore from './fake-favorite-projects-store';
import { FakeAccountStore } from './fake-account-store';
import FakeProjectStatsStore from './fake-project-stats-store';
import { FakeDependentFeaturesStore } from '../../lib/features/dependent-features/fake-dependent-features-store';

const db = {
    select: () => ({
        from: () => Promise.resolve(),
    }),
};

const createStores: () => IUnleashStores = () => {
    return {
        db,
        clientApplicationsStore: new FakeClientApplicationsStore(),
        clientMetricsStoreV2: new FakeClientMetricsStoreV2(),
        clientInstanceStore: new FakeClientInstanceStore(),
        featureToggleStore: new FakeFeatureToggleStore(),
        clientFeatureToggleStore: new FakeClientFeatureToggleStore(),
        tagStore: new FakeTagStore(),
        tagTypeStore: new FakeTagTypeStore(),
        eventStore: new FakeEventStore(),
        strategyStore: new FakeStrategiesStore(),
        contextFieldStore: new FakeContextFieldStore(),
        settingStore: new FakeSettingStore(),
        addonStore: new FakeAddonStore(),
        projectStore: new FakeProjectStore(),
        userStore: new FakeUserStore(),
        accessStore: new FakeAccessStore(),
        accountStore: new FakeAccountStore(),
        userFeedbackStore: new FakeUserFeedbackStore(),
        featureStrategiesStore: new FakeFeatureStrategiesStore(),
        featureTagStore: new FakeFeatureTagStore(),
        environmentStore: new FakeEnvironmentStore(),
        featureEnvironmentStore: new FakeFeatureEnvironmentStore(),
        apiTokenStore: new FakeApiTokenStore(),
        featureTypeStore: new FakeFeatureTypeStore(),
        resetTokenStore: new FakeResetTokenStore(),
        sessionStore: new FakeSessionStore(),
        userSplashStore: new FakeUserSplashStore(),
        roleStore: new FakeRoleStore(),
        segmentStore: new FakeSegmentStore(),
        groupStore: new FakeGroupStore(),
        patStore: new FakePatStore(),
        publicSignupTokenStore: new FakePublicSignupStore(),
        favoriteFeaturesStore: new FakeFavoriteFeaturesStore(),
        favoriteProjectsStore: new FakeFavoriteProjectsStore(),
        projectStatsStore: new FakeProjectStatsStore(),
        importTogglesStore: {} as IImportTogglesStore,
        privateProjectStore: {} as IPrivateProjectStore,
        dependentFeaturesStore: new FakeDependentFeaturesStore(),
        lastSeenStore: { setLastSeen: async () => {} },
    };
};

export default createStores;
