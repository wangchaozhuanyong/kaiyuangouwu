import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const ASSET = 'id mimeType source preview';
const BLOCK = `id code internalName type layoutVariant enabled position startsAt endsAt imageUrl imageAsset { ${ASSET} }
    backgroundColor textColor targetType targetValue settings
    translations { languageCode title subtitle body ctaLabel }
    items { id enabled position imageUrl imageAsset { ${ASSET} } targetType targetValue settings
        translations { languageCode label description } }`;
const POSTER = `id name enabled position posterBackgroundAsset { ${ASSET} } shareBackgroundAsset { ${ASSET} }`;
const PUBLIC_BLOCK = `id code type enabled position imageUrl title subtitle body ctaLabel
    items { id enabled position imageUrl label description }`;
const PROFILE = `id channel { id code customFields { storefrontNameZh storefrontNameEn } }
    descriptionZh descriptionEn taglineZh taglineEn brandBackgroundColor brandPrimaryColor brandAccentColor
    brandHighlightColor logoAsset { id } logoOnLightAsset { id } logoOnDarkAsset { id }`;

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, canonical(value[key])]),
        );
    }
    return value;
}

export function savedConfigurationDigest(stores) {
    return createHash('sha256')
        .update(JSON.stringify(canonical(stores.map(({ published, ...saved }) => saved))))
        .digest('hex');
}

export function validatePublishReview(enabled, review, changedFiles = []) {
    if (!enabled) {
        assert.equal(review, '', 'A storefront review requires its explicit release scope');
        return 'none';
    }
    if (review === 'preserve-existing') {
        assert.ok(
            changedFiles.every(file => file === 'packages/dev-server/scripts/sync-damatong-storefront.mjs'),
            'Preserve mode cannot release changed store data or media',
        );
        return 'preserve';
    }
    assert.match(review, /^[a-f0-9]{64}$/u, 'Storefront writes require the reviewed dry-run SHA-256');
    return 'apply';
}

function assetPath(record) {
    const asset = record.imageAsset;
    const value = asset
        ? asset.mimeType === 'image/svg+xml'
            ? asset.source
            : asset.preview || asset.source
        : record.imageUrl;
    if (!value) return '';
    try {
        return new URL(value).pathname;
    } catch {
        const path = value.replace(/^\/+/, '');
        return path.startsWith('assets/') ? `/${path}` : `/assets/${path}`;
    }
}

export function assertPublishedMatchesSaved(store) {
    for (const [locale, blocks] of Object.entries(store.published)) {
        let previousPosition = -Infinity;
        for (const block of blocks) {
            const saved = store.blocks.find(candidate => candidate.id === block.id);
            assert.ok(saved?.enabled, `Published content is not enabled in store ${store.channelId}`);
            assert.equal(
                block.position,
                saved.position,
                'Published floor position differs from saved position',
            );
            assert.ok(block.position >= previousPosition, 'Published floors are out of saved order');
            previousPosition = block.position;
            const copy = saved.translations.find(item => item.languageCode === locale);
            for (const field of ['title', 'subtitle', 'body', 'ctaLabel']) {
                assert.equal(
                    block[field] ?? '',
                    copy?.[field] ?? '',
                    `Published ${field} differs from saved ${locale} content`,
                );
            }
            assert.equal(
                assetPath(block),
                assetPath(saved),
                'Published image differs from its saved binding',
            );
            const savedItems = saved.items.filter(item => item.enabled);
            assert.deepEqual(
                block.items.map(item => item.id),
                savedItems.map(item => item.id),
                'Published items differ from saved enabled items',
            );
            for (const item of block.items) {
                const savedItem = savedItems.find(candidate => candidate.id === item.id);
                const itemCopy = savedItem.translations.find(
                    translation => translation.languageCode === locale,
                );
                assert.equal(
                    item.label,
                    itemCopy?.label ?? '',
                    'Published item label differs from saved copy',
                );
                assert.equal(
                    item.description ?? '',
                    itemCopy?.description ?? '',
                    'Published item description differs from saved copy',
                );
                assert.equal(
                    assetPath(item),
                    assetPath(savedItem),
                    'Published item image differs from saved binding',
                );
            }
        }
    }
}

