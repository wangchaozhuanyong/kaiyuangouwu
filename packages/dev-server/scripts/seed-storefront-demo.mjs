import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const productImageDirectory = path.resolve(scriptDirectory, '../../core/mock-data/assets');

export const demoProducts = [
    {
        sku: 'DEMO-TABLET-128',
        image: 'kelly-sikkema-685291-unsplash.jpg',
        fulfillmentType: 'physical',
        stockOnHand: 36,
        prices: { USD: 45900, CNY: 329900, MYR: 209900 },
        product: {
            en: {
                name: 'Slate 11 Portable Tablet',
                slug: 'slate-11-portable-tablet',
                description:
                    'Temporary demo product. An 11-inch tablet for reading, note-taking and focused desk work.',
            },
            zh: {
                name: 'Slate 11 便携工作平板',
                slug: 'slate-11-portable-tablet',
                description: '临时演示商品。11 英寸便携平板，适合阅读、记录与日常桌面工作。',
            },
        },
        variant: { en: '128 GB · Wi-Fi · Graphite', zh: '128 GB · Wi-Fi · 石墨灰' },
    },
    {
        sku: 'DEMO-MOUSE-SILENT',
        image: 'oscar-ivan-esquivel-arteaga-687447-unsplash.jpg',
        fulfillmentType: 'physical',
        stockOnHand: 84,
        prices: { USD: 2900, CNY: 19900, MYR: 12900 },
        product: {
            en: {
                name: 'Arc Mini Wireless Mouse',
                slug: 'arc-mini-wireless-mouse',
                description:
                    'Temporary demo product. A compact wireless mouse with quiet clicks for shared workspaces.',
            },
            zh: {
                name: 'Arc Mini 静音无线鼠标',
                slug: 'arc-mini-wireless-mouse',
                description: '临时演示商品。小巧便携的静音无线鼠标，适合办公室与共享空间。',
            },
        },
        variant: { en: 'Graphite · Quiet click', zh: '石墨灰 · 静音按键' },
    },
    {
        sku: 'DEMO-MONITOR-27-4K',
        image: 'daniel-korpai-1302051-unsplash.jpg',
        fulfillmentType: 'physical',
        stockOnHand: 22,
        prices: { USD: 28900, CNY: 209900, MYR: 129900 },
        product: {
            en: {
                name: 'ViewLine 27 4K Monitor',
                slug: 'viewline-27-4k-monitor',
                description:
                    'Temporary demo product. A 27-inch 4K display with an adjustable stand for detailed everyday work.',
            },
            zh: {
                name: 'ViewLine 27 英寸 4K 显示器',
                slug: 'viewline-27-4k-monitor',
                description: '临时演示商品。27 英寸 4K 显示器，配备可调节支架，适合精细办公任务。',
            },
        },
        variant: { en: '27 inch · 4K · Adjustable stand', zh: '27 英寸 · 4K · 可调节支架' },
    },
    {
        sku: 'DEMO-KEYBOARD-75',
        image: 'juan-gomez-674574-unsplash.jpg',
        fulfillmentType: 'physical',
        stockOnHand: 48,
        prices: { USD: 7900, CNY: 54900, MYR: 35900 },
        product: {
            en: {
                name: 'Keyline 75 Mechanical Keyboard',
                slug: 'keyline-75-mechanical-keyboard',
                description:
                    'Temporary demo product. A compact mechanical keyboard with a tactile layout for daily writing.',
            },
            zh: {
                name: 'Keyline 75 机械键盘',
                slug: 'keyline-75-mechanical-keyboard',
                description: '临时演示商品。紧凑的 75% 机械键盘，清晰段落感适合日常文字工作。',
            },
        },
        variant: { en: '75% layout · Tactile switch', zh: '75% 配列 · 段落轴' },
    },
    {
        sku: 'DEMO-DIGITAL-AI-STARTER',
        image: 'florian-olivo-1166419-unsplash.jpg',
        fulfillmentType: 'digital',
        stockOnHand: 0,
        prices: { USD: 1900, CNY: 9900, MYR: 5900 },
        product: {
            en: {
                name: 'AI Workflow Starter Course',
                slug: 'ai-workflow-starter-course',
                description:
                    'Temporary digital demo. A concise starter course covering practical research, writing, planning and review workflows.',
            },
            zh: {
                name: 'AI 工作效率入门课',
                slug: 'ai-workflow-starter-course',
                description: '临时数字商品。覆盖调研、写作、规划与复盘的实用 AI 工作流入门内容。',
            },
        },
        variant: { en: 'Digital download · Starter edition', zh: '数字下载 · 入门版' },
    },
    {
        sku: 'DEMO-DIGITAL-ECOMMERCE',
        image: 'kari-shea-398668-unsplash.jpg',
        fulfillmentType: 'digital',
        stockOnHand: 0,
        prices: { USD: 2900, CNY: 15900, MYR: 9900 },
        product: {
            en: {
                name: 'E-commerce Copywriting Toolkit',
                slug: 'ecommerce-copywriting-toolkit',
                description:
                    'Temporary digital demo. A reusable product-page structure and evidence checklist for e-commerce operations.',
            },
            zh: {
                name: '电商文案工具包',
                slug: 'ecommerce-copywriting-toolkit',
                description: '临时数字商品。包含可复用的商品详情页结构、卖点组织与证据检查清单。',
            },
        },
        variant: { en: 'Digital download · Toolkit', zh: '数字下载 · 工具包' },
    },
    {
        sku: 'DEMO-DIGITAL-PROMPTS',
        image: 'brandi-redd-104140-unsplash.jpg',
        fulfillmentType: 'digital',
        stockOnHand: 0,
        prices: { USD: 900, CNY: 4900, MYR: 2900 },
        product: {
            en: {
                name: 'Business Prompt Template Library',
                slug: 'business-prompt-template-library',
                description:
                    'Temporary digital demo. Structured prompt templates for common business writing and analysis tasks.',
            },
            zh: {
                name: '商务提示词模板库',
                slug: 'business-prompt-template-library',
                description: '临时数字商品。面向常见商务写作与分析任务的结构化提示词模板。',
            },
        },
        variant: { en: 'Digital download · Template pack', zh: '数字下载 · 模板包' },
    },
    {
        sku: 'DEMO-DIGITAL-SUPPORT',
        image: 'nik-shuliahin-619349-unsplash.jpg',
        fulfillmentType: 'digital',
        stockOnHand: 0,
        prices: { USD: 1200, CNY: 6900, MYR: 3900 },
        product: {
            en: {
                name: 'Customer Support Reply Library',
                slug: 'customer-support-reply-library',
                description:
                    'Temporary digital demo. Practical response structures for order, delivery and after-sales conversations.',
            },
            zh: {
                name: '客服回复模板库',
                slug: 'customer-support-reply-library',
                description: '临时数字商品。适用于订单、配送与售后沟通的客服回复结构和示例。',
            },
        },
        variant: { en: 'Digital download · Response pack', zh: '数字下载 · 回复模板包' },
    },
    {
        sku: 'DEMO-DIGITAL-VIDEO',
        image: 'jakob-owens-274337-unsplash.jpg',
        fulfillmentType: 'digital',
        stockOnHand: 0,
        prices: { USD: 1500, CNY: 7900, MYR: 4900 },
        product: {
            en: {
                name: 'Short Video Script Pack',
                slug: 'short-video-script-pack',
                description:
                    'Temporary digital demo. A concise script framework and production checklist for short-form video.',
            },
            zh: {
                name: '短视频脚本素材包',
                slug: 'short-video-script-pack',
                description: '临时数字商品。包含短视频脚本结构、画面证据与制作检查清单。',
            },
        },
        variant: { en: 'Digital download · Script pack', zh: '数字下载 · 脚本包' },
    },
];

