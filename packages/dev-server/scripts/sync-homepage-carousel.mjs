import 'dotenv/config';

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    isLocalApiOrigin,
    parseChannelCodes,
    selectStorefrontMediaChannels,
    storefrontMediaManifest,
    syncStorefrontMedia,
} from './sync-storefront-media.mjs';

export const homepageCarouselManifest = [
    {
        code: 'home-hero-token-topup',
        internalName: '首页轮播 01｜Token 额度充值',
        mediaKey: 'home-hero-token-topup-v1',
        target: { type: 'CATEGORY', collectionSlug: '中专站充值' },
        backgroundColor: '#F3F8FF',
        textColor: '#172554',
        settings: {
            themePreset: 'marketplace-bright',
            fallbackImage: 'moyao-token-topup-v1',
            secondaryTextColor: '#475569',
            accentColor: '#2563EB',
            accentSecondaryColor: '#635BFF',
            buttonTextColor: '#FFFFFF',
        },
        translations: {
            zh_Hans: {
                title: 'Token 额度，按需选择',
                subtitle: '中转站充值',
                body: '1 / 5 / 10 美元档位，从小额体验到持续调用',
                ctaLabel: '查看充值档位',
            },
            en: {
                title: 'Token credit, your way',
                subtitle: 'API relay top-ups',
                body: 'USD 1 / 5 / 10 credit tiers.',
                ctaLabel: 'View top-up tiers',
            },
        },
        items: [
            { zh: ['$1', '小额体验'], en: ['$1', 'Try it'] },
            { zh: ['$5', '日常调用'], en: ['$5', 'Daily calls'] },
            { zh: ['$10', '持续使用'], en: ['$10', 'Ongoing use'] },
        ],
    },
    {
        code: 'home-hero-codex-tiers',
        internalName: '首页轮播 02｜Codex 成品号',
        mediaKey: 'home-hero-codex-tiers-v1',
        target: { type: 'CATEGORY', collectionSlug: 'gpt订阅' },
        backgroundColor: '#EFFCF8',
        textColor: '#123B36',
        settings: {
            themePreset: 'marketplace-bright',
            fallbackImage: 'moyao-codex-tiers-v1',
            secondaryTextColor: '#3F5F5A',
            accentColor: '#059669',
            accentSecondaryColor: '#4F46E5',
            buttonTextColor: '#FFFFFF',
        },
        translations: {
            zh_Hans: {
                title: '不同使用强度，都有对应方案',
                subtitle: 'Codex 账号服务',
                body: 'Plus、Pro X5、Pro X20 成品号清楚分级',
                ctaLabel: '选择 Codex 方案',
            },
            en: {
                title: 'Choose your Codex tier',
                subtitle: 'Codex account services',
                body: 'Plus, Pro X5 and Pro X20 accounts.',
                ctaLabel: 'Choose a Codex tier',
            },
        },
        items: [
            { zh: ['PLUS', '基础档'], en: ['PLUS', 'Standard'] },
            { zh: ['X5', '进阶档'], en: ['X5', 'Advanced'] },
            { zh: ['X20', '高强度档'], en: ['X20', 'High-volume'] },
        ],
    },
    {
        code: 'home-hero-account-services',
        internalName: '首页轮播 03｜AI 数字账号服务',
        mediaKey: 'home-hero-account-services-v1',
        target: { type: 'PAGE', value: '/category' },
        backgroundColor: '#F7F3FF',
        textColor: '#31265F',
        settings: {
            themePreset: 'marketplace-bright',
            fallbackImage: 'moyao-account-services-v1',
            secondaryTextColor: '#5F5675',
            accentColor: '#7C3AED',
            accentSecondaryColor: '#EC4899',
            buttonTextColor: '#FFFFFF',
        },
        translations: {
            zh_Hans: {
                title: 'AI 账号与订阅，一站选购',
                subtitle: 'AI 数字账号服务',
                body: 'Gemini Pro 与 Google 美区账号',
                ctaLabel: '浏览全部商品',
            },
            en: {
                title: 'AI accounts, all in one place',
                subtitle: 'AI digital account services',
                body: 'Gemini Pro and Google US accounts.',
                ctaLabel: 'Browse all products',
            },
        },
        items: [
            { zh: ['Gemini', 'Pro 账号'], en: ['Gemini', 'Pro account'] },
            { zh: ['Google', '美区账号'], en: ['Google', 'US region'] },
            { zh: ['数字交付', '订单可查'], en: ['Digital', 'Trackable'] },
        ],
    },
];

