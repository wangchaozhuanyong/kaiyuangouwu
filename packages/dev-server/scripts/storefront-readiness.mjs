import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testContentPattern = /(?:^|[-_\s])(demo|dummy|test|crud)(?:$|[-_\s])|测试|临时演示/iu;
const placeholderShippingLabels = new Set([
    'standard-shipping',
    'standard shipping',
    'standard delivery',
    '标准配送',
]);

function normalizedText(values) {
    return values
        .filter(value => value != null)
        .map(String)
        .join(' ');
}

function isPublicHostname(value) {
    const hostname = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\.$/, '');
    if (!hostname || !hostname.includes('.')) return false;
    if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname === '0.0.0.0' ||
        hostname === '127.0.0.1' ||
        hostname === '::1'
    ) {
        return false;
    }
    return true;
}

export function isAllowedAuditOrigin(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    const isLocal =
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '::1' ||
        url.hostname.endsWith('.localhost');
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLocal);
}

export function parseTaxPolicy(value) {
    if (!value?.trim()) return {};
    const parsed = JSON.parse(value);
    assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'Tax policy must be an object');
    for (const [channelCode, policy] of Object.entries(parsed)) {
        assert.ok(
            policy && typeof policy === 'object' && typeof policy.pricesIncludeTax === 'boolean',
            `Tax policy for ${String(channelCode)} must define pricesIncludeTax as a boolean`,
        );
        if (policy.rates !== undefined) {
            assert.ok(
                policy.rates && typeof policy.rates === 'object' && !Array.isArray(policy.rates),
                `Tax policy rates for ${String(channelCode)} must be an object`,
            );
            for (const [category, rateValue] of Object.entries(policy.rates)) {
                assert.ok(category.trim(), `Tax category for ${String(channelCode)} cannot be empty`);
                assert.ok(
                    typeof rateValue === 'number' &&
                        Number.isFinite(rateValue) &&
                        rateValue >= 0 &&
                        rateValue <= 100,
                    `Tax rate for ${String(channelCode)}/${String(category)} must be between 0 and 100`,
                );
            }
        }
    }
    return parsed;
}

function pushCheck(checks, { id, scope = 'global', title, passed, detail, unresolved = false }) {
    checks.push({
        id,
        scope,
        title,
        status: passed ? 'pass' : unresolved ? 'manual' : 'blocker',
        detail,
    });
}

function translationLanguages(translations) {
    return new Set((translations ?? []).map(translation => translation.languageCode));
}

function missingBilingualItems(products) {
    const missing = [];
    for (const product of products) {
        const productLanguages = translationLanguages(product.translations);
        if (!productLanguages.has('en') || !productLanguages.has('zh_Hans')) {
            missing.push(`${String(product.id)}:${String(product.name)}`);
        }
        for (const variant of product.variants ?? []) {
            const variantLanguages = translationLanguages(variant.translations);
            if (!variantLanguages.has('en') || !variantLanguages.has('zh_Hans')) {
                missing.push(`${String(variant.sku)} (variant)`);
            }
        }
    }
    return missing;
}

function demoProducts(products) {
    return products.filter(product => {
        const variantText = (product.variants ?? []).flatMap(variant => [variant.sku, variant.name]);
        const text = normalizedText([product.name, product.description, ...variantText]);
        return (
            (product.variants ?? []).some(variant => String(variant.sku).startsWith('DEMO-')) ||
            testContentPattern.test(text)
        );
    });
}

function demoContentBlocks(blocks) {
    return blocks.filter(block => {
        const translationText = (block.translations ?? []).flatMap(translation => [
            translation.title,
            translation.subtitle,
            translation.body,
            translation.ctaLabel,
        ]);
        const itemText = (block.items ?? []).flatMap(item =>
            (item.translations ?? []).flatMap(translation => [translation.label, translation.description]),
        );
        return testContentPattern.test(normalizedText([block.code, ...translationText, ...itemText]));
    });
}

function isPlaceholderShippingMethod(method) {
    return [method.code, method.name]
        .map(value =>
            String(value ?? '')
                .trim()
                .toLowerCase(),
        )
        .some(value => placeholderShippingLabels.has(value) || testContentPattern.test(value));
}

