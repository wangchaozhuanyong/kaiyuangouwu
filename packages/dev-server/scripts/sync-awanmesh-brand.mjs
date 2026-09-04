import 'dotenv/config';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const brandDirectory = path.resolve(scriptDirectory, '../../storefront/src/assets/brand/awanmesh-moyao');

export const awanMeshBrand = {
    channelCode: '__default_channel__',
    storefrontNameZh: 'AwanMesh｜模钥',
    storefrontNameEn: 'AwanMesh',
    descriptionZh: 'AI 模型与数字服务一站式平台',
    descriptionEn: 'One-stop marketplace for AI models and digital services.',
    taglineZh: '一钥通百模',
    taglineEn: 'One Key. Every Model.',
    brandBackgroundColor: '#071426',
    brandPrimaryColor: '#2F6BFF',
    brandAccentColor: '#22D3EE',
    brandHighlightColor: '#7C3AED',
};

export const awanMeshBrandAssets = [
    {
        key: 'app-icon',
        file: path.join(brandDirectory, 'app-icon.svg'),
        profileField: 'logoAssetId',
        name: 'AwanMesh Moyao app icon',
    },
    {
        key: 'logo-on-light',
        file: path.join(brandDirectory, 'logo-on-light.svg'),
        profileField: 'logoOnLightAssetId',
        name: 'AwanMesh Moyao logo on light',
    },
    {
        key: 'logo-on-dark',
        file: path.join(brandDirectory, 'logo-on-dark.svg'),
        profileField: 'logoOnDarkAssetId',
        name: 'AwanMesh Moyao logo on dark',
    },
];

const LOGIN_MUTATION = `
    mutation AwanMeshBrandLogin($username: String!, $password: String!) {
        login(username: $username, password: $password, rememberMe: false) {
            ... on CurrentUser { id channels { id code token } }
            ... on ErrorResult { errorCode message }
        }
    }
`;

const STORE_PROFILES_QUERY = `
    query AwanMeshBrandProfiles {
        storeProfiles {
            id
            updatedAt
            channel { id code token customFields { storefrontNameZh storefrontNameEn } }
            descriptionZh
            descriptionEn
            taglineZh
            taglineEn
            brandBackgroundColor
            brandPrimaryColor
            brandAccentColor
            brandHighlightColor
            logoAsset { id }
            logoOnLightAsset { id }
            logoOnDarkAsset { id }
        }
    }
`;

const ASSET_QUERY = `
    query AwanMeshBrandAsset($tags: [String!]) {
        assets(options: { take: 1, tags: $tags, tagsOperator: AND }) {
            items { id }
        }
    }
`;

const ASSIGN_ASSET_MUTATION = `
    mutation AssignAwanMeshBrandAsset($input: AssignAssetsToChannelInput!) {
        assignAssetsToChannel(input: $input) { id }
    }
`;

const UPDATE_PROFILE_MUTATION = `
    mutation UpdateAwanMeshBrand($input: UpdateStoreProfileInput!) {
        updateStoreProfile(input: $input) {
            id
            updatedAt
            channel { id code customFields { storefrontNameZh storefrontNameEn } }
            descriptionZh
            descriptionEn
            taglineZh
            taglineEn
            brandBackgroundColor
            brandPrimaryColor
            brandAccentColor
            brandHighlightColor
            logoAsset { id }
            logoOnLightAsset { id }
            logoOnDarkAsset { id }
        }
    }
`;

const SHOP_BRANDING_QUERY = `
    query VerifyAwanMeshBrand {
        storefrontBranding {
            logoAssetId
            logoOnLightAssetId
            logoOnDarkAssetId
            name
            description
            tagline
            backgroundColor
            primaryColor
            accentColor
            highlightColor
        }
    }
`;

export function isLocalApiOrigin(value) {
    try {
        const url = new URL(value);
        return (
            (url.protocol === 'http:' || url.protocol === 'https:') &&
            (url.hostname === 'localhost' ||
                url.hostname === '127.0.0.1' ||
                url.hostname === '::1' ||
                url.hostname.endsWith('.localhost'))
        );
    } catch {
        return false;
    }
}

