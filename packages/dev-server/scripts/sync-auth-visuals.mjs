import 'dotenv/config';

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LANGUAGE_CODES = ['zh_Hans', 'en'];

export const authVisualManifest = [
    {
        code: 'auth-login-visual',
        type: 'AUTH_LOGIN',
        backgroundColor: '#070B14',
        textColor: '#ffffff',
        accentColor: '#22D3EE',
        translations: {
            zh_Hans: {
                ctaLabel: 'MOYAO AI｜模钥 AI 工具精选',
                title: '欢迎回来，继续你的 AI 工作流',
                subtitle: '常用 AI 工具、收藏与订单，登录后统一管理',
                body: '',
            },
            en: {
                ctaLabel: 'CURATED AI TOOLS',
                title: 'Welcome back to your AI workflow',
                subtitle: 'Manage your everyday AI tools, favorites and orders in one place',
                body: '',
            },
        },
        tags: {
            zh_Hans: ['精选工具', '订单可查', '售后支持'],
            en: ['Curated tools', 'Track orders', 'Customer support'],
        },
    },
    {
        code: 'auth-register-visual',
        type: 'AUTH_REGISTER',
        backgroundColor: '#070B14',
        textColor: '#ffffff',
        accentColor: '#8B5CF6',
        translations: {
            zh_Hans: {
                ctaLabel: '建立你的 AI 工具账户',
                title: '创建你的 AI 工具中心',
                subtitle: '发现创作、编程与办公工具，购买记录清晰可查',
                body: '',
            },
            en: {
                ctaLabel: 'CREATE YOUR AI ACCOUNT',
                title: 'Create your AI tools hub',
                subtitle: 'Find tools for creating, coding and work, with purchases kept in one place',
                body: '',
            },
        },
        tags: {
            zh_Hans: ['快速注册', '统一管理', '专属服务'],
            en: ['Quick signup', 'One place', 'Dedicated support'],
        },
    },
];

const LOGIN_MUTATION = `
    mutation AuthVisualLogin($username: String!, $password: String!) {
        login(username: $username, password: $password, rememberMe: false) {
            ... on CurrentUser {
                id
                channels { id code token }
            }
            ... on ErrorResult { errorCode message }
        }
    }
`;

const CURRENT_USER_QUERY = `
    query AuthVisualCurrentUser {
        me { id channels { id code token } }
    }
`;

const ADMIN_BLOCKS_QUERY = `
    query AuthVisualAdminBlocks {
        storefrontContentBlocks {
            id
            updatedAt
            code
            type
            enabled
            backgroundColor
            textColor
            settings
            imageUrl
            imageAsset { id }
            translations { languageCode title subtitle body ctaLabel }
            items {
                id
                enabled
                position
                imageUrl
                imageAsset { id }
                targetType
                targetValue
                settings
                translations { languageCode label description }
            }
        }
    }
`;

const UPDATE_BLOCK_MUTATION = `
    mutation UpdateAuthVisual($input: UpdateStorefrontContentBlockInput!) {
        updateStorefrontContentBlock(input: $input) {
            id
            updatedAt
            code
            type
        }
    }
`;

const SHOP_BLOCKS_QUERY = `
    query AuthVisualShopBlocks {
        storefrontContent {
            id
            code
            type
            backgroundColor
            textColor
            settings
            imageUrl
            imageAsset { id }
            title
            subtitle
            body
            ctaLabel
            items {
                id
                position
                imageUrl
                imageAsset { id }
                label
                description
            }
        }
    }
`;

export function isLocalApiOrigin(value) {
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        (url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === '::1' ||
            url.hostname.endsWith('.localhost'))
    );
}

export function parseChannelCodes(value) {
    return Array.from(
        new Set(
            String(value ?? '')
                .split(',')
                .map(code => code.trim())
                .filter(Boolean),
        ),
    );
}

export function findAuthVisualBlock(blocks, definition) {
    const matches = blocks.filter(block => block.code === definition.code);
    assert.equal(
        matches.length,
        1,
        `Expected one content block with code ${definition.code}, found ${String(matches.length)}`,
    );
    assert.equal(matches[0].type, definition.type, `${definition.code} is not ${definition.type}`);
    return matches[0];
}

function translationByLanguage(translations, languageCode, owner) {
    const matches = translations.filter(translation => translation.languageCode === languageCode);
    assert.equal(matches.length, 1, `${owner} requires exactly one ${languageCode} translation`);
    return matches[0];
}

