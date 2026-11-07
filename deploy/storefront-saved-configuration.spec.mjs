import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    assertConfigurationPreserved,
    assertPublishedMatchesSaved,
    captureStorefrontConfiguration,
    configurationSummary,
} from './storefront-configuration-guard.mjs';
import {
    loadSavedStorefrontConfiguration,
    readSavedStorefrontConfiguration,
} from './storefront-saved-configuration.mjs';

function fixture() {
    return {
        channel: [
            { id: 1, code: '__default_channel__', token: 'PLATFORM_TOKEN_MUST_NOT_ESCAPE' },
            {
                id: 2,
                code: 'fixture-store',
                token: 'STORE_TOKEN_MUST_NOT_ESCAPE',
                customFieldsStorefrontnamezh: '测试',
                customFieldsStorefrontnameen: 'Fixture',
            },
        ],
        store_profile: [
            {
                id: 2,
                channelId: 2,
                status: 'ACTIVE',
                isPublished: 0,
                descriptionZh: '保存的中文',
                descriptionEn: 'Saved English',
                logoAssetId: 100,
            },
        ],
        store_domain: [{ channelId: 2, domain: 'fixture.example.test', isPrimary: 1, status: 'ACTIVE' }],
        storefront_content_settings: [{ id: 1, channelId: 2, heroAutoplayIntervalSeconds: 6 }],
        storefront_content_block: [
            {
                id: 10,
                channelId: 2,
                createdAt: new Date('2026-01-01T00:00:00Z'),
                code: 'hero',
                type: 'HERO',
                layoutVariant: 'AUTO',
                enabled: 1,
                position: 0,
                startsAt: null,
                endsAt: null,
                imageAssetId: 100,
                imageUrl: null,
                settings: '{}',
            },
            {
                id: 11,
                channelId: 2,
                code: 'storefront-visual-preset',
                type: 'CUSTOM',
                position: 0,
                enabled: 0,
                settings: '{"presetId":"classic"}',
            },
        ],
        storefront_content_item: [
            {
                id: 20,
                blockId: 10,
                createdAt: new Date('2026-01-01T00:00:00Z'),
                enabled: 1,
                position: 0,
                imageAssetId: 200,
                imageUrl: null,
                settings: '{}',
            },
        ],
        storefront_content_block_translation: ['zh_Hans', 'en'].map((languageCode, i) => ({
            id: i + 1,
            baseId: 10,
            languageCode,
            title: languageCode === 'en' ? 'Saved' : '已保存',
            subtitle: '',
            body: '',
            ctaLabel: '',
        })),
        storefront_content_item_translation: ['zh_Hans', 'en'].map((languageCode, i) => ({
            id: i + 1,
            baseId: 20,
            languageCode,
            label: 'Saved item',
            description: '',
        })),
        referral_program_config: [
            { id: 1, channelId: 2, defaultPosterTemplate: 'BRAND_MINIMAL', posterTemplates: 'BRAND_MINIMAL' },
        ],
        referral_poster_template: [
            {
                id: 50,
                channelId: 2,
                name: 'Saved poster',
                position: 0,
                enabled: 1,
                posterBackgroundAssetId: 100,
                shareBackgroundAssetId: 200,
            },
        ],
        asset: [
            { id: 100, mimeType: 'image/svg+xml', source: 'source/hero.svg', preview: 'preview/hero.png' },
            { id: 200, mimeType: 'image/png', source: 'source/item.png', preview: 'preview/item.png' },
        ],
    };
}
function adapter(data, fail) {
    const calls = [];
    return {
        calls,
        async query(sql, params = []) {
            calls.push({ sql, params });
            assert.ok(
                /^(?:SELECT |SET SESSION TRANSACTION |START TRANSACTION |ROLLBACK$)/u.test(sql),
                'Only fixed read-only commands are allowed',
            );
            if (fail?.(sql)) throw new Error('PRIVATE_DATABASE_ERROR');
            const table = / FROM `([a-z_]+)`/u.exec(sql)?.[1];
            return [table ? structuredClone(data[table]) : []];
        },
    };
}

