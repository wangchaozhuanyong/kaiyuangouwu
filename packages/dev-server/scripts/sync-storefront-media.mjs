import 'dotenv/config';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const storefrontAssets = path.resolve(scriptDirectory, '../../storefront/src/assets/storefront');

export const storefrontMediaManifest = [
    {
        key: 'product-codex-plus',
        file: path.join(storefrontAssets, 'products/redesigned/codex-plus-cover-navy-emerald.png'),
        names: {
            en: 'Codex Plus navy emerald product cover',
            zh: 'Codex Plus 深蓝绿商品封面',
        },
        productSkus: ['gpt-plus-苹果开通'],
    },
    {
        key: 'product-codex-pro-x5',
        file: path.join(storefrontAssets, 'products/redesigned/codex-pro-x5-cover-navy-emerald.png'),
        names: {
            en: 'Codex Pro X5 navy emerald product cover',
            zh: 'Codex Pro X5 深蓝绿商品封面',
        },
        productSkus: ['gpt-prox5-苹果开通'],
    },
    {
        key: 'home-gpt-category-ad',
        file: path.join(storefrontAssets, 'promotions/category-gpt-navy-emerald.png'),
        names: {
            en: 'Navy emerald GPT category artwork',
            zh: '深蓝绿 GPT 分类广告图',
        },
        content: {
            code: 'home-fixed-category-ad',
            type: 'CATEGORY_AD',
        },
    },
    {
        key: 'referral-poster-neon-layout-reference',
        file: path.join(storefrontAssets, 'referral/cloudbridge-neon-service-poster-reference.png'),
        names: {
            en: 'CloudBridge neon referral poster layout reference',
            zh: '云桥 AI 霓虹邀请海报排版参考',
        },
        assetOnly: {
            purpose: 'referral-poster-layout-reference',
        },
    },
];

const LOGIN_MUTATION = `
    mutation StorefrontMediaLogin($username: String!, $password: String!) {
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
`;

const PRODUCT_VARIANT_QUERY = `
    query StorefrontMediaProductVariant($sku: String!) {
        productVariants(options: { take: 2, filter: { sku: { eq: $sku } } }) {
            items {
                id
                sku
                featuredAsset { id }
                assets { id }
                product {
                    id
                    name
                    featuredAsset { id }
                    assets { id }
                }
            }
        }
    }
`;

const SHOP_PRODUCT_QUERY = `
    query StorefrontMediaShopProduct($id: ID!) {
        product(id: $id) {
            id
            featuredAsset { id }
            assets { id }
            variants {
                id
                sku
                featuredAsset { id }
                assets { id }
            }
        }
    }
`;

const CONTENT_BLOCKS_QUERY = `
    query StorefrontMediaContentBlocks {
        storefrontContentBlocks {
            id
            updatedAt
            code
            type
            imageUrl
            backgroundColor
            textColor
            settings
            imageAsset {
                id
            }
        }
    }
`;

const SHOP_CONTENT_BLOCKS_QUERY = `
    query StorefrontMediaShopContentBlocks {
        storefrontContent {
            id
            code
            type
            imageUrl
            settings
            imageAsset { id }
        }
    }
`;

const ASSET_QUERY = `
    query StorefrontMediaAsset($tags: [String!]) {
        assets(options: { take: 1, tags: $tags, tagsOperator: AND }) {
            items {
                id
            }
        }
    }
`;

const ASSIGN_ASSET_MUTATION = `
    mutation AssignStorefrontMediaAsset($input: AssignAssetsToChannelInput!) {
        assignAssetsToChannel(input: $input) {
            id
        }
    }
`;

const UPDATE_PRODUCT_MUTATION = `
    mutation UpdateStorefrontMediaProduct($input: UpdateProductInput!) {
        updateProduct(input: $input) {
            id
        }
    }
`;

const UPDATE_VARIANT_MUTATION = `
    mutation UpdateStorefrontMediaVariant($input: UpdateProductVariantInput!) {
        updateProductVariant(input: $input) {
            id
        }
    }
`;

const UPDATE_CONTENT_MUTATION = `
    mutation UpdateStorefrontMediaContent($input: UpdateStorefrontContentBlockInput!) {
        updateStorefrontContentBlock(input: $input) {
            id
            updatedAt
            code
            imageUrl
            imageAsset {
                id
            }
        }
    }
`;

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