export const demoCollections = [
    {
        channelCode: 'cn-mainland',
        code: 'cn-workstations',
        productSkus: ['DEMO-TABLET-128', 'DEMO-MONITOR-27-4K'],
        translations: [
            {
                languageCode: 'en',
                name: 'Workstations',
                slug: 'cn-workstations',
                description: 'Temporary category for workstation products in the mainland China store.',
            },
            {
                languageCode: 'zh_Hans',
                name: '桌面工作站',
                slug: 'cn-workstations',
                description: '中国大陆店铺的临时桌面工作商品分类。',
            },
        ],
    },
    {
        channelCode: 'cn-mainland',
        code: 'cn-office-input',
        productSkus: ['DEMO-MOUSE-SILENT', 'DEMO-KEYBOARD-75'],
        translations: [
            {
                languageCode: 'en',
                name: 'Office Input Devices',
                slug: 'cn-office-input',
                description: 'Temporary category for office input devices in the mainland China store.',
            },
            {
                languageCode: 'zh_Hans',
                name: '办公输入设备',
                slug: 'cn-office-input',
                description: '中国大陆店铺的临时办公输入设备分类。',
            },
        ],
    },
    {
        channelCode: 'my-malaysia',
        code: 'my-mobile-computing',
        productSkus: ['DEMO-TABLET-128', 'DEMO-MOUSE-SILENT'],
        translations: [
            {
                languageCode: 'en',
                name: 'Mobile Computing',
                slug: 'my-mobile-computing',
                description: 'Temporary mobile-computing category for the Malaysia store.',
            },
            {
                languageCode: 'zh_Hans',
                name: '移动办公',
                slug: 'my-mobile-computing',
                description: '马来西亚店铺的临时移动办公商品分类。',
            },
        ],
    },
    {
        channelCode: 'my-malaysia',
        code: 'my-desk-setup',
        productSkus: ['DEMO-MONITOR-27-4K', 'DEMO-KEYBOARD-75'],
        translations: [
            {
                languageCode: 'en',
                name: 'Desk Setup',
                slug: 'my-desk-setup',
                description: 'Temporary desk-setup category for the Malaysia store.',
            },
            {
                languageCode: 'zh_Hans',
                name: '桌面搭配',
                slug: 'my-desk-setup',
                description: '马来西亚店铺的临时桌面搭配商品分类。',
            },
        ],
    },
    {
        channelCode: 'cn-mainland',
        code: 'cn-digital-library',
        productSkus: [
            'DEMO-DIGITAL-AI-STARTER',
            'DEMO-DIGITAL-ECOMMERCE',
            'DEMO-DIGITAL-PROMPTS',
            'DEMO-DIGITAL-SUPPORT',
            'DEMO-DIGITAL-VIDEO',
        ],
        translations: [
            {
                languageCode: 'en',
                name: 'Digital Library',
                slug: 'cn-digital-library',
                description: 'Temporary digital product category for the mainland China store.',
            },
            {
                languageCode: 'zh_Hans',
                name: '数字内容库',
                slug: 'cn-digital-library',
                description: '中国大陆店铺的临时数字商品分类。',
            },
        ],
    },
    {
        channelCode: 'my-malaysia',
        code: 'my-digital-library',
        productSkus: [
            'DEMO-DIGITAL-AI-STARTER',
            'DEMO-DIGITAL-ECOMMERCE',
            'DEMO-DIGITAL-PROMPTS',
            'DEMO-DIGITAL-SUPPORT',
            'DEMO-DIGITAL-VIDEO',
        ],
        translations: [
            {
                languageCode: 'en',
                name: 'Digital Library',
                slug: 'my-digital-library',
                description: 'Temporary digital product category for the Malaysia store.',
            },
            {
                languageCode: 'zh_Hans',
                name: '数字内容库',
                slug: 'my-digital-library',
                description: '马来西亚店铺的临时数字商品分类。',
            },
        ],
    },
];

