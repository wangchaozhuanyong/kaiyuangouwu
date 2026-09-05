import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildDamatongContentBlocks,
    DAMATONG_AI_PLUGIN_CODE,
    damatongAssets,
    damatongCategories,
    damatongStorefront,
} from './damatong-storefront-config.mjs';
import {
    buildDamatongBrandPlan,
    buildDamatongCategoryPlan,
    buildDamatongContentPlans,
    damatongAssetTags,
    isLocalApiOrigin,
    parseCliArguments,
    prepareDamatongAssets,
    syncDamatongStorefront,
} from './sync-damatong-storefront.mjs';

function assetIds() {
    return new Map(damatongAssets.map((asset, index) => [asset.key, `asset-${index + 1}`]));
}

function collectionIds() {
    return new Map(damatongCategories.map((category, index) => [category.code, `collection-${index + 1}`]));
}

function sourceAiPluginItem() {
    return {
        enabled: true,
        position: 7,
        settings: {
            pluginCode: DAMATONG_AI_PLUGIN_CODE,
            placement: 'CATEGORY_AFTER_PRODUCTS',
            categoryScope: 'SELECTED',
            categoryIds: ['source-category'],
            includeChildren: false,
            rendererVersion: 3,
        },
        translations: [
            {
                languageCode: 'zh_Hans',
                label: '默认站 AI 图像工作台',
                description: '默认站描述',
            },
            {
                languageCode: 'en',
                label: 'Default AI image studio',
                description: 'Default-site description',
            },
        ],
    };
}

function desiredBlocks() {
    return buildDamatongContentBlocks({
        assetIdsByKey: assetIds(),
        collectionIdsByCode: collectionIds(),
        sourceAiPluginItem: sourceAiPluginItem(),
    });
}

function asAdminBlock(block, blockIndex) {
    const { imageAssetId, items, ...fields } = block;
    return {
        id: `block-${blockIndex + 1}`,
        updatedAt: '2026-09-05T00:00:00.000Z',
        ...fields,
        imageAsset: imageAssetId ? { id: imageAssetId } : null,
        items: items.map((item, itemIndex) => {
            const { imageAssetId: itemImageAssetId, ...itemFields } = item;
            return {
                id: `block-${blockIndex + 1}-item-${itemIndex + 1}`,
                ...itemFields,
                imageAsset: itemImageAssetId ? { id: itemImageAssetId } : null,
            };
        }),
    };
}