function sortedItems(items) {
    return [...items].sort((left, right) => left.position - right.position);
}

function imageState(block) {
    return {
        assetId: block.imageAsset?.id ?? null,
        imageUrl: block.imageUrl ?? null,
    };
}

function adminPresentation(block, languageCode) {
    const translation = translationByLanguage(block.translations, languageCode, block.code);
    return {
        backgroundColor: block.backgroundColor ?? null,
        textColor: block.textColor ?? null,
        settings: block.settings ?? null,
        image: imageState(block),
        ctaLabel: translation.ctaLabel,
        title: translation.title,
        subtitle: translation.subtitle,
        body: translation.body,
        items: sortedItems(block.items).map(item => {
            const itemTranslation = translationByLanguage(
                item.translations,
                languageCode,
                `${block.code} item ${String(item.position)}`,
            );
            return {
                position: item.position,
                image: imageState(item),
                label: itemTranslation.label,
                description: itemTranslation.description,
            };
        }),
    };
}

function shopPresentation(block) {
    return {
        backgroundColor: block.backgroundColor ?? null,
        textColor: block.textColor ?? null,
        settings: block.settings ?? null,
        image: imageState(block),
        ctaLabel: block.ctaLabel,
        title: block.title,
        subtitle: block.subtitle,
        body: block.body,
        items: sortedItems(block.items).map(item => ({
            position: item.position,
            image: imageState(item),
            label: item.label,
            description: item.description,
        })),
    };
}

function comparableAdminState(block) {
    return Object.fromEntries(
        LANGUAGE_CODES.map(languageCode => [languageCode, adminPresentation(block, languageCode)]),
    );
}

function desiredAdminState(block, definition) {
    const items = sortedItems(block.items);
    assert.equal(items.length, 3, `${definition.code} must contain exactly three tag items`);
    assert.deepEqual(
        items.map(item => item.position),
        [0, 1, 2],
        `${definition.code} tag item positions must be 0, 1, 2`,
    );
    const settings = {
        ...(block.settings ?? {}),
        authVisualVersion: 1,
        accentColor: definition.accentColor,
    };
    return Object.fromEntries(
        LANGUAGE_CODES.map(languageCode => [
            languageCode,
            {
                backgroundColor: definition.backgroundColor,
                textColor: definition.textColor,
                settings,
                image: imageState(block),
                ...definition.translations[languageCode],
                items: items.map((item, index) => ({
                    position: item.position,
                    image: imageState(item),
                    label: definition.tags[languageCode][index],
                    description: '',
                })),
            },
        ]),
    );
}

function changedFields(current, desired) {
    const changes = [];
    for (const field of ['backgroundColor', 'textColor', 'settings']) {
        if (JSON.stringify(current.zh_Hans[field]) !== JSON.stringify(desired.zh_Hans[field])) {
            changes.push(field);
        }
    }
    for (const languageCode of LANGUAGE_CODES) {
        for (const field of ['ctaLabel', 'title', 'subtitle', 'body']) {
            if (current[languageCode][field] !== desired[languageCode][field]) {
                changes.push(`${languageCode}.${field}`);
            }
        }
        current[languageCode].items.forEach((item, index) => {
            if (item.label !== desired[languageCode].items[index].label) {
                changes.push(`${languageCode}.tags.${String(index)}`);
            }
            if (item.description !== desired[languageCode].items[index].description) {
                changes.push(`${languageCode}.tagDescriptions.${String(index)}`);
            }
        });
    }
    return changes;
}

export function buildAuthVisualPlan(block, definition) {
    const items = sortedItems(block.items);
    const current = comparableAdminState(block);
    const desired = desiredAdminState(block, definition);
    const changes = changedFields(current, desired);
    const settings = desired.zh_Hans.settings;
    return {
        blockId: block.id,
        code: block.code,
        type: block.type,
        updatedAt: block.updatedAt,
        image: imageState(block),
        action: changes.length ? 'update' : 'noop',
        changes,
        desired,
        input: {
            id: block.id,
            backgroundColor: definition.backgroundColor,
            textColor: definition.textColor,
            settings,
            translations: LANGUAGE_CODES.map(languageCode => ({
                languageCode,
                ...definition.translations[languageCode],
            })),
            items: items.map((item, index) => ({
                id: item.id,
                enabled: item.enabled,
                position: item.position,
                targetType: item.targetType,
                targetValue: item.targetValue,
                settings: item.settings,
                translations: LANGUAGE_CODES.map(languageCode => ({
                    languageCode,
                    label: definition.tags[languageCode][index],
                    description: '',
                })),
            })),
        },
    };
}

