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
    title: count => `${count} 项英文内容待复核`,
    description: '中文内容已保存，人工维护的英文内容仍被保留。请切换到 English 检查并保存。',
    severity: 'warning',
    recheckInterval: 15_000,
};

defineDashboardExtension({
    alerts: [staleTranslationAlert],
});