void test('reads one consistent snapshot, preserves bindings and excludes credentials and the visual preset from floors', async () => {
    const db = adapter(fixture());
    const stores = await readSavedStorefrontConfiguration(db);
    assert.equal(stores.length, 1);
    assert.equal(stores[0].profile.primaryDomain, 'fixture.example.test');
    assert.equal(stores[0].profile.isOperational, true);
    assert.deepEqual(
        stores[0].blocks.map(b => b.id),
        ['10'],
    );
    assert.equal(stores[0].blocks[0].items[0].imageAsset.id, 200);
    assert.deepEqual(stores[0].settings.configuredBlockTypes, ['HERO']);
    assert.equal(stores[0].sourceRows.blocks.length, 2);
    assert.match(db.calls[2].sql, /WITH CONSISTENT SNAPSHOT, READ ONLY/u);
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    const methods = [];
    const snapshot = await captureStorefrontConfiguration({
        savedStores: stores,
        request: async (url, init) => {
            assert.match(url, /\/shop-api\?/u);
            assert.equal(init.headers.authorization, undefined);
            assert.equal(init.headers.host, 'fixture.example.test');
            const operation = JSON.parse(init.body);
            methods.push(operation.query);
            assert.ok(!/mutation|login/iu.test(operation.query));
            const locale = new URL(url).searchParams.get('languageCode');
            const copy = stores[0].blocks[0].translations.find(t => t.languageCode === locale);
            return new Response(
                JSON.stringify({
                    data: {
                        activeChannel: { id: '2' },
                        storefrontContent: [
                            {
                                id: '10',
                                position: 0,
                                imageUrl: '/assets/source/hero.svg',
                                ...copy,
                                id: '10',
                                items: [
                                    {
                                        id: '20',
                                        label: 'Saved item',
                                        description: '',
                                        imageUrl: '/assets/preview/item.png',
                                    },
                                ],
                            },
                        ],
                    },
                }),
                { headers: { 'content-type': 'application/json' } },
            );
        },
    });
    assert.equal(methods.length, 2);
    assert.equal(snapshot.format, 2);
    assertPublishedMatchesSaved(snapshot.stores[0]);
    assert.equal(JSON.stringify(snapshot).includes('TOKEN_MUST_NOT_ESCAPE'), false);
    assert.equal(configurationSummary(snapshot).stores[0].contentCount, 1);
});

void test('preserves hidden settings, disabled rows, poster bindings and stored defaults in the release digest', async () => {
    const stores = await readSavedStorefrontConfiguration(adapter(fixture()));
    const before = {
        format: 2,
        stores: stores.map(({ channelToken, ...s }) => ({ ...s, published: { zh_Hans: [], en: [] } })),
    };
    for (const change of [
        s => {
            s.sourceRows.blocks[1].settings = '{"presetId":"changed"}';
        },
        s => {
            s.sharing.defaultPosterTemplate = 'changed';
        },
        s => {
            s.sourceRows.templates[0].shareBackgroundAssetId = 999;
        },
        s => {
            s.sourceRows.assets[0].source = 'changed.svg';
        },
        s => {
            s.sourceRows.channel.customFieldsStorefrontnamezh = 'changed';
        },
    ]) {
        const after = structuredClone(before);
        change(after.stores[0]);
        assert.throws(() => assertConfigurationPreserved(before, after), /configuration changed/u);
    }
});

for (const [name, change] of [
    [
        'missing verified domain',
        d => {
            d.store_domain = [];
        },
    ],
    [
        'closed draft',
        d => {
            d.store_profile[0].status = 'DRAFT';
            d.store_profile[0].isPublished = 0;
        },
    ],
    [
        'duplicate primary domains',
        d => d.store_domain.push({ ...d.store_domain[0], domain: 'second.example.test' }),
    ],
    [
        'missing saved image',
        d => {
            d.asset = [];
        },
    ],
    [
        'missing settings',
        d => {
            d.storefront_content_settings = [];
        },
    ],
    [
        'missing referral defaults',
        d => {
            d.referral_program_config = [];
        },
    ],
    [
        'row budget',
        d => {
            d.channel = Array.from({ length: 10001 }, () => d.channel[0]);
        },
    ],
])
    void test(`fails closed and rolls back on ${name}`, async () => {
        const d = fixture();
        change(d);
        const db = adapter(d);
        await assert.rejects(() => readSavedStorefrontConfiguration(db));
        assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    });

void test('accepts the existing published draft preview predicate and rejects the default Channel', async () => {
    const data = fixture();
    data.store_profile[0].status = 'DRAFT';
    data.store_profile[0].isPublished = 1;
    assert.equal((await readSavedStorefrontConfiguration(adapter(data))).length, 1);
    data.store_profile[0].channelId = 1;
    data.store_domain[0].channelId = 1;
    await assert.rejects(() => readSavedStorefrontConfiguration(adapter(data)), /any storefronts/u);
});
void test('rolls back database failures without attempting any write or login', async () => {
    const db = adapter(fixture(), sql => sql.includes('FROM `storefront_content_item`'));
    await assert.rejects(() => readSavedStorefrontConfiguration(db));
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    await assert.rejects(
        () => loadSavedStorefrontConfiguration({ DB_HOST: 'invalid.fixture', DB_PASSWORD: 'PRIVATE_VALUE' }),
        { message: 'STOREFRONT_CONFIGURATION_DATABASE_READ_FAILED' },
    );
});
void test('pins the same visual-preset discriminator as the content service', () => {
    const source = readFileSync(
        new URL('../packages/storefront-content-plugin/src/visual-presets.ts', import.meta.url),
        'utf8',
    );
    assert.match(source, /STOREFRONT_VISUAL_PRESET_CODE = 'storefront-visual-preset'/u);
});

void test('the required control job executes the database reader and existing public-content guard regressions', () => {
    const workflow = readFileSync(
        new URL('../.github/workflows/build_and_test.yml', import.meta.url),
        'utf8',
    );
    assert.match(
        workflow,
        /node --test packages\/dev-server\/scripts\/storefront-configuration-guard\.spec\.mjs deploy\/storefront-saved-configuration\.spec\.mjs/u,
    );
});