function assertAdminMatchesPlan(block, plan) {
    assert.deepEqual(comparableAdminState(block), plan.desired, `${plan.code} Admin API verification failed`);
    assert.deepEqual(imageState(block), plan.image, `${plan.code} image binding changed unexpectedly`);
}

function assertAdminShopParity(adminBlock, shopBlocksByLanguage) {
    for (const languageCode of LANGUAGE_CODES) {
        const shopBlock = findAuthVisualBlock(shopBlocksByLanguage[languageCode], {
            code: adminBlock.code,
            type: adminBlock.type,
        });
        assert.deepEqual(
            shopPresentation(shopBlock),
            adminPresentation(adminBlock, languageCode),
            `${adminBlock.code} differs between Admin API and Shop API for ${languageCode}`,
        );
    }
}

function requestHeaders(authToken, channelToken, languageCode = 'en') {
    return {
        authorization: `Bearer ${String(authToken)}`,
        'vendure-token': String(channelToken),
        'language-code': languageCode,
    };
}

async function graphql(fetchImpl, apiOrigin, apiPath, query, variables, headers = {}) {
    const response = await fetchImpl(`${apiOrigin}/${apiPath}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ query, variables }),
    });
    const body = await response.json();
    if (!response.ok || body.errors?.length || !body.data) {
        throw new Error(
            body.errors?.map(error => error.message).join('; ') || `HTTP ${String(response.status)}`,
        );
    }
    return { data: body.data, response };
}

async function authenticate(fetchImpl, apiOrigin, username, password, adminBearerToken) {
    if (adminBearerToken) {
        const currentUserResult = await graphql(
            fetchImpl,
            apiOrigin,
            'admin-api',
            CURRENT_USER_QUERY,
            undefined,
            {
                authorization: `Bearer ${adminBearerToken}`,
            },
        );
        assert.ok(currentUserResult.data.me, 'VENDURE_ADMIN_BEARER_TOKEN is invalid or expired');
        return { authToken: adminBearerToken, channels: currentUserResult.data.me.channels };
    }
    const loginResult = await graphql(fetchImpl, apiOrigin, 'admin-api', LOGIN_MUTATION, {
        username,
        password,
    });
    assert.equal(loginResult.data.login.errorCode, undefined, loginResult.data.login.message);
    const authToken = loginResult.response.headers.get('vendure-auth-token') ?? '';
    assert.ok(authToken, 'Admin login did not return a bearer token');
    return { authToken, channels: loginResult.data.login.channels };
}

async function loadAdminBlocks(fetchImpl, apiOrigin, authToken, channel) {
    const result = await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        ADMIN_BLOCKS_QUERY,
        undefined,
        requestHeaders(authToken, channel.token),
    );
    return result.data.storefrontContentBlocks;
}

async function loadShopBlocks(fetchImpl, apiOrigin, channel) {
    const blocksByLanguage = {};
    for (const languageCode of LANGUAGE_CODES) {
        const result = await graphql(fetchImpl, apiOrigin, 'shop-api', SHOP_BLOCKS_QUERY, undefined, {
            'vendure-token': String(channel.token),
            'language-code': languageCode,
        });
        blocksByLanguage[languageCode] = result.data.storefrontContent;
    }
    return blocksByLanguage;
}

async function updateBlock(fetchImpl, apiOrigin, authToken, channel, input) {
    await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        UPDATE_BLOCK_MUTATION,
        { input },
        requestHeaders(authToken, channel.token),
    );
}

export async function syncAuthVisuals({
    apiOrigin,
    username,
    password,
    adminBearerToken,
    channelCodes = ['cn-mainland'],
    apply = false,
    allowRemote = false,
    production = process.env.NODE_ENV === 'production',
    fetchImpl = fetch,
    manifest = authVisualManifest,
}) {
    assert.ok(apiOrigin, 'VENDURE_API_ORIGIN or --api-origin is required');
    assert.ok(
        adminBearerToken || (username && password),
        'VENDURE_ADMIN_BEARER_TOKEN or SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required',
    );
    assert.ok(channelCodes.length > 0, 'At least one auth visual Channel is required');
    if (apply && (production || !isLocalApiOrigin(apiOrigin))) {
        assert.ok(allowRemote, 'Remote or production writes require both --apply and --allow-remote');
    }

    const normalizedOrigin = apiOrigin.replace(/\/$/, '');
    const session = await authenticate(fetchImpl, normalizedOrigin, username, password, adminBearerToken);
    const channelsByCode = new Map(session.channels.map(channel => [channel.code, channel]));
    const selectedChannels = channelCodes.map(code => {
        const channel = channelsByCode.get(code);
        assert.ok(channel, `Admin user cannot access Channel ${code}`);
        return channel;
    });

    const results = [];
    for (const channel of selectedChannels) {
        const beforeBlocks = await loadAdminBlocks(fetchImpl, normalizedOrigin, session.authToken, channel);
        const beforeShop = await loadShopBlocks(fetchImpl, normalizedOrigin, channel);
        const plans = manifest.map(definition => {
            const block = findAuthVisualBlock(beforeBlocks, definition);
            assertAdminShopParity(block, beforeShop);
            return buildAuthVisualPlan(block, definition);
        });

        if (apply) {
            for (const plan of plans) {
                if (plan.action === 'update') {
                    await updateBlock(fetchImpl, normalizedOrigin, session.authToken, channel, plan.input);
                }
            }
            const afterBlocks = await loadAdminBlocks(
                fetchImpl,
                normalizedOrigin,
                session.authToken,
                channel,
            );
            const afterShop = await loadShopBlocks(fetchImpl, normalizedOrigin, channel);
            for (const plan of plans) {
                const block = findAuthVisualBlock(afterBlocks, plan);
                assertAdminMatchesPlan(block, plan);
                assertAdminShopParity(block, afterShop);
            }
        }

        results.push({
            channelCode: channel.code,
            blocks: plans.map(plan => ({
                code: plan.code,
                type: plan.type,
                blockId: plan.blockId,
                updatedAt: plan.updatedAt,
                imageAssetId: plan.image.assetId,
                imageUrl: plan.image.imageUrl,
                action: plan.action,
                changes: plan.changes,
                desiredZhHans: {
                    ctaLabel: plan.desired.zh_Hans.ctaLabel,
                    title: plan.desired.zh_Hans.title,
                    subtitle: plan.desired.zh_Hans.subtitle,
                    tags: plan.desired.zh_Hans.items.map(item => item.label),
                    backgroundColor: plan.desired.zh_Hans.backgroundColor,
                    textColor: plan.desired.zh_Hans.textColor,
                    accentColor: plan.desired.zh_Hans.settings.accentColor,
                },
            })),
        });
    }

    return { applied: apply, apiOrigin: normalizedOrigin, channelCodes, results };
}

export function parseCliArguments(args) {
    const options = { allowRemote: false, apply: false };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--apply') options.apply = true;
        else if (argument === '--allow-remote') options.allowRemote = true;
        else if (argument === '--dry-run') options.apply = false;
        else if (argument === '--api-origin') options.apiOrigin = args[++index];
        else if (argument === '--channel-codes') options.channelCodes = parseChannelCodes(args[++index]);
        else throw new Error(`Unknown argument: ${String(argument)}`);
    }
    return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const options = parseCliArguments(process.argv.slice(2));
    const apiOrigin =
        options.apiOrigin ??
        process.env.VENDURE_API_ORIGIN ??
        `http://${process.env.VENDURE_HOSTNAME || '127.0.0.1'}:${process.env.PORT || '3000'}`;
    const channelCodes =
        options.channelCodes ??
        parseChannelCodes(
            process.env.AUTH_VISUAL_CHANNEL_CODES ??
                process.env.STOREFRONT_MEDIA_CHANNEL_CODES ??
                'cn-mainland',
        );
    const result = await syncAuthVisuals({
        apiOrigin,
        username: process.env.SUPERADMIN_USERNAME,
        password: process.env.SUPERADMIN_PASSWORD,
        adminBearerToken: process.env.VENDURE_ADMIN_BEARER_TOKEN,
        channelCodes,
        apply: options.apply,
        allowRemote: options.allowRemote,
    });
    process.stdout.write(
        `${JSON.stringify(
            {
                ok: true,
                mode: result.applied ? 'apply' : 'dry-run',
                apiOrigin: result.apiOrigin,
                channelCodes: result.channelCodes,
                channels: result.results,
            },
            null,
            2,
        )}\n`,
    );
}
