import { parse } from 'graphql';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    assertConfigurationPreserved,
    assertPublishedMatchesSaved,
    captureStorefrontConfiguration,
    configurationSummary,
    savedConfigurationDigest,
    validatePublishReview,
} from '../../../deploy/storefront-configuration-guard.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

function storeFixture(id = '1') {
    const translations = ['zh_Hans', 'en'].map(languageCode => ({
        languageCode,
        title: languageCode === 'en' ? 'Saved title' : '后台标题',
        subtitle: '',
        body: '',
        ctaLabel: '',
    }));
    const block = {
        id: `${id}01`,
        code: 'hero',
        type: 'HERO',
        enabled: true,
        position: 0,
        settings: {},
        translations,
        items: [],
        imageUrl: '/assets/hero.svg',
        imageAsset: {
            id: `${id}02`,
            mimeType: 'image/svg+xml',
            source: 'source/hero.svg',
            preview: 'preview/hero.png',
        },
    };
    return {
        channelId: id,
        channelCode: `store-${id}`,
        profile: { id, primaryDomain: `store-${id}.example.test` },
        settings: { heroAutoplayIntervalSeconds: 6, configuredBlockTypes: ['HERO'] },
        sharing: {
            defaultPosterTemplate: 'white',
            posterTemplates: ['white'],
            posterTemplateConfigs: [],
            systemPosterTemplateConfigs: [],
        },
        blocks: [block],
        published: Object.fromEntries(
            translations.map(copy => [
                copy.languageCode,
                [{ id: block.id, position: 0, imageUrl: '/assets/source/hero.svg', items: [], ...copy }],
            ]),
        ),
    };
}
function snapshot() {
    return { format: 1, stores: [storeFixture(), storeFixture('2')] };
}

void test('publisher-only mode fails closed for changed manifests, media or missing review', () => {
    assert.equal(validatePublishReview(false, ''), 'none');
    assert.equal(
        validatePublishReview(true, 'preserve-existing', [
            'packages/dev-server/scripts/sync-damatong-storefront.mjs',
        ]),
        'preserve',
    );
    assert.equal(validatePublishReview(true, 'a'.repeat(64)), 'apply');
    for (const file of [
        'packages/dev-server/scripts/damatong-storefront-config.mjs',
        'packages/storefront/src/assets/storefront/damatong/new.png',
    ]) {
        assert.throws(() => validatePublishReview(true, 'preserve-existing', [file]), /changed store data/u);
    }
    for (const review of ['', 'old-plan', 'A'.repeat(64), 'a'.repeat(63), "'; id"])
        assert.throws(() => validatePublishReview(true, review));
    assert.throws(() => validatePublishReview(false, 'preserve-existing'));
    execFileSync(process.execPath, ['deploy/storefront-configuration-guard.mjs', 'review', 'false', ''], {
        cwd: repositoryRoot,
    });
});

void test('configuration hashes ignore GraphQL object-key order but include every store and sharing default', () => {
    const before = snapshot();
    const after = structuredClone(before);
    after.stores[0].profile = Object.fromEntries(Object.entries(after.stores[0].profile).reverse());
    assert.equal(savedConfigurationDigest(before.stores), savedConfigurationDigest(after.stores));
    assert.doesNotThrow(() => assertConfigurationPreserved(before, after));
    after.stores[1].sharing.defaultPosterTemplate = 'other';
    assert.throws(() => assertConfigurationPreserved(before, after), /configuration changed/u);
});

void test('preservation rejects changes to images, text, position, enabled status and interval', () => {
    for (const mutate of [
        store => {
            store.blocks[0].imageAsset.id = 'different';
        },
        store => {
            store.blocks[0].translations[0].title = 'overwritten';
        },
        store => {
            store.blocks[0].position = 3;
        },
        store => {
            store.blocks[0].enabled = false;
        },
        store => {
            store.settings.heroAutoplayIntervalSeconds = 12;
        },
    ]) {
        const before = snapshot();
        const after = structuredClone(before);
        mutate(after.stores[1]);
        assert.throws(() => assertConfigurationPreserved(before, after), /configuration changed/u);
    }
});

