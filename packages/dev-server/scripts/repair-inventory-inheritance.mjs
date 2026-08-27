import 'dotenv/config';

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGIN_MUTATION = `
    mutation InventoryInheritanceLogin($username: String!, $password: String!) {
        login(username: $username, password: $password, rememberMe: false) {
            ... on CurrentUser {
                id
                channels {
                    id
                    code
                    token
                }
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

const CURRENT_USER_QUERY = `
    query InventoryInheritanceCurrentUser {
        me {
            id
            channels {
                id
                code
                token
            }
        }
    }
`;

const PRODUCT_VARIANT_QUERY = `
    query InventoryInheritanceVariant($sku: String!) {
        productVariants(options: { take: 2, filter: { sku: { eq: $sku } } }) {
            items {
                id
                name
                sku
                trackInventory
                product {
                    id
                    name
                }
            }
        }
    }
`;

const UPDATE_PRODUCT_VARIANT_MUTATION = `
    mutation RepairInventoryInheritance($input: UpdateProductVariantInput!) {
        updateProductVariant(input: $input) {
            id
            sku
            trackInventory
        }
    }
`;

export function parseCsv(value) {
    return Array.from(
        new Set(
            String(value ?? '')
                .split(',')
                .map(item => item.trim())
                .filter(Boolean),
        ),
    );
}

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

function requestHeaders(authToken, channelToken) {
    return {
        authorization: `Bearer ${String(authToken)}`,
        'content-type': 'application/json',
        'vendure-token': String(channelToken),
    };
}

async function graphql(fetchImpl, apiOrigin, query, variables, headers = {}) {
    const response = await fetchImpl(`${apiOrigin}/admin-api`, {
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

async function login(fetchImpl, apiOrigin, username, password) {
    const result = await graphql(fetchImpl, apiOrigin, LOGIN_MUTATION, { username, password });
    assert.equal(result.data.login.errorCode, undefined, result.data.login.message);
    const authToken = result.response.headers.get('vendure-auth-token') ?? '';
    assert.ok(authToken, 'Admin login did not return a bearer token');
    return { authToken, channels: result.data.login.channels };
}

async function authenticate(fetchImpl, apiOrigin, username, password, adminBearerToken) {
    if (!adminBearerToken) return login(fetchImpl, apiOrigin, username, password);

    const result = await graphql(fetchImpl, apiOrigin, CURRENT_USER_QUERY, undefined, {
        authorization: `Bearer ${adminBearerToken}`,
    });
    assert.ok(result.data.me, 'VENDURE_ADMIN_BEARER_TOKEN is invalid or expired');
    return { authToken: adminBearerToken, channels: result.data.me.channels };
}

async function loadVariant(fetchImpl, apiOrigin, authToken, channel, sku) {
    const result = await graphql(
        fetchImpl,
        apiOrigin,
        PRODUCT_VARIANT_QUERY,
        { sku },
        requestHeaders(authToken, channel.token),
    );
    const variants = result.data.productVariants.items;
    assert.equal(
        variants.length,
        1,
        `Expected one product variant for SKU ${sku} in Channel ${channel.code}, found ${String(variants.length)}`,
    );
    assert.equal(variants[0].sku, sku, `Resolved SKU does not exactly match ${sku}`);
    return variants[0];
}

export function buildInventoryInheritancePlan(channelTargets) {
    const variantsById = new Map();
    for (const target of channelTargets) {
        const existing = variantsById.get(String(target.variant.id));
        if (existing) {
            assert.equal(
                existing.sku,
                target.variant.sku,
                `Variant ${String(target.variant.id)} changed SKU`,
            );
            assert.equal(
                existing.currentTrackInventory,
                target.variant.trackInventory,
                `Variant ${target.variant.sku} returned inconsistent inventory settings across Channels`,
            );
            existing.channelCodes.push(target.channel.code);
            continue;
        }

        assert.ok(
            ['FALSE', 'INHERIT', 'TRUE'].includes(target.variant.trackInventory),
            `Variant ${target.variant.sku} returned unknown trackInventory value ${String(target.variant.trackInventory)}`,
        );
        assert.notEqual(
            target.variant.trackInventory,
            'TRUE',
            `SKU ${target.variant.sku} explicitly tracks inventory; refusing to replace TRUE with INHERIT`,
        );
        variantsById.set(String(target.variant.id), {
            variantId: String(target.variant.id),
            sku: target.variant.sku,
            variantName: target.variant.name,
            productId: String(target.variant.product.id),
            productName: target.variant.product.name,
            currentTrackInventory: target.variant.trackInventory,
            requestedTrackInventory: 'INHERIT',
            action: target.variant.trackInventory === 'INHERIT' ? 'unchanged' : 'update',
            channelCodes: [target.channel.code],
            requestChannel: target.channel,
        });
    }
    return Array.from(variantsById.values());
}

export async function repairInventoryInheritance({
    apiOrigin,
    username,
    password,
    adminBearerToken,
    channelCodes,
    skus,
    apply = false,
    allowRemote = false,
    production = process.env.NODE_ENV === 'production',
    fetchImpl = fetch,
}) {
    assert.ok(apiOrigin, 'VENDURE_API_ORIGIN is required');
    assert.ok(
        adminBearerToken || (username && password),
        'VENDURE_ADMIN_BEARER_TOKEN or SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required',
    );
    assert.ok(channelCodes?.length > 0, 'INVENTORY_REPAIR_CHANNEL_CODES is required');
    assert.ok(skus?.length > 0, 'INVENTORY_INHERIT_SKUS is required');
    if (apply && (production || !isLocalApiOrigin(apiOrigin))) {
        assert.ok(allowRemote, 'Remote or production writes require both --apply and --allow-remote');
    }

    const normalizedOrigin = apiOrigin.replace(/\/$/u, '');
    const session = await authenticate(fetchImpl, normalizedOrigin, username, password, adminBearerToken);
    const channelsByCode = new Map(session.channels.map(channel => [channel.code, channel]));
    const selectedChannels = channelCodes.map(code => {
        const channel = channelsByCode.get(code);
        assert.ok(channel, `Admin user cannot access Channel ${code}`);
        return channel;
    });

    const channelTargets = [];
    for (const channel of selectedChannels) {
        for (const sku of skus) {
            channelTargets.push({
                channel,
                variant: await loadVariant(fetchImpl, normalizedOrigin, session.authToken, channel, sku),
            });
        }
    }
    const plan = buildInventoryInheritancePlan(channelTargets);

    if (apply) {
        for (const item of plan) {
            if (item.action !== 'update') continue;
            const result = await graphql(
                fetchImpl,
                normalizedOrigin,
                UPDATE_PRODUCT_VARIANT_MUTATION,
                { input: { id: item.variantId, trackInventory: 'INHERIT' } },
                requestHeaders(session.authToken, item.requestChannel.token),
            );
            assert.equal(result.data.updateProductVariant.id, item.variantId);
            assert.equal(result.data.updateProductVariant.sku, item.sku);
            assert.equal(
                result.data.updateProductVariant.trackInventory,
                'INHERIT',
                `SKU ${item.sku} did not persist trackInventory=INHERIT`,
            );
        }
    }

    return {
        applied: apply,
        apiOrigin: normalizedOrigin,
        channelCodes,
        variants: plan.map(({ requestChannel: _requestChannel, ...item }) => item),
    };
}

export function parseCliArguments(args) {
    const options = { allowRemote: false, apply: false, validate: false };
    for (const argument of args) {
        if (argument === '--apply') options.apply = true;
        else if (argument === '--allow-remote') options.allowRemote = true;
        else if (argument === '--dry-run') options.apply = false;
        else if (argument === '--validate') options.validate = true;
        else throw new Error(`Unknown argument: ${String(argument)}`);
    }
    return options;
}

function environmentConfiguration() {
    const apiOrigin =
        process.env.VENDURE_API_ORIGIN ??
        `http://${process.env.VENDURE_HOSTNAME || '127.0.0.1'}:${process.env.PORT || '3000'}`;
    const channelCodes = parseCsv(process.env.INVENTORY_REPAIR_CHANNEL_CODES);
    const skus = parseCsv(process.env.INVENTORY_INHERIT_SKUS);
    assert.ok(channelCodes.length > 0, 'INVENTORY_REPAIR_CHANNEL_CODES is required');
    assert.ok(skus.length > 0, 'INVENTORY_INHERIT_SKUS is required');
    return {
        apiOrigin,
        username: process.env.SUPERADMIN_USERNAME,
        password: process.env.SUPERADMIN_PASSWORD,
        adminBearerToken: process.env.VENDURE_ADMIN_BEARER_TOKEN,
        channelCodes,
        skus,
    };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const options = parseCliArguments(process.argv.slice(2));
    const configuration = environmentConfiguration();
    if (options.validate) {
        assert.ok(
            configuration.adminBearerToken || (configuration.username && configuration.password),
            'VENDURE_ADMIN_BEARER_TOKEN or SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required',
        );
        process.stdout.write(
            `${JSON.stringify(
                {
                    ok: true,
                    mode: 'validate',
                    apiOrigin: configuration.apiOrigin,
                    channelCodes: configuration.channelCodes,
                    skus: configuration.skus,
                },
                null,
                2,
            )}\n`,
        );
    } else {
        const result = await repairInventoryInheritance({
            ...configuration,
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
                    variants: result.variants,
                },
                null,
                2,
            )}\n`,
        );
    }
}
