import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const collectionTranslationReview = JSON.parse(
    readFileSync(new URL('./collection-translation-review.manifest.json', import.meta.url), 'utf8'),
);
const locales = ['zh_Hans', 'en'];
const collectionFields = `id updatedAt isPrivate position inheritFilters
    parent { id } featuredAsset { id } assets { id }
    filters { code args { name value } } translations { languageCode name slug description }`;
const adminQuery = `query CollectionReviewAdmin($slug: String!) {
    activeChannel { id code } collection(slug: $slug) { ${collectionFields} } }`;
const shopQuery = `query CollectionReviewShop($id: ID!) {
    activeChannel { id code } collection(id: $id) { id name slug description featuredAsset { id } } }`;
const auditQuery = `query CollectionReviewAudit { contentTranslationAudit {
    states { entityType entityId fieldPath status origin locked } } }`;
const mutation = `mutation CollectionReviewApply($input: UpdateCollectionInput!) {
    updateCollection(input: $input) { ${collectionFields} } }`;

function translation(collection, locale) {
    const matches = collection.translations.filter(value => value.languageCode === locale);
    assert.equal(matches.length, 1, `Expected one ${locale} translation`);
    return matches[0];
}
function content(collection) {
    const { updatedAt, ...value } = collection;
    return value;
}
function planned(collection, definition) {
    const result = structuredClone(collection);
    const english = translation(result, 'en');
    for (const [field, review] of Object.entries(definition.fields)) english[field] = review.to;
    return result;
}
function reviewed(states, id, field) {
    const matches = states.filter(
        s => s.entityType === 'Collection' && s.entityId === id && s.fieldPath === field,
    );
    return (
        matches.length === 1 &&
        matches[0].status === 'MANUAL_LOCKED' &&
        matches[0].origin === 'MANUAL' &&
        matches[0].locked
    );
}