void test('readback rejects wrong Channel content, stale image and substituted English copy', () => {
    for (const mutate of [
        store => {
            store.published.en[0].id = 'foreign-id';
        },
        store => {
            store.published.en[0].imageUrl = '/assets/stale.png';
        },
        store => {
            store.published.en[0].subtitle = 'Invented default';
        },
        store => {
            store.published.en[0].position = 10;
        },
    ]) {
        const store = storeFixture();
        mutate(store);
        assert.throws(() => assertPublishedMatchesSaved(store));
    }
});

void test('a missing live floor fails while moving explicit sharing records out of the homepage is allowed', () => {
    const before = snapshot();
    const after = structuredClone(before);
    after.stores[0].published.en = [];
    assert.throws(() => assertConfigurationPreserved(before, after), /disappeared/u);
    before.stores[0].blocks[0].settings.purpose = 'referral-system-poster';
    after.stores[0].blocks[0].settings.purpose = 'referral-system-poster';
    assert.doesNotThrow(() => assertConfigurationPreserved(before, after));
});

void test('published item list includes every enabled item in the saved order', () => {
    const store = storeFixture();
    store.blocks[0].items = Array.from({ length: 8 }, (_, i) => ({
        id: `${i}`,
        enabled: true,
        imageUrl: '',
        translations: ['zh_Hans', 'en'].map(languageCode => ({
            languageCode,
            label: `item ${i}`,
            description: '',
        })),
    }));
    for (const blocks of Object.values(store.published))
        blocks[0].items = store.blocks[0].items.map(item => ({
            id: item.id,
            label: `item ${item.id}`,
            description: '',
            imageUrl: '',
        }));
    assert.doesNotThrow(() => assertPublishedMatchesSaved(store));
    store.published.en[0].items.pop();
    assert.throws(() => assertPublishedMatchesSaved(store), /enabled items/u);
});

void test('all Channel reads use scoped tokens and both client locale inputs without exposing secrets', async () => {
    const fixtures = [storeFixture(), storeFixture('2')];
    const calls = [];
    const request = async (url, options) => {
        const { query } = JSON.parse(options.body);
        parse(query);
        calls.push({ url, options, query });
        let data;
        if (query.includes('ConfigurationGuardLogin'))
            data = {
                login: {
                    id: 'admin',
                    channels: fixtures.map(store => ({
                        id: store.channelId,
                        code: store.channelCode,
                        token: `PRIVATE_CHANNEL_${store.channelId}`,
                    })),
                },
            };
        else if (query.includes('ConfigurationGuardProfiles'))
            data = {
                storeProfiles: fixtures.map(store => ({
                    ...store.profile,
                    channel: { id: store.channelId },
                })),
            };
        else {
            const store = fixtures.find(
                item => options.headers['vendure-token'] === `PRIVATE_CHANNEL_${item.channelId}`,
            );
            assert.ok(store);
            if (query.includes('ConfigurationGuardPublished')) {
                assert.equal(options.headers.authorization, undefined);
                // Production require-domain routing resolves the Host and replaces any submitted Channel token.
                assert.equal(options.headers.host, store.profile.primaryDomain);
                const locale = new URL(url).searchParams.get('languageCode');
                assert.equal(options.headers['language-code'], locale);
                data = { activeChannel: { id: store.channelId }, storefrontContent: store.published[locale] };
            } else
                data = {
                    activeChannel: { id: store.channelId },
                    storefrontContentBlocks: store.blocks,
                    storefrontContentSettings: store.settings,
                    referralProgram: store.sharing,
                };
        }
        return new Response(JSON.stringify({ data }), {
            headers: { 'vendure-auth-token': 'PRIVATE_ADMIN_SESSION' },
        });
    };
    const result = await captureStorefrontConfiguration({
        username: 'FIXTURE_USER',
        password: 'FIXTURE_PASSWORD',
        request,
    });
    assert.equal(result.stores.length, 2);
    assert.equal(calls.length, 8);
    assert.ok(
        calls
            .slice(1)
            .filter(call => call.url.includes('admin-api'))
            .every(
                call =>
                    call.options.headers.authorization === 'Bearer PRIVATE_ADMIN_SESSION' &&
                    call.options.headers.host === undefined,
            ),
    );
    const serialized = JSON.stringify({ result, summary: configurationSummary(result) });
    for (const secret of ['PRIVATE_CHANNEL', 'PRIVATE_ADMIN_SESSION', 'FIXTURE_PASSWORD', 'FIXTURE_USER'])
        assert.equal(serialized.includes(secret), false);
    assert.equal(calls.filter(call => call.query.startsWith('mutation')).length, 1);
});