export const homepageCarouselMediaKeys = homepageCarouselManifest.map(item => item.mediaKey);

const LOGIN_MUTATION = `
    mutation HomepageCarouselLogin($username: String!, $password: String!) {
        login(username: $username, password: $password, rememberMe: false) {
            ... on CurrentUser {
                id
                channels { id code token }
            }
            ... on ErrorResult { errorCode message }
        }
    }
`;

const ADMIN_BLOCKS_QUERY = `
    query HomepageCarouselAdminBlocks {
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
    }
`;

const COLLECTION_QUERY = `
    query HomepageCarouselCollection($slug: String!) {
        collections(options: { take: 2, filter: { slug: { eq: $slug } } }) {
            items { id slug name }
        }
    }
`;

const APPLY_CHANGES_MUTATION = `
    mutation ApplyHomepageCarousel($input: ApplyStorefrontContentChangesInput!) {
        applyStorefrontContentChanges(input: $input) {
            id
            code
        }
    }
`;

const DELETE_BLOCK_MUTATION = `
    mutation DeleteHomepageCarouselBlock($id: ID!) {
        deleteStorefrontContentBlock(id: $id) { result message }
    }
`;

const SHOP_BLOCKS_QUERY = `
    query HomepageCarouselShopBlocks {
        storefrontContent {
            id
            code
            type
            layoutVariant
            enabled
            position
            imageUrl
            imageAsset { id }
            backgroundColor
            textColor
            targetType
            targetValue
            settings
            title
            subtitle
            body
            ctaLabel
            items {
                id
                enabled
                position
                imageUrl
                imageAsset { id }
                targetType
                targetValue
                settings
                label
                description
            }
        }
    }
`;

function requestHeaders(authToken, channelToken) {
    return {
        authorization: `Bearer ${String(authToken)}`,
        'vendure-token': String(channelToken),
        'language-code': 'en',
    };
}

