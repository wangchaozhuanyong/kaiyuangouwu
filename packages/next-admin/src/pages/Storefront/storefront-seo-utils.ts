import type {
    StorefrontSeoIdentity,
    StorefrontSeoMetric,
    StorefrontSeoPayload,
    StorefrontSeoSettings,
} from '../../../../store-management-plugin/src/seo/storefront-seo.contract';

export const SEO_TARGET_LABELS = {
    SETTINGS: '店铺设置',
    HOME: '首页',
    PRODUCT: '商品',
    COLLECTION: '分类',
    PAGE: '固定页面',
    ARTICLE: '知识文章',
} as const;
export function seoStatusLabel(status: string) {
    const labels: Record<string, string> = {
        MEASURED: '已测量',
        NO_ACCESS: '无访问权限 (NO_ACCESS)',
        DATA_MISSING: '数据缺失 (DATA_MISSING)',
        NOT_MEASURED: '尚未测量 (NOT_MEASURED)',
        ERROR: '错误',
        WARNING: '注意',
        INFO: '提示',
    };
    return labels[status] ?? '未知状态';
}
export const seoIdentityKey = (identity: StorefrontSeoIdentity) =>
    `${identity.targetType}:${identity.targetId}:${identity.languageCode}`;
export function seoPublicPath(identity: StorefrontSeoIdentity) {
    const prefix = identity.languageCode === 'en' ? '/en' : '/zh';
    if (identity.targetType === 'HOME') return `${prefix}/`;
    if (identity.targetType === 'PRODUCT')
        return `${prefix}/product?id=${encodeURIComponent(identity.targetId)}`;
    if (identity.targetType === 'COLLECTION')
        return `${prefix}/category?collectionId=${encodeURIComponent(identity.targetId)}`;
    if (identity.targetType === 'ARTICLE') return `${prefix}/guides/${encodeURIComponent(identity.targetId)}`;
    if (identity.targetType === 'PAGE' && ['terms', 'privacy'].includes(identity.targetId))
        return `${prefix}/legal?id=${identity.targetId}`;
    if (identity.targetType === 'PAGE') return `${prefix}/${identity.targetId}`;
    return `${prefix}/`;
}
export function seoDate(value: string | null | undefined) {
    return value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' }) : '未记录';
}
export function seoLocalDateTime(value: string | null | undefined) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const two = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}
export const lines = (value: string) => value.split(/\r?\n/u);
export function normalizeSeoDraft(value: StorefrontSeoPayload): StorefrontSeoPayload {
    const clean = (values: string[]) => values.map(item => item.trim()).filter(Boolean);
    if ('indexingEnabled' in value)
        return {
            ...value,
            organization: {
                ...value.organization,
                sameAs: clean(value.organization.sameAs),
                serviceAreas: clean(value.organization.serviceAreas),
            },
        };
    return {
        ...value,
        article: value.article
            ? { ...value.article, relatedProductIds: clean(value.article.relatedProductIds) }
            : null,
    };
}

