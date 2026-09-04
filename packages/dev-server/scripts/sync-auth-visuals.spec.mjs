import assert from 'node:assert/strict';
import test from 'node:test';

import {
    authVisualManifest,
    buildAuthVisualPlan,
    findAuthVisualBlock,
    isLocalApiOrigin,
    parseChannelCodes,
    parseCliArguments,
    selectAuthVisualChannels,
    syncAuthVisuals,
} from './sync-auth-visuals.mjs';

function createAdminBlock(definition, { desired = false } = {}) {
    const translations = ['zh_Hans', 'en'].map(languageCode => ({
        languageCode,
        ...(desired
            ? definition.translations[languageCode]
            : {
                  ctaLabel: languageCode === 'zh_Hans' ? '旧眉题' : 'OLD EYEBROW',
                  title: languageCode === 'zh_Hans' ? '旧标题' : 'Old title',
                  subtitle: languageCode === 'zh_Hans' ? '旧副标题' : 'Old subtitle',
                  body: '',
              }),
    }));
    return {
        id: 'block-1',
        updatedAt: '2026-08-27T01:00:00.000Z',
        code: definition.code,
        type: definition.type,
        enabled: true,
        backgroundColor: desired ? definition.backgroundColor : '#111827',
        textColor: desired ? definition.textColor : '#e5e7eb',
        settings: {
            keepExistingSetting: true,
            authVisualVersion: 1,
            accentColor: desired ? definition.accentColor : '#22c55e',
        },
        imageUrl: null,
        imageAsset: { id: 'asset-existing-image' },
        translations,
        items: [0, 1, 2].map(position => ({
            id: `item-${String(position)}`,
            enabled: true,
            position,
            imageUrl: null,
            imageAsset: null,
            targetType: 'NONE',
            targetValue: null,
            settings: null,
            translations: ['zh_Hans', 'en'].map(languageCode => ({
                languageCode,
                label: desired ? definition.tags[languageCode][position] : `old-${languageCode}-${position}`,
                description: '',
            })),
        })),
    };
}

function shopBlockFromAdmin(block, languageCode) {
    const translation = block.translations.find(item => item.languageCode === languageCode);
    return {
        id: block.id,
        code: block.code,
        type: block.type,
        backgroundColor: block.backgroundColor,
        textColor: block.textColor,
        settings: block.settings,
        imageUrl: block.imageUrl,
        imageAsset: block.imageAsset,
        title: translation.title,
        subtitle: translation.subtitle,
        body: translation.body,
        ctaLabel: translation.ctaLabel,
        items: block.items.map(item => {
            const itemTranslation = item.translations.find(entry => entry.languageCode === languageCode);
            return {
                id: item.id,
                position: item.position,
                imageUrl: item.imageUrl,
                imageAsset: item.imageAsset,
                label: itemTranslation.label,
                description: itemTranslation.description,
            };
        }),
    };
}

function createFetchState(block, { shopDrift = false, shopAlwaysDrifts = false } = {}) {
    const state = {
        blocks: [structuredClone(block)],
        mutations: [],
        batchInputs: [],
        shopDrift,
        shopAlwaysDrifts,
    };
    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        if (request.query.includes('AuthVisualCurrentUser')) {
            return Response.json({
                data: {
                    me: {
                        id: 'admin-1',
                        channels: [{ id: 'channel-1', code: 'cn-mainland', token: 'channel-token' }],
                    },
                },
            });
        }
        if (request.query.includes('AuthVisualAdminBlocks')) {
            return Response.json({ data: { storefrontContentBlocks: structuredClone(state.blocks) } });
        }
        if (request.query.includes('AuthVisualShopBlocks')) {
            const languageCode = init.headers['language-code'];
            const blocks = state.blocks.map(item => shopBlockFromAdmin(item, languageCode));
            if (state.shopDrift) blocks[0].title = 'stale client title';
            return Response.json({
                data: {
                    storefrontContent: blocks,
                },
            });
        }
        if (request.query.includes('ApplyAuthVisualChanges')) {
            state.batchInputs.push(structuredClone(request.variables.input));
            for (const input of request.variables.input.updates) {
                state.mutations.push(structuredClone(input));
                const target = state.blocks.find(item => item.id === input.id);
                target.backgroundColor = input.backgroundColor;
                target.textColor = input.textColor;
                target.settings = input.settings;
                target.translations = input.translations;
                for (const itemInput of input.items) {
                    const item = target.items.find(entry => entry.id === itemInput.id);
                    item.enabled = itemInput.enabled;
                    item.position = itemInput.position;
                    item.targetType = itemInput.targetType;
                    item.targetValue = itemInput.targetValue;
                    item.settings = itemInput.settings;
                    item.translations = itemInput.translations;
                }
                target.updatedAt = '2026-08-27T02:00:00.000Z';
            }
            if (!state.shopAlwaysDrifts) state.shopDrift = false;
            return Response.json({
                data: {
                    applyStorefrontContentChanges: structuredClone(state.blocks),
                },
            });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };
    return { fetchImpl, state };
}