export function isLocalApiOrigin(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        (url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === '::1' ||
            url.hostname.endsWith('.localhost'))
    );
}

export function validateDemoProducts(products) {
    const skus = new Set();
    const slugs = new Set();
    for (const product of products) {
        assert.ok(product.sku.startsWith('DEMO-'), `Demo SKU must start with DEMO-: ${String(product.sku)}`);
        assert.ok(!skus.has(product.sku), `Duplicate demo SKU: ${String(product.sku)}`);
        assert.ok(
            !slugs.has(product.product.en.slug),
            `Duplicate demo slug: ${String(product.product.en.slug)}`,
        );
        assert.equal(
            product.product.en.slug,
            product.product.zh.slug,
            `Slugs must match for ${String(product.sku)}`,
        );
        assert.ok(product.prices.USD > 0 && product.prices.CNY > 0 && product.prices.MYR > 0);
        assert.ok(product.stockOnHand >= 0);
        assert.ok(['physical', 'digital'].includes(product.fulfillmentType));
        skus.add(product.sku);
        slugs.add(product.product.en.slug);
    }
    return true;
}

export function validateDemoCollections(collections, products = demoProducts) {
    const productSkus = new Set(products.map(product => product.sku));
    const collectionCodes = new Set();
    const channelCodes = new Set();

    for (const collection of collections) {
        assert.ok(
            !collectionCodes.has(collection.code),
            `Duplicate demo collection code: ${collection.code}`,
        );
        assert.ok(collection.productSkus.length > 0, `Demo collection has no products: ${collection.code}`);
        assert.ok(
            collection.translations.some(translation => translation.languageCode === 'en') &&
                collection.translations.some(translation => translation.languageCode === 'zh_Hans'),
            `Demo collection must be bilingual: ${collection.code}`,
        );
        for (const sku of collection.productSkus) {
            assert.ok(productSkus.has(sku), `Unknown demo product SKU ${sku} in ${collection.code}`);
        }
        collectionCodes.add(collection.code);
        channelCodes.add(collection.channelCode);
    }

    assert.deepEqual([...channelCodes].sort(), ['cn-mainland', 'my-malaysia']);
    return true;
}

