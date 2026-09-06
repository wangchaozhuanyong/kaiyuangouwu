import assert from 'node:assert/strict';
import test from 'node:test';

import { heroOverlayRepairCodes, repairHeroOverlay } from './repair-hero-overlay.mjs';

function fixture({
    mismatch = false,
    concurrent = false,
    conflict = false,
    missing = false,
    ambiguous = false,
    lostResponse = false,
} = {}) {
    const blocks = [...heroOverlayRepairCodes, 'unrelated-floor'].map((code, index) => ({
        id: String(index),
        updatedAt: 'v1',
        code,
        type: index < 3 ? 'HERO' : 'NOTICE',
        enabled: true,
        position: index,
        imageAsset: {
            id: `asset-${index}`,
            preview: '/assets/preview/image.png',
            source: '/assets/source/image.png',
        },
        imageUrl: '/assets/source/image.png',
        settings: { contrastMode: 'high', custom: { preserve: true } },
        translations: [
            { languageCode: 'zh_Hans', title: '保留中文', subtitle: '', body: '', ctaLabel: '' },
            { languageCode: 'en', title: 'Preserved English', subtitle: '', body: '', ctaLabel: '' },
        ],
        items: [],
    }));
    if (missing) blocks.shift();
    if (ambiguous) blocks.push(structuredClone(blocks[0]));
    const before = structuredClone(blocks);
    const requests = [];
    const writes = [];
    let injected = false;
    const channel = { id: 'channel-1', code: 'my-malaysia' };
    const storeSettings = { heroAutoplayIntervalSeconds: 6, configuredBlockTypes: ['HERO', 'NOTICE'] };
    const fetchImpl = async (url, init) => {
        const { query, variables } = JSON.parse(init.body);
        requests.push({ url, headers: init.headers, query });
        const response = data =>
            new Response(JSON.stringify({ data }), {
                headers: { 'vendure-auth-token': 'fixture-only-session' },
            });
        if (query.includes('HeroRepairLogin'))
            return response({ login: { channels: [{ ...channel, token: 'fixture-only-channel' }] } });
        if (query.includes('HeroRepairApply')) {
            writes.push(variables.input);
            if (conflict) return new Response(JSON.stringify({ errors: [{ message: 'version conflict' }] }));
            assert.deepEqual(
                variables.input.expectedBlocks,
                blocks.map(b => ({ id: b.id, expectedUpdatedAt: b.updatedAt })),
            );
            for (const update of variables.input.updates) {
                assert.deepEqual(Object.keys(update).sort(), ['expectedUpdatedAt', 'id', 'settings']);
                const block = blocks.find(b => b.id === update.id);
                assert.equal(block.updatedAt, update.expectedUpdatedAt);
                block.settings = update.settings;
                block.updatedAt = `v${writes.length + 1}`;
            }
            if (lostResponse) throw new Error('Simulated connection loss after commit');
            return response({
                applyStorefrontContentChanges: blocks.map(({ id, updatedAt }) => ({ id, updatedAt })),
            });
        }
        if (query.includes('HeroRepairAdmin'))
            return response({
                activeChannel: channel,
                storefrontContentSettings: storeSettings,
                storefrontContentBlocks: blocks,
            });
        const language = new URL(url).searchParams.get('languageCode');
        assert.equal(language, init.headers['language-code']);
        const shop = blocks.map(({ translations, updatedAt, ...block }) => ({
            ...block,
            ...Object.fromEntries(
                Object.entries(translations.find(t => t.languageCode === language)).filter(
                    ([key]) => key !== 'languageCode',
                ),
            ),
        }));
        if (mismatch && writes.length === 1 && !injected) {
            injected = true;
            shop[0].settings = { broken: true };
            if (concurrent) blocks[0].settings = { ...blocks[0].settings, anotherEditor: true };
        }
        return response({
            activeChannel: channel,
            storefrontContentSettings: storeSettings,
            storefrontContent: shop,
        });
    };
    return {
        run: (options = {}) =>
            repairHeroOverlay({
                apiOrigin: 'http://localhost:3000',
                username: 'fixture',
                password: 'fixture',
                channelCodes: ['my-malaysia'],
                fetchImpl,
                ...options,
            }),
        requests,
        writes,
        before,
        blocks: () => blocks,
    };
}

test('defaults to dry-run, validates both locales, and does not write', async () => {
    const f = fixture();
    assert.equal((await f.run()).status, 'DRY_RUN');
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.blocks(), f.before);
    assert.ok(f.requests.some(r => r.url.includes('languageCode=zh_Hans')));
    assert.ok(f.requests.some(r => r.url.includes('shop-api?languageCode=en')));
});

test('changes only three themePreset keys atomically and repeated apply is a no-op', async () => {
    const f = fixture();
    assert.equal((await f.run({ apply: true })).status, 'APPLIED_VERIFIED');
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].updates.length, 3);
    assert.deepEqual(f.writes[0].creates, []);
    assert.equal(f.writes[0].orderedCodes, undefined);
    assert.deepEqual(f.blocks()[3], f.before[3]);
    for (let i = 0; i < 3; i++) {
        assert.deepEqual(f.blocks()[i], {
            ...f.before[i],
            updatedAt: 'v2',
            settings: { ...f.before[i].settings, themePreset: 'bright' },
        });
    }
    assert.equal((await f.run({ apply: true })).status, 'VERIFIED_NOOP');
    assert.equal((await f.run({ verify: true })).status, 'VERIFIED');
    assert.equal(f.writes.length, 1);
});

test('fails closed for wrong channel, missing/ambiguous targets, and unguarded production writes', async () => {
    for (const options of [
        { channelCodes: ['__default_channel__'] },
        { apply: true, apiOrigin: 'https://example.test' },
        { apply: true, production: true },
    ]) {
        const f = fixture();
        await assert.rejects(f.run(options));
        assert.equal(f.requests.length, 0);
    }
    for (const options of [{ missing: true }, { ambiguous: true }]) {
        const f = fixture(options);
        await assert.rejects(f.run({ apply: true }));
        assert.equal(f.writes.length, 0);
    }
});

test('rejects optimistic conflicts without modifying data or retrying writes', async () => {
    const f = fixture({ conflict: true });
    await assert.rejects(f.run({ apply: true }));
    assert.equal(f.writes.length, 1);
    assert.deepEqual(f.blocks(), f.before);
});

test('restores original settings and verifies Admin and both Shop locales on post-write failure', async () => {
    const f = fixture({ mismatch: true });
    await assert.rejects(f.run({ apply: true }), /restored and verified/);
    assert.equal(f.writes.length, 2);
    for (let i = 0; i < 3; i++) assert.deepEqual(f.blocks()[i], { ...f.before[i], updatedAt: 'v3' });
});

test('never overwrites concurrent edits during rollback', async () => {
    const f = fixture({ mismatch: true, concurrent: true });
    await assert.rejects(f.run({ apply: true }), /changed concurrently/);
    assert.equal(f.writes.length, 1);
    assert.equal(f.blocks()[0].settings.anotherEditor, true);
});

test('verifies a committed transaction after a lost response without retrying the mutation', async () => {
    const f = fixture({ lostResponse: true });
    assert.equal((await f.run({ apply: true })).status, 'APPLIED_VERIFIED');
    assert.equal(f.writes.length, 1);
});
