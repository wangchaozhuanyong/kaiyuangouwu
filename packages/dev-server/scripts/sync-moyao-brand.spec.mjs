import assert from 'node:assert/strict';
import test from 'node:test';

import {
    brandAssetTags,
    buildMoyaoBrandPlan,
    buildMoyaoBrandRestoreInput,
    isLocalApiOrigin,
    moyaoBrand,
    moyaoBrandAssets,
    parseCliArguments,
    prepareMoyaoBrandAssets,
    syncMoyaoBrand,
} from './sync-moyao-brand.mjs';

function profile(overrides = {}) {
    return {
        id: 'profile-1',
        updatedAt: '2026-09-04T01:00:00.000Z',
        channel: {
            id: 'channel-1',
            code: '__default_channel__',
            customFields: { storefrontNameZh: '旧品牌', storefrontNameEn: 'Old brand' },
        },
        descriptionZh: '',
        descriptionEn: '',
        taglineZh: null,
        taglineEn: null,
        brandBackgroundColor: null,
        brandPrimaryColor: null,
        brandAccentColor: null,
        brandHighlightColor: null,
        logoAsset: null,
        logoOnLightAsset: null,
        logoOnDarkAsset: null,
        ...overrides,
    };
}

function applyProfileInput(current, input, updatedAt) {
    return {
        ...current,
        updatedAt,
        channel: {
            ...current.channel,
            customFields: {
                ...current.channel.customFields,
                storefrontNameZh: input.storefrontNameZh,
                storefrontNameEn: input.storefrontNameEn,
            },
        },
        descriptionZh: input.descriptionZh,
        descriptionEn: input.descriptionEn,
        taglineZh: input.taglineZh || null,
        taglineEn: input.taglineEn || null,
        brandBackgroundColor: input.brandBackgroundColor,
        brandPrimaryColor: input.brandPrimaryColor,
        brandAccentColor: input.brandAccentColor,
        brandHighlightColor: input.brandHighlightColor,
        logoAsset: input.logoAssetId == null ? null : { id: input.logoAssetId },
        logoOnLightAsset: input.logoOnLightAssetId == null ? null : { id: input.logoOnLightAssetId },
        logoOnDarkAsset: input.logoOnDarkAssetId == null ? null : { id: input.logoOnDarkAssetId },
    };
}

function shopBrandingFromProfile(current, languageCode) {
    const isChinese = languageCode === 'zh_Hans';
    return {
        logoAssetId: current.logoAsset?.id ?? null,
        logoOnLightAssetId: current.logoOnLightAsset?.id ?? null,
        logoOnDarkAssetId: current.logoOnDarkAsset?.id ?? null,
        name: isChinese
            ? current.channel.customFields.storefrontNameZh
            : current.channel.customFields.storefrontNameEn,
        description: isChinese ? current.descriptionZh : current.descriptionEn,
        tagline: isChinese ? current.taglineZh : current.taglineEn,
        backgroundColor: current.brandBackgroundColor,
        primaryColor: current.brandPrimaryColor,
        accentColor: current.brandAccentColor,
        highlightColor: current.brandHighlightColor,
    };
}

test('brand kit manifest contains the three optimized WebP roles and hashes them', async () => {
    const prepared = await prepareMoyaoBrandAssets();
    assert.deepEqual(
        prepared.map(item => [item.key, item.profileField]),
        [
            ['app-icon', 'logoAssetId'],
            ['logo-on-light', 'logoOnLightAssetId'],
            ['logo-on-dark', 'logoOnDarkAssetId'],
        ],
    );
    for (const item of prepared) {
        assert.match(item.hash, /^[a-f0-9]{64}$/u);
        assert.deepEqual(item.tags, brandAssetTags(item.key, item.hash));
        assert.equal(item.mimeType, 'image/webp');
        assert.match(item.file, /\.webp$/u);
    }
});

test('plan updates names, bilingual slogan, palette, and all asset bindings together', () => {
    const assets = new Map(moyaoBrandAssets.map((item, index) => [item.key, { id: `asset-${index}` }]));
    const plan = buildMoyaoBrandPlan(profile(), assets);
    assert.equal(plan.action, 'update');
    assert.equal(plan.input.storefrontNameZh, 'MOYAO AI｜模钥');
    assert.equal(plan.input.taglineZh, '全球模型，一钥直达');
    assert.equal(plan.input.taglineEn, 'One Key to Every Model.');
    assert.equal(plan.input.brandBackgroundColor, '#070B14');
    assert.equal(plan.input.brandPrimaryColor, '#635BFF');
    assert.equal(plan.input.logoOnDarkAssetId, 'asset-2');
});