test('manifest uses stable auth block codes and the approved restrained palette', () => {
    assert.deepEqual(
        authVisualManifest.map(item => [item.code, item.type]),
        [
            ['auth-login-visual', 'AUTH_LOGIN'],
            ['auth-register-visual', 'AUTH_REGISTER'],
        ],
    );
    assert.deepEqual(authVisualManifest[0].tags.zh_Hans, ['精选工具', '订单可查', '售后支持']);
    assert.deepEqual(authVisualManifest[1].tags.zh_Hans, ['快速注册', '统一管理', '专属服务']);
    assert.equal(authVisualManifest[0].backgroundColor, '#070B14');
    assert.equal(authVisualManifest[0].accentColor, '#22D3EE');
    assert.equal(authVisualManifest[1].accentColor, '#8B5CF6');
    assert.match(authVisualManifest[0].translations.zh_Hans.ctaLabel, /MOYAO AI/u);
});

test('auth visual Channel selection refuses ambiguous or inaccessible targets', () => {
    const channel = { id: 'channel-1', code: 'cn-mainland', token: 'channel-token' };
    assert.deepEqual(selectAuthVisualChannels([channel]), [channel]);
    assert.throws(
        () => selectAuthVisualChannels([channel, { ...channel, id: 'channel-2', code: 'my-malaysia' }]),
        /AUTH_VISUAL_CHANNEL_CODES is required/,
    );
    assert.throws(() => selectAuthVisualChannels([channel], ['missing']), /cannot access Channel missing/);
});

test('target lookup fails when a stable code is missing or has the wrong type', () => {
    const definition = authVisualManifest[0];
    assert.throws(() => findAuthVisualBlock([], definition), /found 0/);
    assert.throws(
        () => findAuthVisualBlock([{ code: definition.code, type: 'HERO' }], definition),
        /is not AUTH_LOGIN/,
    );
});

test('plan changes copy and palette while retaining the existing image binding', () => {
    const definition = authVisualManifest[0];
    const block = createAdminBlock(definition);
    const plan = buildAuthVisualPlan(block, definition);

    assert.equal(plan.action, 'update');
    assert.equal(plan.input.expectedUpdatedAt, block.updatedAt);
    assert.equal(plan.image.assetId, 'asset-existing-image');
    assert.equal('imageAssetId' in plan.input, false);
    assert.equal('imageUrl' in plan.input, false);
    assert.equal(plan.input.settings.keepExistingSetting, true);
    assert.equal(plan.input.translations[0].title, '欢迎回来，继续你的 AI 工作流');
});

test('a matching block produces an idempotent no-op plan', () => {
    const definition = authVisualManifest[0];
    const plan = buildAuthVisualPlan(createAdminBlock(definition, { desired: true }), definition);

    assert.equal(plan.action, 'noop');
    assert.deepEqual(plan.changes, []);
});

test('dry-run verifies Admin and Shop targets without sending mutations', async () => {
    const definition = authVisualManifest[0];
    const { fetchImpl, state } = createFetchState(createAdminBlock(definition));
    const result = await syncAuthVisuals({
        apiOrigin: 'http://127.0.0.1:3000',
        adminBearerToken: 'admin-session',
        channelCodes: ['cn-mainland'],
        fetchImpl,
        manifest: [definition],
    });

    assert.equal(result.applied, false);
    assert.equal(result.results[0].blocks[0].action, 'update');
    assert.equal(result.results[0].blocks[0].imageAssetId, 'asset-existing-image');
    assert.equal(state.mutations.length, 0);
});

