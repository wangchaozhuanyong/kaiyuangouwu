import { api, DashboardAlertDefinition, defineDashboardExtension } from '@vendure/dashboard';
import { gql } from 'graphql-tag';

const contentTranslationStaleCountQuery = gql`
    query ContentTranslationStaleCount {
        contentTranslationStaleCount
    }
`;

const staleTranslationAlert: DashboardAlertDefinition<number> = {
    id: 'stale-content-translations',
    check: async () => {
        const result = await api.query(contentTranslationStaleCountQuery);
        return result.contentTranslationStaleCount;
    },
    shouldShow: count => count > 0,
    title: count => `${count} 项英文待同步或复核`,
    description: '中文已保存，英文在后台同步；人工锁定的译文会保留，需要管理员复核。',
    severity: 'warning',
    recheckInterval: 15_000,
};

defineDashboardExtension({
    alerts: [staleTranslationAlert],
});
