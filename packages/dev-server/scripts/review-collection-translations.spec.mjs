import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { reviewCollectionTranslations } from './review-collection-translations.mjs';

const definitions = [
    {
        slug: 'visa',
        sourceName: '签证留学',
        fields: {
            name: { source: '签证留学', from: 'Business services', to: 'Visa & study abroad' },
            slug: { source: 'visa', from: 'visa', to: 'visa' },
        },
    },
];
function fixture(
    t,
    {
        mismatch = false,
        concurrent = false,
        sourceChanged = false,
        englishChanged = false,
        lostResponse = false,
        wrongChannel = false,
    } = {},
) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'vendure-collection-review-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const snapshotFile = path.join(directory, 'before.json');
    const channel = { id: '2', code: 'catalog-fixture' };
    let collection = {
        id: '47',
        updatedAt: 'v1',
        isPrivate: false,
        position: 4,
        inheritFilters: true,
        parent: { id: '1' },
        featuredAsset: { id: '90' },
        assets: [{ id: '90' }, { id: '91' }],
        filters: [{ code: 'fixture', args: [{ name: 'value', value: 'keep' }] }],
        translations: [
            {
                languageCode: 'zh_Hans',
                name: sourceChanged ? 'Changed source' : '签证留学',
                slug: 'visa',
                description: '签证与留学',
            },
            {
                languageCode: 'en',
                name: englishChanged ? 'Another editor' : 'Business services',
                slug: 'visa',
                description: 'Visa and study support',
            },
        ],
    };
    const before = structuredClone(collection);
    let states = ['name', 'slug'].map(fieldPath => ({
        entityType: 'Collection',
        entityId: '47',
        fieldPath,
        status: 'STALE',
        origin: 'MANUAL',
        locked: true,
    }));
    const writes = [];
    const requests = [];
    let failed = false;
    let adminReads = 0;
    const fetchImpl = async (url, init) => {
        const { query, variables } = JSON.parse(init.body);
        const locale = new URL(url).searchParams.get('languageCode');
        assert.equal(init.headers['language-code'], locale);
        requests.push({ url, query, locale, variables });
        const response = data =>
            new Response(JSON.stringify({ data }), { headers: { 'vendure-auth-token': 'fixture-session' } });
        if (query.includes('CollectionReviewRoute'))
            return response({ activeChannel: wrongChannel ? { id: '1', code: 'wrong' } : channel });
        if (query.includes('CollectionReviewLogin'))
            return response({
                login: {
                    channels: [
                        { ...channel, token: 'fixture-channel' },
                        { id: '1', code: '__default_channel__', token: 'fixture-default-channel' },
                    ],
                },
            });
        assert.equal(init.headers['vendure-token'], 'fixture-channel');
        if (query.includes('CollectionReviewAudit')) return response({ contentTranslationAudit: { states } });
        if (query.includes('CollectionReviewAdmin')) {
            adminReads++;
            if (concurrent && adminReads === 2)
                collection = { ...collection, updatedAt: 'other', position: 9 };
            return response({ activeChannel: channel, collection });
        }
        if (query.includes('CollectionReviewApply')) {
            const { input } = variables;
            assert.deepEqual(Object.keys(input).sort(), ['id', 'translations']);
            assert.equal(input.translations.length, 1);
            assert.equal(input.translations[0].languageCode, 'en');
            assert.deepEqual(Object.keys(input.translations[0]).sort(), ['languageCode', 'name', 'slug']);
            writes.push(input);
            collection.updatedAt = `v${writes.length + 1}`;
            Object.assign(collection.translations[1], input.translations[0]);
            states = states.map(s => ({ ...s, status: 'MANUAL_LOCKED' }));
            if (lostResponse && writes.length === 1) throw new Error('Lost response');
            return response({ updateCollection: collection });
        }
        assert.ok(query.includes('CollectionReviewShop'));
        const { languageCode, ...copy } = collection.translations.find(
            value => value.languageCode === locale,
        );
        const shop = { id: collection.id, ...copy, featuredAsset: collection.featuredAsset };
        if (mismatch && writes.length === 1 && !failed) {
            failed = true;
            shop.name = 'Mismatch';
        }
        return response({ activeChannel: channel, collection: shop });
    };
    return {
        writes,
        requests,
        before,
        current: () => collection,
        snapshotFile,
        run: (options = {}) =>
            reviewCollectionTranslations({
                apiOrigin: 'http://127.0.0.1:3002',
                shopOrigin: 'https://damatong.net',
                username: 'fixture',
                password: 'fixture',
                channelCodes: ['catalog-fixture'],
                snapshotFile,
                definitions,
                fetchImpl,
                ...options,
            }),
    };
}
test('dry-run checks source/English pairs and both locale routes without writes', async t => {
    const f = fixture(t);
    assert.equal((await f.run()).status, 'DRY_RUN');
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.current(), f.before);
    assert.deepEqual(
        new Set(f.requests.filter(r => r.query.includes('CollectionReviewShop')).map(r => r.locale)),
        new Set(['en', 'zh_Hans']),
    );
});
test('English-only review preserves Chinese, slugs, assets, filters; repeated apply is a no-op', async t => {
    const f = fixture(t);
    assert.equal((await f.run({ apply: true, allowRemote: true })).status, 'APPLIED_VERIFIED');
    const backup = JSON.parse(readFileSync(f.snapshotFile, 'utf8'));
    assert.deepEqual(backup.before, [f.before]);
    assert.equal(f.writes.length, 1);
    assert.deepEqual(
        new Set(
            f.requests.filter(r => r.query.includes('CollectionReviewAudit')).map(r => r.variables.channelId),
        ),
        new Set(['1', '2']),
    );
    const expected = structuredClone(f.before);
    expected.updatedAt = 'v2';
    expected.translations[1].name = 'Visa & study abroad';
    assert.deepEqual(f.current(), expected);
    assert.equal((await f.run({ apply: true, allowRemote: true })).status, 'VERIFIED_NOOP');
    assert.equal((await f.run({ verify: true })).status, 'VERIFIED');
    assert.equal(f.writes.length, 1);
});
test('fails before writes for missing guard, snapshot, wrong store and source or English drift', async t => {
    for (const options of [
        { apply: true },
        { apply: true, allowRemote: true, snapshotFile: undefined },
        { shopOrigin: 'https://unreviewed.test' },
        { channelCodes: [] },
    ]) {
        const f = fixture(t);
        await assert.rejects(f.run(options));
        assert.equal(f.requests.length, 0);
    }
    for (const options of [
        { wrongChannel: true },
        { sourceChanged: true },
        { englishChanged: true },
        { concurrent: true },
    ]) {
        const f = fixture(t, options);
        await assert.rejects(f.run({ apply: true, allowRemote: true }));
        assert.equal(f.writes.length, 0);
    }
});
test('Shop mismatch restores prior English through the same API', async t => {
    const f = fixture(t, { mismatch: true });
    await assert.rejects(f.run({ apply: true, allowRemote: true }), /previous content preserved\/restored/);
    assert.equal(f.writes.length, 2);
    assert.deepEqual(f.current(), { ...f.before, updatedAt: 'v3' });
});
test('a lost mutation response is read back and restored, without blindly replaying the write', async t => {
    const f = fixture(t, { lostResponse: true });
    await assert.rejects(f.run({ apply: true, allowRemote: true }), /previous content preserved\/restored/);
    assert.equal(f.writes.length, 2);
    assert.deepEqual(f.current(), { ...f.before, updatedAt: 'v3' });
});
