import assert from 'node:assert/strict';
import test from 'node:test';

import {
    awanMeshBrand,
    awanMeshBrandAssets,
    brandAssetTags,
    buildAwanMeshBrandPlan,
    isLocalApiOrigin,
    parseCliArguments,
    prepareAwanMeshBrandAssets,
    syncAwanMeshBrand,
} from './sync-awanmesh-brand.mjs';

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

test('brand kit manifest contains the three immutable SVG roles and hashes them', async () => {
    const prepared = await prepareAwanMeshBrandAssets();
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
    }
});

test('plan updates names, bilingual slogan, palette, and all asset bindings together', () => {
    const assets = new Map(awanMeshBrandAssets.map((item, index) => [item.key, { id: `asset-${index}` }]));
    const plan = buildAwanMeshBrandPlan(profile(), assets);
    assert.equal(plan.action, 'update');
    assert.equal(plan.input.storefrontNameZh, 'AwanMesh｜模钥');
    assert.equal(plan.input.taglineEn, 'One Key. Every Model.');
    assert.equal(plan.input.brandBackgroundColor, '#071426');
    assert.equal(plan.input.logoOnDarkAssetId, 'asset-2');
});

test('matching profile and asset IDs produce an idempotent no-op', () => {
    const assets = new Map(awanMeshBrandAssets.map((item, index) => [item.key, { id: `asset-${index}` }]));
    const current = profile({
        channel: {
            id: 'channel-1',
            code: awanMeshBrand.channelCode,
            customFields: {
                storefrontNameZh: awanMeshBrand.storefrontNameZh,
                storefrontNameEn: awanMeshBrand.storefrontNameEn,
            },
        },
        descriptionZh: awanMeshBrand.descriptionZh,
        descriptionEn: awanMeshBrand.descriptionEn,
        taglineZh: awanMeshBrand.taglineZh,
        taglineEn: awanMeshBrand.taglineEn,
        brandBackgroundColor: awanMeshBrand.brandBackgroundColor,
        brandPrimaryColor: awanMeshBrand.brandPrimaryColor,
        brandAccentColor: awanMeshBrand.brandAccentColor,
        brandHighlightColor: awanMeshBrand.brandHighlightColor,
        logoAsset: { id: 'asset-0' },
        logoOnLightAsset: { id: 'asset-1' },
        logoOnDarkAsset: { id: 'asset-2' },
    });
    assert.equal(buildAwanMeshBrandPlan(current, assets).action, 'noop');
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
        syncAwanMeshBrand({
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