export function assertConfigurationPreserved(before, after) {
    assert.equal(
        savedConfigurationDigest(after.stores),
        savedConfigurationDigest(before.stores),
        'Saved storefront configuration changed during this preserve-only release',
    );
    for (const store of after.stores) {
        assertPublishedMatchesSaved(store);
        const previous = before.stores.find(item => item.channelId === store.channelId);
        for (const [locale, blocks] of Object.entries(previous.published)) {
            for (const block of blocks) {
                const saved = store.blocks.find(item => item.id === block.id);
                const sharing = ['referral-system-poster', 'referral-custom-poster'].includes(
                    saved.settings?.purpose,
                );
                const expired = saved.endsAt && new Date(saved.endsAt).getTime() <= Date.now();
                if (!sharing && !expired) {
                    assert.ok(
                        store.published[locale].some(item => item.id === block.id),
                        'Previously published content disappeared without a saved configuration change',
                    );
                }
            }
        }
    }
}

export function configurationSummary(snapshot) {
    return {
        savedSha256: savedConfigurationDigest(snapshot.stores),
        stores: snapshot.stores.map(store => ({
            channelId: store.channelId,
            channelCode: store.channelCode,
            contentCount: store.blocks.length,
            interval: store.settings.heroAutoplayIntervalSeconds,
            published: Object.fromEntries(
                Object.entries(store.published).map(([locale, blocks]) => [locale, blocks.length]),
            ),
            sharing: {
                defaultPosterTemplate: store.sharing.defaultPosterTemplate,
                posterTemplates: store.sharing.posterTemplates,
                templates: [
                    ...store.sharing.systemPosterTemplateConfigs,
                    ...store.sharing.posterTemplateConfigs,
                ].map(poster => ({
                    id: poster.id,
                    enabled: poster.enabled,
                    posterAssetId: poster.posterBackgroundAsset?.id ?? null,
                    posterPath: assetPath({ imageAsset: poster.posterBackgroundAsset }),
                    shareAssetId: poster.shareBackgroundAsset?.id ?? null,
                    sharePath: assetPath({ imageAsset: poster.shareBackgroundAsset }),
                })),
            },
            images: store.blocks
                .filter(block => block.imageAsset || block.imageUrl)
                .map(block => ({
                    id: block.id,
                    code: block.code,
                    type: block.type,
                    enabled: block.enabled,
                    purpose: typeof block.settings?.purpose === 'string' ? block.settings.purpose : null,
                    assetId: block.imageAsset?.id ?? null,
                    path: assetPath(block),
                })),
        })),
    };
}