void test('real loopback transport reads each store through its verified domain without forwarding the admin session', async t => {
    const fixtures = [storeFixture(), storeFixture('2')];
    const seen = [];
    const server = createServer(async (request, response) => {
        try {
            let body = '';
            for await (const chunk of request) body += chunk;
            const { query } = JSON.parse(body);
            const url = new URL(request.url, 'http://127.0.0.1');
            let data;
            if (url.pathname === '/shop-api') {
                const store = fixtures.find(item => item.profile.primaryDomain === request.headers.host);
                if (!store || request.headers.authorization) {
                    response.writeHead(404).end();
                    return;
                }
                seen.push({ domain: request.headers.host, locale: url.searchParams.get('languageCode') });
                data = {
                    activeChannel: { id: store.channelId },
                    storefrontContent: store.published[url.searchParams.get('languageCode')],
                };
            } else if (query.includes('ConfigurationGuardLogin')) {
                response.setHeader('vendure-auth-token', 'PRIVATE_FIXTURE_ADMIN');
                data = {
                    login: {
                        id: 'admin',
                        channels: fixtures.map(store => ({
                            id: store.channelId,
                            code: store.channelCode,
                            token: store.channelId,
                        })),
                    },
                };
            } else if (query.includes('ConfigurationGuardProfiles')) {
                data = {
                    storeProfiles: fixtures.map(store => ({
                        ...store.profile,
                        channel: { id: store.channelId },
                    })),
                };
            } else {
                const store = fixtures.find(item => item.channelId === request.headers['vendure-token']);
                data = {
                    activeChannel: { id: store.channelId },
                    storefrontContentBlocks: store.blocks,
                    storefrontContentSettings: store.settings,
                    referralProgram: store.sharing,
                };
            }
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ data }));
        } catch {
            response.writeHead(500).end();
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });
    const result = await captureStorefrontConfiguration({
        username: 'fixture',
        password: 'fixture',
        apiOrigin: `http://127.0.0.1:${server.address().port}`,
    });
    assert.equal(result.stores.length, 2);
    assert.deepEqual(
        seen,
        fixtures.flatMap(store =>
            ['zh_Hans', 'en'].map(locale => ({ domain: store.profile.primaryDomain, locale })),
        ),
    );
});

void test('missing verified domain fails before any public read instead of falling back to a submitted token', async () => {
    const queries = [];
    await assert.rejects(
        captureStorefrontConfiguration({
            username: 'fixture',
            password: 'fixture',
            request: async (_url, options) => {
                const { query } = JSON.parse(options.body);
                queries.push(query);
                const data = query.includes('ConfigurationGuardLogin')
                    ? { login: { id: 'admin', channels: [{ id: '1', token: 'fixture' }] } }
                    : { storeProfiles: [{ id: '1', channel: { id: '1' }, primaryDomain: null }] };
                return new Response(JSON.stringify({ data }), {
                    headers: { 'vendure-auth-token': 'fixture' },
                });
            },
        }),
        /verified primary domain/u,
    );
    assert.equal(queries.length, 2);
});