function incompleteProducts(products, currencyCode) {
    return products.filter(product => {
        if (!product.enabled || !product.featuredAsset?.id) return true;
        if (!(product.variants ?? []).length) return true;
        return product.variants.some(variant => {
            const fulfillmentType = variant.customFields?.fulfillmentType;
            return (
                !variant.enabled ||
                !variant.sku?.trim() ||
                variant.price <= 0 ||
                variant.currencyCode !== currencyCode ||
                !['physical', 'digital'].includes(fulfillmentType)
            );
        });
    });
}

export function evaluateStorefrontReadiness(snapshot, taxPolicy = {}) {
    const checks = [];
    const channelByCode = new Map((snapshot.channels ?? []).map(channel => [channel.code, channel]));
    const storefrontChannelCodes = snapshot.storefrontChannelCodes ?? [...channelByCode.keys()];

    pushCheck(checks, {
        id: 'domain-routing-mode',
        title: '生产域名路由模式',
        passed: snapshot.configuration?.routingMode === 'require-domain',
        detail: `routingMode=${String(snapshot.configuration?.routingMode ?? 'missing')}`,
    });
    pushCheck(checks, {
        id: 'public-cname-target',
        title: '公开 CNAME 目标',
        passed: isPublicHostname(snapshot.configuration?.cnameTarget),
        detail: `cnameTarget=${String(snapshot.configuration?.cnameTarget ?? 'missing')}`,
    });
    pushCheck(checks, {
        id: 'demo-assets',
        title: '临时商品资源已清理',
        passed: snapshot.demoAssetCount === 0,
        detail: `${Number(snapshot.demoAssetCount ?? 0)} assets tagged storefront-demo`,
    });
    pushCheck(checks, {
        id: 'search-index-queue',
        title: '搜索索引队列已清空',
        passed: snapshot.pendingSearchIndexUpdates === 0 && snapshot.activeSearchIndexJobs === 0,
        detail: `buffered=${Number(snapshot.pendingSearchIndexUpdates ?? 0)}, queued=${Number(
            snapshot.activeSearchIndexJobs ?? 0,
        )}`,
    });
    const missingStorefrontChannels = storefrontChannelCodes.filter(code => !channelByCode.has(code));
    pushCheck(checks, {
        id: 'storefront-channels',
        title: '独立站店铺渠道',
        passed: storefrontChannelCodes.length > 0 && missingStorefrontChannels.length === 0,
        detail: missingStorefrontChannels.length
            ? `missing: ${missingStorefrontChannels.join(', ')}`
            : `${String(storefrontChannelCodes.length)} operational storefronts`,
    });

    for (const channelCode of storefrontChannelCodes) {
        const channel = channelByCode.get(channelCode);
        pushCheck(checks, {
            id: `channel-${channelCode}`,
            scope: channelCode,
            title: '店铺 Channel 存在',
            passed: Boolean(channel),
            detail: channel ? `channelId=${String(channel.id)}` : `Missing ${channelCode}`,
        });
        if (!channel) continue;

        const availableLanguageCodes = new Set(channel.availableLanguageCodes ?? []);
        const availableCurrencyCodes = new Set(channel.availableCurrencyCodes ?? []);
        pushCheck(checks, {
            id: `locale-${channelCode}`,
            scope: channelCode,
            title: '默认语言与币种已配置',
            passed:
                Boolean(channel.defaultLanguageCode && channel.defaultCurrencyCode) &&
                (!availableLanguageCodes.size || availableLanguageCodes.has(channel.defaultLanguageCode)) &&
                (!availableCurrencyCodes.size || availableCurrencyCodes.has(channel.defaultCurrencyCode)),
            detail: `${String(channel.defaultLanguageCode)}/${String(channel.defaultCurrencyCode)}`,
        });

        const taxMemberCodes = new Set(
            (channel.defaultTaxZone?.members ?? []).map(member => String(member.code).toUpperCase()),
        );
        pushCheck(checks, {
            id: `tax-zone-${channelCode}`,
            scope: channelCode,
            title: '默认税区已配置',
            passed: Boolean(channel.defaultTaxZone?.id) && taxMemberCodes.size > 0,
            detail: `${String(channel.defaultTaxZone?.name ?? 'missing')} [${[...taxMemberCodes].join(
                ', ',
            )}]`,
        });

        const shippingMemberCodes = new Set(
            (channel.defaultShippingZone?.members ?? []).map(member => String(member.code).toUpperCase()),
        );
        pushCheck(checks, {
            id: `shipping-zone-${channelCode}`,
            scope: channelCode,
            title: '默认配送区已配置',
            passed: Boolean(channel.defaultShippingZone?.id) && shippingMemberCodes.size > 0,
            detail: `${String(channel.defaultShippingZone?.name ?? 'missing')} [${[
                ...shippingMemberCodes,
            ].join(', ')}]`,
        });

        const approvedTaxMode = taxPolicy[channelCode]?.pricesIncludeTax;
        pushCheck(checks, {
            id: `tax-mode-${channelCode}`,
            scope: channelCode,
            title: '价格含税规则已批准',
            passed: typeof approvedTaxMode === 'boolean' && approvedTaxMode === channel.pricesIncludeTax,
            unresolved: typeof approvedTaxMode !== 'boolean',
            detail:
                typeof approvedTaxMode === 'boolean'
                    ? `configured=${String(channel.pricesIncludeTax)}, approved=${String(approvedTaxMode)}`
                    : `configured=${String(channel.pricesIncludeTax)}, no approved policy supplied`,
        });

        const enabledDefaultZoneRates = (channel.taxRates ?? []).filter(
            rate => rate.enabled && String(rate.zone?.id) === String(channel.defaultTaxZone?.id),
        );
        const usedTaxCategories = new Map();
        for (const product of channel.products ?? []) {
            for (const variant of product.variants ?? []) {
                if (variant.taxCategory?.id) {
                    usedTaxCategories.set(String(variant.taxCategory.id), variant.taxCategory.name);
                }
            }
        }
        const missingTaxCategories = [...usedTaxCategories.entries()].filter(
            ([categoryId]) =>
                !enabledDefaultZoneRates.some(
                    rate => String(rate.category?.id) === categoryId && !rate.customerGroup,
                ),
        );
        pushCheck(checks, {
            id: `tax-rate-coverage-${channelCode}`,
            scope: channelCode,
            title: '在售商品税类已有默认税率',
            passed: usedTaxCategories.size > 0 && missingTaxCategories.length === 0,
            detail: missingTaxCategories.length
                ? `missing: ${missingTaxCategories.map(([, name]) => String(name)).join(', ')}`
                : `${String(usedTaxCategories.size)} categories covered`,
        });

        const approvedRates = taxPolicy[channelCode]?.rates;
        const taxRatesApproved =
            approvedRates &&
            Object.entries(approvedRates).every(([categoryName, approvedValue]) =>
                enabledDefaultZoneRates.some(
                    rate =>
                        !rate.customerGroup &&
                        rate.category?.name === categoryName &&
                        rate.value === approvedValue,
                ),
            );
        pushCheck(checks, {
            id: `tax-rates-approved-${channelCode}`,
            scope: channelCode,
            title: '税率数值已批准',
            passed: Boolean(taxRatesApproved),
            unresolved: !approvedRates,
            detail: approvedRates
                ? Object.entries(approvedRates)
                      .map(([category, value]) => `${String(category)}=${String(value)}%`)
                      .join(', ')
                : 'no approved category rates supplied',
        });

        const activePrimaryDomains = (channel.domains ?? []).filter(
            domain => domain.isPrimary && domain.status === 'ACTIVE' && isPublicHostname(domain.domain),
        );
        pushCheck(checks, {
            id: `primary-domain-${channelCode}`,
            scope: channelCode,
            title: '已验证的公开主域名',
            passed: activePrimaryDomains.length === 1,
            detail: `${String(activePrimaryDomains.length)} active public primary domains`,
        });

        const enabledPayments = (channel.paymentMethods ?? []).filter(method => method.enabled);
        const testPayments = enabledPayments.filter(method =>
            testContentPattern.test(
                normalizedText([method.code, method.name, method.description, method.handler?.code]),
            ),
        );
        pushCheck(checks, {
            id: `payments-${channelCode}`,
            scope: channelCode,
            title: '真实支付方式',
            passed: enabledPayments.length > 0 && testPayments.length === 0,
            detail: testPayments.length
                ? `test methods: ${String(testPayments.map(method => String(method.code)).join(', '))}`
                : `${String(enabledPayments.length)} enabled methods`,
        });

        const testShippingMethods = (channel.shippingMethods ?? []).filter(method =>
            isPlaceholderShippingMethod(method),
        );
        pushCheck(checks, {
            id: `shipping-methods-${channelCode}`,
            scope: channelCode,
            title: '真实配送方式',
            passed: (channel.shippingMethods ?? []).length > 0 && testShippingMethods.length === 0,
            detail: testShippingMethods.length
                ? `test methods: ${String(testShippingMethods.map(method => String(method.code)).join(', '))}`
                : `${String((channel.shippingMethods ?? []).length)} assigned methods`,
        });

        const products = channel.products ?? [];
        const temporaryProducts = demoProducts(products);
        pushCheck(checks, {
            id: `products-real-${channelCode}`,
            scope: channelCode,
            title: '真实商品内容',
            passed: products.length > 0 && temporaryProducts.length === 0,
            detail: temporaryProducts.length
                ? `${String(temporaryProducts.length)} demo products`
                : `${String(products.length)} products`,
        });

        const missingTranslations = missingBilingualItems(products);
        pushCheck(checks, {
            id: `products-bilingual-${channelCode}`,
            scope: channelCode,
            title: '商品与规格中英文完整',
            passed: products.length > 0 && missingTranslations.length === 0,
            detail: missingTranslations.length
                ? `missing translations: ${missingTranslations.slice(0, 5).join(', ')}`
                : `${String(products.length)} products checked`,
        });

        const incomplete = incompleteProducts(products, channel.defaultCurrencyCode);
        pushCheck(checks, {
            id: `products-publishable-${channelCode}`,
            scope: channelCode,
            title: '商品图片、价格和交付类型完整',
            passed: products.length > 0 && incomplete.length === 0,
            detail: incomplete.length
                ? `${String(incomplete.length)} incomplete products`
                : `${String(products.length)} checked`,
        });

        const temporaryBlocks = demoContentBlocks(channel.contentBlocks ?? []);
        pushCheck(checks, {
            id: `content-real-${channelCode}`,
            scope: channelCode,
            title: '首页与政策内容已替换',
            passed: (channel.contentBlocks ?? []).length > 0 && temporaryBlocks.length === 0,
            detail: temporaryBlocks.length
                ? `demo blocks: ${String(temporaryBlocks.map(block => String(block.code)).join(', '))}`
                : `${String((channel.contentBlocks ?? []).length)} content blocks`,
        });

        const availableCountryCodes = new Set(channel.availableCountryCodes ?? []);
        pushCheck(checks, {
            id: `global-country-availability-${channelCode}`,
            scope: channelCode,
            title: '独立站可用国家或地区',
            passed: availableCountryCodes.size > 1,
            detail: `${String(availableCountryCodes.size)} enabled countries or regions`,
        });

        const physicalVariants = products
            .flatMap(product => product.variants ?? [])
            .filter(variant => variant.customFields?.fulfillmentType === 'physical');
        const restrictedShippingMethods = (channel.shippingMethods ?? []).filter(method => {
            if (method.checker?.code !== 'supported-destination-eligibility-checker') return false;
            const allowed = method.checker.args?.find(arg => arg.name === 'allowedCountryCodes')?.value ?? '';
            const allowedCodes = new Set(
                String(allowed)
                    .split(/[\s,;]+/u)
                    .map(code => code.trim().toUpperCase())
                    .filter(Boolean),
            );
            return (
                allowedCodes.size > 0 &&
                [...availableCountryCodes].some(code => !allowedCodes.has(String(code).toUpperCase()))
            );
        });
        pushCheck(checks, {
            id: `global-physical-shipping-${channelCode}`,
            scope: channelCode,
            title: '全球实物配送范围',
            passed: physicalVariants.length === 0 || restrictedShippingMethods.length === 0,
            detail:
                physicalVariants.length === 0
                    ? 'digital-only catalog; shipping restrictions do not limit sales'
                    : restrictedShippingMethods.length
                      ? `restricted methods: ${restrictedShippingMethods.map(method => method.code).join(', ')}`
                      : `${String(physicalVariants.length)} physical variants with global coverage`,
        });
    }

    const summary = {
        pass: checks.filter(check => check.status === 'pass').length,
        manual: checks.filter(check => check.status === 'manual').length,
        blocker: checks.filter(check => check.status === 'blocker').length,
    };
    return { ready: summary.blocker === 0 && summary.manual === 0, summary, checks };
}