export async function reviewCollectionTranslations({
    apiOrigin,
    shopOrigin,
    username,
    password,
    channelCodes,
    apply = false,
    verify = false,
    allowRemote = false,
    snapshotFile,
    definitions = collectionTranslationReview,
    fetchImpl = fetch,
}) {
    assert.ok(
        apiOrigin && shopOrigin && username && password,
        'Explicit origins and environment credentials required',
    );
    assert.ok(!(apply && verify), 'Choose apply or verify');
    assert.ok(channelCodes?.length === 1, 'Exactly one reviewed Channel code is required per invocation');
    assert.ok(
        ['https://damatong.net', 'https://moyaoai.com'].includes(new URL(shopOrigin).origin),
        'Unreviewed storefront',
    );
    if (apply) {
        assert.ok(allowRemote, 'Writes require --apply --allow-remote');
        assert.ok(snapshotFile, 'Writes require an external --snapshot-file backup');
    }
    const request = async (origin, api, query, variables = {}, requestHeaders = {}, locale = 'zh_Hans') => {
        const response = await fetchImpl(`${origin.replace(/\/$/, '')}/${api}?languageCode=${locale}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'language-code': locale, ...requestHeaders },
            body: JSON.stringify({ query, variables }),
            signal: AbortSignal.timeout(30_000),
        });
        const result = await response.json();
        assert.ok(
            response.ok && result.data && !result.errors?.length,
            `${api} request failed (HTTP ${response.status})`,
        );
        return { data: result.data, response };
    };
    const channel = (
        await request(shopOrigin, 'shop-api', 'query CollectionReviewRoute { activeChannel { id code } }')
    ).data.activeChannel;
    assert.equal(channel?.code, channelCodes[0], 'Public storefront and reviewed Channel differ');
    const login = await request(
        apiOrigin,
        'admin-api',
        `mutation CollectionReviewLogin($username:String!,$password:String!) {
        login(username:$username,password:$password,rememberMe:false) {
        ... on CurrentUser { channels { id code token } } ... on ErrorResult { errorCode } } }`,
        { username, password },
    );
    assert.ok(!login.data.login.errorCode, 'Admin authentication failed');
    const session = login.response.headers.get('vendure-auth-token');
    const matches = login.data.login.channels.filter(c => c.id === channel.id && c.code === channel.code);
    assert.ok(session && matches.length === 1, 'Matching authenticated Channel required');
    const publicHeaders = { 'vendure-token': matches[0].token };
    const headers = { ...publicHeaders, authorization: `Bearer ${session}` };
    const read = async definition => {
        const { data } = await request(
            apiOrigin,
            'admin-api',
            adminQuery,
            { slug: definition.slug },
            headers,
        );
        assert.deepEqual(data.activeChannel, channel, 'Admin Channel mismatch');
        assert.ok(data.collection, `Missing ${definition.slug}`);
        const zh = translation(data.collection, 'zh_Hans');
        assert.equal(zh.slug, definition.slug, 'Source slug mismatch');
        assert.equal(zh.name, definition.sourceName, 'Chinese source changed since review');
        return data.collection;
    };
    const audit = async () =>
        (await request(apiOrigin, 'admin-api', auditQuery, {}, headers)).data.contentTranslationAudit.states;
    const verifyShop = async collection => {
        for (const locale of locales) {
            const { data } = await request(
                shopOrigin,
                'shop-api',
                shopQuery,
                { id: collection.id },
                publicHeaders,
                locale,
            );
            assert.deepEqual(data.activeChannel, channel, 'Shop Channel mismatch');
            assert.ok(data.collection, `Shop is missing collection ${collection.id}`);
            const expected = translation(collection, locale);
            for (const field of ['name', 'slug', 'description'])
                assert.equal(
                    data.collection[field],
                    expected[field],
                    `${locale} ${field} differs from Admin`,
                );
            assert.deepEqual(
                data.collection.featuredAsset,
                collection.featuredAsset,
                'Shop featured asset mismatch',
            );
        }
    };
    const before = [];
    for (const definition of definitions) {
        const collection = await read(definition);
        const zh = translation(collection, 'zh_Hans');
        const en = translation(collection, 'en');
        for (const [field, review] of Object.entries(definition.fields)) {
            assert.ok(['name', 'slug'].includes(field), 'Only reviewed name/slug fields are supported');
            assert.equal(zh[field], review.source, 'Source field changed since review');
            assert.ok(en[field] === review.from || en[field] === review.to, 'English changed since review');
        }
        await verifyShop(collection);
        before.push(collection);
    }
    assert.equal(new Set(before.map(c => c.id)).size, definitions.length, 'Ambiguous duplicate collection');
    const states = await audit();
    const plans = before.map((collection, index) => ({
        slug: definitions[index].slug,
        id: collection.id,
        fields: Object.entries(definitions[index].fields).map(([field, review]) => ({
            field,
            from: translation(collection, 'en')[field],
            to: review.to,
            action:
                translation(collection, 'en')[field] === review.to && reviewed(states, collection.id, field)
                    ? 'noop'
                    : 'review',
        })),
    }));
    const unchanged = plans.every(p => p.fields.every(f => f.action === 'noop'));
    if (verify) {
        assert.ok(unchanged, 'Reviewed English and manual-lock state not verified');
        return { status: 'VERIFIED', channel, plans };
    }
    if (!apply) return { status: 'DRY_RUN', channel, plans };
    if (unchanged) return { status: 'VERIFIED_NOOP', channel, plans };
    // Exclusive create prevents accidentally replacing the only pre-write backup.
    writeFileSync(
        snapshotFile,
        JSON.stringify({ capturedAt: new Date().toISOString(), channel, before, plans }, null, 2),
        { flag: 'wx', mode: 0o600 },
    );
    const writes = [];
    try {
        for (let index = 0; index < definitions.length; index++) {
            const plan = plans[index];
            if (plan.fields.every(f => f.action === 'noop')) continue;
            const current = await read(definitions[index]);
            // Native UpdateCollectionInput has no expectedUpdatedAt. Recheck the complete snapshot
            // immediately before the narrow English-only mutation; never resubmit Chinese or other bindings.
            assert.deepEqual(current, before[index], 'Concurrent collection edit before write');
            const fields = Object.fromEntries(plan.fields.map(f => [f.field, f.to]));
            const expected = planned(current, definitions[index]);
            writes.push({ index, expected });
            await request(
                apiOrigin,
                'admin-api',
                mutation,
                { input: { id: current.id, translations: [{ languageCode: 'en', ...fields }] } },
                headers,
            );
            const after = await read(definitions[index]);
            assert.deepEqual(content(after), content(expected), 'Collection changed outside reviewed fields');
            await verifyShop(after);
        }
        const afterStates = await audit();
        for (let index = 0; index < definitions.length; index++) {
            const current = await read(definitions[index]);
            assert.deepEqual(
                content(current),
                content(planned(before[index], definitions[index])),
                'Final collection verification failed',
            );
            await verifyShop(current);
            for (const field of Object.keys(definitions[index].fields))
                assert.ok(reviewed(afterStates, current.id, field), 'Manual lock verification failed');
        }
    } catch (error) {
        let restored = true;
        for (const { index, expected } of writes.reverse()) {
            try {
                const current = await read(definitions[index]);
                if (JSON.stringify(content(current)) === JSON.stringify(content(before[index]))) continue;
                assert.deepEqual(
                    content(current),
                    content(expected),
                    'Concurrent edit prevents automatic restoration',
                );
                const previous = translation(before[index], 'en');
                const fields = Object.fromEntries(
                    Object.keys(definitions[index].fields).map(field => [field, previous[field]]),
                );
                await request(
                    apiOrigin,
                    'admin-api',
                    mutation,
                    { input: { id: current.id, translations: [{ languageCode: 'en', ...fields }] } },
                    headers,
                );
                const restoredCollection = await read(definitions[index]);
                assert.deepEqual(
                    content(restoredCollection),
                    content(before[index]),
                    'Restoration verification failed',
                );
                await verifyShop(restoredCollection);
            } catch {
                restored = false;
            }
        }
        throw new Error(
            restored
                ? 'Review failed; previous content preserved/restored. Check audit metadata before retry.'
                : 'Review failed; concurrent edits or API failure prevented full restoration. Use the saved snapshot.',
            { cause: error },
        );
    }
    return { status: 'APPLIED_VERIFIED', channel, plans, snapshotFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const allowed = new Set(['--dry-run', '--apply', '--verify', '--allow-remote', '--snapshot-file']);
    const snapshotIndex = args.indexOf('--snapshot-file');
    const snapshotFile = snapshotIndex < 0 ? undefined : args[snapshotIndex + 1];
    const flags = args.filter((_, index) => snapshotIndex < 0 || index !== snapshotIndex + 1);
    assert.ok(
        flags.every(flag => allowed.has(flag)),
        'Unknown argument',
    );
    assert.ok(
        flags.filter(flag => ['--dry-run', '--apply', '--verify'].includes(flag)).length <= 1,
        'Choose one mode',
    );
    reviewCollectionTranslations({
        apiOrigin: process.env.VENDURE_API_ORIGIN,
        shopOrigin: process.env.VENDURE_STOREFRONT_URL,
        username: process.env.SUPERADMIN_USERNAME,
        password: process.env.SUPERADMIN_PASSWORD,
        channelCodes: (process.env.HOMEPAGE_CAROUSEL_CHANNEL_CODES || '').split(',').filter(Boolean),
        apply: args.includes('--apply'),
        verify: args.includes('--verify'),
        allowRemote: args.includes('--allow-remote'),
        snapshotFile,
    })
        .then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
        .catch(() => {
            process.stderr.write(
                'COLLECTION_TRANSLATION_REVIEW_FAILED; inspect the saved snapshot and read-only verification\n',
            );
            process.exitCode = 1;
        });
}