test('matching profile and asset IDs produce an idempotent no-op', () => {
    const assets = new Map(moyaoBrandAssets.map((item, index) => [item.key, { id: `asset-${index}` }]));
    const current = profile({
        channel: {
            id: 'channel-1',
            code: moyaoBrand.channelCode,
            customFields: {
                storefrontNameZh: moyaoBrand.storefrontNameZh,
                storefrontNameEn: moyaoBrand.storefrontNameEn,
            },
        },
        descriptionZh: moyaoBrand.descriptionZh,
        descriptionEn: moyaoBrand.descriptionEn,
        taglineZh: moyaoBrand.taglineZh,
        taglineEn: moyaoBrand.taglineEn,
        brandBackgroundColor: moyaoBrand.brandBackgroundColor,
        brandPrimaryColor: moyaoBrand.brandPrimaryColor,
        brandAccentColor: moyaoBrand.brandAccentColor,
        brandHighlightColor: moyaoBrand.brandHighlightColor,
        logoAsset: { id: 'asset-0' },
        logoOnLightAsset: { id: 'asset-1' },
        logoOnDarkAsset: { id: 'asset-2' },
    });
    assert.equal(buildMoyaoBrandPlan(current, assets).action, 'noop');
});

test('restore input preserves every original brand field and uses the post-write version', () => {
    const before = profile({
        taglineZh: null,
        taglineEn: 'Previous tagline',
        brandPrimaryColor: '#123456',
        logoAsset: { id: 'old-icon' },
        logoOnLightAsset: { id: 'old-light' },
        logoOnDarkAsset: { id: 'old-dark' },
    });
    const restore = buildMoyaoBrandRestoreInput(before, {
        ...before,
        updatedAt: '2026-09-04T02:00:00.000Z',
    });

    assert.equal(restore.expectedUpdatedAt, '2026-09-04T02:00:00.000Z');
    assert.equal(restore.storefrontNameZh, '旧品牌');
    assert.equal(restore.taglineZh, '');
    assert.equal(restore.taglineEn, 'Previous tagline');
    assert.equal(restore.brandPrimaryColor, '#123456');
    assert.equal(restore.logoAssetId, 'old-icon');
    assert.equal(restore.logoOnLightAssetId, 'old-light');
    assert.equal(restore.logoOnDarkAssetId, 'old-dark');
});

test('CLI stays dry-run by default and remote detection is strict', () => {
    assert.deepEqual(parseCliArguments([]), {
        apply: false,
        verify: false,
        allowRemote: false,
        validate: false,
    });
    assert.deepEqual(parseCliArguments(['--apply', '--allow-remote', '--channel-code', 'main']), {
        apply: true,
        verify: false,
        allowRemote: true,
        validate: false,
        channelCode: 'main',
    });
    assert.deepEqual(parseCliArguments(['--verify']), {
        apply: false,
        verify: true,
        allowRemote: false,
        validate: false,
    });
    assert.equal(isLocalApiOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isLocalApiOrigin('https://console.moyaoai.com'), false);
});

test('apply and read-only verification modes cannot be combined', async () => {
    await assert.rejects(
        syncMoyaoBrand({
            apiOrigin: 'http://127.0.0.1:3000',
            username: 'admin',
            password: 'secret',
            apply: true,
            verify: true,
            fetchImpl: () => {
                throw new Error('network must not be reached');
            },
        }),
        /mutually exclusive/u,
    );
});

test('remote writes require the second explicit guard before any network request', async () => {
    await assert.rejects(
        syncMoyaoBrand({
            apiOrigin: 'https://console.moyaoai.com',
            username: 'admin',
            password: 'secret',
            apply: true,
            fetchImpl: () => {
                throw new Error('network must not be reached');
            },
        }),
        /--apply and --allow-remote/u,
    );
});