function requestHeaders(authToken, channelToken) {
    return {
        authorization: `Bearer ${String(authToken)}`,
        'vendure-token': channelToken,
        'language-code': 'en',
    };
}

async function graphql(fetchImpl, apiOrigin, query, variables, headers = {}) {
    const response = await fetchImpl(`${String(apiOrigin)}/admin-api`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ query, variables }),
    });
    const rawBody = await response.text();
    let body;
    try {
        body = JSON.parse(rawBody);
    } catch {
        throw new Error(
            `Admin API returned ${String(response.status)} ${String(
                response.headers.get('content-type') ?? 'unknown content type',
            )} instead of GraphQL JSON at ${String(apiOrigin)}/admin-api`,
        );
    }
    if (!response.ok || body.errors?.length || !body.data) {
        throw new Error(
            body.errors?.map(error => error.message).join('; ') || `HTTP ${String(response.status)}`,
        );
    }
    return { data: body.data, response };
}

async function fetchProducts(fetchImpl, apiOrigin, authToken, channelToken) {
    const items = [];
    const take = 100;
    let totalItems = 0;
    do {
        const result = await graphql(
            fetchImpl,
            apiOrigin,
            `
                query ReadinessProducts($options: ProductListOptions) {
                    products(options: $options) {
                        totalItems
                        items {
                            id
                            name
                            description
                            enabled
                            featuredAsset {
                                id
                            }
                            translations {
                                languageCode
                                name
                                slug
                                description
                            }
                            variants {
                                id
                                name
                                sku
                                enabled
                                price
                                currencyCode
                                trackInventory
                                taxCategory {
                                    id
                                    name
                                }
                                translations {
                                    languageCode
                                    name
                                }
                                customFields {
                                    fulfillmentType
                                }
                            }
                        }
                    }
                }
            `,
            { options: { take, skip: items.length, sort: { id: 'ASC' } } },
            requestHeaders(authToken, channelToken),
        );
        totalItems = result.data.products.totalItems;
        items.push(...result.data.products.items);
    } while (items.length < totalItems);
    return items;
}

