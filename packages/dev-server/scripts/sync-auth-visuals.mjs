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
                ctaLabel: 'MOYAO AI TOOLS',
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

const APPLY_BLOCKS_MUTATION = `
    mutation ApplyAuthVisualChanges($input: ApplyStorefrontContentChangesInput!) {
        applyStorefrontContentChanges(input: $input) {
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

export function selectAuthVisualChannels(availableChannels, channelCodes) {
    if (channelCodes?.length) {
        const channelsByCode = new Map(availableChannels.map(channel => [channel.code, channel]));
        return channelCodes.map(code => {
            const channel = channelsByCode.get(code);
            assert.ok(channel, `Admin user cannot access Channel ${code}`);
            return channel;
        });
    }
    assert.ok(availableChannels.length > 0, 'Admin user cannot access any Channel');
    assert.equal(
        availableChannels.length,
        1,
        'AUTH_VISUAL_CHANNEL_CODES is required when the admin user can access multiple Channels',
    );
    return availableChannels;
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
            expectedUpdatedAt: block.updatedAt,
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

function adminShopParityReport(adminBlock, shopBlocksByLanguage) {
    try {
        assertAdminShopParity(adminBlock, shopBlocksByLanguage);
        return { inSync: true, error: null };
    } catch (error) {
        return { inSync: false, error: error.message };
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
        const apiPath = `shop-api?languageCode=${encodeURIComponent(languageCode)}`;
        const result = await graphql(fetchImpl, apiOrigin, apiPath, SHOP_BLOCKS_QUERY, undefined, {
            'vendure-token': String(channel.token),
            'language-code': languageCode,
        });
        blocksByLanguage[languageCode] = result.data.storefrontContent;
    }
    return blocksByLanguage;
}

async function applyBlockPlans(fetchImpl, apiOrigin, authToken, channel, blocks, plans) {
    const updates = plans.filter(plan => plan.action === 'update').map(plan => plan.input);
    if (!updates.length) return blocks;
    const result = await graphql(
        fetchImpl,
        apiOrigin,
        'admin-api',
        APPLY_BLOCKS_MUTATION,
        {
            input: {
                expectedBlocks: blocks.map(block => ({
                    id: block.id,
                    expectedUpdatedAt: block.updatedAt,
                })),
                creates: [],
                updates,
            },
        },
        requestHeaders(authToken, channel.token),
    );
    return result.data.applyStorefrontContentChanges;
}

function restoreAuthVisualInput(beforeBlock, currentBlock) {
    return {
        id: beforeBlock.id,
        expectedUpdatedAt: currentBlock.updatedAt,
        backgroundColor: beforeBlock.backgroundColor,
        textColor: beforeBlock.textColor,
        settings: beforeBlock.settings,
        translations: beforeBlock.translations.map(({ languageCode, title, subtitle, body, ctaLabel }) => ({
            languageCode,
            title,
            subtitle,
            body,
            ctaLabel,
        })),
        items: beforeBlock.items.map(item => ({
            id: item.id,
            enabled: item.enabled,
            position: item.position,
            targetType: item.targetType,
            targetValue: item.targetValue,
            settings: item.settings,
            translations: item.translations.map(({ languageCode, label, description }) => ({
                languageCode,
                label,
                description,
            })),
        })),
    };
}

async function restoreAuthVisuals(
    fetchImpl,
    apiOrigin,
    authToken,
    channel,
    beforeBlocks,
    currentBlocks,
    plans,
) {
    const changedIds = new Set(
        plans.filter(plan => plan.action === 'update').map(plan => String(plan.blockId)),
    );
    const restorePlans = beforeBlocks
        .filter(block => changedIds.has(String(block.id)))
        .map(block => {
            const current = currentBlocks.find(candidate => String(candidate.id) === String(block.id));
            assert.ok(current, `Cannot restore missing auth visual block ${block.code}`);
            return { action: 'update', input: restoreAuthVisualInput(block, current) };
        });
    await applyBlockPlans(fetchImpl, apiOrigin, authToken, channel, currentBlocks, restorePlans);
}

async function rollbackCompletedAuthChannels(rollbacks) {
    const errors = [];
    for (const rollback of [...rollbacks].reverse()) {
        try {
            await rollback();
        } catch (error) {
            errors.push(error);
        }
    }
    if (errors.length) {
        throw new AggregateError(errors, 'One or more previously published auth Channels failed rollback');
    }
}

async function verifyAuthVisualPlans({
    fetchImpl,
    apiOrigin,
    shopOrigin = apiOrigin,
    authToken,
    channel,
    plans,
    attempts,
    delayMs,
    waitImpl,
}) {
    let afterBlocks;
    let verificationError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        afterBlocks = await loadAdminBlocks(fetchImpl, apiOrigin, authToken, channel);
        try {
            const afterShop = await loadShopBlocks(fetchImpl, shopOrigin, channel);
            for (const plan of plans) {
                const block = findAuthVisualBlock(afterBlocks, plan);
                assertAdminMatchesPlan(block, plan);
                assertAdminShopParity(block, afterShop);
            }
            return afterBlocks;
        } catch (error) {
            verificationError = error;
            if (attempt < attempts) await waitImpl(delayMs);
        }
    }
    throw verificationError;
}

export async function syncAuthVisuals({
    apiOrigin,
    shopOrigin = apiOrigin,
    username,
    password,
    adminBearerToken,
    channelCodes,
    apply = false,
    verify = false,
    allowRemote = false,
    production = process.env.NODE_ENV === 'production',
    fetchImpl = fetch,
    manifest = authVisualManifest,
    verificationAttempts = 5,
    verificationDelayMs = 250,
    waitImpl = delayMs => new Promise(resolve => setTimeout(resolve, delayMs)),
}) {
    assert.ok(apiOrigin, 'VENDURE_API_ORIGIN or --api-origin is required');
    assert.ok(shopOrigin, 'VENDURE_STOREFRONT_URL or --shop-origin is required');
    assert.ok(
        adminBearerToken || (username && password),
        'VENDURE_ADMIN_BEARER_TOKEN or SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required',
    );
    assert.ok(!(apply && verify), '--apply and --verify are mutually exclusive');
    if (channelCodes) {
        assert.ok(channelCodes.length > 0, 'At least one auth visual Channel is required');
    }
    assert.ok(Number.isInteger(verificationAttempts) && verificationAttempts > 0);
    if (apply && (production || !isLocalApiOrigin(apiOrigin))) {
        assert.ok(allowRemote, 'Remote or production writes require both --apply and --allow-remote');
    }

    const normalizedApiOrigin = apiOrigin.replace(/\/$/, '');
    const normalizedShopOrigin = shopOrigin.replace(/\/$/, '');
    const session = await authenticate(fetchImpl, normalizedApiOrigin, username, password, adminBearerToken);
    const selectedChannels = selectAuthVisualChannels(session.channels, channelCodes);

    const results = [];
    const completedChannelRollbacks = [];
    for (const channel of selectedChannels) {
        const beforeBlocks = await loadAdminBlocks(
            fetchImpl,
            normalizedApiOrigin,
            session.authToken,
            channel,
        );
        const beforeShop = await loadShopBlocks(fetchImpl, normalizedShopOrigin, channel);
        const plans = manifest.map(definition => {
            const block = findAuthVisualBlock(beforeBlocks, definition);
            return {
                ...buildAuthVisualPlan(block, definition),
                beforeParity: adminShopParityReport(block, beforeShop),
            };
        });

        if (verify) {
            await verifyAuthVisualPlans({
                fetchImpl,
                apiOrigin: normalizedApiOrigin,
                shopOrigin: normalizedShopOrigin,
                authToken: session.authToken,
                channel,
                plans,
                attempts: verificationAttempts,
                delayMs: verificationDelayMs,
                waitImpl,
            });
        }

        if (apply) {
            let appliedBlocks;
            let afterBlocks;
            let currentRestored = false;
            const hasUpdates = plans.some(plan => plan.action === 'update');
            try {
                appliedBlocks = await applyBlockPlans(
                    fetchImpl,
                    normalizedApiOrigin,
                    session.authToken,
                    channel,
                    beforeBlocks,
                    plans,
                );
                afterBlocks = appliedBlocks;
                try {
                    afterBlocks = await verifyAuthVisualPlans({
                        fetchImpl,
                        apiOrigin: normalizedApiOrigin,
                        shopOrigin: normalizedShopOrigin,
                        authToken: session.authToken,
                        channel,
                        plans,
                        attempts: verificationAttempts,
                        delayMs: verificationDelayMs,
                        waitImpl,
                    });
                } catch (verificationError) {
                    if (!hasUpdates) throw verificationError;
                    try {
                        await restoreAuthVisuals(
                            fetchImpl,
                            normalizedApiOrigin,
                            session.authToken,
                            channel,
                            beforeBlocks,
                            afterBlocks,
                            plans,
                        );
                        currentRestored = true;
                    } catch (rollbackError) {
                        throw new AggregateError(
                            [verificationError, rollbackError],
                            `Auth visual verification failed and rollback also failed in Channel ${channel.code}`,
                        );
                    }
                    throw new Error(
                        `Auth visual verification failed; previous Admin bindings were restored in Channel ${channel.code}`,
                        { cause: verificationError },
                    );
                }
                completedChannelRollbacks.push(async () => {
                    const currentBlocks = await loadAdminBlocks(
                        fetchImpl,
                        normalizedApiOrigin,
                        session.authToken,
                        channel,
                    );
                    await restoreAuthVisuals(
                        fetchImpl,
                        normalizedApiOrigin,
                        session.authToken,
                        channel,
                        beforeBlocks,
                        currentBlocks,
                        plans,
                    );
                });
            } catch (error) {
                const rollbackErrors = [];
                if (appliedBlocks && hasUpdates && !currentRestored) {
                    try {
                        await restoreAuthVisuals(
                            fetchImpl,
                            normalizedApiOrigin,
                            session.authToken,
                            channel,
                            beforeBlocks,
                            afterBlocks ?? appliedBlocks,
                            plans,
                        );
                    } catch (rollbackError) {
                        rollbackErrors.push(rollbackError);
                    }
                }
                try {
                    await rollbackCompletedAuthChannels(completedChannelRollbacks);
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
                if (rollbackErrors.length) {
                    throw new AggregateError(
                        [error, ...rollbackErrors],
                        'Auth visual batch failed and one or more Channels also failed rollback',
                    );
                }
                throw error;
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
                beforeAdminShopParity: plan.beforeParity,
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

    return {
        applied: apply,
        verified: apply || verify,
        apiOrigin: normalizedApiOrigin,
        shopOrigin: normalizedShopOrigin,
        channelCodes: selectedChannels.map(channel => channel.code),
        results,
    };
}

export function parseCliArguments(args) {
    const options = { allowRemote: false, apply: false, verify: false };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--apply') options.apply = true;
        else if (argument === '--verify') options.verify = true;
        else if (argument === '--allow-remote') options.allowRemote = true;
        else if (argument === '--dry-run') {
            options.apply = false;
            options.verify = false;
        } else if (argument === '--api-origin') options.apiOrigin = args[++index];
        else if (argument === '--shop-origin') options.shopOrigin = args[++index];
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
        (process.env.AUTH_VISUAL_CHANNEL_CODES
            ? parseChannelCodes(process.env.AUTH_VISUAL_CHANNEL_CODES)
            : undefined);
    const result = await syncAuthVisuals({
        apiOrigin,
        shopOrigin: options.shopOrigin ?? process.env.VENDURE_STOREFRONT_URL ?? apiOrigin,
        username: process.env.SUPERADMIN_USERNAME,
        password: process.env.SUPERADMIN_PASSWORD,
        adminBearerToken: process.env.VENDURE_ADMIN_BEARER_TOKEN,
        channelCodes,
        apply: options.apply,
        verify: options.verify,
        allowRemote: options.allowRemote,
    });
    process.stdout.write(
        `${JSON.stringify(
            {
                ok: true,
                mode: result.applied ? 'apply' : result.verified ? 'verify' : 'dry-run',
                apiOrigin: result.apiOrigin,
                shopOrigin: result.shopOrigin,
                channelCodes: result.channelCodes,
                channels: result.results,
            },
            null,
            2,
        )}\n`,
    );
}