async function graphql(fetchImpl, origin, apiPath, query, variables, headers = {}) {
    const response = await fetchImpl(`${origin}/${apiPath}`, {
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

async function loadAdminBlocks(fetchImpl, apiOrigin, authToken, channel) {
    const result = await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        ADMIN_BLOCKS_QUERY,
        undefined,
        requestHeaders(authToken, channel.token),
    );
    return result.data.storefrontContentBlocks;
}

async function resolveCollectionIds(fetchImpl, apiOrigin, authToken, channel, manifest) {
    const slugs = Array.from(
        new Set(manifest.flatMap(item => (item.target.collectionSlug ? [item.target.collectionSlug] : []))),
    );
    const ids = new Map();
    for (const slug of slugs) {
        const result = await graphql(
            fetchImpl,
            apiOrigin,
            'admin-api?languageCode=zh_Hans',
            COLLECTION_QUERY,
            { slug },
            { ...requestHeaders(authToken, channel.token), 'language-code': 'zh_Hans' },
        );
        assert.equal(
            result.data.collections.items.length,
            1,
            `Expected one collection with slug ${slug} in Channel ${channel.code}, found ${String(result.data.collections.items.length)}`,
        );
        ids.set(slug, String(result.data.collections.items[0].id));
    }
    return ids;
}

function sortedBlocks(blocks) {
    return [...blocks].sort(
        (left, right) => left.position - right.position || String(left.id).localeCompare(String(right.id)),
    );
}

export function resolveCarouselBlocks(blocks, manifest = homepageCarouselManifest) {
    const selected = new Map();
    const usedIds = new Set();

    for (const definition of manifest) {
        const exact = blocks.filter(block => block.code === definition.code);
        assert.ok(exact.length <= 1, `Carousel code ${definition.code} is ambiguous`);
        if (exact[0]) {
            assert.equal(exact[0].type, 'HERO', `Content block ${definition.code} is not HERO`);
            selected.set(definition.code, exact[0]);
            usedIds.add(String(exact[0].id));
        }
    }

    const primary = manifest[0];
    if (primary && !selected.has(primary.code)) {
        const legacyHeroes = blocks.filter(block => block.type === 'HERO' && !usedIds.has(String(block.id)));
        assert.ok(
            legacyHeroes.length <= 1,
            `Expected at most one legacy HERO to adopt, found ${String(legacyHeroes.length)}`,
        );
        if (legacyHeroes[0]) {
            selected.set(primary.code, legacyHeroes[0]);
            usedIds.add(String(legacyHeroes[0].id));
        }
    }

    const unexpectedHeroes = blocks.filter(block => block.type === 'HERO' && !usedIds.has(String(block.id)));
    assert.equal(
        unexpectedHeroes.length,
        0,
        `Unexpected HERO blocks require manual review: ${unexpectedHeroes.map(block => block.code).join(', ')}`,
    );
    return selected;
}

function desiredTarget(definition, collectionIds) {
    if (definition.target.collectionSlug) {
        const id = collectionIds.get(definition.target.collectionSlug);
        assert.ok(id, `Collection ${definition.target.collectionSlug} was not resolved`);
        return { targetType: definition.target.type, targetValue: id };
    }
    return { targetType: definition.target.type, targetValue: definition.target.value };
}

function desiredTranslations(definition) {
    return ['zh_Hans', 'en'].map(languageCode => ({
        languageCode,
        ...definition.translations[languageCode],
    }));
}

function desiredItems(definition, block) {
    const existingByPosition = new Map((block?.items ?? []).map(item => [item.position, item]));
    return definition.items.map((item, position) => {
        const existing = existingByPosition.get(position);
        return {
            ...(existing ? { id: existing.id } : {}),
            enabled: true,
            position,
            imageAssetId: null,
            imageUrl: null,
            targetType: 'NONE',
            targetValue: null,
            settings: null,
            translations: [
                { languageCode: 'zh_Hans', label: item.zh[0], description: item.zh[1] },
                { languageCode: 'en', label: item.en[0], description: item.en[1] },
            ],
        };
    });
}

function desiredBlockInput(definition, block, assetId, collectionIds, position) {
    const target = desiredTarget(definition, collectionIds);
    return {
        code: definition.code,
        internalName: definition.internalName,
        type: 'HERO',
        layoutVariant: 'HERO_OVERLAY',
        enabled: true,
        position,
        startsAt: null,
        endsAt: null,
        imageAssetId: assetId,
        imageUrl: null,
        backgroundColor: definition.backgroundColor,
        textColor: definition.textColor,
        ...target,
        settings: { ...(block?.settings ?? {}), ...definition.settings },
        translations: desiredTranslations(definition),
        items: desiredItems(definition, block),
    };
}

function translationsMatch(actual, desired, fields) {
    const byLanguage = new Map(actual.map(item => [item.languageCode, item]));
    return desired.every(expected => {
        const current = byLanguage.get(expected.languageCode);
        return current && fields.every(field => (current[field] ?? '') === (expected[field] ?? ''));
    });
}

function itemsMatch(actual, desired) {
    if (actual.length !== desired.length) return false;
    const orderedActual = [...actual].sort((left, right) => left.position - right.position);
    return desired.every((expected, index) => {
        const current = orderedActual[index];
        return (
            current?.enabled === true &&
            current.position === expected.position &&
            current.imageAsset == null &&
            current.imageUrl == null &&
            current.targetType === 'NONE' &&
            current.targetValue == null &&
            JSON.stringify(current.settings ?? null) === JSON.stringify(expected.settings ?? null) &&
            translationsMatch(current.translations, expected.translations, ['label', 'description'])
        );
    });
}

function blockMatches(block, desired) {
    return (
        block.code === desired.code &&
        block.internalName === desired.internalName &&
        block.type === desired.type &&
        block.layoutVariant === desired.layoutVariant &&
        block.enabled === desired.enabled &&
        block.startsAt == null &&
        block.endsAt == null &&
        String(block.imageAsset?.id ?? '') === String(desired.imageAssetId ?? '') &&
        block.backgroundColor === desired.backgroundColor &&
        block.textColor === desired.textColor &&
        block.targetType === desired.targetType &&
        block.targetValue === desired.targetValue &&
        JSON.stringify(block.settings ?? null) === JSON.stringify(desired.settings ?? null) &&
        translationsMatch(block.translations, desired.translations, [
            'title',
            'subtitle',
            'body',
            'ctaLabel',
        ]) &&
        itemsMatch(block.items, desired.items)
    );
}

export function buildHomepageCarouselPlan({
    blocks,
    assetIds,
    collectionIds,
    manifest = homepageCarouselManifest,
}) {
    const selected = resolveCarouselBlocks(blocks, manifest);
    const ordered = sortedBlocks(blocks);
    const selectedIds = new Set(Array.from(selected.values()).map(block => String(block.id)));
    const selectedIndexes = ordered.flatMap((block, index) =>
        selectedIds.has(String(block.id)) ? [index] : [],
    );
    const firstHeroIndex = ordered.findIndex(block => block.type === 'HERO');
    const sourceInsertionIndex =
        selectedIndexes.length > 0
            ? Math.min(...selectedIndexes)
            : firstHeroIndex >= 0
              ? firstHeroIndex
              : Math.max(
                    0,
                    ordered.findIndex(block => block.type !== 'NOTICE'),
                );
    const insertionIndex = ordered
        .slice(0, sourceInsertionIndex)
        .filter(block => !selectedIds.has(String(block.id))).length;
    const remainingCodes = ordered
        .filter(
            block => !selectedIds.has(String(block.id)) && !manifest.some(item => item.code === block.code),
        )
        .map(block => block.code);
    const orderedCodes = [...remainingCodes];
    orderedCodes.splice(insertionIndex, 0, ...manifest.map(item => item.code));

    const creates = [];
    const updates = [];
    const entries = [];
    for (const [index, definition] of manifest.entries()) {
        const block = selected.get(definition.code) ?? null;
        const assetId = assetIds.get(definition.mediaKey) ?? null;
        const desired = desiredBlockInput(definition, block, assetId, collectionIds, insertionIndex + index);
        if (!block) {
            creates.push(desired);
            entries.push({
                code: definition.code,
                action: 'create',
                assetId,
                targetValue: desired.targetValue,
            });
        } else if (blockMatches(block, desired)) {
            entries.push({
                code: definition.code,
                action: 'noop',
                assetId,
                targetValue: desired.targetValue,
            });
        } else {
            updates.push({ id: block.id, expectedUpdatedAt: block.updatedAt, ...desired });
            entries.push({
                code: definition.code,
                action: block.code === definition.code ? 'update' : 'adopt-and-update',
                assetId,
                targetValue: desired.targetValue,
            });
        }
    }

    const currentEffectiveCodes = ordered.flatMap(block => {
        const definition = manifest.find(item => selected.get(item.code)?.id === block.id);
        return definition ? [definition.code] : [block.code];
    });
    for (const definition of manifest) {
        if (!currentEffectiveCodes.includes(definition.code))
            currentEffectiveCodes.splice(insertionIndex, 0, definition.code);
    }
    const orderChanged = JSON.stringify(currentEffectiveCodes) !== JSON.stringify(orderedCodes);

    return {
        entries,
        input: {
            expectedBlocks: blocks.map(block => ({ id: block.id, expectedUpdatedAt: block.updatedAt })),
            creates,
            updates,
            orderedCodes: orderChanged ? orderedCodes : undefined,
        },
        orderChanged,
        requiresWrite: creates.length > 0 || updates.length > 0 || orderChanged,
        selectedIds,
    };
}

function snapshotBlockInput(snapshot, current) {
    return {
        id: snapshot.id,
        expectedUpdatedAt: current.updatedAt,
        code: snapshot.code,
        internalName: snapshot.internalName,
        type: snapshot.type,
        layoutVariant: snapshot.layoutVariant,
        enabled: snapshot.enabled,
        position: snapshot.position,
        startsAt: snapshot.startsAt,
        endsAt: snapshot.endsAt,
        imageAssetId: snapshot.imageAsset?.id ?? null,
        imageUrl: snapshot.imageAsset ? null : (snapshot.imageUrl ?? null),
        backgroundColor: snapshot.backgroundColor,
        textColor: snapshot.textColor,
        targetType: snapshot.targetType,
        targetValue: snapshot.targetValue,
        settings: snapshot.settings,
        translations: snapshot.translations.map(item => ({
            languageCode: item.languageCode,
            title: item.title,
            subtitle: item.subtitle,
            body: item.body,
            ctaLabel: item.ctaLabel,
        })),
        items: snapshot.items.map(item => ({
            id: item.id,
            enabled: item.enabled,
            position: item.position,
            imageAssetId: item.imageAsset?.id ?? null,
            imageUrl: item.imageAsset ? null : (item.imageUrl ?? null),
            targetType: item.targetType,
            targetValue: item.targetValue,
            settings: item.settings,
            translations: item.translations.map(translation => ({
                languageCode: translation.languageCode,
                label: translation.label,
                description: translation.description,
            })),
        })),
    };
}

async function applyPlan(fetchImpl, apiOrigin, authToken, channel, plan) {
    await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        APPLY_CHANGES_MUTATION,
        { input: plan.input },
        requestHeaders(authToken, channel.token),
    );
}

function contentPresentation(block, languageCode) {
    const copy = block.translations?.find(entry => entry.languageCode === languageCode) ?? block;
    return {
        id: String(block.id),
        code: block.code,
        type: block.type,
        layoutVariant: block.layoutVariant,
        enabled: block.enabled,
        position: block.position,
        imageAssetId: String(block.imageAsset?.id ?? ''),
        imageUrl: block.imageUrl ?? null,
        backgroundColor: block.backgroundColor,
        textColor: block.textColor,
        settings: block.settings ?? null,
        targetType: block.targetType,
        targetValue: block.targetValue,
        title: copy.title,
        subtitle: copy.subtitle,
        body: copy.body,
        ctaLabel: copy.ctaLabel,
        items: [...block.items]
            .sort((left, right) => left.position - right.position)
            .map(entry => {
                const itemCopy =
                    entry.translations?.find(translation => translation.languageCode === languageCode) ??
                    entry;
                return {
                    id: String(entry.id),
                    enabled: entry.enabled,
                    position: entry.position,
                    imageAssetId: String(entry.imageAsset?.id ?? ''),
                    imageUrl: entry.imageUrl ?? null,
                    targetType: entry.targetType,
                    targetValue: entry.targetValue,
                    settings: entry.settings ?? null,
                    label: itemCopy.label,
                    description: itemCopy.description,
                };
            }),
    };
}

async function verifyShopLanguage({ fetchImpl, shopOrigin, channel, languageCode, manifest, adminBlocks }) {
    const result = await graphql(
        fetchImpl,
        shopOrigin,
        shopApiPathForLanguage(languageCode),
        SHOP_BLOCKS_QUERY,
        undefined,
        {
            'vendure-token': String(channel.token),
            'language-code': languageCode,
        },
    );
    const blocks = result.data.storefrontContent;
    assert.deepEqual(
        blocks.filter(block => block.type === 'HERO').map(block => block.code),
        manifest.map(definition => definition.code),
        `Shop API ${languageCode} carousel order or slide count differs from the reviewed plan`,
    );
    for (const definition of manifest) {
        const matches = blocks.filter(candidate => candidate.code === definition.code);
        assert.equal(matches.length, 1, `Shop API ${languageCode} cannot resolve ${definition.code}`);
        const block = matches[0];
        const adminBlock = adminBlocks.find(candidate => candidate.code === definition.code);
        assert.ok(adminBlock?.imageUrl?.trim(), `Admin API ${definition.code} has no displayable image URL`);
        assert.deepEqual(
            contentPresentation(block, languageCode),
            contentPresentation(adminBlock, languageCode),
            `Shop API ${languageCode} ${definition.code} differs from Admin API`,
        );
    }
}

export function shopApiPathForLanguage(languageCode) {
    return `shop-api?languageCode=${encodeURIComponent(languageCode)}`;
}

async function verifyChannel(options) {
    const blocks = await loadAdminBlocks(
        options.fetchImpl,
        options.apiOrigin,
        options.authToken,
        options.channel,
    );
    const plan = buildHomepageCarouselPlan({
        blocks,
        assetIds: options.assetIds,
        collectionIds: options.collectionIds,
        manifest: options.manifest,
    });
    assert.ok(!plan.requiresWrite, `Homepage carousel drift remains in Channel ${options.channel.code}`);
    await verifyShopLanguage({ ...options, adminBlocks: blocks, languageCode: 'zh_Hans' });
    await verifyShopLanguage({ ...options, adminBlocks: blocks, languageCode: 'en' });
    return blocks;
}

async function restoreChannel({ fetchImpl, apiOrigin, authToken, channel, before, selectedIds, manifest }) {
    let current = await loadAdminBlocks(fetchImpl, apiOrigin, authToken, channel);
    const beforeCodes = new Set(before.map(block => block.code));
    const created = current.filter(
        block =>
            manifest.some(item => item.code === block.code) &&
            !beforeCodes.has(block.code) &&
            !selectedIds.has(String(block.id)),
    );
    for (const block of created) {
        const deletion = await graphql(
            fetchImpl,
            apiOrigin,
            'admin-api',
            DELETE_BLOCK_MUTATION,
            { id: block.id },
            requestHeaders(authToken, channel.token),
        );
        assert.equal(
            deletion.data.deleteStorefrontContentBlock.result,
            'DELETED',
            `Cannot remove newly created carousel block ${block.code} during rollback`,
        );
    }
    current = await loadAdminBlocks(fetchImpl, apiOrigin, authToken, channel);
    const currentById = new Map(current.map(block => [String(block.id), block]));
    const snapshots = before.filter(block => selectedIds.has(String(block.id)));
    const updates = snapshots.map(snapshot => {
        const live = currentById.get(String(snapshot.id));
        assert.ok(live, `Cannot restore content block ${snapshot.id}`);
        return snapshotBlockInput(snapshot, live);
    });
    await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        APPLY_CHANGES_MUTATION,
        {
            input: {
                expectedBlocks: current.map(block => ({ id: block.id, expectedUpdatedAt: block.updatedAt })),
                creates: [],
                updates,
                orderedCodes: sortedBlocks(before).map(block => block.code),
            },
        },
        requestHeaders(authToken, channel.token),
    );
    const restored = await loadAdminBlocks(fetchImpl, apiOrigin, authToken, channel);
    assert.deepEqual(
        sortedBlocks(restored).map(block => block.code),
        sortedBlocks(before).map(block => block.code),
        'Rollback did not restore the previous content order',
    );
    for (const snapshot of snapshots) {
        const block = restored.find(entry => String(entry.id) === String(snapshot.id));
        assert.ok(block, `Rollback lost content block ${snapshot.id}`);
        assert.deepEqual(
            snapshotBlockInput(block, { updatedAt: '' }),
            snapshotBlockInput(snapshot, { updatedAt: '' }),
            `Rollback did not restore content block ${snapshot.id}`,
        );
    }
}