export async function readStorefrontReadiness({ apiOrigin, username, password, fetchImpl = fetch }) {
    assert.ok(isAllowedAuditOrigin(apiOrigin), 'Audit API origin must use HTTPS, except for localhost HTTP');
    assert.ok(username && password, 'SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required');
    const normalizedOrigin = apiOrigin.replace(/\/$/, '');
    const login = await graphql(
        fetchImpl,
        normalizedOrigin,
        `
            mutation ReadinessLogin($username: String!, $password: String!) {
                login(username: $username, password: $password, rememberMe: false) {
                    ... on CurrentUser {
                        id
                        channels {
                            id
                            code
                            token
                        }
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        `,
        { username, password },
    );
    assert.equal(login.data.login.errorCode, undefined, login.data.login.message);
    const authToken = login.response.headers.get('vendure-auth-token') ?? '';
    assert.ok(authToken, 'Admin login did not return a bearer token');
    const loginChannels = new Map(login.data.login.channels.map(channel => [channel.code, channel]));
    const defaultChannel = loginChannels.get('__default_channel__') ?? login.data.login.channels[0];
    assert.ok(defaultChannel, 'No accessible Vendure Channel was returned');

    const globalResult = await graphql(
        fetchImpl,
        normalizedOrigin,
        `
            query ReadinessGlobal {
                channels(options: { take: 100 }) {
                    items {
                        id
                        code
                        defaultLanguageCode
                        availableLanguageCodes
                        defaultCurrencyCode
                        availableCurrencyCodes
                        pricesIncludeTax
                        defaultTaxZone {
                            id
                            name
                            members {
                                code
                                name
                            }
                        }
                        defaultShippingZone {
                            id
                            name
                            members {
                                code
                                name
                            }
                        }
                    }
                }
                storeProfiles {
                    status
                    isOperational
                    primaryDomain
                    channel {
                        id
                        code
                    }
                }
                storeDomainConfiguration {
                    cnameTarget
                    routingMode
                }
                assets(options: { take: 1, tags: ["storefront-demo"], tagsOperator: AND }) {
                    totalItems
                }
                pendingSearchIndexUpdates
                jobs(
                    options: {
                        take: 1
                        filter: {
                            queueName: { eq: "update-search-index" }
                            state: { in: ["PENDING", "RUNNING"] }
                        }
                    }
                ) {
                    totalItems
                }
            }
        `,
        undefined,
        requestHeaders(authToken, defaultChannel.token),
    );

    const storefrontChannelCodes = globalResult.data.storeProfiles
        .filter(
            profile =>
                profile.isOperational &&
                (profile.status === 'ACTIVE' || Boolean(profile.primaryDomain?.trim())),
        )
        .map(profile => profile.channel.code);
    const channels = [];
    for (const channelCode of storefrontChannelCodes) {
        const baseChannel = globalResult.data.channels.items.find(channel => channel.code === channelCode);
        const loginChannel = loginChannels.get(channelCode);
        if (!baseChannel || !loginChannel) continue;
        const result = await graphql(
            fetchImpl,
            normalizedOrigin,
            `
                query ReadinessChannel($channelId: ID!) {
                    paymentMethods(options: { take: 100 }) {
                        items {
                            code
                            name
                            description
                            enabled
                            handler {
                                code
                            }
                        }
                    }
                    shippingMethods(options: { take: 100 }) {
                        items {
                            code
                            name
                            description
                            fulfillmentHandlerCode
                            checker {
                                code
                                args {
                                    name
                                    value
                                }
                            }
                            calculator {
                                code
                            }
                        }
                    }
                    taxRates(options: { take: 100 }) {
                        items {
                            name
                            enabled
                            value
                            zone {
                                id
                                name
                            }
                            category {
                                id
                                name
                            }
                            customerGroup {
                                id
                            }
                        }
                    }
                    storefrontContentBlocks {
                        code
                        enabled
                        type
                        translations {
                            languageCode
                            title
                            subtitle
                            body
                            ctaLabel
                        }
                        items {
                            targetType
                            targetValue
                            translations {
                                languageCode
                                label
                                description
                            }
                        }
                    }
                    storeDomains(channelId: $channelId) {
                        domain
                        isPrimary
                        status
                    }
                    countries(options: { take: 300, filter: { enabled: { eq: true } } }) {
                        items {
                            code
                        }
                    }
                }
            `,
            { channelId: baseChannel.id },
            requestHeaders(authToken, loginChannel.token),
        );
        channels.push({
            ...baseChannel,
            domains: result.data.storeDomains,
            paymentMethods: result.data.paymentMethods.items,
            shippingMethods: result.data.shippingMethods.items,
            taxRates: result.data.taxRates.items,
            contentBlocks: result.data.storefrontContentBlocks,
            availableCountryCodes: result.data.countries.items.map(country => country.code),
            products: await fetchProducts(fetchImpl, normalizedOrigin, authToken, loginChannel.token),
        });
    }

    return {
        configuration: globalResult.data.storeDomainConfiguration,
        demoAssetCount: globalResult.data.assets.totalItems,
        pendingSearchIndexUpdates: globalResult.data.pendingSearchIndexUpdates,
        activeSearchIndexJobs: globalResult.data.jobs.totalItems,
        storefrontChannelCodes,
        channels,
    };
}