test('read-only verification requires the reviewed Admin values and Shop parity', async () => {
    const definition = authVisualManifest[0];
    const matching = createFetchState(createAdminBlock(definition, { desired: true }));
    const result = await syncAuthVisuals({
        apiOrigin: 'http://127.0.0.1:3000',
        adminBearerToken: 'admin-session',
        channelCodes: ['cn-mainland'],
        verify: true,
        fetchImpl: matching.fetchImpl,
        manifest: [definition],
        verificationAttempts: 1,
    });

    assert.equal(result.applied, false);
    assert.equal(result.verified, true);
    assert.equal(matching.state.mutations.length, 0);

    const drifted = createFetchState(createAdminBlock(definition, { desired: true }), {
        shopDrift: true,
        shopAlwaysDrifts: true,
    });
    await assert.rejects(
        syncAuthVisuals({
            apiOrigin: 'http://127.0.0.1:3000',
            adminBearerToken: 'admin-session',
            channelCodes: ['cn-mainland'],
            verify: true,
            fetchImpl: drifted.fetchImpl,
            manifest: [definition],
            verificationAttempts: 1,
        }),
        /differs between Admin API/u,
    );
    assert.equal(drifted.state.mutations.length, 0);
});

test('apply updates through Admin API, preserves the image and verifies Shop API parity', async () => {
    const definition = authVisualManifest[0];
    const { fetchImpl, state } = createFetchState(createAdminBlock(definition));
    const result = await syncAuthVisuals({
        apiOrigin: 'http://127.0.0.1:3000',
        adminBearerToken: 'admin-session',
        channelCodes: ['cn-mainland'],
        apply: true,
        fetchImpl,
        manifest: [definition],
    });

    assert.equal(result.applied, true);
    assert.equal(state.mutations.length, 1);
    assert.deepEqual(state.batchInputs[0].expectedBlocks, [
        { id: 'block-1', expectedUpdatedAt: '2026-08-27T01:00:00.000Z' },
    ]);
    assert.equal('imageAssetId' in state.mutations[0], false);
    assert.equal('imageUrl' in state.mutations[0], false);
    assert.equal(state.blocks[0].imageAsset.id, 'asset-existing-image');
    assert.equal(state.blocks[0].translations[0].title, '欢迎回来，继续你的 AI 工作流');
});

test('apply can repair observed Admin-Shop drift and reports the pre-publish mismatch', async () => {
    const definition = authVisualManifest[0];
    const { fetchImpl, state } = createFetchState(createAdminBlock(definition), { shopDrift: true });
    const result = await syncAuthVisuals({
        apiOrigin: 'http://127.0.0.1:3000',
        adminBearerToken: 'admin-session',
        channelCodes: ['cn-mainland'],
        apply: true,
        fetchImpl,
        manifest: [definition],
    });

    assert.equal(result.results[0].blocks[0].beforeAdminShopParity.inSync, false);
    assert.match(result.results[0].blocks[0].beforeAdminShopParity.error, /differs between Admin API/);
    assert.equal(state.mutations.length, 1);
});

test('failed Shop verification restores the previous auth content batch', async () => {
    const definition = authVisualManifest[0];
    const original = createAdminBlock(definition);
    const { fetchImpl, state } = createFetchState(original, {
        shopDrift: true,
        shopAlwaysDrifts: true,
    });

    await assert.rejects(
        syncAuthVisuals({
            apiOrigin: 'http://127.0.0.1:3000',
            adminBearerToken: 'admin-session',
            channelCodes: ['cn-mainland'],
            apply: true,
            fetchImpl,
            manifest: [definition],
            verificationAttempts: 1,
        }),
        /previous Admin bindings were restored/,
    );
    assert.equal(state.batchInputs.length, 2);
    assert.equal(state.blocks[0].translations[0].title, original.translations[0].title);
    assert.equal(state.blocks[0].backgroundColor, original.backgroundColor);
});

