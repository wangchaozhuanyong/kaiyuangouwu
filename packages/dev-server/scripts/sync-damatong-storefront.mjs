import 'dotenv/config';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildDamatongContentBlocks,
    DAMATONG_AI_PLUGIN_CODE,
    damatongAssets,
    damatongCategories,
    damatongStorefront,
} from './damatong-storefront-config.mjs';

const LANGUAGE_CODES = ['zh_Hans', 'en'];
const ADOPT_EXISTING_TYPES = new Set([
    'HERO',
    'NOTICE',
    'QUICK_LINKS',
    'CATEGORY_AD',
    'STORY',
    'TRUST_BAR',
    'LEGAL',
    'SUPPORT',
    'AUTH_LOGIN',
    'AUTH_REGISTER',
    'NAVIGATION',
    'CLIENT_PLUGINS',
]);
const REVIEWED_LEGACY_CODES = new Map([
    ['damatong-hero-marketplace', ['damatong-hero-coffee']],
    ['damatong-hero-malaysia-services', ['damatong-hero-services']],
    ['damatong-hero-ai-subscriptions', ['damatong-hero-subscriptions']],
]);

const LOGIN_MUTATION = `
    mutation DamatongStorefrontLogin($username: String!, $password: String!) {
        login(username: $username, password: $password, rememberMe: false) {
            ... on CurrentUser { id channels { id code token } }
            ... on ErrorResult { errorCode message }
        }
    }
`;

const ACTIVE_CHANNEL_QUERY = `
    query DamatongActiveChannel {
        activeChannel { code }
    }
`;

const STORE_PROFILES_QUERY = `
    query DamatongStoreProfiles {
        storeProfiles {
            id
            updatedAt
            channel { id code token customFields { storefrontNameZh storefrontNameEn } }
            descriptionZh
            descriptionEn
            taglineZh
            taglineEn
            brandBackgroundColor
            brandPrimaryColor
            brandAccentColor
            brandHighlightColor
            logoAsset { id }
            logoOnLightAsset { id }
            logoOnDarkAsset { id }
        }
    }
`;

const ADMIN_BLOCKS_QUERY = `
    query DamatongStorefrontBlocks {
        storefrontContentBlocks {
            id
            updatedAt
            code
            internalName
            type
            layoutVariant
            enabled
            position
            startsAt
            endsAt
            imageUrl
            imageAsset { id }
            backgroundColor
            textColor
            targetType
            targetValue
            settings
            translations { languageCode title subtitle body ctaLabel }
            items {
                id
                enabled
                position
                imageUrl
                imageAsset { id }
                targetType
                targetValue
                settings
                translations { languageCode label description }
            }
        }
        storefrontContentSettings { heroAutoplayIntervalSeconds }
    }
`;

const COLLECTION_QUERY = `
    query DamatongCollection($slug: String!) {
        collection(slug: $slug) {
            id
            name
            slug
            featuredAsset { id }
            assets { id }
            translations { languageCode name slug description }
        }
    }
`;

const ASSET_QUERY = `
    query DamatongStorefrontAsset($tags: [String!]) {
        assets(options: { take: 2, tags: $tags, tagsOperator: AND }) { items { id } }
    }
`;

const ASSIGN_ASSET_MUTATION = `
    mutation AssignDamatongStorefrontAsset($input: AssignAssetsToChannelInput!) {
        assignAssetsToChannel(input: $input) { id }
    }
`;

const UPDATE_PROFILE_MUTATION = `
    mutation UpdateDamatongStoreProfile($input: UpdateStoreProfileInput!) {
        updateStoreProfile(input: $input) { id updatedAt }
    }
`;

const CREATE_COLLECTION_MUTATION = `
    mutation CreateDamatongCollection($input: CreateCollectionInput!) {
        createCollection(input: $input) { id }
    }
`;

const UPDATE_COLLECTION_MUTATION = `
    mutation UpdateDamatongCollection($input: UpdateCollectionInput!) {
        updateCollection(input: $input) { id }
    }
`;

const APPLY_BLOCKS_MUTATION = `
    mutation ApplyDamatongContentChanges($input: ApplyStorefrontContentChangesInput!) {
        applyStorefrontContentChanges(input: $input) { id updatedAt code type }
    }
`;

const DELETE_BLOCK_MUTATION = `
    mutation DeleteDamatongContentBlock($id: ID!) {
        deleteStorefrontContentBlock(id: $id) { result message }
    }
`;

const DELETE_COLLECTION_MUTATION = `
    mutation DeleteDamatongCollection($id: ID!) {
        deleteCollection(id: $id) { result message }
    }
`;

const UPDATE_SETTINGS_MUTATION = `
    mutation UpdateDamatongContentSettings($input: UpdateStorefrontContentSettingsInput!) {
        updateStorefrontContentSettings(input: $input) { heroAutoplayIntervalSeconds }
    }
`;

const SHOP_VERIFICATION_QUERY = `
    query VerifyDamatongStorefront {
        activeChannel { code customFields { storefrontNameZh storefrontNameEn } }
        storefrontBranding {
            logoAssetId
            logoOnLightAssetId
            logoOnDarkAssetId
            name
            description
            tagline
            backgroundColor
            primaryColor
            accentColor
            highlightColor
        }
        collections(options: { take: 200 }) {
            items { id name slug featuredAsset { id } }
        }
        storefrontContent {
            id
            code
            type
            imageAsset { id }
            title
            subtitle
            body
            ctaLabel
            settings
            items {
                id
                position
                imageAsset { id }
                targetType
                targetValue
                settings
                label
                description
            }
        }
        storefrontContentSettings { heroAutoplayIntervalSeconds }
    }
`;

export function isLocalApiOrigin(value) {
    try {
        const url = new URL(value);
        return (
            (url.protocol === 'http:' || url.protocol === 'https:') &&
            (url.hostname === 'localhost' ||
                url.hostname === '127.0.0.1' ||
                url.hostname === '::1' ||
                url.hostname.endsWith('.localhost'))
        );
    } catch {
        return false;
    }
}

export function damatongAssetTags(key, hash) {
    return ['damatong-storefront', `damatong-storefront:${key}`, `damatong-storefront-sha256:${hash}`];
}