function formatReport(report) {
    const lines = [
        `Storefront production readiness: ${report.ready ? 'READY' : 'BLOCKED'}`,
        `pass=${String(report.summary.pass)} manual=${String(report.summary.manual)} blocker=${String(
            report.summary.blocker,
        )}`,
    ];
    for (const check of report.checks.filter(item => item.status !== 'pass')) {
        lines.push(
            `${String(check.status).toUpperCase()} [${String(check.scope)}] ${String(check.title)}: ${String(
                check.detail,
            )}`,
        );
    }
    return `${lines.join('\n')}\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    try {
        const apiOrigin = process.env.VENDURE_API_ORIGIN;
        assert.ok(apiOrigin, 'VENDURE_API_ORIGIN is required');
        const snapshot = await readStorefrontReadiness({
            apiOrigin,
            username: process.env.SUPERADMIN_USERNAME,
            password: process.env.SUPERADMIN_PASSWORD,
        });
        const report = evaluateStorefrontReadiness(
            snapshot,
            parseTaxPolicy(process.env.READINESS_TAX_POLICY_JSON),
        );
        process.stdout.write(
            process.argv.includes('--json')
                ? `${String(JSON.stringify(report, null, 2))}\n`
                : formatReport(report),
        );
        process.exitCode = report.ready ? 0 : 1;
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