/** CSV imports remain evidence from an operator, never live platform measurements. */
export function parseSeoMetricCsv(
    source: string,
    importedAt = new Date().toISOString(),
): StorefrontSeoMetric[] {
    const rows: string[][] = [];
    let row: string[] = [],
        cell = '',
        quoted = false;
    for (let index = 0; index < source.length; index++) {
        const character = source[index];
        if (character === '"') {
            if (quoted && source[index + 1] === '"') {
                cell += '"';
                index++;
            } else quoted = !quoted;
        } else if (!quoted && character === ',') {
            row.push(cell);
            cell = '';
        } else if (!quoted && (character === '\n' || character === '\r')) {
            if (character === '\r' && source[index + 1] === '\n') index++;
            row.push(cell);
            if (row.some(Boolean)) rows.push(row);
            row = [];
            cell = '';
        } else cell += character;
    }
    if (quoted) throw new Error('CSV 引号未闭合。');
    row.push(cell);
    if (row.some(Boolean)) rows.push(row);
    const header = rows.shift()?.map(item => item.replace(/^\uFEFF/u, '').trim()) ?? [];
    const required = ['source', 'property', 'dateFrom', 'dateTo', 'url', 'status', 'evidenceUrl'];
    for (const name of required) if (!header.includes(name)) throw new Error(`CSV 缺少列：${name}`);
    if (!rows.length) throw new Error('CSV 没有数据行。');
    if (rows.length > 250) throw new Error('一次最多导入 250 行。');
    return rows.map((values, index) => {
        if (values.length !== header.length) throw new Error(`第 ${index + 2} 行列数不符。`);
        const value = Object.fromEntries(header.map((name, position) => [name, values[position].trim()]));
        if (!['GSC', 'GOOGLE_AI', 'GA4', 'BING', 'MANUAL'].includes(value.source))
            throw new Error(`第 ${index + 2} 行来源不支持。`);
        if (!['MEASURED', 'NO_ACCESS', 'DATA_MISSING', 'NOT_MEASURED'].includes(value.status))
            throw new Error(`第 ${index + 2} 行状态不支持。`);
        const validDate = (date: string) =>
            /^\d{4}-\d{2}-\d{2}$/u.test(date) &&
            Number.isFinite(Date.parse(date)) &&
            new Date(date).toISOString().slice(0, 10) === date;
        if (!validDate(value.dateFrom) || !validDate(value.dateTo) || value.dateFrom > value.dateTo)
            throw new Error(`第 ${index + 2} 行日期范围无效。`);
        const number = (name: string) => {
            if (!value[name]) return null;
            const parsed = Number(value[name]);
            if (
                !Number.isFinite(parsed) ||
                parsed < 0 ||
                (name !== 'revenue' && !Number.isSafeInteger(parsed))
            )
                throw new Error(`第 ${index + 2} 行 ${name} 不是有效非负数字。`);
            if (value.status !== 'MEASURED') throw new Error(`第 ${index + 2} 行未测量状态不能填写指标。`);
            return parsed;
        };
        if (
            value.source === 'GOOGLE_AI' &&
            ['clicks', 'sessions', 'orders', 'revenue'].some(name => value[name])
        )
            throw new Error(`第 ${index + 2} 行 Google AI 报告仅记录实际展示量。`);
        if (
            value.status === 'MEASURED' &&
            ['impressions', 'clicks', 'sessions', 'orders', 'revenue'].every(name => !value[name])
        )
            throw new Error(`第 ${index + 2} 行已测量状态需要真实指标。`);
        if (value.revenue && !/^[A-Z]{3,8}$/u.test(value.currencyCode ?? ''))
            throw new Error(`第 ${index + 2} 行收入需要真实币种。`);
        if (!/^https:\/\//u.test(value.evidenceUrl))
            throw new Error(`第 ${index + 2} 行需要 HTTPS 证据地址。`);
        return {
            id: `manual-${importedAt}-${index}`,
            source: value.source as StorefrontSeoMetric['source'],
            property: value.property,
            dateFrom: value.dateFrom,
            dateTo: value.dateTo,
            url: value.url,
            status: value.status as StorefrontSeoMetric['status'],
            impressions: number('impressions'),
            clicks: number('clicks'),
            sessions: number('sessions'),
            orders: number('orders'),
            revenue: number('revenue'),
            currencyCode: value.currencyCode ?? '',
            languageCode: value.languageCode ?? '',
            country: value.country ?? '',
            device: value.device ?? '',
            importedAt,
            evidenceUrl: value.evidenceUrl,
        };
    });
}
export function seoEvidenceSummary(settings: StorefrontSeoSettings) {
    return {
        indexing: 'NOT_MEASURED',
        search: settings.metrics.length ? '人工导入，见证据与日期' : 'DATA_MISSING',
        platformAccess: settings.platformBindings.some(binding => binding.status === 'VERIFIED')
            ? '人工登记验证状态'
            : 'NO_ACCESS',
        aiCitations: settings.aiCitations.length ? '人工观测样本' : 'NOT_MEASURED',
    };
}