export function brandAssetTags(key, hash) {
    return ['awanmesh-brand', `awanmesh-brand:${key}`, `awanmesh-brand-sha256:${hash}`];
}

export async function prepareAwanMeshBrandAssets(manifest = awanMeshBrandAssets) {
    const keys = new Set();
    return Promise.all(
        manifest.map(async asset => {
            assert.match(asset.key, /^[a-z0-9][a-z0-9-]+$/u, `Invalid brand asset key: ${asset.key}`);
            assert.ok(!keys.has(asset.key), `Duplicate brand asset key: ${asset.key}`);
            keys.add(asset.key);
            const bytes = await readFile(asset.file);
            assert.ok(bytes.byteLength > 0, `Brand asset is empty: ${asset.file}`);
            const hash = createHash('sha256').update(bytes).digest('hex');
            return { ...asset, bytes, hash, tags: brandAssetTags(asset.key, hash) };
        }),
    );
}

function requestHeaders(authToken, channelToken, languageCode = 'en') {
    const headers = {
        'vendure-token': String(channelToken),
        'language-code': languageCode,
    };
    if (authToken) headers.authorization = `Bearer ${String(authToken)}`;
    return headers;
}

async function graphql(fetchImpl, endpoint, query, variables, headers = {}) {
    const response = await fetchImpl(endpoint, {
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

async function login(fetchImpl, adminEndpoint, username, password) {
    const result = await graphql(fetchImpl, adminEndpoint, LOGIN_MUTATION, { username, password });
    assert.equal(result.data.login.errorCode, undefined, result.data.login.message);
    const authToken = result.response.headers.get('vendure-auth-token') ?? '';
    assert.ok(authToken, 'Admin login did not return a bearer token');
    return { authToken, channels: result.data.login.channels };
}

async function findAsset(fetchImpl, adminEndpoint, authToken, channel, tags) {
    const result = await graphql(
        fetchImpl,
        adminEndpoint,
        ASSET_QUERY,
        { tags },
        requestHeaders(authToken, channel.token),
    );
    return result.data.assets.items[0] ?? null;
}

async function uploadAsset(fetchImpl, adminEndpoint, authToken, channel, asset) {
    const form = new FormData();
    form.append(
        'operations',
        JSON.stringify({
            operationName: 'CreateAwanMeshBrandAsset',
            query: `mutation CreateAwanMeshBrandAsset($input: [CreateAssetInput!]!) {
                createAssets(input: $input) {
                    ... on Asset { id }
                    ... on ErrorResult { errorCode message }
                }
            }`,
            variables: {
                input: [
                    {
                        file: null,
                        tags: asset.tags,
                        translations: [
                            { languageCode: 'en', name: asset.name },
                            { languageCode: 'zh_Hans', name: asset.name },
                        ],
                    },
                ],
            },
        }),
    );
    form.append('map', JSON.stringify({ 0: ['variables.input.0.file'] }));
    form.append('0', new Blob([asset.bytes], { type: 'image/svg+xml' }), path.basename(asset.file));
    const response = await fetchImpl(adminEndpoint, {
        method: 'POST',
        headers: requestHeaders(authToken, channel.token),
        body: form,
    });
    const body = await response.json();
    const result = body.data?.createAssets?.[0];
    if (!response.ok || body.errors?.length || !result?.id) {
        throw new Error(
            result?.message ||
                body.errors?.map(error => error.message).join('; ') ||
                `Brand asset upload failed (HTTP ${String(response.status)})`,
        );
    }
    return result;
}

function profileAssetId(profile, field) {
    const relation = {
        logoAssetId: 'logoAsset',
        logoOnLightAssetId: 'logoOnLightAsset',
        logoOnDarkAssetId: 'logoOnDarkAsset',
    }[field];
    return profile[relation]?.id ?? null;
}

function shopEndpointForLanguage(endpoint, languageCode) {
    const url = new URL(endpoint);
    url.searchParams.set('languageCode', languageCode);
    return url.toString();
}

export function buildAwanMeshBrandPlan(profile, assetsByKey, brand = awanMeshBrand) {
    const desired = {
        storefrontNameZh: brand.storefrontNameZh,
        storefrontNameEn: brand.storefrontNameEn,
        descriptionZh: brand.descriptionZh,
        descriptionEn: brand.descriptionEn,
        taglineZh: brand.taglineZh,
        taglineEn: brand.taglineEn,
        brandBackgroundColor: brand.brandBackgroundColor,
        brandPrimaryColor: brand.brandPrimaryColor,
        brandAccentColor: brand.brandAccentColor,
        brandHighlightColor: brand.brandHighlightColor,
    };
    const current = {
        storefrontNameZh: profile.channel.customFields?.storefrontNameZh ?? '',
        storefrontNameEn: profile.channel.customFields?.storefrontNameEn ?? '',
        descriptionZh: profile.descriptionZh,
        descriptionEn: profile.descriptionEn,
        taglineZh: profile.taglineZh,
        taglineEn: profile.taglineEn,
        brandBackgroundColor: profile.brandBackgroundColor,
        brandPrimaryColor: profile.brandPrimaryColor,
        brandAccentColor: profile.brandAccentColor,
        brandHighlightColor: profile.brandHighlightColor,
    };
    const changes = Object.keys(desired).filter(key => current[key] !== desired[key]);
    const input = { id: profile.id, expectedUpdatedAt: profile.updatedAt, ...desired };
    for (const definition of awanMeshBrandAssets) {
        const asset = assetsByKey.get(definition.key);
        if (!asset) {
            changes.push(definition.profileField);
            continue;
        }
        input[definition.profileField] = asset.id;
        if (String(profileAssetId(profile, definition.profileField)) !== String(asset.id)) {
            changes.push(definition.profileField);
        }
    }
    return { action: changes.length ? 'update' : 'noop', changes, input };
}

function assertShopBranding(branding, languageCode, assetIds, brand) {
    assert.equal(branding.name, languageCode === 'zh_Hans' ? brand.storefrontNameZh : brand.storefrontNameEn);
    assert.equal(
        branding.description,
        languageCode === 'zh_Hans' ? brand.descriptionZh : brand.descriptionEn,
    );
    assert.equal(branding.tagline, languageCode === 'zh_Hans' ? brand.taglineZh : brand.taglineEn);
    assert.equal(String(branding.logoAssetId), String(assetIds['app-icon']));
    assert.equal(String(branding.logoOnLightAssetId), String(assetIds['logo-on-light']));
    assert.equal(String(branding.logoOnDarkAssetId), String(assetIds['logo-on-dark']));
    assert.equal(branding.backgroundColor, brand.brandBackgroundColor);
    assert.equal(branding.primaryColor, brand.brandPrimaryColor);
    assert.equal(branding.accentColor, brand.brandAccentColor);
    assert.equal(branding.highlightColor, brand.brandHighlightColor);
}

export async function syncAwanMeshBrand({
    apiOrigin,
    shopOrigin = apiOrigin,
    username,
    password,
    channelCode = awanMeshBrand.channelCode,
    apply = false,
    allowRemote = false,
    production = process.env.NODE_ENV === 'production',
    fetchImpl = fetch,
    assetManifest = awanMeshBrandAssets,
    brand = awanMeshBrand,
}) {
    assert.ok(apiOrigin, 'VENDURE_API_ORIGIN or --api-origin is required');
    assert.ok(username && password, 'SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD are required');
    if (apply && (production || !isLocalApiOrigin(apiOrigin))) {
        assert.ok(allowRemote, 'Remote or production writes require both --apply and --allow-remote');
    }
    const normalizedApiOrigin = apiOrigin.replace(/\/$/u, '');
    const normalizedShopOrigin = shopOrigin.replace(/\/$/u, '');
    const adminEndpoint = `${normalizedApiOrigin}/admin-api`;
    const shopEndpoint = `${normalizedShopOrigin}/shop-api`;
    const preparedAssets = await prepareAwanMeshBrandAssets(assetManifest);
    const session = await login(fetchImpl, adminEndpoint, username, password);
    const channel = session.channels.find(item => item.code === channelCode);
    assert.ok(channel, `Admin user cannot access Channel ${channelCode}`);
    const profilesResult = await graphql(
        fetchImpl,
        adminEndpoint,
        STORE_PROFILES_QUERY,
        undefined,
        requestHeaders(session.authToken, channel.token),
    );
    const profiles = profilesResult.data.storeProfiles.filter(item => item.channel.code === channelCode);
    assert.equal(profiles.length, 1, `Expected one StoreProfile for Channel ${channelCode}`);
    let profile = profiles[0];
    const assetsByKey = new Map();
    const assetActions = [];
    for (const definition of preparedAssets) {
        let asset = await findAsset(fetchImpl, adminEndpoint, session.authToken, channel, definition.tags);
        const action = asset ? 'reuse' : 'upload';
        if (apply && !asset) {
            asset = await uploadAsset(fetchImpl, adminEndpoint, session.authToken, channel, definition);
        }
        if (apply && asset) {
            await graphql(
                fetchImpl,
                adminEndpoint,
                ASSIGN_ASSET_MUTATION,
                { input: { assetIds: [asset.id], channelId: channel.id } },
                requestHeaders(session.authToken, channel.token),
            );
        }
        if (asset) assetsByKey.set(definition.key, asset);
        assetActions.push({ key: definition.key, action, assetId: asset?.id ?? null, hash: definition.hash });
    }
    let plan = buildAwanMeshBrandPlan(profile, assetsByKey, brand);
    if (apply) {
        assert.equal(assetsByKey.size, preparedAssets.length, 'All three brand assets are required');
        plan = buildAwanMeshBrandPlan(profile, assetsByKey, brand);
        if (plan.action === 'update') {
            const updated = await graphql(
                fetchImpl,
                adminEndpoint,
                UPDATE_PROFILE_MUTATION,
                { input: plan.input },
                requestHeaders(session.authToken, channel.token),
            );
            profile = updated.data.updateStoreProfile;
        }
        const assetIds = Object.fromEntries([...assetsByKey].map(([key, asset]) => [key, asset.id]));
        for (const languageCode of ['zh_Hans', 'en']) {
            const result = await graphql(
                fetchImpl,
                shopEndpointForLanguage(shopEndpoint, languageCode),
                SHOP_BRANDING_QUERY,
                undefined,
                requestHeaders('', channel.token, languageCode),
            );
            assertShopBranding(result.data.storefrontBranding, languageCode, assetIds, brand);
        }
    }
    return {
        applied: apply,
        apiOrigin: normalizedApiOrigin,
        shopOrigin: normalizedShopOrigin,
        channelCode,
        profileId: profile.id,
        plan,
        assets: assetActions,
    };
}

export function parseCliArguments(args) {
    const options = { apply: false, allowRemote: false, validate: false };
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--apply') options.apply = true;
        else if (argument === '--dry-run') options.apply = false;
        else if (argument === '--allow-remote') options.allowRemote = true;
        else if (argument === '--validate') options.validate = true;
        else if (argument === '--api-origin') options.apiOrigin = args[++index];
        else if (argument === '--shop-origin') options.shopOrigin = args[++index];
        else if (argument === '--channel-code') options.channelCode = args[++index];
        else throw new Error(`Unknown argument: ${String(argument)}`);
    }
    return options;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const options = parseCliArguments(process.argv.slice(2));
    if (options.validate) {
        const assets = await prepareAwanMeshBrandAssets();
        process.stdout.write(
            `${JSON.stringify({ ok: true, mode: 'validate', assets: assets.map(item => ({ key: item.key, hash: item.hash })) }, null, 2)}\n`,
        );
    } else {
        const apiOrigin =
            options.apiOrigin ??
            process.env.VENDURE_API_ORIGIN ??
            `http://${process.env.VENDURE_HOSTNAME || '127.0.0.1'}:${process.env.PORT || '3000'}`;
        const result = await syncAwanMeshBrand({
            apiOrigin,
            shopOrigin: options.shopOrigin ?? process.env.VENDURE_STOREFRONT_URL ?? apiOrigin,
            username: process.env.SUPERADMIN_USERNAME,
            password: process.env.SUPERADMIN_PASSWORD,
            channelCode:
                options.channelCode ?? process.env.AWANMESH_CHANNEL_CODE ?? awanMeshBrand.channelCode,
            apply: options.apply,
            allowRemote: options.allowRemote,
        });
        process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`);
    }
}
