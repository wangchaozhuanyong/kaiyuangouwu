export interface AccountRecommendationSettings {
    enabled: boolean;
    titleZh: string;
    titleEn: string;
    limit: number;
}

export const defaultAccountRecommendationSettings: Readonly<AccountRecommendationSettings> = {
    enabled: true,
    titleZh: '专属推荐',
    titleEn: 'Selected for you',
    limit: 8,
};

export function accountRecommendationSettingsError(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') return '推荐设置不能为空';
    const settings = value as Record<string, unknown>;
    if (typeof settings.enabled !== 'boolean') return '推荐开关必须为布尔值';
    if (!Number.isInteger(settings.limit) || Number(settings.limit) < 1 || Number(settings.limit) > 10)
        return '展示数量请输入 1–10 的整数';
    for (const key of ['titleZh', 'titleEn']) {
        if (typeof settings[key] !== 'string' || !settings[key].trim() || settings[key].trim().length > 80)
            return '中英文标题均需填写，且不超过 80 个字符';
    }
    return undefined;
}

export function resolveAccountRecommendationSettings(value: unknown): AccountRecommendationSettings {
    if (accountRecommendationSettingsError(value)) return { ...defaultAccountRecommendationSettings };
    const settings = value as AccountRecommendationSettings;
    return {
        enabled: settings.enabled,
        titleZh: settings.titleZh.trim(),
        titleEn: settings.titleEn.trim(),
        limit: settings.limit,
    };
}

export function accountRecommendationSettingsEqual(
    a: AccountRecommendationSettings | null | undefined,
    b: AccountRecommendationSettings,
): boolean {
    return (
        !!a &&
        a.enabled === b.enabled &&
        a.limit === b.limit &&
        a.titleZh === b.titleZh &&
        a.titleEn === b.titleEn
    );
}
