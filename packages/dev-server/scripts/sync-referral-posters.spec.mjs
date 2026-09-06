import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import presetsModule from '../../store-management-plugin/dist/referral/referral-poster-presets.js';

import {
    comparablePoster,
    parsePosterArguments,
    prepareReferralPosters,
    syncReferralPosters,
    systemBlockInput,
} from './sync-referral-posters.mjs';
const {
    referralPosterPresets: presets,
    referralPosterCopy: copy,
    referralPosterContentCode: codeFor,
} = presetsModule;

function fixture() {
    const state = {
        a: { blocks: [], custom: [], version: 'v1', visibility: [presets[0].id], default: presets[0].id },
        b: { blocks: [], custom: [], version: 'v1', visibility: [], default: '' },
    };
    const calls = [];
    const mediaCalls = [];
    let sequence = 1;
    const controls = { failEnglish: false, loseBatchResponse: false };
    const channels = [
        { id: 'a', code: 'shop-a', token: 'fixture-a' },
        { id: 'b', code: 'shop-b', token: 'fixture-b' },
    ];
    const asset = id => ({
        id,
        source: `https://assets.example/${id}.png`,
        preview: `https://assets.example/${id}.png`,
        width: 1080,
        height: 1920,
    });
    function program(key, locale, shop = false, systems = false) {
        const store = state[key];
        return {
            channelId: key,
            updatedAt: store.version,
            posterTemplates: [...store.visibility],
            defaultPosterTemplate: store.default,
            posterTemplateConfigs: structuredClone(store.custom.filter(item => !shop || item.enabled)),
            ...(systems
                ? {
                      systemPosterTemplateConfigs: presets.map((preset, position) => {
                          const block = store.blocks.find(item => item.code === codeFor(preset.id));
                          return {
                              ...copy,
                              ...block?.settings.copy,
                              id: preset.id,
                              name: locale === 'en' ? preset.nameEn : preset.nameZh,
                              enabled: store.visibility.includes(preset.id),
                              position,
                              layoutVariant: 'STANDARD_CENTER',
                              posterBackgroundAsset: block?.imageAsset ? asset(block.imageAsset.id) : null,
                              shareBackgroundAsset: null,
                              foregroundColor: block?.textColor || preset.foregroundColor,
                              accentColor: block?.settings.accentColor || preset.accentColor,
                              overlayOpacity: 0,
                              design: { ...preset.design, ...block?.settings.design },
                          };
                      }),
                  }
                : {}),
        };
    }
    const response = data =>
        new Response(JSON.stringify({ data }), { headers: { 'vendure-auth-token': 'fixture-auth' } });
    async function fetchImpl(url, init) {
        const { query, variables } = JSON.parse(init.body);
        calls.push({ query, variables, url, headers: init.headers });
        if (query.includes('PosterPublishLogin')) return response({ login: { channels } });
        const key = init.headers['vendure-token'] === 'fixture-a' ? 'a' : 'b';
        const store = state[key];
        const locale = new URL(url).searchParams.get('languageCode');
        assert.equal(init.headers['language-code'], locale, 'Both client locale routes are required');
        const shop = url.includes('/shop-api');
        if (query.includes('PosterPublishState'))
            return response({
                referralProgram: program(key, locale),
                storefrontContentBlocks: structuredClone(store.blocks),
            });
        if (query.includes('PosterPublishVerify')) {
            const result = program(key, locale, shop, true);
            if (controls.failEnglish && shop && locale === 'en' && key === 'b') {
                result.systemPosterTemplateConfigs[0].headlineEn = 'Stale English copy';
                controls.failEnglish = false;
            }
            return response({ activeChannel: { code: `shop-${key}` }, referralProgram: result });
        }
        if (query.includes('PosterBindBatch')) {
            const { input } = variables;
            assert.deepEqual(
                input.expectedBlocks,
                store.blocks.map(block => ({ id: block.id, expectedUpdatedAt: block.updatedAt })),
            );
            for (const create of input.creates) {
                const { imageAssetId, ...rest } = create;
                store.blocks.push({
                    ...rest,
                    id: `block-${sequence++}`,
                    updatedAt: `v${sequence++}`,
                    imageAsset: { id: imageAssetId },
                    imageUrl: null,
                });
            }
            for (const update of input.updates) {
                const existing = store.blocks.find(item => item.id === update.id);
                assert.equal(existing.updatedAt, update.expectedUpdatedAt);
                const { imageAssetId, expectedUpdatedAt, ...rest } = update;
                Object.assign(existing, rest, {
                    imageAsset: imageAssetId ? { id: imageAssetId } : null,
                    updatedAt: `v${sequence++}`,
                });
            }
            if (controls.loseBatchResponse) {
                controls.loseBatchResponse = false;
                throw new Error('Lost response after commit');
            }
            return response({ applyStorefrontContentChanges: structuredClone(store.blocks) });
        }
        if (query.includes('PosterCreateAi')) {
            const { posterBackgroundAssetId, shareBackgroundAssetId, expectedUpdatedAt, ...rest } =
                variables.input;
            assert.equal(expectedUpdatedAt, store.version);
            const created = {
                ...rest,
                id: `custom-${sequence++}`,
                posterBackgroundAsset: asset(posterBackgroundAssetId),
                shareBackgroundAsset: null,
            };
            store.custom.push(created);
            store.version = `v${sequence++}`;
            return response({ createReferralPosterTemplate: created });
        }
        if (query.includes('PosterUndoCustom')) {
            store.custom = store.custom.filter(item => item.id !== variables.id);
            return response({ deleteReferralPosterTemplate: { result: 'DELETED' } });
        }
        if (query.includes('PosterUndoBlock')) {
            store.blocks = store.blocks.filter(item => item.id !== variables.id);
            return response({ deleteStorefrontContentBlock: { result: 'DELETED' } });
        }
        throw new Error(`Unhandled fixture query: ${query.slice(0, 60)}`);
    }
    async function mediaSync(mediaOptions) {
        mediaCalls.push(mediaOptions);
        return {
            results: mediaOptions.manifest.map(item => ({ key: item.key, assetId: `asset-${item.key}` })),
        };
    }
    const options = {
        apiOrigin: 'http://127.0.0.1:3000',
        username: 'fixture',
        password: 'fixture',
        channelCodes: ['shop-a', 'shop-b'],
        aiChannelCode: 'shop-a',
        fetchImpl,
        mediaSync,
        production: false,
    };
    return { options, calls, mediaCalls, state, controls };
}
async function withBackup(run) {
    const directory = await mkdtemp(path.join(tmpdir(), 'poster-publisher-'));
    try {
        await run(path.join(directory, 'before.json'));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

test('six backgrounds have exact dimensions and unique deterministic identities', async () => {
    const entries = await prepareReferralPosters();
    assert.equal(entries.length, 6);
    assert.equal(new Set(entries.map(item => item.hash)).size, 6);
    assert.equal(new Set(entries.map(item => item.assetOnly.purpose)).size, 6);
    assert.equal(entries.filter(item => item.templateId).length, 5);
});

test('writes are opt-in and credentials and target Channels cannot be passed on the CLI', async () => {
    assert.deepEqual(parsePosterArguments([]), {
        apply: false,
        allowRemote: false,
        verify: false,
        validate: false,
    });
    assert.throws(() => parsePosterArguments(['--channel-codes', 'shop']), /environment variables/);
    assert.throws(() => parsePosterArguments(['--apply', '--verify']), /mutually exclusive/);
    const noNetwork = () => {
        throw new Error('Network must not be reached');
    };
    await assert.rejects(syncReferralPosters({ fetchImpl: noNetwork }), /REFERRAL_POSTER_CHANNEL_CODES/);
    await assert.rejects(
        syncReferralPosters({ channelCodes: ['shop'], aiChannelCode: 'another', fetchImpl: noNetwork }),
        /explicitly included/,
    );
    await assert.rejects(
        syncReferralPosters({
            ...fixture().options,
            apiOrigin: 'https://store.example',
            apply: true,
            fetchImpl: noNetwork,
        }),
        /--allow-remote/,
    );
});

test('republishing preserves bilingual store copy and detects content-code conflicts', () => {
    const existing = {
        id: 'block',
        type: 'CUSTOM',
        updatedAt: 'version',
        settings: {
            purpose: 'referral-system-poster',
            templateId: presets[0].id,
            copy: { headlineZh: '本店广告', headlineEn: 'Our reviewed advertisement' },
            design: { panel: '#eeeeee' },
            extra: 'preserved',
        },
    };
    const input = systemBlockInput(presets[0], 'new-asset', existing);
    assert.deepEqual(input.settings.copy, existing.settings.copy);
    assert.equal(input.expectedUpdatedAt, 'version');
    assert.equal(input.settings.design.panel, '#eeeeee');
    assert.equal(input.settings.extra, 'preserved');
    assert.throws(() => systemBlockInput(presets[0], 'asset', { ...existing, type: 'HERO' }), /conflict/);
});

test('dry-run works against the previous API contract and never writes content', async () => {
    const f = fixture();
    const result = await syncReferralPosters(f.options);
    assert.equal(result.applied, false);
    assert.equal(result.results.length, 11);
    assert.equal(result.results.filter(item => item.kind === 'custom-ai').length, 1);
    assert.equal(f.calls.filter(call => call.query.includes('mutation')).length, 1);
    assert.ok(!f.calls.some(call => call.query.includes('systemPosterTemplateConfigs')));
    assert.ok(f.mediaCalls.every(call => !call.apply));
    assert.doesNotMatch(JSON.stringify(result), /fixture-auth|fixture-a|fixture-b/);
});

test('publishes five atomic bindings per store, creates AI only in its store, and verifies both locales', () =>
    withBackup(async backupFile => {
        const f = fixture();
        const result = await syncReferralPosters({ ...f.options, backupFile, apply: true });
        assert.equal(result.verified, true);
        assert.equal(f.state.a.blocks.length, 5);
        assert.equal(f.state.b.blocks.length, 5);
        assert.equal(f.state.a.custom.length, 1);
        assert.equal(f.state.a.custom[0].enabled, false);
        assert.equal(f.state.b.custom.length, 0);
        assert.deepEqual(f.state.b.visibility, []);
        assert.equal(f.calls.filter(call => call.query.includes('PosterBindBatch')).length, 2);
        for (const token of ['fixture-a', 'fixture-b'])
            for (const locale of ['en', 'zh_Hans'])
                assert.ok(
                    f.calls.some(
                        call =>
                            call.url.includes(`/shop-api?languageCode=${locale}`) &&
                            call.headers['vendure-token'] === token,
                    ),
                );
        const before = f.calls.length;
        await syncReferralPosters({ ...f.options, backupFile: `${backupFile}.second`, apply: true });
        assert.equal(
            f.calls
                .slice(before)
                .filter(
                    call => call.query.includes('PosterBindBatch') || call.query.includes('PosterCreateAi'),
                ).length,
            0,
        );
        assert.equal(f.state.a.custom.length, 1);
        const verifyStart = f.calls.length;
        await syncReferralPosters({ ...f.options, verify: true });
        assert.equal(f.calls.slice(verifyStart).filter(call => call.query.includes('mutation')).length, 1);
    }));

test('stale English on the second store restores all confirmed content and leaves no AI import', () =>
    withBackup(async backupFile => {
        const f = fixture();
        f.controls.failEnglish = true;
        await assert.rejects(syncReferralPosters({ ...f.options, backupFile, apply: true }), /were restored/);
        for (const store of Object.values(f.state)) {
            assert.deepEqual(store.blocks, []);
            assert.deepEqual(store.custom, []);
        }
        assert.equal(f.state.a.default, presets[0].id);
        assert.deepEqual(f.state.b.visibility, []);
    }));

test('a lost batch response after commit is recovered by invocation marker and rolled back', () =>
    withBackup(async backupFile => {
        const f = fixture();
        f.controls.loseBatchResponse = true;
        await assert.rejects(syncReferralPosters({ ...f.options, backupFile, apply: true }), /were restored/);
        assert.deepEqual(f.state.a.blocks, []);
        assert.deepEqual(f.state.a.custom, []);
    }));

function scopedFetch(f, wrongPublicPath = false) {
    return async (url, init) => {
        const { query } = JSON.parse(init.body);
        if (query.includes('PosterPublishLogin'))
            return new Response(
                JSON.stringify({
                    data: {
                        login: {
                            channels: [
                                { id: 'a', code: '__default_channel__', token: 'fixture-a' },
                                { id: 'b', code: 'second-store', token: 'fixture-b' },
                            ],
                        },
                    },
                }),
                { headers: { 'vendure-auth-token': 'fixture-auth' } },
            );
        if (query.includes('PosterStoreRoute'))
            return new Response(
                JSON.stringify({
                    data: {
                        activeChannel: {
                            code:
                                new URL(url).hostname === 'moyaoai.com'
                                    ? '__default_channel__'
                                    : 'second-store',
                        },
                    },
                }),
            );
        const response = await f.options.fetchImpl(url, init);
        if (!query.includes('PosterPublishVerify')) return response;
        const body = await response.json();
        const isPrimary = init.headers['vendure-token'] === 'fixture-a';
        body.data.activeChannel.code = isPrimary ? '__default_channel__' : 'second-store';
        for (const template of [
            ...body.data.referralProgram.posterTemplateConfigs,
            ...body.data.referralProgram.systemPosterTemplateConfigs,
        ]) {
            if (!template.posterBackgroundAsset) continue;
            for (const field of ['source', 'preview']) {
                const assetUrl = new URL(template.posterBackgroundAsset[field]);
                const suffix = wrongPublicPath && url.includes('/shop-api') ? '-wrong' : '';
                template.posterBackgroundAsset[field] = `${new URL(url).origin}${assetUrl.pathname}${suffix}`;
            }
        }
        return new Response(JSON.stringify(body));
    };
}

test('reviewed scope resolves real domain Channels without exposing their routing tokens', async () => {
    const f = fixture();
    const fetchImpl = scopedFetch(f);
    const result = await syncReferralPosters({
        ...f.options,
        channelCodes: [],
        aiChannelCode: undefined,
        scope: 'both-stores',
        fetchImpl,
    });
    assert.deepEqual(result.channelCodes, ['__default_channel__', 'second-store']);
    assert.equal(result.results.filter(item => item.kind === 'custom-ai').length, 1);
    assert.equal(result.results.find(item => item.kind === 'custom-ai').channelCode, '__default_channel__');
    assert.doesNotMatch(JSON.stringify(result), /fixture-auth|fixture-a|fixture-b/);
});

test('internal and public API asset origins preserve full template parity for both stores and custom posters', () =>
    withBackup(async backupFile => {
        const f = fixture();
        const options = {
            ...f.options,
            channelCodes: [],
            aiChannelCode: undefined,
            scope: 'both-stores',
            fetchImpl: scopedFetch(f),
        };
        await syncReferralPosters({ ...options, backupFile, apply: true });
        f.state.a.custom[0].enabled = true;
        assert.equal((await syncReferralPosters({ ...options, verify: true })).verified, true);
    }));

test('a different public asset path still fails parity and restores imported content', () =>
    withBackup(async backupFile => {
        const f = fixture();
        await assert.rejects(
            syncReferralPosters({
                ...f.options,
                channelCodes: [],
                aiChannelCode: undefined,
                scope: 'both-stores',
                fetchImpl: scopedFetch(f, true),
                backupFile,
                apply: true,
            }),
            /were restored/,
        );
        assert.equal(f.state.a.blocks.length, 0);
        assert.equal(f.state.a.custom.length, 0);
    }));

test('origin normalization keeps unrelated hosts, dimensions, asset IDs and copy differences detectable', () => {
    const adminOrigin = 'http://127.0.0.1:3002';
    const shopOrigin = 'https://moyaoai.com';
    const poster = host => ({
        headlineZh: '广告内容',
        posterBackgroundAsset: {
            id: '131',
            width: 1080,
            height: 1920,
            source: `${host}/assets/source/14/poster.png`,
            preview: `${host}/assets/preview/c1/poster.png`,
        },
    });
    const expected = comparablePoster(poster(adminOrigin), adminOrigin);
    assert.deepEqual(comparablePoster(poster(shopOrigin), shopOrigin), expected);
    assert.deepEqual(comparablePoster(poster(shopOrigin), adminOrigin, shopOrigin), expected);
    assert.notDeepEqual(comparablePoster(poster('https://unrelated.example'), shopOrigin), expected);
    for (const field of ['id', 'width', 'height']) {
        const changed = poster(shopOrigin);
        changed.posterBackgroundAsset[field] = 'different';
        assert.notDeepEqual(comparablePoster(changed, shopOrigin), expected);
    }
    assert.notDeepEqual(
        comparablePoster({ ...poster(shopOrigin), headlineZh: '旧广告' }, shopOrigin),
        expected,
    );
});

test('a later-store verification failure restores earlier store copy and background exactly', () =>
    withBackup(async backupFile => {
        const f = fixture();
        const initial = systemBlockInput(presets[0], 'previous-asset');
        const { imageAssetId, ...rest } = initial;
        const previous = {
            ...rest,
            id: 'existing-block',
            updatedAt: 'before-version',
            imageUrl: null,
            imageAsset: { id: imageAssetId },
            settings: {
                ...initial.settings,
                copy: {
                    ...copy,
                    headlineZh: 'Original store heading',
                    headlineEn: 'Reviewed original English',
                },
            },
        };
        f.state.a.blocks.push(structuredClone(previous));
        f.controls.failEnglish = true;
        await assert.rejects(syncReferralPosters({ ...f.options, backupFile, apply: true }), /were restored/);
        assert.equal(f.state.a.blocks.length, 1);
        assert.deepEqual({ ...f.state.a.blocks[0], updatedAt: previous.updatedAt }, previous);
        assert.deepEqual(f.state.a.custom, []);
    }));
