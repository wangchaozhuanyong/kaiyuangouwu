import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Standalone maintenance entry: credentials are injected by the reviewed server shell.
function isLocalApiOrigin(value) {
    const url = new URL(value);
    return (
        ['http:', 'https:'].includes(url.protocol) &&
        (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.hostname.endsWith('.localhost'))
    );
}

// Reviewed, settings-only repair. Never invoke the whole-store publisher for this correction.
export const heroOverlayRepairCodes = [
    'damatong-hero-marketplace',
    'damatong-hero-malaysia-services',
    'damatong-hero-ai-subscriptions',
];
const locales = ['zh_Hans', 'en'];
const image = 'imageUrl imageAsset { id preview source }';
const copy = 'title subtitle body ctaLabel';
const common = `id code type internalName layoutVariant enabled position startsAt endsAt ${image}
    backgroundColor textColor targetType targetValue settings ${copy}`;
const item = `id enabled position ${image} targetType targetValue settings label description`;
const settingsQuery = 'storefrontContentSettings { heroAutoplayIntervalSeconds configuredBlockTypes }';
const adminQuery = `query HeroRepairAdmin { activeChannel { id code } ${settingsQuery}
    storefrontContentBlocks { updatedAt ${common} translations { languageCode ${copy} }
    items { ${item} translations { languageCode label description } } } }`;
const shopQuery = `query HeroRepairShop { activeChannel { id code } ${settingsQuery}
    storefrontContent { ${common} items { ${item} } } }`;
const applyQuery = `mutation HeroRepairApply($input: ApplyStorefrontContentChangesInput!) {
    applyStorefrontContentChanges(input: $input) { id updatedAt } }`;

function target(blocks, code) {
    const matches = blocks.filter(block => block.code === code);
    assert.equal(matches.length, 1, `Expected exactly one ${code}`);
    assert.equal(matches[0].type, 'HERO', `${code} is not HERO`);
    assert.equal(matches[0].enabled, true, `${code} must be enabled`);
    return matches[0];
}

function stable(blocks) {
    return blocks.map(({ updatedAt, ...block }) => block);
}

function assetIdentity(asset) {
    if (!asset) return null;
    const assetPath = value => {
        if (!value) return null;
        const pathname = new URL(value, 'https://asset.invalid').pathname;
        return /^\/(preview|source)\//.test(pathname) ? `/assets${pathname}` : pathname;
    };
    return { id: asset.id, preview: assetPath(asset.preview), source: assetPath(asset.source) };
}

function expected(blocks) {
    return stable(blocks).map(block =>
        heroOverlayRepairCodes.includes(block.code)
            ? { ...block, settings: { ...block.settings, themePreset: 'bright' } }
            : block,
    );
}

export function planHeroOverlayRepair(blocks) {
    return heroOverlayRepairCodes.map(code => {
        const block = target(blocks, code);
        return {
            code,
            id: block.id,
            expectedUpdatedAt: block.updatedAt,
            action: block.settings?.themePreset === 'bright' ? 'noop' : 'update',
            from: block.settings?.themePreset ?? 'standard',
            to: 'bright',
            settings: { ...block.settings, themePreset: 'bright' },
        };
    });
}