export async function syncHomepageCarousel({
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
    manifest = homepageCarouselManifest,
    mediaManifest = storefrontMediaManifest,
}) {
    assert.ok(apiOrigin, 'VENDURE_API_ORIGIN or --api-origin is required');
    assert.ok(shopOrigin, 'VENDURE_STOREFRONT_URL or --shop-origin is required');
    assert.ok(username && password, 'SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required');
    assert.ok(!(apply && verify), '--apply and --verify are mutually exclusive');
    if (apply && (production || !isLocalApiOrigin(apiOrigin))) {
        assert.ok(allowRemote, 'Remote or production writes require both --apply and --allow-remote');
    }

    const normalizedApiOrigin = apiOrigin.replace(/\/$/u, '');
    const normalizedShopOrigin = shopOrigin.replace(/\/$/u, '');
    const session = await login(fetchImpl, normalizedApiOrigin, username, password);
    const channels = selectStorefrontMediaChannels(session.channels, channelCodes);
    const preflight = [];
    for (const channel of channels) {
        const blocks = await loadAdminBlocks(fetchImpl, normalizedApiOrigin, session.authToken, channel);
        resolveCarouselBlocks(blocks, manifest);
        const collectionIds = await resolveCollectionIds(
            fetchImpl,
            normalizedApiOrigin,
            session.authToken,
            channel,
            manifest,
        );
        preflight.push({ channel, blocks, collectionIds });
    }
    const mediaResult = await syncStorefrontMedia({
        apiOrigin: normalizedApiOrigin,
        shopOrigin: normalizedShopOrigin,
        username,
        password,
        channelCodes,
        apply,
        verify,
        allowRemote,
        production,
        fetchImpl,
        manifest: mediaManifest,
        mediaKeys: manifest.map(item => item.mediaKey),
    });
    const assetIds = new Map(mediaResult.results.map(item => [item.key, item.assetId]));
    if (apply || verify) {
        for (const definition of manifest) {
            assert.ok(
                assetIds.get(definition.mediaKey),
                `Media ${definition.mediaKey} has no verified Asset ID`,
            );
        }
    }

    const results = [];
    const appliedChannels = [];
    try {
        for (const { channel, blocks, collectionIds } of preflight) {
            const plan = buildHomepageCarouselPlan({ blocks, assetIds, collectionIds, manifest });
            if (verify) {
                await verifyChannel({
                    fetchImpl,
                    apiOrigin: normalizedApiOrigin,
                    shopOrigin: normalizedShopOrigin,
                    authToken: session.authToken,
                    channel,
                    manifest,
                    assetIds,
                    collectionIds,
                });
            } else if (apply) {
                if (plan.requiresWrite) {
                    await applyPlan(fetchImpl, normalizedApiOrigin, session.authToken, channel, plan);
                    appliedChannels.push({ channel, before: blocks, selectedIds: plan.selectedIds });
                }
                await verifyChannel({
                    fetchImpl,
                    apiOrigin: normalizedApiOrigin,
                    shopOrigin: normalizedShopOrigin,
                    authToken: session.authToken,
                    channel,
                    manifest,
                    assetIds,
                    collectionIds,
                });
            }
            results.push({
                channelCode: channel.code,
                entries: plan.entries,
                orderChanged: plan.orderChanged,
                verified: apply || verify,
            });
        }
    } catch (error) {
        const rollbackErrors = [];
        for (const record of [...appliedChannels].reverse()) {
            try {
                await restoreChannel({
                    fetchImpl,
                    apiOrigin: normalizedApiOrigin,
                    authToken: session.authToken,
                    channel: record.channel,
                    before: record.before,
                    selectedIds: record.selectedIds,
                    manifest,
                });
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        if (rollbackErrors.length) {
            throw new AggregateError(
                [error, ...rollbackErrors],
                'Homepage carousel publish failed and rollback also failed',
            );
        }
        throw new Error(
            appliedChannels.length
                ? 'Homepage carousel publish failed; previous content bindings were restored'
                : 'Homepage carousel verification or publish failed; no content batch was confirmed applied',
            { cause: error },
        );
    }

    return {
        applied: apply,
        verified: apply || verify,
        apiOrigin: normalizedApiOrigin,
        shopOrigin: normalizedShopOrigin,
        channelCodes: channels.map(channel => channel.code),
        media: mediaResult.results.map(item => ({
            key: item.key,
            assetAction: item.assetAction,
            assetId: item.assetId,
        })),
        results,
    };
}

export function parseCliArguments(args) {
    const options = { allowRemote: false, apply: false, verify: false, validate: false };
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
        else throw new Error(`Unknown argument: ${String(argument)}`);
    }
    return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const options = parseCliArguments(process.argv.slice(2));
    if (options.validate) {
        process.stdout.write(
            `${JSON.stringify(
                {
                    ok: true,
                    mode: 'validate',
                    slides: homepageCarouselManifest.map(item => ({
                        code: item.code,
                        mediaKey: item.mediaKey,
                        target: item.target,
                    })),
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
        const channelCodes =
            options.channelCodes ??
            (process.env.HOMEPAGE_CAROUSEL_CHANNEL_CODES
                ? parseChannelCodes(process.env.HOMEPAGE_CAROUSEL_CHANNEL_CODES)
                : process.env.STOREFRONT_MEDIA_CHANNEL_CODES
                  ? parseChannelCodes(process.env.STOREFRONT_MEDIA_CHANNEL_CODES)
                  : undefined);
        const result = await syncHomepageCarousel({
            apiOrigin,
            shopOrigin: options.shopOrigin ?? process.env.VENDURE_STOREFRONT_URL ?? apiOrigin,
            username: process.env.SUPERADMIN_USERNAME,
            password: process.env.SUPERADMIN_PASSWORD,
            channelCodes,
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
                    media: result.media,
                    carousel: result.results,
                },
                null,
                2,
            )}\n`,
        );
    }
}