export function parseChannelCodes(value) {
    return Array.from(
        new Set(
            String(value ?? '')
                .split(',')
                .map(code => code.trim())
                .filter(Boolean),
        ),
    );
}

export function parseMediaKeys(value) {
    const keys = parseChannelCodes(value);
    assert.ok(keys.length > 0, '--keys requires at least one media key');
    return keys;
}

export function selectStorefrontMediaChannels(availableChannels, channelCodes) {
    if (channelCodes?.length) {
        const channelsByCode = new Map(availableChannels.map(channel => [channel.code, channel]));
        return channelCodes.map(code => {
            const channel = channelsByCode.get(code);
            assert.ok(channel, `Admin user cannot access Channel ${code}`);
            return channel;
        });
    }

    assert.ok(availableChannels.length > 0, 'Admin user cannot access any Channel');
    assert.equal(
        availableChannels.length,
        1,
        'STOREFRONT_MEDIA_CHANNEL_CODES is required when the admin user can access multiple Channels',
    );
    return availableChannels;
}

export function createUploadMap(variablePath) {
    return { 0: [variablePath] };
}

export function assetTags(key, hash) {
    return [`storefront-media:${key}`, `storefront-media-sha256:${hash}`];
}

export function findContentBlock(blocks, target) {
    const exact = target.code ? blocks.find(block => block.code === target.code) : undefined;
    if (exact) {
        assert.equal(exact.type, target.type, `Content block ${target.code} is not ${target.type}`);
        return exact;
    }

    const candidates = blocks.filter(block => {
        if (block.type !== target.type) return false;
        return Object.entries(target.matchSettings ?? {}).every(
            ([key, value]) => block.settings?.[key] === value,
        );
    });
    assert.equal(
        candidates.length,
        1,
        `Expected one ${target.type} content block${target.code ? ` (${target.code})` : ''}, found ${String(candidates.length)}`,
    );
    return candidates[0];
}

export async function prepareStorefrontMediaManifest(manifest = storefrontMediaManifest) {
    assert.ok(Array.isArray(manifest) && manifest.length > 0, 'Storefront media manifest is empty');
    const keys = new Set();
    const productTargets = new Map();
    const contentTargets = new Map();
    const assetOnlyTargets = new Map();
    const prepared = [];

    for (const entry of manifest) {
        assert.match(entry.key, /^[a-z0-9][a-z0-9-]+$/, `Invalid media key: ${String(entry.key)}`);
        assert.ok(!keys.has(entry.key), `Duplicate media key: ${entry.key}`);
        assert.ok(
            entry.productSkus?.length || entry.content || entry.assetOnly,
            `Media ${entry.key} has no publish target`,
        );
        if (entry.assetOnly) {
            assert.match(
                entry.assetOnly.purpose,
                /^[a-z0-9][a-z0-9-]+$/,
                `Media ${entry.key} requires a stable asset-library purpose`,
            );
        }
        for (const sku of entry.productSkus ?? []) {
            assert.ok(
                !productTargets.has(sku),
                `Product SKU ${sku} is targeted by both ${productTargets.get(sku)} and ${entry.key}`,
            );
            productTargets.set(sku, entry.key);
        }
        if (entry.content) {
            const contentTarget =
                entry.content.code ??
                `${entry.content.type}:${JSON.stringify(entry.content.matchSettings ?? {})}`;
            assert.ok(
                !contentTargets.has(contentTarget),
                `Content target ${contentTarget} is targeted by both ${contentTargets.get(contentTarget)} and ${entry.key}`,
            );
            contentTargets.set(contentTarget, entry.key);
        }
        if (entry.assetOnly) {
            assert.ok(
                !assetOnlyTargets.has(entry.assetOnly.purpose),
                `Asset-library purpose ${entry.assetOnly.purpose} is targeted by both ${assetOnlyTargets.get(entry.assetOnly.purpose)} and ${entry.key}`,
            );
            assetOnlyTargets.set(entry.assetOnly.purpose, entry.key);
        }
        assert.ok(entry.names?.en && entry.names?.zh, `Media ${entry.key} requires bilingual names`);
        keys.add(entry.key);

        const bytes = await readFile(entry.file);
        assert.ok(bytes.byteLength > 0, `Media file is empty: ${entry.file}`);
        const hash = createHash('sha256').update(bytes).digest('hex');
        prepared.push({
            ...entry,
            bytes,
            hash,
            tags: assetTags(entry.key, hash),
        });
    }
    return prepared;
}