/** Read saved configuration and both public locales. Session and Channel tokens never leave this function. */
export async function captureStorefrontConfiguration({
    username,
    password,
    request = fetch,
    apiOrigin = 'http://127.0.0.1:3002',
} = {}) {
    assert.ok(username && password, 'Storefront verification credentials are unavailable');
    const origin = new URL(apiOrigin);
    assert.ok(
        ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname),
        'Configuration guard requires a loopback API',
    );
    let auth = '';
    async function query(document, { variables = {}, channel = '', locale = 'zh_Hans', shop = false } = {}) {
        const operation = document.match(/(?:query|mutation)\s+(ConfigurationGuard\w+)/u)?.[1];
        assert.ok(operation, 'Configuration query must have a fixed operation name');
        let failure = 'REQUEST_FAILED';
        try {
            const response = await request(
                `${origin.origin}/${shop ? 'shop-api' : 'admin-api'}?languageCode=${locale}`,
                {
                    method: 'POST',
                    signal: AbortSignal.timeout(60_000),
                    headers: {
                        'content-type': 'application/json',
                        'language-code': locale,
                        ...(channel ? { 'vendure-token': channel } : {}),
                        ...(!shop && auth ? { authorization: `Bearer ${auth}` } : {}),
                    },
                    body: JSON.stringify({ query: document, variables }),
                },
            );
            failure = 'HTTP_ERROR';
            assert.ok(response.ok, `Configuration query failed with HTTP ${response.status}`);
            failure = 'INVALID_JSON';
            const result = await response.json();
            failure = 'API_ERROR';
            assert.ok(
                !result.errors?.length && result.data,
                'Configuration API returned an error; no data changed',
            );
            auth ||= response.headers.get('vendure-auth-token') ?? '';
            return result.data;
        } catch (error) {
            const reason = error?.name === 'TimeoutError' ? 'TIMEOUT' : failure;
            // Operation names and fixed reason codes are safe; API/transport messages may contain secrets.
            throw new Error(`STOREFRONT_CONFIGURATION_QUERY_FAILED operation=${operation} reason=${reason}`);
        }
    }
    const { login } = await query(
        `mutation ConfigurationGuardLogin($username: String!, $password: String!) {
            login(username: $username, password: $password) {
                ... on CurrentUser { id channels { id code token } }
            }
        }`,
        { variables: { username, password } },
    );
    assert.ok(login?.id && auth && login.channels.length, 'Configuration guard login failed');
    const { storeProfiles } = await query(
        `query ConfigurationGuardProfiles { storeProfiles { ${PROFILE} } }`,
    );
    const stores = [];
    for (const channel of [...login.channels].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
        const result = await query(
            `query ConfigurationGuardContent {
                activeChannel { id }
                storefrontContentBlocks { ${BLOCK} }
                storefrontContentSettings { heroAutoplayIntervalSeconds configuredBlockTypes }
                referralProgram {
                    defaultPosterTemplate posterTemplates
                    posterTemplateConfigs { ${POSTER} }
                    systemPosterTemplateConfigs { ${POSTER} }
                }
            }`,
            { channel: channel.token },
        );
        assert.equal(result.activeChannel.id, channel.id, 'Configuration guard Channel mismatch');
        const published = {};
        for (const locale of ['zh_Hans', 'en']) {
            const data = await query(
                `query ConfigurationGuardPublished { activeChannel { id } storefrontContent { ${PUBLIC_BLOCK} } }`,
                { channel: channel.token, locale, shop: true },
            );
            assert.equal(data.activeChannel.id, channel.id, 'Shop API Channel mismatch');
            published[locale] = data.storefrontContent;
        }
        stores.push({
            channelId: channel.id,
            channelCode: channel.code,
            profile: storeProfiles.find(profile => profile.channel.id === channel.id) ?? null,
            blocks: result.storefrontContentBlocks,
            settings: result.storefrontContentSettings,
            sharing: result.referralProgram,
            published,
        });
    }
    return { format: 1, stores };
}

async function main() {
    const [mode, file, review, ...changedFiles] = process.argv.slice(2);
    if (mode === 'review') {
        assert.ok(['true', 'false'].includes(file), 'Invalid storefront release scope');
        validatePublishReview(file === 'true', review, changedFiles);
        return;
    }
    assert.ok(['capture', 'verify', 'inspect'].includes(mode), 'Unsupported configuration guard mode');
    assert.ok(mode === 'inspect' ? !file : Boolean(file), 'Configuration snapshot path is required');
    const snapshot = await captureStorefrontConfiguration({
        username: process.env.SUPERADMIN_USERNAME,
        password: process.env.SUPERADMIN_PASSWORD,
    });
    if (mode === 'capture') await writeFile(file, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
    if (mode === 'verify') assertConfigurationPreserved(JSON.parse(await readFile(file, 'utf8')), snapshot);
    const summary = configurationSummary(snapshot);
    if (mode !== 'inspect') summary.stores = summary.stores.map(({ images, sharing, ...counts }) => counts);
    const output = `${JSON.stringify(summary)}\nSTOREFRONT_CONFIGURATION_${mode.toUpperCase()}_OK\n`;
    assert.ok(Buffer.byteLength(output) <= 18000, 'Configuration summary exceeds the SSM evidence limit');
    process.stdout.write(output);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
