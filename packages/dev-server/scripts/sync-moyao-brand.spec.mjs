import assert from 'node:assert/strict';
import test from 'node:test';

import {
    brandAssetTags,
    buildMoyaoBrandPlan,
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

test('CLI stays dry-run by default and remote detection is strict', () => {
    assert.deepEqual(parseCliArguments([]), { apply: false, allowRemote: false, validate: false });
    assert.deepEqual(parseCliArguments(['--apply', '--allow-remote', '--channel-code', 'main']), {
        apply: true,
        allowRemote: true,
        validate: false,
        channelCode: 'main',
    });
    assert.equal(isLocalApiOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isLocalApiOrigin('https://console.moyaoai.com'), false);
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
            return Response.json({ data: { storeProfiles: [profile()] } });
        }
        if (request.query.includes('CreateMoyaoBrandAsset')) {
            assert.match(request.query, /\.\.\. on Asset \{ id \}/u);
            assert.doesNotMatch(request.query, /\.\.\. on Asset \{[^}]*\b(?:name|preview|source)\b[^}]*\}/u);
            const logicalTag = request.variables.input[0].tags.find(tag =>
                /^moyao-ai-brand:(?!sha256:)/u.test(tag),
            );
            const key = logicalTag.replace('moyao-ai-brand:', '');
            return Response.json({ data: { createAssets: [{ id: createdAssetIds[key] }] } });
        }
        if (request.query.includes('query MoyaoBrandAsset')) {
            assert.match(request.query, /items \{ id \}/u);
            assert.doesNotMatch(request.query, /\b(?:name|preview|source)\b/u);
            return Response.json({ data: { assets: { items: [] } } });
        }
        if (request.query.includes('AssignMoyaoBrandAsset')) {
            return Response.json({ data: { assignAssetsToChannel: [{ id: 'assigned' }] } });
        }
        if (request.query.includes('UpdateMoyaoBrand')) {
            return Response.json({ data: { updateStoreProfile: { id: 'profile-1' } } });
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
    assert.deepEqual(
        shopRequests.map(request => request.languageCode),
        ['zh_Hans', 'en'],
    );
    for (const request of shopRequests) {
        assert.equal(request.url.pathname, '/shop-api');
        assert.equal(request.headers['language-code'], request.languageCode);
    }
});