function requestHeaders(authToken, channelToken) {
    return {
        authorization: `Bearer ${String(authToken)}`,
        'vendure-token': String(channelToken),
        'language-code': 'en',
    };
}

async function graphql(fetchImpl, apiOrigin, apiPath, query, variables, headers = {}) {
    const response = await fetchImpl(`${apiOrigin}/${apiPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
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

async function login(fetchImpl, apiOrigin, username, password) {
    const result = await graphql(fetchImpl, apiOrigin, 'admin-api', LOGIN_MUTATION, {
        username,
        password,
    });
    assert.equal(result.data.login.errorCode, undefined, result.data.login.message);
    const authToken = result.response.headers.get('vendure-auth-token') ?? '';
    assert.ok(authToken, 'Admin login did not return a bearer token');
    return { authToken, channels: result.data.login.channels };
}

async function findAsset(fetchImpl, apiOrigin, authToken, channel, tags) {
    const result = await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        ASSET_QUERY,
        { tags },
        requestHeaders(authToken, channel.token),
    );
    return result.data.assets.items[0] ?? null;
}

function mimeType(file) {
    switch (path.extname(file).toLowerCase()) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.webp':
            return 'image/webp';
        default:
            throw new Error(`Unsupported storefront media type: ${file}`);
    }
}

async function uploadAsset(fetchImpl, apiOrigin, authToken, channel, media) {
    const form = new FormData();
    form.append(
        'operations',
        JSON.stringify({
            operationName: 'CreateStorefrontMediaAsset',
            query: `mutation CreateStorefrontMediaAsset($input: [CreateAssetInput!]!) {
                createAssets(input: $input) {
                    ... on Asset {
                        id
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }`,
            variables: {
                input: [
                    {
                        file: null,
                        tags: ['storefront-media', ...media.tags],
                        translations: [
                            { languageCode: 'en', name: media.names.en },
                            { languageCode: 'zh_Hans', name: media.names.zh },
                        ],
                    },
                ],
            },
        }),
    );
    form.append('map', JSON.stringify(createUploadMap('variables.input.0.file')));
    form.append('0', new Blob([media.bytes], { type: mimeType(media.file) }), path.basename(media.file));

    const response = await fetchImpl(`${apiOrigin}/admin-api`, {
        method: 'POST',
        headers: requestHeaders(authToken, channel.token),
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
    return result;
}

async function loadChannelState(fetchImpl, apiOrigin, authToken, channel, manifest) {
    const contentResult = await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        CONTENT_BLOCKS_QUERY,
        undefined,
        requestHeaders(authToken, channel.token),
    );
    const productSkus = Array.from(new Set(manifest.flatMap(entry => entry.productSkus ?? [])));
    const variants = new Map();

    for (const sku of productSkus) {
        const result = await graphql(
            fetchImpl,
            apiOrigin,
            'admin-api',
            PRODUCT_VARIANT_QUERY,
            { sku },
            requestHeaders(authToken, channel.token),
        );
        assert.equal(
            result.data.productVariants.items.length,
            1,
            `Expected one product variant for SKU ${sku} in Channel ${channel.code}, found ${String(result.data.productVariants.items.length)}`,
        );
        variants.set(sku, result.data.productVariants.items[0]);
    }

    return {
        blocks: contentResult.data.storefrontContentBlocks,
        channel,
        variants,
    };
}

async function loadShopChannelState(fetchImpl, apiOrigin, channel, adminState, manifest) {
    const headers = {
        'vendure-token': String(channel.token),
        'language-code': 'en',
    };
    const products = new Map();
    const productIds = Array.from(
        new Set(
            manifest.flatMap(media =>
                (media.productSkus ?? []).map(sku => String(adminState.variants.get(sku)?.product.id)),
            ),
        ),
    ).filter(id => id !== 'undefined');
    for (const productId of productIds) {
        const result = await graphql(
            fetchImpl,
            apiOrigin,
            'shop-api',
            SHOP_PRODUCT_QUERY,
            { id: productId },
            headers,
        );
        assert.ok(
            result.data.product,
            `Shop API cannot read product ${productId} in Channel ${channel.code}`,
        );
        products.set(productId, result.data.product);
    }

    let blocks = [];
    if (manifest.some(media => media.content)) {
        const result = await graphql(
            fetchImpl,
            apiOrigin,
            'shop-api',
            SHOP_CONTENT_BLOCKS_QUERY,
            undefined,
            headers,
        );
        blocks = result.data.storefrontContent;
    }
    return { blocks, channel, products };
}

async function assignAsset(fetchImpl, apiOrigin, authToken, requestChannel, targetChannel, assetId) {
    await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        ASSIGN_ASSET_MUTATION,
        { input: { assetIds: [assetId], channelId: targetChannel.id } },
        requestHeaders(authToken, requestChannel.token),
    );
}

function ids(items) {
    return (items ?? []).map(item => String(item.id));
}

function appendAssetId(items, assetId) {
    return Array.from(new Set([...ids(items), String(assetId)]));
}

async function updateProductAssetState(fetchImpl, apiOrigin, authToken, channel, variant, state) {
    await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        UPDATE_PRODUCT_MUTATION,
        {
            input: {
                id: variant.product.id,
                featuredAssetId: state.product.featuredAssetId,
                assetIds: state.product.assetIds,
            },
        },
        requestHeaders(authToken, channel.token),
    );
    await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        UPDATE_VARIANT_MUTATION,
        {
            input: {
                id: variant.id,
                featuredAssetId: state.variant.featuredAssetId,
                assetIds: state.variant.assetIds,
            },
        },
        requestHeaders(authToken, channel.token),
    );
}

async function bindProductAsset(fetchImpl, apiOrigin, authToken, channel, variant, assetId) {
    const before = {
        product: {
            featuredAssetId: variant.product.featuredAsset?.id ?? null,
            assetIds: ids(variant.product.assets),
        },
        variant: {
            featuredAssetId: variant.featuredAsset?.id ?? null,
            assetIds: ids(variant.assets),
        },
    };
    const desired = {
        product: {
            featuredAssetId: assetId,
            assetIds: appendAssetId(variant.product.assets, assetId),
        },
        variant: {
            featuredAssetId: assetId,
            assetIds: appendAssetId(variant.assets, assetId),
        },
    };
    try {
        await updateProductAssetState(fetchImpl, apiOrigin, authToken, channel, variant, desired);
    } catch (error) {
        try {
            await updateProductAssetState(fetchImpl, apiOrigin, authToken, channel, variant, before);
        } catch (rollbackError) {
            throw new AggregateError(
                [error, rollbackError],
                `Product media binding failed and rollback also failed for SKU ${variant.sku}`,
            );
        }
        throw error;
    }
    return async () => updateProductAssetState(fetchImpl, apiOrigin, authToken, channel, variant, before);
}

async function bindContentAsset(fetchImpl, apiOrigin, authToken, channel, block, content, assetId) {
    const input = {
        id: block.id,
        expectedUpdatedAt: block.updatedAt,
        imageAssetId: assetId,
        imageUrl: null,
    };
    if (content.backgroundColor) input.backgroundColor = content.backgroundColor;
    if (content.textColor) input.textColor = content.textColor;
    if (content.settings) input.settings = { ...(block.settings ?? {}), ...content.settings };

    const result = await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        UPDATE_CONTENT_MUTATION,
        { input },
        requestHeaders(authToken, channel.token),
    );
    return async () => {
        await graphql(
            fetchImpl,
            apiOrigin,
            'admin-api',
            UPDATE_CONTENT_MUTATION,
            {
                input: {
                    id: block.id,
                    expectedUpdatedAt: result.data.updateStorefrontContentBlock.updatedAt,
                    imageAssetId: block.imageAsset?.id ?? null,
                    imageUrl: block.imageUrl ?? null,
                    backgroundColor: block.backgroundColor ?? null,
                    textColor: block.textColor ?? null,
                    settings: block.settings ?? null,
                },
            },
            requestHeaders(authToken, channel.token),
        );
    };
}

function assertEntityUsesAsset(entity, assetId, owner) {
    assert.equal(
        entity?.featuredAsset?.id ?? null,
        assetId,
        `${owner} featured Asset differs from the reviewed media Asset`,
    );
    assert.ok(
        ids(entity?.assets).includes(String(assetId)),
        `${owner} gallery does not contain the reviewed media Asset`,
    );
}

async function verifyMediaAcrossChannels({
    fetchImpl,
    apiOrigin,
    shopOrigin = apiOrigin,
    authToken,
    channels,
    media,
}) {
    let expectedAssetId;
    const verification = [];
    for (const channel of channels) {
        const asset = await findAsset(fetchImpl, apiOrigin, authToken, channel, media.tags);
        assert.ok(asset, `Reviewed media ${media.key} is missing from Channel ${channel.code}`);
        expectedAssetId ??= String(asset.id);
        assert.equal(
            String(asset.id),
            expectedAssetId,
            `Reviewed media ${media.key} resolves to different Asset IDs across Channels`,
        );

        const adminState = await loadChannelState(fetchImpl, apiOrigin, authToken, channel, [media]);
        const shopState = await loadShopChannelState(fetchImpl, shopOrigin, channel, adminState, [media]);
        for (const sku of media.productSkus ?? []) {
            const adminVariant = adminState.variants.get(sku);
            assert.ok(adminVariant, `Admin API cannot read SKU ${sku} in Channel ${channel.code}`);
            assertEntityUsesAsset(
                adminVariant.product,
                expectedAssetId,
                `Admin API product ${adminVariant.product.id}`,
            );
            assertEntityUsesAsset(adminVariant, expectedAssetId, `Admin API variant ${adminVariant.id}`);

            const shopProduct = shopState.products.get(String(adminVariant.product.id));
            assert.ok(
                shopProduct,
                `Shop API cannot read product ${adminVariant.product.id} in Channel ${channel.code}`,
            );
            assertEntityUsesAsset(
                shopProduct,
                expectedAssetId,
                `Shop API product ${adminVariant.product.id}`,
            );
            const shopVariants = shopProduct.variants.filter(variant => variant.sku === sku);
            assert.equal(
                shopVariants.length,
                1,
                `Expected one Shop API variant for SKU ${sku} in Channel ${channel.code}, found ${String(shopVariants.length)}`,
            );
            assertEntityUsesAsset(shopVariants[0], expectedAssetId, `Shop API variant ${shopVariants[0].id}`);
            verification.push({
                channelCode: channel.code,
                kind: 'product',
                sku,
                assetId: expectedAssetId,
                adminShopParity: true,
            });
        }

        if (media.content) {
            const adminBlock = findContentBlock(adminState.blocks, media.content);
            const shopBlock = findContentBlock(shopState.blocks, media.content);
            assert.equal(
                adminBlock.imageAsset?.id ?? null,
                expectedAssetId,
                `Admin API content ${adminBlock.code} does not use the reviewed media Asset`,
            );
            assert.equal(
                shopBlock.imageAsset?.id ?? null,
                expectedAssetId,
                `Shop API content ${shopBlock.code} differs from Admin API`,
            );
            verification.push({
                channelCode: channel.code,
                kind: 'content',
                code: adminBlock.code,
                assetId: expectedAssetId,
                adminShopParity: true,
            });
        }

        if (media.assetOnly) {
            verification.push({
                channelCode: channel.code,
                kind: 'asset-library',
                purpose: media.assetOnly.purpose,
                assetId: expectedAssetId,
                adminChannelVerified: true,
            });
        }
    }
    return { assetId: expectedAssetId, verification };
}

async function verifyMediaWithRetry(options, attempts, delayMs, waitImpl) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await verifyMediaAcrossChannels(options);
        } catch (error) {
            lastError = error;
            if (attempt < attempts) await waitImpl(delayMs);
        }
    }
    throw lastError;
}

async function rollbackBindings(rollbacks, mediaKey) {
    const rollbackErrors = [];
    for (const rollback of [...rollbacks].reverse()) {
        try {
            await rollback();
        } catch (error) {
            rollbackErrors.push(error);
        }
    }
    if (rollbackErrors.length) {
        throw new AggregateError(
            rollbackErrors,
            `Storefront media ${mediaKey} failed and one or more binding rollbacks also failed`,
        );
    }
}

export async function syncStorefrontMedia({
    apiOrigin,
    shopOrigin = apiOrigin,
    username,
    password,
    channelCodes,
    apply = false,
    verify = false,
    allowRemote = false,
    production = process.env.NODE_ENV === 'production',
    fetchImpl = fetch,
    manifest = storefrontMediaManifest,
    mediaKeys,
    verificationAttempts = 5,
    verificationDelayMs = 250,
    waitImpl = delayMs => new Promise(resolve => setTimeout(resolve, delayMs)),
}) {
    assert.ok(apiOrigin, 'VENDURE_API_ORIGIN or --api-origin is required');
    assert.ok(shopOrigin, 'VENDURE_STOREFRONT_URL or --shop-origin is required');
    assert.ok(username && password, 'SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required');
    if (channelCodes) {
        assert.ok(channelCodes.length > 0, 'At least one storefront media Channel is required');
    }
    assert.ok(!(apply && verify), '--apply and --verify are mutually exclusive');
    assert.ok(Number.isInteger(verificationAttempts) && verificationAttempts > 0);
    if (apply && (production || !isLocalApiOrigin(apiOrigin))) {
        assert.ok(allowRemote, 'Remote or production writes require both --apply and --allow-remote');
    }

    const selectedManifest = mediaKeys
        ? mediaKeys.map(key => {
              const entry = manifest.find(item => item.key === key);
              assert.ok(entry, `Unknown storefront media key: ${key}`);
              return entry;
          })
        : manifest;
    const normalizedApiOrigin = apiOrigin.replace(/\/$/, '');
    const normalizedShopOrigin = shopOrigin.replace(/\/$/, '');
    const prepared = await prepareStorefrontMediaManifest(selectedManifest);
    const session = await login(fetchImpl, normalizedApiOrigin, username, password);
    const selectedChannels = selectStorefrontMediaChannels(session.channels, channelCodes);
    const channelStates = [];
    for (const channel of selectedChannels) {
        channelStates.push(
            await loadChannelState(fetchImpl, normalizedApiOrigin, session.authToken, channel, prepared),
        );
    }

    const assetChannel = selectedChannels[0];
    const results = [];
    const completedRollbacks = [];
    for (const media of prepared) {
        let asset = await findAsset(
            fetchImpl,
            normalizedApiOrigin,
            session.authToken,
            assetChannel,
            media.tags,
        );
        const action = asset ? 'reuse' : 'upload';
        const targets = [];

        for (const state of channelStates) {
            for (const sku of media.productSkus ?? []) {
                const variant = state.variants.get(sku);
                assert.ok(variant, `Product variant ${sku} is missing from Channel ${state.channel.code}`);
                targets.push({
                    channelCode: state.channel.code,
                    kind: 'product',
                    sku,
                    productId: variant.product.id,
                    variantId: variant.id,
                });
            }
            if (media.content) {
                const block = findContentBlock(state.blocks, media.content);
                targets.push({
                    channelCode: state.channel.code,
                    kind: 'content',
                    code: block.code,
                    blockId: block.id,
                });
            }
            if (media.assetOnly) {
                targets.push({
                    channelCode: state.channel.code,
                    kind: 'asset-library',
                    purpose: media.assetOnly.purpose,
                });
            }
        }

        let verification = [];
        if (apply) {
            const rollbacks = [];
            try {
                asset =
                    asset ??
                    (await uploadAsset(
                        fetchImpl,
                        normalizedApiOrigin,
                        session.authToken,
                        assetChannel,
                        media,
                    ));
                for (const channel of selectedChannels) {
                    await assignAsset(
                        fetchImpl,
                        normalizedApiOrigin,
                        session.authToken,
                        assetChannel,
                        channel,
                        asset.id,
                    );
                }
                const updatedProducts = new Set();
                for (const state of channelStates) {
                    for (const sku of media.productSkus ?? []) {
                        const variant = state.variants.get(sku);
                        const targetKey = `${String(variant.product.id)}:${String(variant.id)}`;
                        if (updatedProducts.has(targetKey)) continue;
                        rollbacks.push(
                            await bindProductAsset(
                                fetchImpl,
                                normalizedApiOrigin,
                                session.authToken,
                                state.channel,
                                variant,
                                asset.id,
                            ),
                        );
                        updatedProducts.add(targetKey);
                    }
                    if (media.content) {
                        const block = findContentBlock(state.blocks, media.content);
                        rollbacks.push(
                            await bindContentAsset(
                                fetchImpl,
                                normalizedApiOrigin,
                                session.authToken,
                                state.channel,
                                block,
                                media.content,
                                asset.id,
                            ),
                        );
                    }
                }
                const verified = await verifyMediaWithRetry(
                    {
                        fetchImpl,
                        apiOrigin: normalizedApiOrigin,
                        shopOrigin: normalizedShopOrigin,
                        authToken: session.authToken,
                        channels: selectedChannels,
                        media,
                    },
                    verificationAttempts,
                    verificationDelayMs,
                    waitImpl,
                );
                assert.equal(
                    verified.assetId,
                    String(asset.id),
                    `Post-publish verification resolved an unexpected Asset for ${media.key}`,
                );
                verification = verified.verification;
                completedRollbacks.push(...rollbacks);
            } catch (error) {
                try {
                    await rollbackBindings(
                        [...completedRollbacks, ...rollbacks],
                        `reviewed batch ending at ${media.key}`,
                    );
                } catch (rollbackError) {
                    throw new AggregateError([error, rollbackError], rollbackError.message);
                }
                throw new Error(
                    `Storefront media ${media.key} publish failed; previous bindings were restored for the reviewed batch`,
                    { cause: error },
                );
            }
        } else if (verify) {
            const verified = await verifyMediaWithRetry(
                {
                    fetchImpl,
                    apiOrigin: normalizedApiOrigin,
                    shopOrigin: normalizedShopOrigin,
                    authToken: session.authToken,
                    channels: selectedChannels,
                    media,
                },
                verificationAttempts,
                verificationDelayMs,
                waitImpl,
            );
            asset = { id: verified.assetId };
            verification = verified.verification;
        }

        results.push({
            key: media.key,
            file: media.file,
            hash: media.hash,
            assetAction: action,
            assetId: asset?.id ?? null,
            targets,
            verification,
        });
    }

    return {
        applied: apply,
        verified: apply || verify,
        apiOrigin: normalizedApiOrigin,
        shopOrigin: normalizedShopOrigin,
        channelCodes: selectedChannels.map(channel => channel.code),
        results,
    };
}

export function parseCliArguments(args) {
    const options = {
        allowRemote: false,
        apply: false,
        verify: false,
        validate: false,
    };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--apply') options.apply = true;
        else if (argument === '--verify') options.verify = true;
        else if (argument === '--allow-remote') options.allowRemote = true;
        else if (argument === '--validate') options.validate = true;
        else if (argument === '--dry-run') {
            options.apply = false;
            options.verify = false;
        } else if (argument === '--api-origin') options.apiOrigin = args[++index];
        else if (argument === '--shop-origin') options.shopOrigin = args[++index];
        else if (argument === '--channel-codes') options.channelCodes = parseChannelCodes(args[++index]);
        else if (argument === '--keys') options.mediaKeys = parseMediaKeys(args[++index]);
        else throw new Error(`Unknown argument: ${String(argument)}`);
    }
    return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const options = parseCliArguments(process.argv.slice(2));
    if (options.validate) {
        const prepared = await prepareStorefrontMediaManifest();
        process.stdout.write(
            `${JSON.stringify({ ok: true, mode: 'validate', mediaCount: prepared.length, keys: prepared.map(item => item.key) }, null, 2)}\n`,
        );
    } else {
        const apiOrigin =
            options.apiOrigin ??
            process.env.VENDURE_API_ORIGIN ??
            `http://${process.env.VENDURE_HOSTNAME || '127.0.0.1'}:${process.env.PORT || '3000'}`;
        const channelCodes =
            options.channelCodes ??
            (process.env.STOREFRONT_MEDIA_CHANNEL_CODES
                ? parseChannelCodes(process.env.STOREFRONT_MEDIA_CHANNEL_CODES)
                : undefined);
        const result = await syncStorefrontMedia({
            apiOrigin,
            shopOrigin: options.shopOrigin ?? process.env.VENDURE_STOREFRONT_URL ?? apiOrigin,
            username: process.env.SUPERADMIN_USERNAME,
            password: process.env.SUPERADMIN_PASSWORD,
            channelCodes,
            mediaKeys: options.mediaKeys,
            apply: options.apply,
            verify: options.verify,
            allowRemote: options.allowRemote,
        });
        process.stdout.write(
            `${JSON.stringify(
                {
                    ok: true,
                    mode: result.applied ? 'apply' : options.verify ? 'verify' : 'dry-run',
                    apiOrigin: result.apiOrigin,
                    shopOrigin: result.shopOrigin,
                    channelCodes: result.channelCodes,
                    media: result.results.map(item => ({
                        key: item.key,
                        assetAction: item.assetAction,
                        assetId: item.assetId,
                        targets: item.targets,
                        verification: item.verification,
                    })),
                },
                null,
                2,
            )}\n`,
        );
    }
}