export async function prepareDamatongAssets(manifest = damatongAssets) {
    assert.ok(manifest.length > 0, 'Damatong asset manifest is empty');
    const keys = new Set();
    const prepared = [];
    for (const asset of manifest) {
        assert.match(asset.key, /^[a-z0-9][a-z0-9-]+$/u, `Invalid asset key: ${asset.key}`);
        assert.ok(!keys.has(asset.key), `Duplicate Damatong asset key: ${asset.key}`);
        assert.ok(asset.nameZh && asset.nameEn, `${asset.key} requires bilingual asset names`);
        keys.add(asset.key);
        const bytes = await readFile(asset.file);
        assert.ok(bytes.byteLength > 0, `Damatong asset is empty: ${asset.file}`);
        const hash = createHash('sha256').update(bytes).digest('hex');
        prepared.push({ ...asset, bytes, hash, tags: damatongAssetTags(asset.key, hash) });
    }
    return prepared;
}

function requestHeaders(authToken, channelToken, languageCode = 'en') {
    return {
        ...(authToken ? { authorization: `Bearer ${String(authToken)}` } : {}),
        'vendure-token': String(channelToken),
        'language-code': languageCode,
    };
}

async function graphql(fetchImpl, endpoint, query, variables, headers = {}) {
    const response = await fetchImpl(endpoint, {
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

async function authenticate(fetchImpl, adminEndpoint, username, password) {
    const result = await graphql(fetchImpl, adminEndpoint, LOGIN_MUTATION, { username, password });
    assert.equal(result.data.login.errorCode, undefined, result.data.login.message);
    const authToken = result.response.headers.get('vendure-auth-token') ?? '';
    assert.ok(authToken, 'Admin login did not return a bearer token');
    return { authToken, channels: result.data.login.channels };
}

async function loadProfile(fetchImpl, adminEndpoint, authToken, channel) {
    const result = await graphql(
        fetchImpl,
        adminEndpoint,
        STORE_PROFILES_QUERY,
        undefined,
        requestHeaders(authToken, channel.token),
    );
    const profiles = result.data.storeProfiles.filter(item => item.channel.code === channel.code);
    assert.equal(profiles.length, 1, `Expected one StoreProfile for Channel ${channel.code}`);
    return profiles[0];
}

async function loadBlocks(fetchImpl, adminEndpoint, authToken, channel) {
    const result = await graphql(
        fetchImpl,
        adminEndpoint,
        ADMIN_BLOCKS_QUERY,
        undefined,
        requestHeaders(authToken, channel.token),
    );
    return {
        blocks: result.data.storefrontContentBlocks,
        settings: result.data.storefrontContentSettings,
    };
}

async function loadCollections(fetchImpl, adminEndpoint, authToken, channel) {
    const entries = await Promise.all(
        damatongCategories.map(async definition => {
            const en = definition.translations.find(value => value.languageCode === 'en');
            const result = await graphql(
                fetchImpl,
                adminEndpoint,
                COLLECTION_QUERY,
                { slug: en.slug },
                requestHeaders(authToken, channel.token),
            );
            return [definition.code, result.data.collection];
        }),
    );
    return new Map(entries);
}

async function loadCollectionBySlug(fetchImpl, adminEndpoint, authToken, channel, slug) {
    const result = await graphql(
        fetchImpl,
        adminEndpoint,
        COLLECTION_QUERY,
        { slug },
        requestHeaders(authToken, channel.token),
    );
    return result.data.collection;
}

async function findAsset(fetchImpl, adminEndpoint, authToken, channel, asset) {
    const result = await graphql(
        fetchImpl,
        adminEndpoint,
        ASSET_QUERY,
        { tags: asset.tags },
        requestHeaders(authToken, channel.token),
    );
    assert.ok(result.data.assets.items.length <= 1, `Ambiguous asset tags for ${asset.key}`);
    return result.data.assets.items[0] ?? null;
}

async function uploadAsset(fetchImpl, adminEndpoint, authToken, channel, asset) {
    const form = new FormData();
    form.append(
        'operations',
        JSON.stringify({
            operationName: 'CreateDamatongStorefrontAsset',
            query: `mutation CreateDamatongStorefrontAsset($input: [CreateAssetInput!]!) {
                createAssets(input: $input) {
                    ... on Asset { id }
                    ... on ErrorResult { errorCode message }
                }
            }`,
            variables: {
                input: [
                    {
                        file: null,
                        tags: asset.tags,
                        translations: [
                            { languageCode: 'zh_Hans', name: asset.nameZh },
                            { languageCode: 'en', name: asset.nameEn },
                        ],
                    },
                ],
            },
        }),
    );
    form.append('map', JSON.stringify({ 0: ['variables.input.0.file'] }));
    form.append('0', new Blob([asset.bytes], { type: asset.mimeType }), path.basename(asset.file));
    const response = await fetchImpl(adminEndpoint, {
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
                `Damatong asset upload failed (HTTP ${String(response.status)})`,
        );
    }
    return result;
}

async function assignAsset(fetchImpl, adminEndpoint, authToken, channel, assetId) {
    await graphql(
        fetchImpl,
        adminEndpoint,
        ASSIGN_ASSET_MUTATION,
        { input: { assetIds: [assetId], channelId: channel.id } },
        requestHeaders(authToken, channel.token),
    );
}

function profileAssetId(profile, field) {
    const relation = {
        logoAssetId: 'logoAsset',
        logoOnLightAssetId: 'logoOnLightAsset',
        logoOnDarkAssetId: 'logoOnDarkAsset',
    }[field];
    return profile[relation]?.id ?? null;
}

export function buildDamatongBrandPlan(
    profile,
    assetIdsByKey,
    brand = damatongStorefront,
    manifest = damatongAssets,
) {
    const desired = {
        storefrontNameZh: brand.storefrontNameZh,
        storefrontNameEn: brand.storefrontNameEn,
        descriptionZh: brand.descriptionZh,
        descriptionEn: brand.descriptionEn,
        taglineZh: brand.taglineZh,
        taglineEn: brand.taglineEn,
        brandBackgroundColor: brand.brandBackgroundColor,
        brandPrimaryColor: brand.brandPrimaryColor,
        brandAccentColor: brand.brandAccentColor,
        brandHighlightColor: brand.brandHighlightColor,
    };
    const current = {
        storefrontNameZh: profile.channel.customFields?.storefrontNameZh ?? '',
        storefrontNameEn: profile.channel.customFields?.storefrontNameEn ?? '',
        descriptionZh: profile.descriptionZh ?? '',
        descriptionEn: profile.descriptionEn ?? '',
        taglineZh: profile.taglineZh ?? '',
        taglineEn: profile.taglineEn ?? '',
        brandBackgroundColor: profile.brandBackgroundColor ?? null,
        brandPrimaryColor: profile.brandPrimaryColor ?? null,
        brandAccentColor: profile.brandAccentColor ?? null,
        brandHighlightColor: profile.brandHighlightColor ?? null,
    };
    const input = { id: profile.id, expectedUpdatedAt: profile.updatedAt, ...desired };
    const changes = Object.keys(desired).filter(key => current[key] !== desired[key]);
    for (const asset of manifest.filter(value => value.profileField)) {
        const assetId = assetIdsByKey.get(asset.key);
        assert.ok(assetId, `Missing profile asset ID for ${asset.key}`);
        input[asset.profileField] = assetId;
        if (String(profileAssetId(profile, asset.profileField)) !== String(assetId)) {
            changes.push(asset.profileField);
        }
    }
    return { action: changes.length ? 'update' : 'noop', changes, input };
}

function normalizedTranslations(translations, fields) {
    return [...(translations ?? [])]
        .map(value =>
            Object.fromEntries([
                ['languageCode', value.languageCode],
                ...fields.map(field => [field, value[field] ?? '']),
            ]),
        )
        .sort((left, right) => left.languageCode.localeCompare(right.languageCode));
}

export function buildDamatongCategoryPlan(existing, definition, featuredAssetId) {
    assert.ok(featuredAssetId, `${definition.code} requires a featured asset`);
    const translations = normalizedTranslations(definition.translations, ['name', 'slug', 'description']);
    const existingAssetIds = existing?.assets?.map(asset => asset.id) ?? [];
    const assetIds = Array.from(new Set([featuredAssetId, ...existingAssetIds]));
    const createInput = { filters: [], translations, featuredAssetId, assetIds };
    if (!existing) {
        return { code: definition.code, action: 'create', input: createInput };
    }
    const currentTranslations = normalizedTranslations(existing.translations, [
        'name',
        'slug',
        'description',
    ]);
    const translationsChanged = JSON.stringify(currentTranslations) !== JSON.stringify(translations);
    const featuredAssetChanged = String(existing.featuredAsset?.id ?? '') !== String(featuredAssetId);
    const galleryChanged = !existingAssetIds.map(String).includes(String(featuredAssetId));
    return {
        code: definition.code,
        id: existing.id,
        action: translationsChanged || featuredAssetChanged || galleryChanged ? 'update' : 'noop',
        input: { id: existing.id, translations, featuredAssetId, assetIds },
    };
}

function itemStableKey(item) {
    const settings = item.settings ?? {};
    for (const key of [
        'categoryCode',
        'supportChannel',
        'navigationKey',
        'pluginCode',
        'documentKind',
        'metricKey',
        'trustKey',
        'authTag',
    ]) {
        if (typeof settings[key] === 'string' && settings[key]) return `${key}:${settings[key]}`;
    }
    return `position:${String(item.position)}`;
}

function reconcileBlockItems(existing, desired) {
    if (!existing) return desired;
    const existingItems = new Map(existing.items.map(item => [itemStableKey(item), item]));
    return {
        ...desired,
        items: desired.items.map(item => {
            const current = existingItems.get(itemStableKey(item));
            return current?.id ? { ...item, id: current.id } : item;
        }),
    };
}

function contentItemInput(item) {
    return {
        ...(item.id ? { id: item.id } : {}),
        enabled: item.enabled ?? true,
        position: item.position,
        imageAssetId: item.imageAsset?.id ?? item.imageAssetId ?? null,
        imageUrl: item.imageUrl ?? null,
        targetType: item.targetType ?? 'NONE',
        targetValue: item.targetValue ?? null,
        settings: item.settings ?? null,
        translations: normalizedTranslations(item.translations, ['label', 'description']),
    };
}

function hasDashboardSupportContacts(block) {
    return (
        block?.type === 'SUPPORT' &&
        block.settings?.placeholderContacts !== true &&
        block.items.some(
            item =>
                item.enabled !== false &&
                item.targetType !== 'NONE' &&
                typeof item.targetValue === 'string' &&
                item.targetValue.trim().length > 0,
        )
    );
}

export function preserveDashboardSupportContacts(existingBlocks, desiredBlocks) {
    const existing = existingBlocks.find(block => block.type === 'SUPPORT');
    if (!hasDashboardSupportContacts(existing)) return desiredBlocks;
    return desiredBlocks.map(block =>
        block.type === 'SUPPORT'
            ? {
                  ...block,
                  settings: {
                      ...block.settings,
                      ...existing.settings,
                      placeholderContacts: false,
                      contactOwnership: 'dashboard',
                  },
                  translations: normalizedTranslations(existing.translations, [
                      'title',
                      'subtitle',
                      'body',
                      'ctaLabel',
                  ]),
                  items: existing.items.map(contentItemInput),
              }
            : block,
    );
}

function comparableItem(item) {
    return {
        enabled: item.enabled ?? true,
        position: item.position,
        imageAssetId: item.imageAsset?.id ?? item.imageAssetId ?? null,
        imageUrl: item.imageUrl ?? null,
        targetType: item.targetType ?? 'NONE',
        targetValue: item.targetValue ?? null,
        settings: item.settings ?? null,
        translations: normalizedTranslations(item.translations, ['label', 'description']),
    };
}

function comparableBlock(block) {
    return {
        code: block.code,
        internalName: block.internalName ?? null,
        type: block.type,
        layoutVariant: block.layoutVariant ?? 'AUTO',
        enabled: block.enabled ?? true,
        position: block.position,
        startsAt: block.startsAt ?? null,
        endsAt: block.endsAt ?? null,
        imageAssetId: block.imageAsset?.id ?? block.imageAssetId ?? null,
        imageUrl: block.imageUrl ?? null,
        backgroundColor: block.backgroundColor ?? null,
        textColor: block.textColor ?? null,
        targetType: block.targetType ?? 'NONE',
        targetValue: block.targetValue ?? null,
        settings: block.settings ?? null,
        translations: normalizedTranslations(block.translations, ['title', 'subtitle', 'body', 'ctaLabel']),
        items: [...block.items].sort((left, right) => left.position - right.position).map(comparableItem),
    };
}

function findExistingBlock(existingBlocks, desired, claimedExistingIds) {
    const availableBlocks = existingBlocks.filter(block => !claimedExistingIds.has(String(block.id)));
    const exact = availableBlocks.filter(block => block.code === desired.code);
    assert.ok(exact.length <= 1, `Content code ${desired.code} is ambiguous`);
    if (exact[0]) return exact[0];
    const reviewedLegacyCodes = REVIEWED_LEGACY_CODES.get(desired.code) ?? [];
    const reviewedLegacy = availableBlocks.filter(block => reviewedLegacyCodes.includes(block.code));
    assert.ok(reviewedLegacy.length <= 1, `Reviewed legacy content for ${desired.code} is ambiguous`);
    if (reviewedLegacy[0]) return reviewedLegacy[0];
    if (!ADOPT_EXISTING_TYPES.has(desired.type)) return null;
    const sameType = availableBlocks.filter(block => block.type === desired.type);
    assert.ok(sameType.length <= 1, `Content type ${desired.type} is ambiguous`);
    return sameType[0] ?? null;
}

export function buildDamatongContentPlans(existingBlocks, desiredBlocks) {
    const codes = new Set();
    const claimedExistingIds = new Set();
    const plans = desiredBlocks.map(desiredBlock => {
        assert.ok(!codes.has(desiredBlock.code), `Duplicate desired content code ${desiredBlock.code}`);
        codes.add(desiredBlock.code);
        const existing = findExistingBlock(existingBlocks, desiredBlock, claimedExistingIds);
        if (existing) {
            assert.equal(existing.type, desiredBlock.type, `${desiredBlock.code} has the wrong content type`);
            claimedExistingIds.add(String(existing.id));
        }
        const desired = reconcileBlockItems(existing, desiredBlock);
        if (!existing) {
            return { code: desired.code, type: desired.type, action: 'create', input: desired };
        }
        const action =
            JSON.stringify(comparableBlock(existing)) === JSON.stringify(comparableBlock(desired))
                ? 'noop'
                : 'update';
        return {
            code: desired.code,
            type: desired.type,
            action,
            input: {
                id: existing.id,
                expectedUpdatedAt: existing.updatedAt,
                ...desired,
            },
        };
    });
    const unmanagedEnabledHeroes = existingBlocks.filter(
        block =>
            block.type === 'HERO' && block.enabled !== false && !claimedExistingIds.has(String(block.id)),
    );
    assert.equal(
        unmanagedEnabledHeroes.length,
        0,
        `Unmanaged active Damatong heroes must be reviewed: ${unmanagedEnabledHeroes
            .map(block => block.code)
            .join(', ')}`,
    );
    return plans;
}

function findSourceAiPluginItem(sourceBlocks, sourceChannelCode) {
    const pluginBlocks = sourceBlocks.filter(
        block => block.type === 'CLIENT_PLUGINS' && block.code === 'storefront-client-plugins',
    );
    assert.equal(
        pluginBlocks.length,
        1,
        `Expected one default-site client plugin block in Channel ${sourceChannelCode}`,
    );
    const matches = pluginBlocks[0].items.filter(
        item => item.settings?.pluginCode === DAMATONG_AI_PLUGIN_CODE && item.enabled,
    );
    assert.equal(
        matches.length,
        1,
        `Expected one enabled ${DAMATONG_AI_PLUGIN_CODE} in Channel ${sourceChannelCode}`,
    );
    const languages = new Set(matches[0].translations.map(value => value.languageCode));
    for (const languageCode of LANGUAGE_CODES) {
        assert.ok(languages.has(languageCode), `${DAMATONG_AI_PLUGIN_CODE} is missing ${languageCode}`);
    }
    return matches[0];
}

async function upsertCollection(fetchImpl, adminEndpoint, authToken, channel, plan) {
    if (plan.action === 'noop') return plan.id;
    const mutation = plan.action === 'create' ? CREATE_COLLECTION_MUTATION : UPDATE_COLLECTION_MUTATION;
    const result = await graphql(
        fetchImpl,
        adminEndpoint,
        mutation,
        { input: plan.input },
        requestHeaders(authToken, channel.token),
    );
    return plan.action === 'create' ? result.data.createCollection.id : result.data.updateCollection.id;
}

async function applyBlockPlans(fetchImpl, adminEndpoint, authToken, channel, blocks, plans) {
    const creates = plans.filter(plan => plan.action === 'create').map(plan => plan.input);
    const updates = plans.filter(plan => plan.action === 'update').map(plan => plan.input);
    if (!creates.length && !updates.length) return blocks;
    const result = await graphql(
        fetchImpl,
        adminEndpoint,
        APPLY_BLOCKS_MUTATION,
        {
            input: {
                expectedBlocks: blocks.map(block => ({
                    id: block.id,
                    expectedUpdatedAt: block.updatedAt,
                })),
                creates,
                updates,
            },
        },
        requestHeaders(authToken, channel.token),
    );
    return result.data.applyStorefrontContentChanges;
}

function assertShopBranding(branding, languageCode, assetIdsByKey, brand) {
    assert.equal(branding.name, languageCode === 'zh_Hans' ? brand.storefrontNameZh : brand.storefrontNameEn);
    assert.equal(
        branding.description,
        languageCode === 'zh_Hans' ? brand.descriptionZh : brand.descriptionEn,
    );
    assert.equal(branding.tagline, languageCode === 'zh_Hans' ? brand.taglineZh : brand.taglineEn);
    assert.equal(String(branding.logoAssetId), String(assetIdsByKey.get('brand-app-icon')));
    assert.equal(String(branding.logoOnLightAssetId), String(assetIdsByKey.get('brand-logo-light')));
    assert.equal(String(branding.logoOnDarkAssetId), String(assetIdsByKey.get('brand-logo-dark')));
    assert.equal(branding.backgroundColor, brand.brandBackgroundColor);
    assert.equal(branding.primaryColor, brand.brandPrimaryColor);
    assert.equal(branding.accentColor, brand.brandAccentColor);
    assert.equal(branding.highlightColor, brand.brandHighlightColor);
}

async function verifyShop(
    fetchImpl,
    shopEndpoint,
    channel,
    assetIdsByKey,
    collectionIdsByCode,
    desiredBlocks,
) {
    for (const languageCode of LANGUAGE_CODES) {
        const endpoint = new URL(shopEndpoint);
        endpoint.searchParams.set('languageCode', languageCode);
        const result = await graphql(
            fetchImpl,
            endpoint.toString(),
            SHOP_VERIFICATION_QUERY,
            undefined,
            requestHeaders('', channel.token, languageCode),
        );
        assert.equal(result.data.activeChannel.code, channel.code);
        assertShopBranding(result.data.storefrontBranding, languageCode, assetIdsByKey, damatongStorefront);
        assert.equal(
            result.data.storefrontContentSettings.heroAutoplayIntervalSeconds,
            damatongStorefront.heroAutoplayIntervalSeconds,
        );

        for (const category of damatongCategories) {
            const expectedId = collectionIdsByCode.get(category.code);
            const collection = result.data.collections.items.find(
                item => String(item.id) === String(expectedId),
            );
            assert.ok(collection, `Shop API is missing ${category.code} for ${languageCode}`);
            assert.equal(
                String(collection.featuredAsset?.id),
                String(assetIdsByKey.get(category.assetKey)),
                `${category.code} has the wrong Shop API image`,
            );
            const expectedTranslation = category.translations.find(
                value => value.languageCode === languageCode,
            );
            assert.equal(collection.name, expectedTranslation.name);
            assert.equal(collection.slug, expectedTranslation.slug);
        }

        for (const desired of desiredBlocks) {
            const block = result.data.storefrontContent.find(item => item.code === desired.code);
            assert.ok(block, `Shop API is missing ${desired.code} for ${languageCode}`);
            assert.equal(block.type, desired.type);
            assert.equal(
                String(block.imageAsset?.id ?? ''),
                String(desired.imageAssetId ?? ''),
                `${desired.code} has the wrong Shop API image`,
            );
            assert.deepEqual(block.settings ?? null, desired.settings ?? null);
            const expectedTranslation = desired.translations.find(
                value => value.languageCode === languageCode,
            );
            assert.equal(block.title, expectedTranslation.title);
            assert.equal(block.subtitle ?? '', expectedTranslation.subtitle ?? '');
            assert.equal(block.body ?? '', expectedTranslation.body ?? '');
            assert.equal(block.ctaLabel ?? '', expectedTranslation.ctaLabel ?? '');
            const expectedItems = desired.items
                .filter(item => item.enabled !== false)
                .sort((left, right) => left.position - right.position);
            const actualItems = [...block.items].sort((left, right) => left.position - right.position);
            assert.equal(
                actualItems.length,
                expectedItems.length,
                `${desired.code} has the wrong item count`,
            );
            for (let index = 0; index < expectedItems.length; index += 1) {
                const expectedItem = expectedItems[index];
                const actualItem = actualItems[index];
                const expectedItemTranslation = expectedItem.translations.find(
                    value => value.languageCode === languageCode,
                );
                assert.equal(actualItem.position, expectedItem.position);
                assert.equal(
                    String(actualItem.imageAsset?.id ?? ''),
                    String(expectedItem.imageAssetId ?? ''),
                );
                assert.equal(actualItem.targetType, expectedItem.targetType ?? 'NONE');
                assert.equal(actualItem.targetValue ?? null, expectedItem.targetValue ?? null);
                assert.deepEqual(actualItem.settings ?? null, expectedItem.settings ?? null);
                assert.equal(actualItem.label, expectedItemTranslation?.label ?? '');
                assert.equal(actualItem.description ?? '', expectedItemTranslation?.description ?? '');
            }
        }
        const pluginBlock = result.data.storefrontContent.find(
            item => item.code === 'storefront-client-plugins',
        );
        assert.ok(
            pluginBlock.items.some(item => item.settings?.pluginCode === DAMATONG_AI_PLUGIN_CODE),
            'Damatong Shop API is missing the synchronized AI plugin',
        );
    }
}

function profileRestoreInput(beforeProfile, currentProfile) {
    return {
        id: beforeProfile.id,
        expectedUpdatedAt: currentProfile.updatedAt,
        storefrontNameZh: beforeProfile.channel.customFields?.storefrontNameZh ?? '',
        storefrontNameEn: beforeProfile.channel.customFields?.storefrontNameEn ?? '',
        descriptionZh: beforeProfile.descriptionZh ?? '',
        descriptionEn: beforeProfile.descriptionEn ?? '',
        taglineZh: beforeProfile.taglineZh ?? '',
        taglineEn: beforeProfile.taglineEn ?? '',
        brandBackgroundColor: beforeProfile.brandBackgroundColor ?? null,
        brandPrimaryColor: beforeProfile.brandPrimaryColor ?? null,
        brandAccentColor: beforeProfile.brandAccentColor ?? null,
        brandHighlightColor: beforeProfile.brandHighlightColor ?? null,
        logoAssetId: profileAssetId(beforeProfile, 'logoAssetId'),
        logoOnLightAssetId: profileAssetId(beforeProfile, 'logoOnLightAssetId'),
        logoOnDarkAssetId: profileAssetId(beforeProfile, 'logoOnDarkAssetId'),
    };
}

function comparableProfile(profile) {
    const { id, expectedUpdatedAt, ...values } = profileRestoreInput(profile, profile);
    return { id: String(id), ...values };
}

function collectionRestoreInput(collection) {
    return {
        id: collection.id,
        featuredAssetId: collection.featuredAsset?.id ?? null,
        assetIds: collection.assets?.map(asset => asset.id) ?? [],
        translations: normalizedTranslations(collection.translations, ['name', 'slug', 'description']),
    };
}

function blockRestoreInput(beforeBlock, currentBlock) {
    const currentItemIds = new Set(currentBlock.items.map(item => String(item.id)));
    const restoreItem = item => {
        const input = contentItemInput(item);
        if (!currentItemIds.has(String(item.id))) delete input.id;
        return input;
    };
    return {
        id: beforeBlock.id,
        expectedUpdatedAt: currentBlock.updatedAt,
        code: beforeBlock.code,
        internalName: beforeBlock.internalName ?? null,
        type: beforeBlock.type,
        layoutVariant: beforeBlock.layoutVariant ?? 'AUTO',
        enabled: beforeBlock.enabled ?? true,
        position: beforeBlock.position,
        startsAt: beforeBlock.startsAt ?? null,
        endsAt: beforeBlock.endsAt ?? null,
        imageAssetId: beforeBlock.imageAsset?.id ?? null,
        imageUrl: beforeBlock.imageUrl ?? null,
        backgroundColor: beforeBlock.backgroundColor ?? null,
        textColor: beforeBlock.textColor ?? null,
        targetType: beforeBlock.targetType ?? 'NONE',
        targetValue: beforeBlock.targetValue ?? null,
        settings: beforeBlock.settings ?? null,
        translations: normalizedTranslations(beforeBlock.translations, [
            'title',
            'subtitle',
            'body',
            'ctaLabel',
        ]),
        items: beforeBlock.items.map(restoreItem),
    };
}

function comparableCollection(collection) {
    if (!collection) return null;
    return {
        id: String(collection.id),
        featuredAssetId: String(collection.featuredAsset?.id ?? ''),
        assetIds: (collection.assets ?? []).map(asset => String(asset.id)).sort(),
        translations: normalizedTranslations(collection.translations, ['name', 'slug', 'description']),
    };
}

function comparableBlockSet(blocks) {
    return [...blocks].map(comparableBlock).sort((left, right) => left.code.localeCompare(right.code));
}

async function deleteEntity(fetchImpl, adminEndpoint, authToken, channel, mutation, dataKey, id) {
    const result = await graphql(
        fetchImpl,
        adminEndpoint,
        mutation,
        { id },
        requestHeaders(authToken, channel.token),
    );
    const deletion = result.data[dataKey];
    assert.equal(deletion.result, 'DELETED', deletion.message || `Could not delete ${String(id)}`);
}

async function rollbackDamatongStorefront({
    fetchImpl,
    adminEndpoint,
    authToken,
    channel,
    beforeProfile,
    beforeContent,
    beforeCollections,
    categoryPlans,
    contentPlans,
}) {
    let currentContent = await loadBlocks(fetchImpl, adminEndpoint, authToken, channel);
    for (const plan of contentPlans.filter(candidate => candidate.action === 'create')) {
        const created = currentContent.blocks.find(block => block.code === plan.code);
        if (created) {
            await deleteEntity(
                fetchImpl,
                adminEndpoint,
                authToken,
                channel,
                DELETE_BLOCK_MUTATION,
                'deleteStorefrontContentBlock',
                created.id,
            );
        }
    }
    currentContent = await loadBlocks(fetchImpl, adminEndpoint, authToken, channel);
    const changedBlockIds = new Set(
        contentPlans.filter(plan => plan.action === 'update').map(plan => String(plan.input.id)),
    );
    const restorePlans = beforeContent.blocks
        .filter(block => changedBlockIds.has(String(block.id)))
        .map(block => {
            const current = currentContent.blocks.find(
                candidate => String(candidate.id) === String(block.id),
            );
            assert.ok(current, `Cannot restore missing Damatong block ${block.code}`);
            return { action: 'update', input: blockRestoreInput(block, current) };
        });
    await applyBlockPlans(fetchImpl, adminEndpoint, authToken, channel, currentContent.blocks, restorePlans);
    if (
        currentContent.settings.heroAutoplayIntervalSeconds !==
        beforeContent.settings.heroAutoplayIntervalSeconds
    ) {
        await graphql(
            fetchImpl,
            adminEndpoint,
            UPDATE_SETTINGS_MUTATION,
            {
                input: {
                    heroAutoplayIntervalSeconds: beforeContent.settings.heroAutoplayIntervalSeconds,
                },
            },
            requestHeaders(authToken, channel.token),
        );
    }

    const currentCollections = await loadCollections(fetchImpl, adminEndpoint, authToken, channel);
    for (const plan of [...categoryPlans].reverse()) {
        const before = beforeCollections.get(plan.code);
        const current = currentCollections.get(plan.code);
        if (!before && current) {
            await deleteEntity(
                fetchImpl,
                adminEndpoint,
                authToken,
                channel,
                DELETE_COLLECTION_MUTATION,
                'deleteCollection',
                current.id,
            );
        } else if (before && current && plan.action === 'update') {
            await graphql(
                fetchImpl,
                adminEndpoint,
                UPDATE_COLLECTION_MUTATION,
                { input: collectionRestoreInput(before) },
                requestHeaders(authToken, channel.token),
            );
        }
    }

    const currentProfile = await loadProfile(fetchImpl, adminEndpoint, authToken, channel);
    if (
        JSON.stringify(comparableProfile(currentProfile)) !== JSON.stringify(comparableProfile(beforeProfile))
    ) {
        await graphql(
            fetchImpl,
            adminEndpoint,
            UPDATE_PROFILE_MUTATION,
            { input: profileRestoreInput(beforeProfile, currentProfile) },
            requestHeaders(authToken, channel.token),
        );
    }

    const [restoredProfile, restoredContent] = await Promise.all([
        loadProfile(fetchImpl, adminEndpoint, authToken, channel),
        loadBlocks(fetchImpl, adminEndpoint, authToken, channel),
    ]);
    assert.deepEqual(comparableProfile(restoredProfile), comparableProfile(beforeProfile));
    assert.deepEqual(comparableBlockSet(restoredContent.blocks), comparableBlockSet(beforeContent.blocks));
    assert.equal(
        restoredContent.settings.heroAutoplayIntervalSeconds,
        beforeContent.settings.heroAutoplayIntervalSeconds,
    );
    for (const definition of damatongCategories) {
        const before = beforeCollections.get(definition.code);
        const beforeEnglish = before?.translations.find(value => value.languageCode === 'en');
        const slug =
            beforeEnglish?.slug ?? definition.translations.find(value => value.languageCode === 'en').slug;
        const restored = await loadCollectionBySlug(fetchImpl, adminEndpoint, authToken, channel, slug);
        assert.deepEqual(comparableCollection(restored), comparableCollection(before));
    }
}

export async function syncDamatongStorefront({
    apiOrigin,
    shopOrigin = apiOrigin,
    username,
    password,
    channelToken = damatongStorefront.channelToken,
    sourceChannelCode = damatongStorefront.sourceChannelCode,
    apply = false,
    verify = false,
    allowRemote = false,
    production = process.env.NODE_ENV === 'production',
    fetchImpl = fetch,
    assetManifest = damatongAssets,
}) {
    assert.ok(apiOrigin, 'VENDURE_API_ORIGIN or --api-origin is required');
    assert.ok(username && password, 'SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required');
    assert.ok(!(apply && verify), '--apply and --verify are mutually exclusive');
    if (apply && (production || !isLocalApiOrigin(apiOrigin))) {
        assert.ok(allowRemote, 'Remote or production writes require both --apply and --allow-remote');
        assert.equal(
            damatongStorefront.supportPageReadyForProduction,
            true,
            'Remote Damatong writes require a production-safe support page',
        );
    }

    const normalizedApiOrigin = apiOrigin.replace(/\/$/u, '');
    const normalizedShopOrigin = shopOrigin.replace(/\/$/u, '');
    const adminEndpoint = `${normalizedApiOrigin}/admin-api`;
    const shopEndpoint = `${normalizedShopOrigin}/shop-api`;
    const preparedAssets = await prepareDamatongAssets(assetManifest);
    const storefrontChannelResult = await graphql(fetchImpl, shopEndpoint, ACTIVE_CHANNEL_QUERY, undefined);
    const storefrontChannelCode = storefrontChannelResult.data.activeChannel?.code;
    assert.ok(storefrontChannelCode, 'The Damatong Shop API did not resolve an active Channel');
    const session = await authenticate(fetchImpl, adminEndpoint, username, password);
    const targetChannels = session.channels.filter(item => item.code === storefrontChannelCode);
    const sourceChannels = session.channels.filter(item => item.code === sourceChannelCode);
    assert.equal(
        targetChannels.length,
        1,
        `Expected one accessible Channel routed by the Damatong Shop API (${storefrontChannelCode})`,
    );
    assert.equal(
        sourceChannels.length,
        1,
        `Expected one accessible source Channel with code ${sourceChannelCode}`,
    );
    const [channel] = targetChannels;
    const [sourceChannel] = sourceChannels;
    assert.notEqual(
        String(channel.id),
        String(sourceChannel.id),
        'Damatong and default-site Channels must be different',
    );

    const [profile, currentContent, currentCollections, sourceContent] = await Promise.all([
        loadProfile(fetchImpl, adminEndpoint, session.authToken, channel),
        loadBlocks(fetchImpl, adminEndpoint, session.authToken, channel),
        loadCollections(fetchImpl, adminEndpoint, session.authToken, channel),
        loadBlocks(fetchImpl, adminEndpoint, session.authToken, sourceChannel),
    ]);
    const sourceAiPluginItem = findSourceAiPluginItem(sourceContent.blocks, sourceChannelCode);

    const assetActions = [];
    const resolvedAssets = new Map();
    for (const asset of preparedAssets) {
        const existing = await findAsset(fetchImpl, adminEndpoint, session.authToken, channel, asset);
        assetActions.push({
            key: asset.key,
            action: existing ? 'reuse' : 'upload',
            assetId: existing?.id ?? null,
            hash: asset.hash,
        });
        resolvedAssets.set(asset.key, existing);
    }

    const plannedAssetIds = new Map(
        assetActions.map(item => [item.key, item.assetId ?? `pending-asset:${item.key}`]),
    );
    if (verify) {
        assert.ok(
            assetActions.every(item => item.action === 'reuse'),
            'Damatong verification requires every immutable asset to exist',
        );
    }
    const brandPlanPreview = buildDamatongBrandPlan(profile, plannedAssetIds);
    const categoryPlanPreview = damatongCategories.map(definition =>
        buildDamatongCategoryPlan(
            currentCollections.get(definition.code),
            definition,
            plannedAssetIds.get(definition.assetKey),
        ),
    );
    const plannedCollectionIds = new Map(
        categoryPlanPreview.map(plan => [plan.code, plan.id ?? `pending-collection:${plan.code}`]),
    );
    const previewBlocks = preserveDashboardSupportContacts(
        currentContent.blocks,
        buildDamatongContentBlocks({
            assetIdsByKey: plannedAssetIds,
            collectionIdsByCode: plannedCollectionIds,
            sourceAiPluginItem,
            sourceChannelCode,
        }),
    );
    const contentPlanPreview = buildDamatongContentPlans(currentContent.blocks, previewBlocks);
    const settingsAction =
        currentContent.settings.heroAutoplayIntervalSeconds === damatongStorefront.heroAutoplayIntervalSeconds
            ? 'noop'
            : 'update';

    if (verify) {
        assert.equal(brandPlanPreview.action, 'noop', 'Damatong brand Admin API verification failed');
        assert.ok(
            categoryPlanPreview.every(plan => plan.action === 'noop'),
            'Damatong category Admin API verification failed',
        );
        assert.ok(
            contentPlanPreview.every(plan => plan.action === 'noop'),
            'Damatong content Admin API verification failed',
        );
        assert.equal(settingsAction, 'noop', 'Damatong content settings Admin API verification failed');
        await verifyShop(
            fetchImpl,
            shopEndpoint,
            channel,
            plannedAssetIds,
            plannedCollectionIds,
            previewBlocks,
        );
        return {
            applied: false,
            verified: true,
            apiOrigin: normalizedApiOrigin,
            shopOrigin: normalizedShopOrigin,
            channelCode: channel.code,
            channelToken,
            sourceChannelCode,
            assets: assetActions,
            brand: { action: brandPlanPreview.action, changes: brandPlanPreview.changes },
            categories: categoryPlanPreview.map(({ code, action }) => ({ code, action })),
            content: contentPlanPreview.map(({ code, type, action }) => ({ code, type, action })),
            settings: { action: settingsAction },
        };
    }

    if (!apply) {
        return {
            applied: false,
            verified: false,
            apiOrigin: normalizedApiOrigin,
            shopOrigin: normalizedShopOrigin,
            channelCode: channel.code,
            channelToken,
            sourceChannelCode,
            assets: assetActions,
            brand: { action: brandPlanPreview.action, changes: brandPlanPreview.changes },
            categories: categoryPlanPreview.map(({ code, action }) => ({ code, action })),
            content: contentPlanPreview.map(({ code, type, action }) => ({ code, type, action })),
            settings: { action: settingsAction },
        };
    }

    const assetIdsByKey = new Map();
    for (const asset of preparedAssets) {
        const resolved =
            resolvedAssets.get(asset.key) ??
            (await uploadAsset(fetchImpl, adminEndpoint, session.authToken, channel, asset));
        await assignAsset(fetchImpl, adminEndpoint, session.authToken, channel, resolved.id);
        assetIdsByKey.set(asset.key, resolved.id);
    }

    const beforeProfile = structuredClone(profile);
    const beforeContent = structuredClone(currentContent);
    const beforeCollections = structuredClone(currentCollections);
    const brandPlan = buildDamatongBrandPlan(profile, assetIdsByKey);
    const categoryPlans = damatongCategories.map(definition =>
        buildDamatongCategoryPlan(
            currentCollections.get(definition.code),
            definition,
            assetIdsByKey.get(definition.assetKey),
        ),
    );
    const collectionIdsByCode = new Map();
    let contentPlans = [];
    let desiredBlocks = [];
    let writesStarted = false;
    try {
        if (brandPlan.action === 'update') {
            writesStarted = true;
            await graphql(
                fetchImpl,
                adminEndpoint,
                UPDATE_PROFILE_MUTATION,
                { input: brandPlan.input },
                requestHeaders(session.authToken, channel.token),
            );
        }

        for (const plan of categoryPlans) {
            if (plan.action !== 'noop') writesStarted = true;
            const id = await upsertCollection(fetchImpl, adminEndpoint, session.authToken, channel, plan);
            collectionIdsByCode.set(plan.code, id);
        }

        desiredBlocks = preserveDashboardSupportContacts(
            currentContent.blocks,
            buildDamatongContentBlocks({
                assetIdsByKey,
                collectionIdsByCode,
                sourceAiPluginItem,
                sourceChannelCode,
            }),
        );
        contentPlans = buildDamatongContentPlans(currentContent.blocks, desiredBlocks);
        if (contentPlans.some(plan => plan.action !== 'noop')) writesStarted = true;
        await applyBlockPlans(
            fetchImpl,
            adminEndpoint,
            session.authToken,
            channel,
            currentContent.blocks,
            contentPlans,
        );
        if (settingsAction === 'update') {
            writesStarted = true;
            await graphql(
                fetchImpl,
                adminEndpoint,
                UPDATE_SETTINGS_MUTATION,
                {
                    input: {
                        heroAutoplayIntervalSeconds: damatongStorefront.heroAutoplayIntervalSeconds,
                    },
                },
                requestHeaders(session.authToken, channel.token),
            );
        }

        const [verifiedProfile, verifiedContent, verifiedCollections] = await Promise.all([
            loadProfile(fetchImpl, adminEndpoint, session.authToken, channel),
            loadBlocks(fetchImpl, adminEndpoint, session.authToken, channel),
            loadCollections(fetchImpl, adminEndpoint, session.authToken, channel),
        ]);
        assert.equal(buildDamatongBrandPlan(verifiedProfile, assetIdsByKey).action, 'noop');
        for (const definition of damatongCategories) {
            assert.equal(
                buildDamatongCategoryPlan(
                    verifiedCollections.get(definition.code),
                    definition,
                    assetIdsByKey.get(definition.assetKey),
                ).action,
                'noop',
                `${definition.code} Admin API verification failed`,
            );
        }
        assert.ok(
            buildDamatongContentPlans(verifiedContent.blocks, desiredBlocks).every(
                plan => plan.action === 'noop',
            ),
            'Damatong content Admin API verification failed',
        );
        assert.equal(
            verifiedContent.settings.heroAutoplayIntervalSeconds,
            damatongStorefront.heroAutoplayIntervalSeconds,
        );
        await verifyShop(fetchImpl, shopEndpoint, channel, assetIdsByKey, collectionIdsByCode, desiredBlocks);
    } catch (verificationError) {
        if (!writesStarted) throw verificationError;
        try {
            await rollbackDamatongStorefront({
                fetchImpl,
                adminEndpoint,
                authToken: session.authToken,
                channel,
                beforeProfile,
                beforeContent,
                beforeCollections,
                categoryPlans,
                contentPlans,
            });
        } catch (rollbackError) {
            throw new AggregateError(
                [verificationError, rollbackError],
                `Damatong verification failed and rollback also failed in Channel ${channel.code}`,
            );
        }
        throw new Error(
            `Damatong verification failed; previous Admin bindings were restored in Channel ${channel.code}`,
            { cause: verificationError },
        );
    }

    return {
        applied: true,
        apiOrigin: normalizedApiOrigin,
        shopOrigin: normalizedShopOrigin,
        channelCode: channel.code,
        channelToken,
        sourceChannelCode,
        assets: assetActions,
        brand: { action: brandPlan.action, changes: brandPlan.changes },
        categories: categoryPlans.map(({ code, action }) => ({ code, action })),
        content: contentPlans.map(({ code, type, action }) => ({ code, type, action })),
        settings: { action: settingsAction },
        verified: true,
    };
}

export function parseCliArguments(args) {
    const options = { apply: false, verify: false, allowRemote: false, validate: false };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--apply') options.apply = true;
        else if (argument === '--dry-run') options.apply = false;
        else if (argument === '--verify') options.verify = true;
        else if (argument === '--allow-remote') options.allowRemote = true;
        else if (argument === '--validate') options.validate = true;
        else if (argument === '--api-origin') options.apiOrigin = args[++index];
        else if (argument === '--shop-origin') options.shopOrigin = args[++index];
        else if (argument === '--channel-token') options.channelToken = args[++index];
        else if (argument === '--source-channel-code') options.sourceChannelCode = args[++index];
        else throw new Error(`Unknown argument: ${String(argument)}`);
    }
    if (options.apply && options.verify) throw new Error('--apply and --verify are mutually exclusive');
    return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const options = parseCliArguments(process.argv.slice(2));
    if (options.validate) {
        const assets = await prepareDamatongAssets();
        process.stdout.write(
            `${JSON.stringify(
                {
                    ok: true,
                    mode: 'validate',
                    channelToken: options.channelToken ?? damatongStorefront.channelToken,
                    sourceChannelCode: options.sourceChannelCode ?? damatongStorefront.sourceChannelCode,
                    categories: damatongCategories.map(category => category.code),
                    assets: assets.map(asset => ({ key: asset.key, hash: asset.hash })),
                },
                null,
                2,
            )}\n`,
        );
    } else {
        const apiOrigin =
            options.apiOrigin ??
            process.env.VENDURE_API_ORIGIN ??
            `http://${process.env.VENDURE_HOSTNAME || '127.0.0.1'}:${process.env.PORT || '3000'}`;
        const result = await syncDamatongStorefront({
            apiOrigin,
            shopOrigin: options.shopOrigin ?? process.env.VENDURE_STOREFRONT_URL ?? apiOrigin,
            username: process.env.SUPERADMIN_USERNAME,
            password: process.env.SUPERADMIN_PASSWORD,
            channelToken:
                options.channelToken ?? process.env.DAMATONG_CHANNEL_TOKEN ?? damatongStorefront.channelToken,
            sourceChannelCode:
                options.sourceChannelCode ??
                process.env.DAMATONG_AI_SOURCE_CHANNEL_CODE ??
                damatongStorefront.sourceChannelCode,
            apply: options.apply,
            verify: options.verify,
            allowRemote: options.allowRemote,
        });
        process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
    }
}