void test('guard rejects remote targets, authentication errors and API errors before returning a snapshot', async () => {
    await assert.rejects(
        captureStorefrontConfiguration({ username: 'u', password: 'p', apiOrigin: 'https://example.test' }),
        /loopback/u,
    );
    await assert.rejects(
        captureStorefrontConfiguration({
            username: 'u',
            password: 'p',
            request: async () =>
                new Response(JSON.stringify({ errors: [{ message: 'PRIVATE_SERVER_ERROR' }] })),
        }),
        /operation=ConfigurationGuardLogin reason=API_ERROR/u,
    );
});

void test('configuration failures identify the operation without leaking transport or API response details', async () => {
    const sentinel = 'PRIVATE_PASSWORD_AND_QUERY_DETAILS';
    for (const [request, reason] of [
        [
            async () => {
                throw new DOMException(sentinel, 'TimeoutError');
            },
            'TIMEOUT',
        ],
        [
            async () => {
                throw new Error(sentinel);
            },
            'REQUEST_FAILED',
        ],
        [async () => new Response(sentinel, { status: 503 }), 'HTTP_ERROR'],
        [async () => new Response(sentinel), 'INVALID_JSON'],
        [async () => new Response(JSON.stringify({ errors: [{ message: sentinel }] })), 'API_ERROR'],
    ]) {
        await assert.rejects(
            captureStorefrontConfiguration({ username: 'fixture', password: sentinel, request }),
            error => {
                assert.equal(
                    error.message,
                    `STOREFRONT_CONFIGURATION_QUERY_FAILED operation=ConfigurationGuardLogin reason=${reason}`,
                );
                assert.equal(error.message.includes(sentinel), false);
                return true;
            },
        );
    }
    await assert.rejects(
        captureStorefrontConfiguration({
            username: 'fixture',
            password: sentinel,
            request: async (_url, options) => {
                if (JSON.parse(options.body).query.includes('ConfigurationGuardProfiles'))
                    throw new DOMException(sentinel, 'TimeoutError');
                return new Response(
                    JSON.stringify({ data: { login: { id: '1', channels: [{ id: '1' }] } } }),
                    { headers: { 'vendure-auth-token': sentinel } },
                );
            },
        }),
        /operation=ConfigurationGuardProfiles reason=TIMEOUT/u,
    );
});

void test('release plan, bootstrap and fixed inspection wire the new review and preservation checks', () => {
    const deploy = readFileSync(
        new URL('../../../deploy/deploy-production-from-s3.sh', import.meta.url),
        'utf8',
    );
    const build = readFileSync(
        new URL('../../../.github/workflows/build_production_runtime.yml', import.meta.url),
        'utf8',
    );
    const workflow = readFileSync(
        new URL('../../../.github/workflows/deploy_production_runtime.yml', import.meta.url),
        'utf8',
    );
    assert.match(build, /damatong_publish_review:/u);
    assert.match(build, /damatongPublishReview: \$damatongPublishReview/u);
    assert.match(workflow, /\.damatongPublishReview \| type == "string"/u);
    assert.match(workflow, /VENDURE_REVIEWED_DAMATONG_PUBLISH_REVIEW='\$\{DAMATONG_PUBLISH_REVIEW\}'/u);
    assert.match(deploy, /storefront-configuration-guard\.mjs" review/u);
    assert.match(deploy, /storefront-configuration-guard\.mjs" capture/u);
    assert.match(deploy, /storefront-configuration-guard\.mjs" verify/u);
    assert.match(deploy, /STOREFRONT_PUBLISH_REVIEW_SHA256="\$\{reviewed_damatong_publish_review\}"/u);
    assert.match(deploy, /storefront_configuration_guard=enabled/u);
    assert.match(deploy, /typeof publisher\.assertReviewedStorefrontPublish !== "function"/u);
});