export function createUploadMap(variablePath) {
    return { 0: [variablePath] };
}

export function demoInventoryTracking(product) {
    return product.fulfillmentType === 'digital' ? 'FALSE' : 'TRUE';
}

function headers(authToken, channelToken) {
    return {
        authorization: `Bearer ${String(authToken)}`,
        'vendure-token': channelToken,
        'language-code': 'en',
    };
}

async function graphql(fetchImpl, apiOrigin, query, variables, requestHeaders = {}) {
    const response = await fetchImpl(`${String(apiOrigin)}/admin-api`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...requestHeaders },
        body: JSON.stringify({ query, variables }),
    });
    const body = await response.json();
    if (!response.ok || body.errors?.length || !body.data) {
        throw new Error(
            body.errors?.map(error => error.message).join('; ') || `HTTP ${String(response.status)}`,
        );
    }
    return { data: body.data, response };
}

async function uploadAsset(fetchImpl, apiOrigin, authToken, channelToken, product) {
    const tag = `storefront-demo:${String(product.sku).toLowerCase()}`;
    const existing = await graphql(
        fetchImpl,
        apiOrigin,
        `
            query DemoAsset($tags: [String!]) {
                assets(options: { take: 1, tags: $tags, tagsOperator: AND }) {
                    items {
                        id
                    }
                }
            }
        `,
        { tags: [tag] },
        headers(authToken, channelToken),
    );
    if (existing.data.assets.items[0]?.id) return existing.data.assets.items[0].id;

    const imagePath = path.join(productImageDirectory, product.image);
    const bytes = await readFile(imagePath);
    const form = new FormData();
    form.append(
        'operations',
        JSON.stringify({
            operationName: 'CreateStorefrontDemoAsset',
            query: `mutation CreateStorefrontDemoAsset($input: [CreateAssetInput!]!) {
                createAssets(input: $input) {
                    ... on Asset { id }
                    ... on ErrorResult { message }
                }
            }`,
            variables: {
                input: [
                    {
                        file: null,
                        tags: ['storefront-demo', tag],
                        translations: [
                            {
                                languageCode: 'en',
                                name: `${String(product.product.en.name)} demo image`,
                            },
                            {
                                languageCode: 'zh_Hans',
                                name: `${String(product.product.zh.name)}临时图片`,
                            },
                        ],
                    },
                ],
            },
        }),
    );
    form.append('map', JSON.stringify(createUploadMap('variables.input.0.file')));
    form.append('0', new Blob([bytes], { type: 'image/jpeg' }), product.image);

    const response = await fetchImpl(`${String(apiOrigin)}/admin-api`, {
        method: 'POST',
        headers: headers(authToken, channelToken),
        body: form,
    });
    const body = await response.json();
    const result = body.data?.createAssets?.[0];
    if (!response.ok || body.errors?.length || !result?.id) {
        throw new Error(
            result?.message ||
                body.errors?.map(error => error.message).join('; ') ||
                `Asset upload failed (HTTP ${String(response.status)}): ${String(JSON.stringify(body))}`,
        );
    }
    return result.id;
}

