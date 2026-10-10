import type {
    StorefrontSeoAiCitation,
    StorefrontSeoMetric,
    StorefrontSeoPlatformBinding,
    StorefrontSeoSettings,
} from './storefront-seo.contract';

import { seoArray, seoDate, seoObject, seoText, seoUrl } from './storefront-seo.validation';

function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
    if (!choices.includes(value as T)) throw new Error(`${label}无效`);
    return value as T;
}
function uniqueIds<T extends { id: string }>(rows: T[], label: string): T[] {
    if (rows.some(row => !row.id) || new Set(rows.map(row => row.id)).size !== rows.length)
        throw new Error(`${label}身份为空或重复`);
    return rows;
}
function count(value: unknown, label: string, decimal = false): number | null {
    if (value == null || value === '') return null;
    if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        (!decimal && !Number.isSafeInteger(value))
    )
        throw new Error(`${label}必须是实际非负数值或空值`);
    return value;
}
function dateOnly(value: unknown, label: string): string {
    const text = seoText(value, 10, label);
    const date = seoDate(text, label);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || date?.slice(0, 10) !== text) throw new Error(`${label}无效`);
    return text;
}
export function validateSeoEvidence(
    raw: Record<string, unknown>,
): Pick<StorefrontSeoSettings, 'platformBindings' | 'metrics' | 'aiCitations'> {
    const platformBindings: StorefrontSeoPlatformBinding[] = seoArray(
        raw.platformBindings,
        20,
        '平台绑定',
    ).map(entry => {
        const value = seoObject(entry, ['platform', 'property', 'status', 'verifiedAt', 'note']);
        const property = seoText(value.property, 500, '平台属性');
        if (!property || /(?:bearer\s|-----BEGIN|password=|access_token|client_secret)/iu.test(property))
            throw new Error('平台属性不得包含凭据');
        const status = choice(value.status, ['UNVERIFIED', 'VERIFIED'], '绑定状态');
        const verifiedAt = seoDate(value.verifiedAt, '验证日期');
        if (status === 'VERIFIED' && !verifiedAt) throw new Error('已验证绑定需要实际验证日期');
        return {
            platform: choice(value.platform, ['GSC', 'BING', 'GA4', 'MERCHANT_CENTER'], '平台'),
            property,
            status,
            verifiedAt,
            note: seoText(value.note, 500, '绑定说明'),
        };
    });
    if (
        new Set(platformBindings.map(binding => `${binding.platform}:${binding.property}`)).size !==
        platformBindings.length
    )
        throw new Error('平台绑定重复');
    const metrics: StorefrontSeoMetric[] = uniqueIds(
        seoArray(raw.metrics, 250, '指标记录').map(entry => {
            const value = seoObject(entry, [
                'id',
                'source',
                'property',
                'dateFrom',
                'dateTo',
                'url',
                'languageCode',
                'country',
                'device',
                'status',
                'impressions',
                'clicks',
                'sessions',
                'orders',
                'revenue',
                'currencyCode',
                'importedAt',
                'evidenceUrl',
            ]);
            const dateFrom = dateOnly(value.dateFrom, '开始日期');
            const dateTo = dateOnly(value.dateTo, '结束日期');
            if (dateFrom > dateTo) throw new Error('指标时间范围倒置');
            const status = choice(
                value.status,
                ['MEASURED', 'NO_ACCESS', 'DATA_MISSING', 'NOT_MEASURED'],
                '指标状态',
            );
            const values = {
                impressions: count(value.impressions, '展示'),
                clicks: count(value.clicks, '点击'),
                sessions: count(value.sessions, '访问'),
                orders: count(value.orders, '订单'),
                revenue: count(value.revenue, '收入', true),
            };
            if (status !== 'MEASURED' && Object.values(values).some(metric => metric != null))
                throw new Error('未取得真实数据的指标必须为空，不能填写零值');
            if (status === 'MEASURED' && Object.values(values).every(metric => metric == null))
                throw new Error('已测量记录至少需要一项实际指标');
            const currencyCode = seoText(value.currencyCode, 8, '收入币种');
            if (values.revenue != null && !/^[A-Z]{3,8}$/u.test(currencyCode))
                throw new Error('收入需要真实币种');
            const source = choice(value.source, ['GSC', 'GOOGLE_AI', 'GA4', 'BING', 'MANUAL'], '指标来源');
            if (
                source === 'GOOGLE_AI' &&
                [values.clicks, values.sessions, values.orders, values.revenue].some(metric => metric != null)
            )
                throw new Error('Google AI 报告只导入实际展示量，点击、访问、订单与收入应为空');
            const property = seoText(value.property, 500, '指标属性');
            const evidenceUrl = seoUrl(value.evidenceUrl, '指标证据');
            if (status === 'MEASURED' && !property && !evidenceUrl)
                throw new Error('实际指标需要属性标识或证据来源');
            return {
                id: seoText(value.id, 100, '指标身份'),
                source,
                property,
                dateFrom,
                dateTo,
                url: seoUrl(value.url, '指标页面'),
                languageCode: seoText(value.languageCode, 16, '指标语言'),
                country: seoText(value.country, 100, '指标国家'),
                device: seoText(value.device, 50, '指标设备'),
                status,
                ...values,
                currencyCode,
                importedAt: seoDate(value.importedAt, '导入日期') ?? new Date().toISOString(),
                evidenceUrl,
            };
        }),
        '指标',
    );
    const aiCitations: StorefrontSeoAiCitation[] = uniqueIds(
        seoArray(raw.aiCitations, 250, 'AI 样本').map(entry => {
            const value = seoObject(entry, [
                'id',
                'platform',
                'prompt',
                'url',
                'observedAt',
                'languageCode',
                'region',
                'kind',
                'evidenceUrl',
                'notes',
            ]);
            const url = seoUrl(value.url, '回答引用地址');
            const observedAt = seoDate(value.observedAt, '样本时间');
            const platform = seoText(value.platform, 100, 'AI 平台');
            const prompt = seoText(value.prompt, 3000, '样本问题');
            const kind = choice(value.kind, ['CITATION', 'MENTION'], '样本类型');
            const evidenceUrl = seoUrl(value.evidenceUrl, '样本证据');
            if (!observedAt || !platform || !prompt || !evidenceUrl || (kind === 'CITATION' && !url))
                throw new Error('AI 样本需要平台、问题、实际时间与证据地址；引用样本还需要引用地址');
            return {
                id: seoText(value.id, 100, '样本身份'),
                platform,
                prompt,
                url,
                observedAt,
                languageCode: seoText(value.languageCode, 16, '样本语言'),
                region: seoText(value.region, 100, '样本地区'),
                kind,
                evidenceUrl,
                notes: seoText(value.notes, 1000, '样本说明'),
            };
        }),
        'AI 样本',
    );
    return { platformBindings, metrics, aiCitations };
}
