import {
    defaultStorefrontSeoDocument,
    defaultStorefrontSeoSettings,
    storefrontSeoLanguages,
    storefrontSeoPageKeys,
    storefrontSeoTargetTypes,
    type StorefrontSeoDocument,
    type StorefrontSeoIdentity,
    type StorefrontSeoPayload,
    type StorefrontSeoSettings,
} from './storefront-seo.contract';

export function seoObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是对象');
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some(key => !allowed.includes(key))) throw new Error('配置包含未支持的字段');
    return record;
}
export function seoText(value: unknown, max: number, label: string, fallback = ''): string {
    if (value === undefined) return fallback;
    if (
        typeof value !== 'string' ||
        value.length > max ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
    )
        throw new Error(`${label}格式或长度无效`);
    return value.trim();
}
export function seoDate(value: unknown, label: string): string | null {
    if (value == null || value === '') return null;
    const text = seoText(value, 40, label);
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/u.test(text) || !Number.isFinite(Date.parse(text)))
        throw new Error(`${label}无效`);
    return new Date(text).toISOString();
}
export function seoArray(value: unknown, max: number, label: string): unknown[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > max) throw new Error(`${label}数量无效`);
    return value;
}
export function seoUrl(value: unknown, label: string, image = false): string {
    const text = seoText(value, 2048, label);
    if (!text) return '';
    let url: URL;
    try {
        url = new URL(text, 'https://seo.invalid');
    } catch {
        throw new Error(`${label}地址无效`);
    }
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        /(?:token|api.?key|secret|password|cookie|code)/iu.test(url.search)
    )
        throw new Error(`${label}不允许凭据或非 HTTPS 地址`);
    if (url.hostname === 'seo.invalid' && (!image || !/^\/(assets|storefront)\//u.test(text)))
        throw new Error(`${label}必须是公开 HTTPS 地址`);
    if (image && text.startsWith('//')) throw new Error(`${label}地址无效`);
    return text;
}
function bool(value: unknown, fallback: boolean): boolean {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new Error('开关必须为布尔值');
    return value;
}
function flags<T extends Record<string, boolean>>(raw: unknown, defaults: T): T {
    const values = raw === undefined ? {} : seoObject(raw, Object.keys(defaults));
    return Object.fromEntries(
        Object.entries(defaults).map(([key, value]) => [key, bool(values[key], value)]),
    ) as T;
}
export function validateSeoIdentity(raw: StorefrontSeoIdentity): StorefrontSeoIdentity {
    if (!storefrontSeoTargetTypes.includes(raw.targetType)) throw new Error('搜索页面类型无效');
    const targetId = seoText(raw.targetId, 160, '页面身份');
    if (raw.targetType === 'SETTINGS') {
        if (targetId !== 'store' || raw.languageCode !== 'und') throw new Error('店铺设置身份无效');
    } else {
        if (!storefrontSeoLanguages.includes(raw.languageCode as 'en')) throw new Error('页面语言无效');
        if (raw.targetType === 'HOME' && targetId !== 'home') throw new Error('首页身份无效');
        if (raw.targetType === 'PAGE' && !storefrontSeoPageKeys.includes(targetId as 'services'))
            throw new Error('固定页面身份无效');
        if (['PRODUCT', 'COLLECTION'].includes(raw.targetType) && !/^[a-zA-Z0-9_-]{1,128}$/u.test(targetId))
            throw new Error('实体身份无效');
        if (raw.targetType === 'ARTICLE' && !/^[a-z0-9][a-z0-9-]{0,99}$/u.test(targetId))
            throw new Error('文章地址只允许 1–100 个小写字母、数字与连字符');
    }
    return { targetType: raw.targetType, targetId, languageCode: raw.languageCode };
}
function redirectPath(value: unknown, label: string, destination: boolean) {
    const text = seoText(value, 2048, label);
    if (
        !text.startsWith('/') ||
        text.startsWith('//') ||
        text.includes('\\') ||
        text.includes('#') ||
        /%(?:2f|5c)/iu.test(text)
    )
        throw new Error(`${label}必须为本站公开路径`);
    const url = new URL(text, 'https://seo.invalid');
    const pathname = decodeURIComponent(url.pathname).replace(/^\/(zh|en)(?=\/|$)/u, '') || '/';
    if (
        /^\/(?:admin|console|shop-api|admin-api|cart|account|orders?|payment|checkout|purchase|login|register|two-factor|mail-query|storefront)(?:\/|$)/u.test(
            pathname,
        )
    )
        throw new Error('不能重定向账户、交易、API 或私有工具');
    if (
        destination &&
        !/^(?:\/|\/(?:product|category|services|support|legal|promo)|\/guides\/[a-z0-9][a-z0-9-]{0,99})$/u.test(
            pathname,
        )
    )
        throw new Error('目标必须是公开内容路径');
    if (
        [...url.searchParams.keys()].some(
            key => !['id', 'collectionId', 'collection', 'child', 'page'].includes(key),
        )
    )
        throw new Error('重定向不允许追踪或私有参数');
    if (destination) {
        const keys = [...url.searchParams.keys()];
        if (new Set(keys).size !== keys.length) throw new Error('目标参数不能重复');
        const allowed =
            pathname === '/product' || pathname === '/legal'
                ? ['id']
                : pathname === '/category'
                  ? ['collectionId', 'collection', 'child', 'page']
                  : [];
        if (keys.some(key => !allowed.includes(key))) throw new Error('目标参数与公开页面不匹配');
        if (pathname === '/product' && !/^[a-zA-Z0-9_-]{1,128}$/u.test(url.searchParams.get('id') ?? ''))
            throw new Error('商品目标必须包含有效 id');
        if (pathname === '/legal' && !['terms', 'privacy'].includes(url.searchParams.get('id') ?? ''))
            throw new Error('法律页目标必须为 terms 或 privacy');
        if (pathname === '/category') {
            for (const key of ['collectionId', 'collection', 'child']) {
                if (
                    url.searchParams.has(key) &&
                    !/^[a-zA-Z0-9_-]{1,128}$/u.test(url.searchParams.get(key) ?? '')
                )
                    throw new Error('分类目标参数无效');
            }
            if (url.searchParams.has('page') && !/^[1-9]\d{0,6}$/u.test(url.searchParams.get('page') ?? ''))
                throw new Error('分类页码无效');
        }
    }
    url.searchParams.sort();
    return `${url.pathname}${url.search}`;
}
export function validateSeoRedirects(raw: unknown): StorefrontSeoSettings['redirects'] {
    const redirects = seoArray(raw, 100, '重定向').map(
        (entry): StorefrontSeoSettings['redirects'][number] => {
            const value = seoObject(entry, ['from', 'to', 'status']);
            const from = redirectPath(value.from, '原地址', false);
            const to = redirectPath(value.to, '目标地址', true);
            if (from === to || (value.status !== 301 && value.status !== 308))
                throw new Error('重定向不能指向自身且必须为 301/308');
            return { from, to, status: value.status };
        },
    );
    const paths = new Map(redirects.map(item => [item.from, item.to]));
    if (paths.size !== redirects.length) throw new Error('原地址重复');
    for (const item of redirects) {
        const visited = new Set<string>();
        let path: string | undefined = item.from;
        while (path) {
            if (visited.has(path)) throw new Error('重定向存在循环');
            visited.add(path);
            path = paths.get(path);
        }
    }
    return redirects;
}
export function validateSeoSettings(
    raw: unknown,
    evidence: Pick<StorefrontSeoSettings, 'platformBindings' | 'metrics' | 'aiCitations'>,
): StorefrontSeoSettings {
    const defaults = defaultStorefrontSeoSettings();
    const value = seoObject(raw, Object.keys(defaults));
    const enabledLanguages =
        value.enabledLanguages === undefined
            ? defaults.enabledLanguages
            : seoArray(value.enabledLanguages, 2, '语言');
    if (
        enabledLanguages.length < 1 ||
        enabledLanguages.some(language => !storefrontSeoLanguages.includes(language as 'en')) ||
        new Set(enabledLanguages).size !== enabledLanguages.length
    )
        throw new Error('启用语言无效');
    const template =
        value.titleTemplates === undefined ? {} : seoObject(value.titleTemplates, storefrontSeoLanguages);
    const descriptions =
        value.defaultDescriptions === undefined
            ? {}
            : seoObject(value.defaultDescriptions, storefrontSeoLanguages);
    const organization =
        value.organization === undefined
            ? {}
            : seoObject(value.organization, Object.keys(defaults.organization));
    const businessType = organization.businessType ?? 'Organization';
    if (businessType !== 'Organization' && businessType !== 'LocalBusiness') throw new Error('商家类型无效');
    const result: StorefrontSeoSettings = {
        indexingEnabled: bool(value.indexingEnabled, false),
        enabledLanguages: enabledLanguages as StorefrontSeoSettings['enabledLanguages'],
        titleTemplates: {
            zh_Hans: seoText(template.zh_Hans, 250, '中文标题模板', defaults.titleTemplates.zh_Hans),
            en: seoText(template.en, 250, '英文标题模板', defaults.titleTemplates.en),
        },
        defaultDescriptions: {
            zh_Hans: seoText(descriptions.zh_Hans, 600, '中文摘要'),
            en: seoText(descriptions.en, 600, '英文摘要'),
        },
        shareImageUrl: seoUrl(value.shareImageUrl, '分享图', true),
        searchCrawlers: flags(value.searchCrawlers, defaults.searchCrawlers),
        trainingCrawlers: flags(value.trainingCrawlers, defaults.trainingCrawlers),
        llmsEnabled: bool(value.llmsEnabled, false),
        organization: {
            businessType,
            sameAs: seoArray(organization.sameAs, 20, '外部资料链接').map(url => seoUrl(url, '外部资料链接')),
            publicAddress: seoText(organization.publicAddress, 500, '公开营业地址'),
            serviceAreas: seoArray(organization.serviceAreas, 30, '服务区域').map(area =>
                seoText(area, 160, '服务区域'),
            ),
            evidenceUrl: seoUrl(organization.evidenceUrl, '商家资料证据'),
            reviewedAt: seoDate(organization.reviewedAt, '审核日期'),
        },
        redirects: validateSeoRedirects(value.redirects),
        ...evidence,
    };
    for (const text of Object.values(result.titleTemplates)) {
        if (/\{(?!title\}|store\})[^}]*\}/u.test(text)) throw new Error('标题模板只支持 {title} 和 {store}');
    }
    return result;
}
export function validateSeoDocument(
    raw: unknown,
    identity: StorefrontSeoIdentity,
    publishing = false,
): StorefrontSeoDocument {
    const value = seoObject(raw, Object.keys(defaultStorefrontSeoDocument(identity.targetType)));
    const indexMode = value.indexMode ?? 'INHERIT';
    if (indexMode !== 'INHERIT' && indexMode !== 'INDEX' && indexMode !== 'NOINDEX')
        throw new Error('收录策略无效');
    let article: StorefrontSeoDocument['article'] = null;
    if (identity.targetType === 'ARTICLE') {
        const defaults = defaultStorefrontSeoDocument('ARTICLE').article;
        if (!defaults) throw new Error('文章默认配置不存在');
        const content = value.article == null ? {} : seoObject(value.article, Object.keys(defaults));
        article = {
            body: seoText(content.body, 60000, '文章正文'),
            summary: seoText(content.summary, 1000, '文章摘要'),
            authorName: seoText(content.authorName, 160, '作者'),
            reviewerName: seoText(content.reviewerName, 160, '审核人'),
            reviewedAt: seoDate(content.reviewedAt, '文章审核日期'),
            sources: seoArray(content.sources, 30, '内容来源').map(entry => {
                const source = seoObject(entry, ['label', 'url', 'accessedAt']);
                const url = seoUrl(source.url, '来源地址');
                if (!url) throw new Error('来源地址不能为空');
                return {
                    label: seoText(source.label, 200, '来源名称'),
                    url,
                    accessedAt: seoDate(source.accessedAt, '来源查阅日期'),
                };
            }),
            relatedProductIds: seoArray(content.relatedProductIds, 30, '相关商品').map(id =>
                seoText(id, 128, '商品身份'),
            ),
        };
        if (
            publishing &&
            (!article.body ||
                !article.authorName ||
                !article.reviewerName ||
                !article.reviewedAt ||
                !article.sources.length)
        )
            throw new Error('发布文章前请填写正文、作者、审核人与日期及可核查来源');
    } else if (value.article != null) throw new Error('此页面不能保存文章正文');
    const result: StorefrontSeoDocument = {
        title: seoText(value.title, 250, '标题'),
        description: seoText(value.description, 1000, '摘要'),
        shareTitle: seoText(value.shareTitle, 250, '分享标题'),
        shareDescription: seoText(value.shareDescription, 1000, '分享摘要'),
        shareImageUrl: seoUrl(value.shareImageUrl, '分享图', true),
        indexMode,
        article,
    };
    if (publishing && identity.targetType === 'ARTICLE' && !result.title)
        throw new Error('发布文章前请填写标题');
    return result;
}
export function validateSeoPayloadSize(value: StorefrontSeoPayload): void {
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 60000)
        throw new Error('搜索配置超过 60 KB 保存容量，请减少指标记录或文章内容');
}