test('publisher only requests stable asset IDs and verifies each Shop API language explicitly', async () => {
    const shopRequests = [];
    const createdAssetIds = {
        'app-icon': 'asset-icon',
        'logo-on-light': 'asset-light',
        'logo-on-dark': 'asset-dark',
    };
    const uploadedAssets = {};
    let profileUpdateCount = 0;
    let assetAssignmentCount = 0;
    let currentProfile = profile();
    let version = 1;
    const fetchImpl = async (url, init) => {
        const request =
            init.body instanceof FormData
                ? JSON.parse(String(init.body.get('operations')))
                : JSON.parse(init.body);
        if (request.query.includes('MoyaoBrandLogin')) {
            return new Response(
                JSON.stringify({
                    data: {
                        login: {
                            id: 'admin-1',
                            channels: [
                                {
                                    id: 'channel-1',
                                    code: moyaoBrand.channelCode,
                                    token: 'channel-token',
                                },
                            ],
                        },
                    },
                }),
                { headers: { 'content-type': 'application/json', 'vendure-auth-token': 'auth-token' } },
            );
        }
        if (request.query.includes('MoyaoBrandProfiles')) {
            return Response.json({ data: { storeProfiles: [currentProfile] } });
        }
        if (request.query.includes('CreateMoyaoBrandAsset')) {
            assert.match(request.query, /\.\.\. on Asset \{ id \}/u);
            assert.doesNotMatch(request.query, /\.\.\. on Asset \{[^}]*\b(?:name|preview|source)\b[^}]*\}/u);
            const logicalTag = request.variables.input[0].tags.find(tag =>
                /^moyao-ai-brand:(?!sha256:)/u.test(tag),
            );
            const key = logicalTag.replace('moyao-ai-brand:', '');
            uploadedAssets[key] = { id: createdAssetIds[key] };
            return Response.json({ data: { createAssets: [{ id: createdAssetIds[key] }] } });
        }
        if (request.query.includes('query MoyaoBrandAsset')) {
            assert.match(request.query, /items \{ id \}/u);
            assert.doesNotMatch(request.query, /\b(?:name|preview|source)\b/u);
            const logicalTag = request.variables.tags.find(tag => /^moyao-ai-brand:(?!sha256:)/u.test(tag));
            const key = logicalTag.replace('moyao-ai-brand:', '');
            return Response.json({
                data: { assets: { items: uploadedAssets[key] ? [uploadedAssets[key]] : [] } },
            });
        }
        if (request.query.includes('AssignMoyaoBrandAsset')) {
            assetAssignmentCount += 1;
            return Response.json({ data: { assignAssetsToChannel: [{ id: 'assigned' }] } });
        }
        if (request.query.includes('UpdateMoyaoBrand')) {
            profileUpdateCount += 1;
            version += 1;
            currentProfile = applyProfileInput(
                currentProfile,
                request.variables.input,
                `2026-09-04T0${String(version)}:00:00.000Z`,
            );
            return Response.json({ data: { updateStoreProfile: currentProfile } });
        }
        if (request.query.includes('VerifyMoyaoBrand')) {
            const requestUrl = new URL(url);
            const languageCode = requestUrl.searchParams.get('languageCode');
            shopRequests.push({ url: requestUrl, headers: init.headers, languageCode });
            const isChinese = languageCode === 'zh_Hans';
            return Response.json({
                data: {
                    storefrontBranding: {
                        logoAssetId: createdAssetIds['app-icon'],
                        logoOnLightAssetId: createdAssetIds['logo-on-light'],
                        logoOnDarkAssetId: createdAssetIds['logo-on-dark'],
                        name: isChinese ? moyaoBrand.storefrontNameZh : moyaoBrand.storefrontNameEn,
                        description: isChinese ? moyaoBrand.descriptionZh : moyaoBrand.descriptionEn,
                        tagline: isChinese ? moyaoBrand.taglineZh : moyaoBrand.taglineEn,
                        backgroundColor: moyaoBrand.brandBackgroundColor,
                        primaryColor: moyaoBrand.brandPrimaryColor,
                        accentColor: moyaoBrand.brandAccentColor,
                        highlightColor: moyaoBrand.brandHighlightColor,
                    },
                },
            });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };

    const result = await syncMoyaoBrand({
        apiOrigin: 'http://127.0.0.1:3000',
        shopOrigin: 'https://moyaoai.com',
        username: 'admin',
        password: 'secret',
        apply: true,
        fetchImpl,
    });

    assert.equal(result.applied, true);
    assert.equal(result.verified, true);
    assert.deepEqual(
        shopRequests.map(request => request.languageCode),
        ['zh_Hans', 'en'],
    );
    for (const request of shopRequests) {
        assert.equal(request.url.pathname, '/shop-api');
        assert.equal(request.headers['language-code'], request.languageCode);
    }

    const verification = await syncMoyaoBrand({
        apiOrigin: 'http://127.0.0.1:3000',
        shopOrigin: 'https://moyaoai.com',
        username: 'admin',
        password: 'secret',
        verify: true,
        fetchImpl,
    });

    assert.equal(verification.applied, false);
    assert.equal(verification.verified, true);
    assert.equal(profileUpdateCount, 1);
    assert.equal(assetAssignmentCount, 3);
    assert.deepEqual(
        shopRequests.slice(2).map(request => request.languageCode),
        ['zh_Hans', 'en'],
    );
});