function relativeLuminance(hexColor) {
    const channels = hexColor
        .slice(1)
        .match(/.{2}/gu)
        .map(value => Number.parseInt(value, 16) / 255)
        .map(value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground, background) {
    const foregroundLuminance = relativeLuminance(foreground);
    const backgroundLuminance = relativeLuminance(background);
    return (
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    );
}

test('the Damatong asset manifest is complete, unique and readable', async () => {
    const prepared = await prepareDamatongAssets();
    assert.equal(prepared.length, 14);
    assert.equal(new Set(prepared.map(asset => asset.key)).size, prepared.length);
    assert.ok(prepared.every(asset => asset.bytes.byteLength > 0));
    assert.ok(prepared.every(asset => /^[a-f0-9]{64}$/u.test(asset.hash)));
    for (const asset of prepared) {
        assert.deepEqual(damatongAssetTags(asset.key, asset.hash), asset.tags);
    }
});

test('the Damatong category plan contains exactly the requested six categories', () => {
    assert.deepEqual(
        damatongCategories.map(
            category => category.translations.find(value => value.languageCode === 'zh_Hans').name,
        ),
        ['正品香烟', '正品白酒', '正品槟榔', '坦克咖啡', '商业服务', '软件订阅'],
    );
    const first = damatongCategories[0];
    const createPlan = buildDamatongCategoryPlan(null, first, 'asset-cigarettes');
    assert.equal(createPlan.action, 'create');
    assert.equal(createPlan.input.featuredAssetId, 'asset-cigarettes');

    const existing = {
        id: 'collection-cigarettes',
        featuredAsset: { id: 'asset-cigarettes' },
        assets: [{ id: 'asset-cigarettes' }],
        translations: first.translations,
    };
    assert.equal(buildDamatongCategoryPlan(existing, first, 'asset-cigarettes').action, 'noop');
});

test('fixed content, navigation, support placeholders and auth visuals are fully configured', () => {
    const blocks = desiredBlocks();
    assert.equal(blocks.length, 14);
    assert.equal(new Set(blocks.map(block => block.code)).size, blocks.length);
    assert.deepEqual(
        [
            damatongStorefront.brandBackgroundColor,
            damatongStorefront.brandPrimaryColor,
            damatongStorefront.brandAccentColor,
            damatongStorefront.brandHighlightColor,
        ],
        ['#f5f7fb', '#2f6feb', '#102d4a', '#f28c28'],
    );

    const heroes = blocks.filter(block => block.type === 'HERO');
    assert.deepEqual(
        heroes.map(block => block.code),
        ['damatong-hero-marketplace', 'damatong-hero-malaysia-services', 'damatong-hero-ai-subscriptions'],
    );
    assert.deepEqual(
        heroes.map(block => [block.targetType, block.targetValue]),
        [
            ['PAGE', '/category'],
            ['COLLECTION', collectionIds().get('business-services')],
            ['PAGE', '/services'],
        ],
    );
    assert.ok(heroes.every(block => block.imageAssetId && block.translations.length === 2));
    assert.ok(heroes.every(block => block.settings.contrastMode === 'high'));
    assert.deepEqual(
        heroes.map(block => block.settings.campaign),
        ['damatong-goods-v2', 'damatong-malaysia-services-v2', 'damatong-ai-subscriptions-v2'],
    );
    assert.deepEqual(
        heroes.map(block => [block.backgroundColor, block.settings.accentColor]),
        [
            ['#fff8ee', '#2f6feb'],
            ['#f1f7ff', '#2f6feb'],
            ['#f7f8fc', '#2f6feb'],
        ],
    );
    for (const hero of heroes) {
        assert.ok(contrastRatio(hero.textColor, hero.backgroundColor) >= 7);
        assert.ok(contrastRatio(hero.settings.secondaryTextColor, hero.backgroundColor) >= 7);
        assert.ok(contrastRatio(hero.settings.buttonTextColor, hero.settings.accentColor) >= 4.5);
        assert.ok(contrastRatio(hero.settings.buttonTextColor, hero.settings.accentSecondaryColor) >= 4.5);
    }

    const quickLinks = blocks.find(block => block.code === 'damatong-quick-links');
    const trustBar = blocks.find(block => block.code === 'damatong-trust-bar');
    assert.equal(quickLinks.settings.visualStyle, 'damatong-balanced');
    assert.equal(trustBar.settings.visualStyle, 'damatong-balanced');
    const businessServicesFeature = blocks.find(block => block.code === 'damatong-business-services-feature');
    assert.equal(businessServicesFeature.settings.visualStyle, 'damatong-balanced');
    assert.equal(businessServicesFeature.imageAssetId, assetIds().get('hero-malaysia-services'));
    assert.deepEqual(
        quickLinks.items.map(item => item.settings.categoryCode),
        damatongCategories.map(category => category.code),
    );
    assert.ok(quickLinks.items.every(item => item.targetType === 'COLLECTION' && item.imageAssetId));

    const support = blocks.find(block => block.type === 'SUPPORT');
    assert.equal(support.settings.placeholderContacts, true);
    const enabledSupportItems = support.items.filter(item => item.enabled);
    assert.deepEqual(
        enabledSupportItems.map(item => item.targetValue),
        ['https://wa.me/00000000000', 'https://t.me/damatong_placeholder_contact'],
    );
    assert.ok(enabledSupportItems.every(item => item.settings.supportAccount));

    const navigation = blocks.find(block => block.type === 'NAVIGATION');
    assert.deepEqual(
        navigation.items.map(item => item.targetValue),
        ['/', '/category', '/services', '/cart', '/account'],
    );
    assert.ok(blocks.some(block => block.code === 'auth-login-visual'));
    assert.ok(blocks.some(block => block.code === 'auth-register-visual'));
    assert.ok(blocks.some(block => block.type === 'LEGAL'));
});

test('the Damatong AI entry mirrors the default-site item while using the business-services slot', () => {
    const source = sourceAiPluginItem();
    const pluginBlock = desiredBlocks().find(block => block.type === 'CLIENT_PLUGINS');
    assert.equal(pluginBlock.items.length, 1);
    const item = pluginBlock.items[0];
    assert.equal(item.settings.pluginCode, DAMATONG_AI_PLUGIN_CODE);
    assert.equal(item.settings.rendererVersion, source.settings.rendererVersion);
    assert.equal(item.settings.placement, 'BUSINESS_SERVICES_MAIN');
    assert.equal(item.settings.categoryScope, 'ALL');
    assert.deepEqual(item.translations, source.translations);
    assert.equal(item.settings.syncedFromChannel, damatongStorefront.sourceChannelCode);
});

test('content planning is idempotent and preserves existing item ids', () => {
    const blocks = desiredBlocks();
    const existing = blocks.map(asAdminBlock);
    const plans = buildDamatongContentPlans(existing, blocks);
    assert.ok(plans.every(plan => plan.action === 'noop'));
    assert.ok(plans.every(plan => plan.input.items.every(item => item.id)));
});

test('one legacy hero is adopted once and expanded into exactly three managed campaigns', () => {
    const blocks = desiredBlocks();
    const [firstHero] = blocks.filter(block => block.type === 'HERO');
    const legacyHero = asAdminBlock(
        {
            ...firstHero,
            code: 'legacy-malaysia-homepage-hero',
            internalName: 'Legacy hero',
        },
        0,
    );
    const heroPlans = buildDamatongContentPlans([legacyHero], blocks).filter(plan => plan.type === 'HERO');

    assert.deepEqual(
        heroPlans.map(plan => plan.action),
        ['update', 'create', 'create'],
    );
    assert.equal(heroPlans[0].input.id, legacyHero.id);
    assert.equal(heroPlans[1].input.id, undefined);
    assert.equal(heroPlans[2].input.id, undefined);
});

test('an extra active hero blocks planning instead of leaking into the three-ad carousel', () => {
    const blocks = desiredBlocks();
    const existing = blocks.map(asAdminBlock);
    existing.push(
        asAdminBlock(
            {
                ...blocks.find(block => block.type === 'HERO'),
                code: 'unreviewed-extra-hero',
            },
            existing.length,
        ),
    );

    assert.throws(
        () => buildDamatongContentPlans(existing, blocks),
        /Unmanaged active Damatong heroes must be reviewed/u,
    );
});

test('brand planning is idempotent after the requested profile is in place', () => {
    const ids = assetIds();
    const profile = {
        id: 'profile-1',
        updatedAt: '2026-09-05T00:00:00.000Z',
        channel: {
            customFields: {
                storefrontNameZh: damatongStorefront.storefrontNameZh,
                storefrontNameEn: damatongStorefront.storefrontNameEn,
            },
        },
        descriptionZh: damatongStorefront.descriptionZh,
        descriptionEn: damatongStorefront.descriptionEn,
        taglineZh: damatongStorefront.taglineZh,
        taglineEn: damatongStorefront.taglineEn,
        brandBackgroundColor: damatongStorefront.brandBackgroundColor,
        brandPrimaryColor: damatongStorefront.brandPrimaryColor,
        brandAccentColor: damatongStorefront.brandAccentColor,
        brandHighlightColor: damatongStorefront.brandHighlightColor,
        logoAsset: { id: ids.get('brand-app-icon') },
        logoOnLightAsset: { id: ids.get('brand-logo-light') },
        logoOnDarkAsset: { id: ids.get('brand-logo-dark') },
    };
    assert.equal(buildDamatongBrandPlan(profile, ids).action, 'noop');
});

test('publisher CLI is dry-run by default and recognizes guarded apply options', () => {
    assert.deepEqual(parseCliArguments([]), { apply: false, allowRemote: false, validate: false });
    assert.deepEqual(parseCliArguments(['--apply', '--allow-remote', '--channel-code', 'my-malaysia']), {
        apply: true,
        allowRemote: true,
        validate: false,
        channelCode: 'my-malaysia',
    });
    assert.equal(isLocalApiOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isLocalApiOrigin('https://damatong.net'), false);
});

test('remote apply stays blocked while the support contacts are placeholders', async () => {
    await assert.rejects(
        () =>
            syncDamatongStorefront({
                apiOrigin: 'https://damatong.net',
                username: 'admin',
                password: 'secret',
                apply: true,
                allowRemote: true,
                fetchImpl: async () => {
                    throw new Error('network must not be reached');
                },
            }),
        /blocked until real support contacts replace the placeholders/u,
    );
});

test('apply mode updates drift and verifies the same ids through Admin and Shop APIs', async () => {
    const ids = assetIds();
    const collections = collectionIds();
    const sourceItem = sourceAiPluginItem();
    const blocks = buildDamatongContentBlocks({
        assetIdsByKey: ids,
        collectionIdsByCode: collections,
        sourceAiPluginItem: sourceItem,
    });
    const adminBlocks = blocks.map(asAdminBlock);
    let contentUpdated = false;
    let updateMutationCount = 0;

    const profile = {
        id: 'profile-1',
        updatedAt: '2026-09-05T00:00:00.000Z',
        channel: {
            id: 'channel-my',
            code: damatongStorefront.channelCode,
            token: 'target-token',
            customFields: {
                storefrontNameZh: damatongStorefront.storefrontNameZh,
                storefrontNameEn: damatongStorefront.storefrontNameEn,
            },
        },
        descriptionZh: damatongStorefront.descriptionZh,
        descriptionEn: damatongStorefront.descriptionEn,
        taglineZh: damatongStorefront.taglineZh,
        taglineEn: damatongStorefront.taglineEn,
        brandBackgroundColor: damatongStorefront.brandBackgroundColor,
        brandPrimaryColor: damatongStorefront.brandPrimaryColor,
        brandAccentColor: damatongStorefront.brandAccentColor,
        brandHighlightColor: damatongStorefront.brandHighlightColor,
        logoAsset: { id: ids.get('brand-app-icon') },
        logoOnLightAsset: { id: ids.get('brand-logo-light') },
        logoOnDarkAsset: { id: ids.get('brand-logo-dark') },
    };

    const categoryBySlug = new Map(
        damatongCategories.map(category => [
            category.translations.find(value => value.languageCode === 'en').slug,
            category,
        ]),
    );
    const assetIdByTag = new Map(
        damatongAssets.map(asset => [`damatong-storefront:${asset.key}`, ids.get(asset.key)]),
    );

    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        const channelToken = init.headers?.['vendure-token'];
        if (request.query.includes('DamatongStorefrontLogin')) {
            return new Response(
                JSON.stringify({
                    data: {
                        login: {
                            id: 'admin-1',
                            channels: [
                                {
                                    id: 'channel-my',
                                    code: damatongStorefront.channelCode,
                                    token: 'target-token',
                                },
                                {
                                    id: 'channel-default',
                                    code: damatongStorefront.sourceChannelCode,
                                    token: 'source-token',
                                },
                            ],
                        },
                    },
                }),
                { headers: { 'vendure-auth-token': 'auth-token' } },
            );
        }
        if (request.query.includes('DamatongStoreProfiles')) {
            return Response.json({ data: { storeProfiles: [profile] } });
        }
        if (request.query.includes('DamatongStorefrontBlocks')) {
            if (channelToken === 'source-token') {
                return Response.json({
                    data: {
                        storefrontContentBlocks: [
                            {
                                id: 'source-plugin-block',
                                updatedAt: '2026-09-05T00:00:00.000Z',
                                code: 'storefront-client-plugins',
                                type: 'CLIENT_PLUGINS',
                                items: [sourceItem],
                            },
                        ],
                        storefrontContentSettings: { heroAutoplayIntervalSeconds: 5 },
                    },
                });
            }
            const current = structuredClone(adminBlocks);
            if (!contentUpdated) current[0].internalName = '旧的首页主视觉';
            return Response.json({
                data: {
                    storefrontContentBlocks: current,
                    storefrontContentSettings: {
                        heroAutoplayIntervalSeconds: damatongStorefront.heroAutoplayIntervalSeconds,
                    },
                },
            });
        }
        if (request.query.includes('DamatongCollection')) {
            const category = categoryBySlug.get(request.variables.slug);
            const featuredAssetId = ids.get(category.assetKey);
            return Response.json({
                data: {
                    collection: {
                        id: collections.get(category.code),
                        featuredAsset: { id: featuredAssetId },
                        assets: [{ id: featuredAssetId }],
                        translations: category.translations,
                    },
                },
            });
        }
        if (/query\s+DamatongStorefrontAsset\b/u.test(request.query)) {
            const stableTag = request.variables.tags.find(tag => assetIdByTag.has(tag));
            return Response.json({
                data: { assets: { items: [{ id: assetIdByTag.get(stableTag) }] } },
            });
        }
        if (request.query.includes('AssignDamatongStorefrontAsset')) {
            return Response.json({
                data: { assignAssetsToChannel: request.variables.input.assetIds.map(id => ({ id })) },
            });
        }
        if (request.query.includes('UpdateDamatongContentBlock')) {
            assert.match(request.query, /mutation\s+UpdateDamatongContentBlock/u);
            assert.equal(init.headers.authorization, 'Bearer auth-token');
            assert.equal(request.variables.input.code, blocks[0].code);
            updateMutationCount += 1;
            contentUpdated = true;
            return Response.json({
                data: {
                    updateStorefrontContentBlock: {
                        id: adminBlocks[0].id,
                        code: blocks[0].code,
                        type: blocks[0].type,
                        updatedAt: '2026-09-05T00:01:00.000Z',
                    },
                },
            });
        }
        if (request.query.includes('VerifyDamatongStorefront')) {
            const languageCode = init.headers['language-code'];
            return Response.json({
                data: {
                    activeChannel: { code: damatongStorefront.channelCode, customFields: {} },
                    storefrontBranding: {
                        logoAssetId: ids.get('brand-app-icon'),
                        logoOnLightAssetId: ids.get('brand-logo-light'),
                        logoOnDarkAssetId: ids.get('brand-logo-dark'),
                        name:
                            languageCode === 'zh_Hans'
                                ? damatongStorefront.storefrontNameZh
                                : damatongStorefront.storefrontNameEn,
                        description:
                            languageCode === 'zh_Hans'
                                ? damatongStorefront.descriptionZh
                                : damatongStorefront.descriptionEn,
                        tagline:
                            languageCode === 'zh_Hans'
                                ? damatongStorefront.taglineZh
                                : damatongStorefront.taglineEn,
                        backgroundColor: damatongStorefront.brandBackgroundColor,
                        primaryColor: damatongStorefront.brandPrimaryColor,
                        accentColor: damatongStorefront.brandAccentColor,
                        highlightColor: damatongStorefront.brandHighlightColor,
                    },
                    collections: {
                        items: damatongCategories.map(category => {
                            const localized = category.translations.find(
                                value => value.languageCode === languageCode,
                            );
                            return {
                                id: collections.get(category.code),
                                name: localized.name,
                                slug: localized.slug,
                                featuredAsset: { id: ids.get(category.assetKey) },
                            };
                        }),
                    },
                    storefrontContent: blocks.map((block, blockIndex) => ({
                        id: `block-${blockIndex + 1}`,
                        code: block.code,
                        type: block.type,
                        imageAsset: block.imageAssetId ? { id: block.imageAssetId } : null,
                        title: block.translations.find(value => value.languageCode === languageCode).title,
                        subtitle: '',
                        body: '',
                        ctaLabel: '',
                        settings: block.settings,
                        items: block.items.map((item, itemIndex) => ({
                            id: `item-${itemIndex + 1}`,
                            position: item.position,
                            imageAsset: item.imageAssetId ? { id: item.imageAssetId } : null,
                            targetType: item.targetType,
                            targetValue: item.targetValue,
                            settings: item.settings,
                            label:
                                item.translations.find(value => value.languageCode === languageCode)?.label ??
                                '',
                            description: '',
                        })),
                    })),
                    storefrontContentSettings: {
                        heroAutoplayIntervalSeconds: damatongStorefront.heroAutoplayIntervalSeconds,
                    },
                },
            });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };

    const result = await syncDamatongStorefront({
        apiOrigin: 'http://127.0.0.1:3000',
        username: 'admin',
        password: 'secret',
        apply: true,
        fetchImpl,
    });
    assert.equal(result.applied, true);
    assert.equal(result.verified, true);
    assert.equal(updateMutationCount, 1);
});