test('a later Channel failure restores earlier Channels in the reviewed auth batch', async () => {
    const definition = authVisualManifest[0];
    const originalOne = createAdminBlock(definition);
    const originalTwo = { ...createAdminBlock(definition), id: 'block-2' };
    const channels = [
        { id: 'channel-1', code: 'channel-one', token: 'token-one' },
        { id: 'channel-2', code: 'channel-two', token: 'token-two' },
    ];
    const states = new Map([
        ['token-one', [structuredClone(originalOne)]],
        ['token-two', [structuredClone(originalTwo)]],
    ]);
    let version = 1;
    const fetchImpl = async (_url, init) => {
        const request = JSON.parse(init.body);
        if (request.query.includes('AuthVisualCurrentUser')) {
            return Response.json({ data: { me: { id: 'admin-1', channels } } });
        }
        const token = init.headers['vendure-token'];
        const blocks = states.get(token);
        assert.ok(blocks);
        if (request.query.includes('AuthVisualAdminBlocks')) {
            return Response.json({ data: { storefrontContentBlocks: blocks } });
        }
        if (request.query.includes('AuthVisualShopBlocks')) {
            const languageCode = init.headers['language-code'];
            const shopBlocks = blocks.map(block => shopBlockFromAdmin(block, languageCode));
            if (token === 'token-two') shopBlocks[0].title = 'stale second Channel';
            return Response.json({ data: { storefrontContent: shopBlocks } });
        }
        if (request.query.includes('ApplyAuthVisualChanges')) {
            for (const input of request.variables.input.updates) {
                const target = blocks.find(block => block.id === input.id);
                target.backgroundColor = input.backgroundColor;
                target.textColor = input.textColor;
                target.settings = input.settings;
                target.translations = input.translations;
                target.items = input.items.map(item => ({
                    ...target.items.find(candidate => candidate.id === item.id),
                    ...item,
                }));
                version += 1;
                target.updatedAt = `2026-08-27T${String(version).padStart(2, '0')}:00:00.000Z`;
            }
            return Response.json({ data: { applyStorefrontContentChanges: blocks } });
        }
        throw new Error(`Unexpected GraphQL request: ${request.query}`);
    };

    await assert.rejects(
        syncAuthVisuals({
            apiOrigin: 'http://127.0.0.1:3000',
            adminBearerToken: 'admin-session',
            channelCodes: ['channel-one', 'channel-two'],
            apply: true,
            fetchImpl,
            manifest: [definition],
            verificationAttempts: 1,
        }),
        /restored in Channel channel-two/,
    );
    assert.equal(states.get('token-one')[0].translations[0].title, originalOne.translations[0].title);
    assert.equal(states.get('token-two')[0].translations[0].title, originalTwo.translations[0].title);
});

test('remote and production writes require the second explicit guard', async () => {
    await assert.rejects(
        syncAuthVisuals({
            apiOrigin: 'https://api.example.com',
            adminBearerToken: 'admin-session',
            channelCodes: ['cn-mainland'],
            apply: true,
            fetchImpl: () => {
                throw new Error('network must not be reached');
            },
        }),
        /--apply and --allow-remote/,
    );
    await assert.rejects(
        syncAuthVisuals({
            apiOrigin: 'http://127.0.0.1:3002',
            adminBearerToken: 'admin-session',
            channelCodes: ['cn-mainland'],
            apply: true,
            production: true,
            fetchImpl: () => {
                throw new Error('network must not be reached');
            },
        }),
        /--apply and --allow-remote/,
    );
});

test('apply and read-only verification modes cannot be combined', async () => {
    await assert.rejects(
        syncAuthVisuals({
            apiOrigin: 'http://127.0.0.1:3000',
            adminBearerToken: 'admin-session',
            channelCodes: ['cn-mainland'],
            apply: true,
            verify: true,
            fetchImpl: () => {
                throw new Error('network must not be reached');
            },
        }),
        /mutually exclusive/u,
    );
});

test('CLI parsing deduplicates Channels and keeps writes opt-in', () => {
    assert.deepEqual(parseChannelCodes('cn-mainland, my-malaysia,cn-mainland'), [
        'cn-mainland',
        'my-malaysia',
    ]);
    assert.deepEqual(
        parseCliArguments([
            '--apply',
            '--allow-remote',
            '--api-origin',
            'https://api.example.com',
            '--channel-codes',
            'cn-mainland,my-malaysia',
        ]),
        {
            apply: true,
            allowRemote: true,
            verify: false,
            apiOrigin: 'https://api.example.com',
            channelCodes: ['cn-mainland', 'my-malaysia'],
        },
    );
    assert.equal(isLocalApiOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isLocalApiOrigin('https://api.example.com'), false);
});