export async function repairHeroOverlay({
    apiOrigin,
    shopOrigin = apiOrigin,
    username,
    password,
    channelCodes,
    apply = false,
    verify = false,
    allowRemote = false,
    production = false,
    fetchImpl = fetch,
}) {
    assert.ok(
        apiOrigin && username && password,
        'API origin and administrator environment credentials required',
    );
    assert.deepEqual(channelCodes, ['my-malaysia'], 'This repair requires exactly the my-malaysia Channel');
    assert.ok(!(apply && verify), '--apply and --verify are mutually exclusive');
    if (apply && (production || !isLocalApiOrigin(apiOrigin))) {
        assert.ok(allowRemote, 'Production/remote writes require --apply --allow-remote');
    }
    const request = async (origin, api, query, variables = {}, headers = {}, language = 'en') => {
        const response = await fetchImpl(`${origin.replace(/\/$/, '')}/${api}?languageCode=${language}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'language-code': language, ...headers },
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(30_000),
        });
        const result = await response.json();
        // Do not echo response bodies, submitted credentials, or session headers into logs.
        assert.ok(
            response.ok && result.data && !result.errors?.length,
            `${api} request failed (HTTP ${response.status})`,
        );
        return { data: result.data, response };
    };
    const login = await request(
        apiOrigin,
        'admin-api',
        `mutation HeroRepairLogin($username: String!, $password: String!) {
        login(username:$username,password:$password,rememberMe:false) {
            ... on CurrentUser { channels { id code token } } ... on ErrorResult { errorCode }
        } }`,
        { username, password },
    );
    assert.ok(!login.data.login.errorCode, 'Admin login failed');
    const session = login.response.headers.get('vendure-auth-token');
    assert.ok(session, 'Admin login did not return a session');
    const matches = login.data.login.channels.filter(candidate => candidate.code === channelCodes[0]);
    assert.equal(matches.length, 1, 'Administrator must have exactly one matching Channel');
    const channel = matches[0];
    const channelHeaders = { 'vendure-token': channel.token };
    const adminHeaders = { ...channelHeaders, authorization: `Bearer ${session}` };
    const readAdmin = async () => {
        const { data } = await request(apiOrigin, 'admin-api', adminQuery, {}, adminHeaders);
        assert.deepEqual(
            data.activeChannel,
            { id: channel.id, code: channel.code },
            'Admin Channel mismatch',
        );
        return data;
    };
    const readShop = async () => {
        const result = {};
        for (const locale of locales) {
            const { data } = await request(shopOrigin, 'shop-api', shopQuery, {}, channelHeaders, locale);
            assert.deepEqual(
                data.activeChannel,
                { id: channel.id, code: channel.code },
                'Shop Channel mismatch',
            );
            result[locale] = data;
        }
        return result;
    };
    const before = await readAdmin();
    const beforeShop = await readShop();
    const plans = planHeroOverlayRepair(before.storefrontContentBlocks);
    for (const code of heroOverlayRepairCodes) {
        const admin = target(before.storefrontContentBlocks, code);
        for (const locale of locales) {
            const shop = target(beforeShop[locale].storefrontContent, code);
            const translation = admin.translations.filter(t => t.languageCode === locale);
            assert.equal(translation.length, 1, `${code} requires a ${locale} translation`);
            for (const field of copy.split(' '))
                assert.equal(shop[field], translation[0][field], `${code} ${locale} ${field} mismatch`);
            assert.deepEqual(shop.settings, admin.settings, `${code} settings mismatch before repair`);
            assert.deepEqual(
                assetIdentity(shop.imageAsset),
                assetIdentity(admin.imageAsset),
                `${code} asset mismatch before repair`,
            );
        }
    }
    const summary = plans.map(({ code, id, from, to, action }) => ({ code, id, from, to, action }));
    if (verify) {
        assert.ok(
            plans.every(plan => plan.action === 'noop'),
            'Hero overlay repair is not applied',
        );
        return { status: 'VERIFIED', channel: channel.code, plans: summary };
    }
    if (!apply) return { status: 'DRY_RUN', channel: channel.code, plans: summary };
    const changes = plans.filter(plan => plan.action === 'update');
    if (!changes.length) return { status: 'VERIFIED_NOOP', channel: channel.code, plans: summary };
    const write = (snapshot, updates) =>
        request(
            apiOrigin,
            'admin-api',
            applyQuery,
            {
                input: {
                    expectedBlocks: snapshot.storefrontContentBlocks.map(({ id, updatedAt }) => ({
                        id,
                        expectedUpdatedAt: updatedAt,
                    })),
                    creates: [],
                    updates,
                },
            },
            adminHeaders,
        );
    let receipt;
    try {
        receipt = (
            await write(
                before,
                changes.map(({ id, expectedUpdatedAt, settings }) => ({ id, expectedUpdatedAt, settings })),
            )
        ).data.applyStorefrontContentChanges;
    } catch {
        // A lost mutation response can still mean the transaction committed. Read before deciding.
    }
    try {
        const after = await readAdmin();
        assert.deepEqual(
            stable(after.storefrontContentBlocks),
            expected(before.storefrontContentBlocks),
            'Admin snapshot changed beyond themePreset',
        );
        assert.deepEqual(
            after.storefrontContentSettings,
            before.storefrontContentSettings,
            'Carousel interval or configured types changed',
        );
        const afterShop = await readShop();
        for (const locale of locales) {
            assert.deepEqual(
                afterShop[locale].storefrontContent,
                expected(beforeShop[locale].storefrontContent),
                `${locale} Shop verification failed`,
            );
            assert.deepEqual(
                afterShop[locale].storefrontContentSettings,
                beforeShop[locale].storefrontContentSettings,
                `${locale} settings changed`,
            );
        }
    } catch {
        const current = await readAdmin();
        if (!receipt) {
            const unchanged = changes.every(plan => {
                const now = target(current.storefrontContentBlocks, plan.code);
                const original = target(before.storefrontContentBlocks, plan.code);
                return now.updatedAt === original.updatedAt;
            });
            throw new Error(
                unchanged
                    ? 'Write failed or conflicted; no target version changed; no retry performed'
                    : 'Mutation response missing and verification failed; inspect current data before any further write',
            );
        }
        // Only restore targets still exactly matching this write. Never overwrite another editor's work.
        const restore = changes.map(plan => {
            const original = target(before.storefrontContentBlocks, plan.code);
            const now = target(current.storefrontContentBlocks, plan.code);
            assert.equal(
                now.updatedAt,
                receipt.find(block => block.id === now.id)?.updatedAt,
                `${plan.code} changed concurrently; automatic rollback stopped`,
            );
            assert.deepEqual(
                stable([now]),
                expected([original]),
                `${plan.code} changed concurrently; automatic rollback stopped`,
            );
            return { id: now.id, expectedUpdatedAt: now.updatedAt, settings: original.settings };
        });
        await write(current, restore);
        const restored = await readAdmin();
        const restoredShop = await readShop();
        for (const plan of changes) {
            assert.deepEqual(
                stable([target(restored.storefrontContentBlocks, plan.code)]),
                stable([target(before.storefrontContentBlocks, plan.code)]),
                'Admin rollback verification failed',
            );
            for (const locale of locales)
                assert.deepEqual(
                    target(restoredShop[locale].storefrontContent, plan.code),
                    target(beforeShop[locale].storefrontContent, plan.code),
                    'Shop rollback verification failed',
                );
        }
        throw new Error('Repair verification failed; original target settings restored and verified');
    }
    return { status: 'APPLIED_VERIFIED', channel: channel.code, plans: summary };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    assert.ok(
        args.every(arg => ['--dry-run', '--apply', '--verify', '--allow-remote'].includes(arg)),
        'Unsupported option',
    );
    assert.ok(
        args.filter(arg => ['--dry-run', '--apply', '--verify'].includes(arg)).length <= 1,
        'Choose one mode',
    );
    repairHeroOverlay({
        apiOrigin: process.env.VENDURE_API_ORIGIN,
        shopOrigin: process.env.VENDURE_STOREFRONT_URL || process.env.VENDURE_API_ORIGIN,
        username: process.env.SUPERADMIN_USERNAME,
        password: process.env.SUPERADMIN_PASSWORD,
        channelCodes: (process.env.HOMEPAGE_CAROUSEL_CHANNEL_CODES || '')
            .split(',')
            .map(code => code.trim())
            .filter(Boolean),
        apply: args.includes('--apply'),
        verify: args.includes('--verify'),
        allowRemote: args.includes('--allow-remote'),
        production: process.env.NODE_ENV === 'production',
    })
        .then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
        .catch(error => {
            process.stderr.write(error.message.split('\n')[0] + '\n');
            process.exitCode = 1;
        });
}