test('failed bilingual Shop verification restores the complete previous StoreProfile', async () => {
    const original = profile({
        descriptionZh: '旧中文简介',
        descriptionEn: 'Previous description',
        taglineZh: '旧口号',
        taglineEn: 'Previous tagline',
        brandBackgroundColor: '#111111',
        brandPrimaryColor: '#222222',
        brandAccentColor: '#333333',
        brandHighlightColor: '#444444',
        logoAsset: { id: 'old-icon' },
        logoOnLightAsset: { id: 'old-light' },
        logoOnDarkAsset: { id: 'old-dark' },
    });
    const newAssets = {
        'app-icon': 'new-icon',
        'logo-on-light': 'new-light',
        'logo-on-dark': 'new-dark',
    };
    const state = {
        currentProfile: structuredClone(original),
        updateInputs: [],
        version: 1,
    };
    const fetchImpl = async (url, init) => {
        const request = JSON.parse(init.body);
        if (request.query.includes('MoyaoBrandLogin')) {
            return new Response(
                JSON.stringify({
                    data: {
                        login: {
                            id: 'admin-1',
                            channels: [
                                {
                                    id: 'channel-1',
                                    code: moyaoBrand.channelCode,
                                    token: 'channel-token',
                                },
                            ],
                        },
                    },
                }),
                { headers: { 'content-type': 'application/json', 'vendure-auth-token': 'auth-token' } },
            );
        }
        if (request.query.includes('MoyaoBrandProfiles')) {
            return Response.json({ data: { storeProfiles: [state.currentProfile] } });
        }
        if (request.query.includes('query MoyaoBrandAsset')) {
            const logicalTag = request.variables.tags.find(tag => /^moyao-ai-brand:(?!sha256:)/u.test(tag));
            const key = logicalTag.replace('moyao-ai-brand:', '');
            return Response.json({ data: { assets: { items: [{ id: newAssets[key] }] } } });
        }
        if (request.query.includes('AssignMoyaoBrandAsset')) {
            return Response.json({ data: { assignAssetsToChannel: [{ id: 'assigned' }] } });
        }
        if (request.query.includes('UpdateMoyaoBrand')) {
            state.updateInputs.push(structuredClone(request.variables.input));
            state.version += 1;
            state.currentProfile = applyProfileInput(
                state.currentProfile,
                request.variables.input,
                `2026-09-04T0${String(state.version)}:00:00.000Z`,
            );
            return Response.json({ data: { updateStoreProfile: state.currentProfile } });
        }
        if (request.query.includes('VerifyMoyaoBrand')) {
            const languageCode = new URL(url).searchParams.get('languageCode');
            const branding = shopBrandingFromProfile(state.currentProfile, languageCode);
            if (state.currentProfile.channel.customFields.storefrontNameEn === moyaoBrand.storefrontNameEn) {
                branding.name = 'stale client brand';
            }
            return Response.json({ data: { storefrontBranding: branding } });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };

    await assert.rejects(
        syncMoyaoBrand({
            apiOrigin: 'http://127.0.0.1:3000',
            username: 'admin',
            password: 'secret',
            apply: true,
            fetchImpl,
            verificationAttempts: 1,
        }),
        /previous StoreProfile was restored/u,
    );

    assert.equal(state.updateInputs.length, 2);
    assert.equal(state.updateInputs[1].expectedUpdatedAt, '2026-09-04T02:00:00.000Z');
    assert.equal(state.updateInputs[1].storefrontNameZh, '旧品牌');
    assert.equal(state.updateInputs[1].logoAssetId, 'old-icon');
    assert.equal(state.updateInputs[1].logoOnLightAssetId, 'old-light');
    assert.equal(state.updateInputs[1].logoOnDarkAssetId, 'old-dark');
    assert.deepEqual(state.currentProfile, {
        ...original,
        updatedAt: '2026-09-04T03:00:00.000Z',
    });
});
