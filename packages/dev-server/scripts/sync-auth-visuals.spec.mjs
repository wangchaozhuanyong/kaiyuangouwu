import assert from 'node:assert/strict';
import test from 'node:test';

import {
    authVisualManifest,
    buildAuthVisualPlan,
    findAuthVisualBlock,
    isLocalApiOrigin,
    parseChannelCodes,
    parseCliArguments,
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

function createFetchState(block) {
    const state = { blocks: [structuredClone(block)], mutations: [] };
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
            return Response.json({
                data: {
                    storefrontContent: state.blocks.map(item => shopBlockFromAdmin(item, languageCode)),
                },
            });
        }
        if (request.query.includes('UpdateAuthVisual')) {
            state.mutations.push(structuredClone(request.variables.input));
            const input = request.variables.input;
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
            return Response.json({
                data: {
                    updateStorefrontContentBlock: {
                        id: target.id,
                        updatedAt: target.updatedAt,
                        code: target.code,
                        type: target.type,
                    },
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
    assert.equal('imageAssetId' in state.mutations[0], false);
    assert.equal('imageUrl' in state.mutations[0], false);
    assert.equal(state.blocks[0].imageAsset.id, 'asset-existing-image');
    assert.equal(state.blocks[0].translations[0].title, '欢迎回来，继续你的 AI 工作流');
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
            apiOrigin: 'https://api.example.com',
            channelCodes: ['cn-mainland', 'my-malaysia'],
        },
    );
    assert.equal(isLocalApiOrigin('http://127.0.0.1:3000'), true);
    assert.equal(isLocalApiOrigin('https://api.example.com'), false);
});
