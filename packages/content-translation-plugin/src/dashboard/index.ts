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
    description:
        '中文内容已保存并自动翻译；之前人工修改过的英文不会被覆盖，因此已标记待复核。日常录入仍只需填写中文。',
    severity: 'warning',
    recheckInterval: 15_000,
};

defineDashboardExtension({
    alerts: [staleTranslationAlert],
});