async function upsertDemoCollection(fetchImpl, apiOrigin, authToken, channel, collection, productIdsBySku) {
    const existing = await graphql(
        fetchImpl,
        apiOrigin,
        `
            query ExistingDemoCollection($slug: String!) {
                collection(slug: $slug) {
                    id
                }
            }
        `,
        { slug: collection.code },
        headers(authToken, channel.token),
    );
    const productIds = collection.productSkus.map(sku => {
        const productId = productIdsBySku.get(sku);
        assert.ok(productId, `Product ${sku} must exist before its demo collection is created`);
        return productId;
    });
    const filters = [
        {
            code: 'product-id-filter',
            arguments: [
                { name: 'productIds', value: JSON.stringify(productIds) },
                { name: 'combineWithAnd', value: 'true' },
            ],
        },
    ];

    if (existing.data.collection?.id) {
        const updated = await graphql(
            fetchImpl,
            apiOrigin,
            `
                mutation UpdateDemoCollection($input: UpdateCollectionInput!) {
                    updateCollection(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    id: existing.data.collection.id,
                    filters,
                    translations: collection.translations,
                },
            },
            headers(authToken, channel.token),
        );
        return updated.data.updateCollection.id;
    }

    const created = await graphql(
        fetchImpl,
        apiOrigin,
        `
            mutation CreateDemoCollection($input: CreateCollectionInput!) {
                createCollection(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                filters,
                translations: collection.translations,
            },
        },
        headers(authToken, channel.token),
    );
    return created.data.createCollection.id;
}

function productTranslations(product) {
    return [
        { languageCode: 'en', ...product.product.en },
        { languageCode: 'zh_Hans', ...product.product.zh },
    ];
}

function variantTranslations(product) {
    return [
        { languageCode: 'en', name: product.variant.en },
        { languageCode: 'zh_Hans', name: product.variant.zh },
    ];
}

export async function seedStorefrontDemo({ apiOrigin, username, password, fetchImpl = fetch }) {
    assert.ok(isLocalApiOrigin(apiOrigin), 'The demo seed only accepts localhost API origins');
    assert.ok(username && password, 'SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required');
    validateDemoProducts(demoProducts);
    validateDemoCollections(demoCollections);
    const normalizedOrigin = apiOrigin.replace(/\/$/, '');

    const login = await graphql(
        fetchImpl,
        normalizedOrigin,
        `
            mutation DemoLogin($username: String!, $password: String!) {
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

    const channels = new Map(login.data.login.channels.map(channel => [channel.code, channel]));
    const defaultChannel = channels.get('__default_channel__');
    const targetChannels = ['cn-mainland', 'my-malaysia'].map(code => channels.get(code));
    assert.ok(defaultChannel, 'Default Channel is missing');
    assert.ok(targetChannels.every(Boolean), 'cn-mainland and my-malaysia Channels are required');

    const existing = await graphql(
        fetchImpl,
        normalizedOrigin,
        `
            query ExistingDemoVariants {
                productVariants(options: { take: 100 }) {
                    items {
                        id
                        sku
                        product {
                            id
                            featuredAsset {
                                id
                            }
                            channels {
                                id
                                code
                            }
                        }
                    }
                }
            }
        `,
        undefined,
        headers(authToken, defaultChannel.token),
    );
    const variantsBySku = new Map(existing.data.productVariants.items.map(variant => [variant.sku, variant]));
    const results = [];
    const productIdsBySku = new Map();

    for (const product of demoProducts) {
        const assetId = await uploadAsset(
            fetchImpl,
            normalizedOrigin,
            authToken,
            defaultChannel.token,
            product,
        );
        let variant = variantsBySku.get(product.sku);
        let productId;

        if (!variant) {
            const createdProduct = await graphql(
                fetchImpl,
                normalizedOrigin,
                `
                    mutation CreateDemoProduct($input: CreateProductInput!) {
                        createProduct(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        enabled: true,
                        featuredAssetId: assetId,
                        assetIds: [assetId],
                        translations: productTranslations(product),
                    },
                },
                headers(authToken, defaultChannel.token),
            );
            productId = createdProduct.data.createProduct.id;
            const createdVariants = await graphql(
                fetchImpl,
                normalizedOrigin,
                `
                    mutation CreateDemoVariant($input: [CreateProductVariantInput!]!) {
                        createProductVariants(input: $input) {
                            id
                            sku
                            product {
                                id
                                channels {
                                    id
                                    code
                                }
                            }
                        }
                    }
                `,
                {
                    input: [
                        {
                            productId,
                            enabled: true,
                            translations: variantTranslations(product),
                            sku: product.sku,
                            price: product.prices.USD,
                            featuredAssetId: assetId,
                            assetIds: [assetId],
                            stockOnHand: product.stockOnHand,
                            trackInventory: demoInventoryTracking(product),
                            customFields: { fulfillmentType: product.fulfillmentType },
                        },
                    ],
                },
                headers(authToken, defaultChannel.token),
            );
            variant = createdVariants.data.createProductVariants[0];
        } else {
            productId = variant.product.id;
            await graphql(
                fetchImpl,
                normalizedOrigin,
                `
                    mutation UpdateDemoProduct($input: UpdateProductInput!) {
                        updateProduct(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        id: productId,
                        enabled: true,
                        featuredAssetId: assetId,
                        assetIds: [assetId],
                        translations: productTranslations(product),
                    },
                },
                headers(authToken, defaultChannel.token),
            );
        }

        await graphql(
            fetchImpl,
            normalizedOrigin,
            `
                mutation UpdateDefaultDemoVariant($input: UpdateProductVariantInput!) {
                    updateProductVariant(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    id: variant.id,
                    enabled: true,
                    translations: variantTranslations(product),
                    price: product.prices.USD,
                    featuredAssetId: assetId,
                    assetIds: [assetId],
                    stockOnHand: product.stockOnHand,
                    trackInventory: demoInventoryTracking(product),
                    customFields: { fulfillmentType: product.fulfillmentType },
                },
            },
            headers(authToken, defaultChannel.token),
        );

        for (const channel of targetChannels) {
            if (!variant.product.channels.some(assigned => assigned.id === channel.id)) {
                await graphql(
                    fetchImpl,
                    normalizedOrigin,
                    `
                        mutation AssignDemoProduct($input: AssignProductsToChannelInput!) {
                            assignProductsToChannel(input: $input) {
                                id
                            }
                        }
                    `,
                    { input: { productIds: [productId], channelId: channel.id, priceFactor: 1 } },
                    headers(authToken, defaultChannel.token),
                );
            }
            await graphql(
                fetchImpl,
                normalizedOrigin,
                `
                    mutation AssignDemoAsset($input: AssignAssetsToChannelInput!) {
                        assignAssetsToChannel(input: $input) {
                            id
                        }
                    }
                `,
                { input: { assetIds: [assetId], channelId: channel.id } },
                headers(authToken, defaultChannel.token),
            );
            await graphql(
                fetchImpl,
                normalizedOrigin,
                `
                    mutation UpdateChannelDemoPrice($input: UpdateProductVariantInput!) {
                        updateProductVariant(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        id: variant.id,
                        price: product.prices[channel.code === 'cn-mainland' ? 'CNY' : 'MYR'],
                    },
                },
                headers(authToken, channel.token),
            );
        }

        results.push({ sku: product.sku, productId, variantId: variant.id, assetId });
        productIdsBySku.set(product.sku, productId);
    }

    const collectionResults = [];
    for (const collection of demoCollections) {
        const channel = channels.get(collection.channelCode);
        assert.ok(channel, `Channel ${collection.channelCode} is required`);
        const collectionId = await upsertDemoCollection(
            fetchImpl,
            normalizedOrigin,
            authToken,
            channel,
            collection,
            productIdsBySku,
        );
        collectionResults.push({ code: collection.code, channelCode: collection.channelCode, collectionId });
    }

    return { products: results, collections: collectionResults };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    if (!process.argv.includes('--apply')) {
        throw new Error('Pass --apply to add or update local storefront demo products');
    }
    const apiOrigin = process.env.VENDURE_API_ORIGIN;
    const username = process.env.SUPERADMIN_USERNAME;
    const password = process.env.SUPERADMIN_PASSWORD;
    assert.ok(apiOrigin, 'VENDURE_API_ORIGIN is required');
    const results = await seedStorefrontDemo({ apiOrigin, username, password });
    process.stdout.write(
        `${String(
            JSON.stringify({
                ok: true,
                productCount: results.products.length,
                collectionCount: results.collections.length,
                skus: results.products.map(item => item.sku),
                collectionCodes: results.collections.map(item => item.code),
            }),
        )}\n`,
    );
}
