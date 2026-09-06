import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    isLocalApiOrigin,
    parseChannelCodes,
    prepareStorefrontMediaManifest,
    syncStorefrontMedia,
} from './sync-storefront-media.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const assetDirectory = path.resolve(directory, '../assets/referral-posters/v2');
const manifest = JSON.parse(await readFile(path.join(assetDirectory, 'manifest.json'), 'utf8'));
const { referralPosterPresets, referralPosterCopy, referralPosterContentCode } =
    await import('../../store-management-plugin/dist/referral/referral-poster-presets.js');
const copyFields = Object.keys(referralPosterCopy);
const posterFields = `id name enabled position layoutVariant
    posterBackgroundAsset { id source preview width height } shareBackgroundAsset { id }
    ${copyFields.join(' ')} foregroundColor accentColor overlayOpacity`;
const programFields = `channelId updatedAt defaultPosterTemplate posterTemplates
    posterTemplateConfigs { ${posterFields} }`;
const blockFields = `id code updatedAt enabled type internalName layoutVariant position
    imageAsset { id } imageUrl textColor backgroundColor settings
    translations { languageCode title subtitle body ctaLabel }`;
const stateQuery = `query PosterPublishState { referralProgram { ${programFields} }
    storefrontContentBlocks { ${blockFields} } }`;
const verifyQuery = `query PosterPublishVerify { activeChannel { code }
    referralProgram { ${programFields}
        systemPosterTemplateConfigs { ${posterFields} design }
    } }`;
const batchMutation = `mutation PosterBindBatch($input:ApplyStorefrontContentChangesInput!) {
    applyStorefrontContentChanges(input:$input) { ${blockFields} }
}`;
const locales = ['zh_Hans', 'en'];
const scopeOrigins = {
    primary: ['https://moyaoai.com'],
    'both-stores': ['https://moyaoai.com', 'https://damatong.net'],
};

export async function prepareReferralPosters() {
    assert.deepEqual(
        manifest.systemFiles.map(item => item.id),
        referralPosterPresets.map(item => item.id),
    );
    const entries = manifest.systemFiles.map(item => {
        const preset = referralPosterPresets.find(value => value.id === item.id);
        return {
            key: `${referralPosterContentCode(item.id)}-v2`,
            templateId: item.id,
            file: path.join(assetDirectory, item.file),
            names: { zh: preset.nameZh, en: preset.nameEn },
            assetOnly: { purpose: referralPosterContentCode(item.id) },
        };
    });
    entries.push({
        key: manifest.custom.key,
        file: path.join(assetDirectory, manifest.custom.file),
        names: { zh: manifest.custom.name, en: 'Aurora core AI poster' },
        assetOnly: { purpose: 'referral-custom-poster' },
    });
    const prepared = await prepareStorefrontMediaManifest(entries);
    for (const item of prepared) {
        assert.equal(item.bytes.subarray(1, 4).toString(), 'PNG', 'Expected PNG background');
        assert.equal(item.bytes.readUInt32BE(16), 1080, 'Poster width must remain 1080');
        assert.equal(item.bytes.readUInt32BE(20), 1920, 'Poster height must remain 1920');
    }
    assert.doesNotMatch(
        JSON.stringify({ referralPosterCopy, custom: manifest.custom.copy }),
        /moyaoai\.com|CloudBridge|云桥|MOYAO/,
    );
    return prepared;
}

export function systemBlockInput(preset, assetId, existing) {
    const code = referralPosterContentCode(preset.id);
    if (existing) {
        assert.equal(existing.type, 'CUSTOM', `Content code conflict: ${code}`);
        assert.equal(
            existing.settings?.purpose,
            'referral-system-poster',
            `Content purpose conflict: ${code}`,
        );
        assert.equal(existing.settings?.templateId, preset.id, `Template conflict: ${code}`);
        // Preserve all store-specific copy and choices on subsequent publishing runs.
        return {
            id: existing.id,
            expectedUpdatedAt: existing.updatedAt,
            imageAssetId: assetId,
            enabled: false,
            settings: {
                ...existing.settings,
                version: 2,
                design: { ...preset.design, ...existing.settings.design },
            },
        };
    }
    return {
        code,
        internalName: `分享海报 · ${preset.nameZh}`,
        type: 'CUSTOM',
        layoutVariant: 'CUSTOM',
        enabled: false,
        position: 9000 + referralPosterPresets.indexOf(preset),
        imageAssetId: assetId,
        backgroundColor: preset.design.background,
        textColor: preset.foregroundColor,
        settings: {
            purpose: 'referral-system-poster',
            templateId: preset.id,
            version: 2,
            copy: referralPosterCopy,
            design: preset.design,
            accentColor: preset.accentColor,
        },
        translations: [
            { languageCode: 'zh_Hans', title: preset.nameZh },
            { languageCode: 'en', title: preset.nameEn },
        ],
    };
}

function contentSnapshot(block) {
    return {
        imageAssetId: block.imageAsset?.id ?? null,
        imageUrl: block.imageUrl ?? null,
        enabled: block.enabled,
        settings: block.settings,
    };
}

function expectedCopy(block) {
    return Object.fromEntries(
        copyFields.map(field => [
            field,
            typeof block.settings?.copy?.[field] === 'string'
                ? block.settings.copy[field]
                : referralPosterCopy[field],
        ]),
    );
}

export function comparablePoster(template, requestOrigin) {
    const result = { ...template };
    for (const field of ['posterBackgroundAsset', 'shareBackgroundAsset']) {
        if (!template[field]) continue;
        result[field] = { ...template[field] };
        for (const key of ['source', 'preview']) {
            if (typeof template[field][key] !== 'string') continue;
            const url = new URL(template[field][key], requestOrigin);
            assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password);
            // AssetServer derives same-origin URLs from each API request. Only remove that
            // verified request origin; an unrelated/CDN host must still match exactly.
            result[field][key] =
                url.origin === new URL(requestOrigin).origin
                    ? `${url.pathname}${url.search}${url.hash}`
                    : url.href;
        }
    }
    return result;
}

export async function syncReferralPosters({
    apiOrigin,
    username,
    password,
    channelCodes = [],
    aiChannelCode,
    scope,
    apply = false,
    verify = false,
    allowRemote = false,
    backupFile,
    fetchImpl = fetch,
    mediaSync = syncStorefrontMedia,
    production = process.env.NODE_ENV === 'production',
}) {
    assert.ok(!(apply && verify), '--apply and --verify are mutually exclusive');
    assert.ok(!scope || scopeOrigins[scope], 'Invalid REFERRAL_POSTER_SCOPE');
    assert.ok(!scope || !channelCodes.length, 'Choose a reviewed scope or explicit Channel codes, not both');
    assert.ok(
        scope || channelCodes.length,
        'REFERRAL_POSTER_CHANNEL_CODES or REFERRAL_POSTER_SCOPE is required',
    );
    assert.equal(new Set(channelCodes).size, channelCodes.length, 'Duplicate Channel codes');
    assert.ok(
        !aiChannelCode || channelCodes.includes(aiChannelCode),
        'AI Channel must be explicitly included',
    );
    assert.ok(apiOrigin && username && password, 'API origin and admin credentials are required');
    if (apply && (production || !isLocalApiOrigin(apiOrigin)))
        assert.ok(allowRemote, 'Remote writes require --apply and --allow-remote');
    if (apply) assert.ok(backupFile, 'REFERRAL_POSTER_BACKUP_FILE is required before applying');
    const prepared = await prepareReferralPosters();
    const mutationId = randomUUID();
    const origin = apiOrigin.replace(/\/$/, '');
    let authToken = '';
    async function request(
        query,
        variables = {},
        channel,
        api = 'admin-api',
        locale = 'zh_Hans',
        host = origin,
    ) {
        const response = await fetchImpl(`${host}/${api}?languageCode=${locale}`, {
            method: 'POST',
            signal: AbortSignal.timeout(30_000),
            headers: {
                'content-type': 'application/json',
                'language-code': locale,
                ...(api === 'admin-api' && authToken ? { authorization: `Bearer ${authToken}` } : {}),
                ...(channel ? { 'vendure-token': channel.token } : {}),
            },
            body: JSON.stringify({ query, variables }),
        });
        const body = await response.json();
        assert.ok(
            response.ok && !body.errors?.length && body.data,
            `Poster ${api} request failed (${response.status})`,
        );
        return { data: body.data, response };
    }
    const login = await request(
        `mutation PosterPublishLogin($username:String!,$password:String!) {
        login(username:$username,password:$password,rememberMe:false) {
            ... on CurrentUser { id channels { id code token } } ... on ErrorResult { errorCode }
        } }`,
        { username, password },
    );
    authToken = login.response.headers.get('vendure-auth-token') || '';
    assert.ok(authToken && login.data.login.channels, 'Admin authentication failed');
    const available = login.data.login.channels;
    function select(code) {
        const matches = available.filter(item => item.code === code);
        assert.equal(matches.length, 1, `Expected one accessible Channel: ${code}`);
        return matches[0];
    }
    const channels = [];
    if (scope) {
        for (const shopOrigin of scopeOrigins[scope]) {
            const { data } = await request(
                'query PosterStoreRoute { activeChannel { code } }',
                {},
                undefined,
                'shop-api',
                'zh_Hans',
                shopOrigin,
            );
            const channel = { ...select(data.activeChannel.code), shopOrigin };
            assert.ok(
                !channels.some(item => item.id === channel.id),
                'Store domains resolve to the same Channel',
            );
            channels.push(channel);
        }
        assert.equal(
            channels[0].code,
            '__default_channel__',
            'Primary domain must resolve to the primary Channel',
        );
        aiChannelCode = channels[0].code;
    } else {
        channels.push(...channelCodes.map(code => ({ ...select(code), shopOrigin: origin })));
    }
    const states = [];
    // Preflight all stores and media before any upload or content mutation. This uses the
    // previous API contract so stage two can preflight before starting the new candidate API.
    for (const channel of channels) {
        const { data } = await request(stateQuery, {}, channel);
        for (const preset of referralPosterPresets) {
            const matches = data.storefrontContentBlocks.filter(
                block => block.code === referralPosterContentCode(preset.id),
            );
            assert.ok(matches.length <= 1, 'Ambiguous system poster content code');
            if (matches[0]) systemBlockInput(preset, matches[0].imageAsset?.id, matches[0]);
        }
        const selected = prepared.filter(item => item.templateId || channel.code === aiChannelCode);
        const media = await mediaSync({
            apiOrigin: origin,
            username,
            password,
            channelCodes: [channel.code],
            manifest: selected,
            apply: false,
            verify,
            allowRemote,
            production,
            fetchImpl,
        });
        states.push({
            channel,
            before: data,
            selected,
            media,
            written: [],
            createdCustom: null,
            desired: [],
        });
    }
    if (apply || verify) {
        for (const state of states) {
            const { data } = await request(verifyQuery, {}, state.channel);
            assert.equal(
                data.referralProgram.systemPosterTemplateConfigs.length,
                5,
                'Deploy the new poster API before binding backgrounds',
            );
        }
    }
    if (apply)
        await writeFile(
            backupFile,
            JSON.stringify(
                {
                    version: 2,
                    apiOrigin: origin,
                    before: states.map(state => ({ channelCode: state.channel.code, ...state.before })),
                },
                null,
                2,
            ),
            { flag: 'wx', mode: 0o600 },
        );

    async function verifyState(state) {
        const { channel, media } = state;
        const current = (await request(stateQuery, {}, channel)).data;
        assert.deepEqual(
            current.referralProgram.posterTemplates,
            state.before.referralProgram.posterTemplates,
            'System visibility unexpectedly changed',
        );
        assert.equal(
            current.referralProgram.defaultPosterTemplate,
            state.before.referralProgram.defaultPosterTemplate,
            'Default selection unexpectedly changed',
        );
        for (const previous of state.before.referralProgram.posterTemplateConfigs) {
            assert.deepEqual(
                current.referralProgram.posterTemplateConfigs.find(item => item.id === previous.id),
                previous,
                'Existing custom copy or visibility unexpectedly changed',
            );
        }
        for (const locale of locales) {
            const admin = (await request(verifyQuery, {}, channel, 'admin-api', locale)).data;
            const shop = (await request(verifyQuery, {}, channel, 'shop-api', locale, channel.shopOrigin))
                .data;
            assert.equal(admin.activeChannel.code, channel.code);
            assert.equal(shop.activeChannel.code, channel.code, 'Shop route resolved another store');
            assert.deepEqual(shop.referralProgram.posterTemplates, admin.referralProgram.posterTemplates);
            assert.equal(
                shop.referralProgram.defaultPosterTemplate,
                admin.referralProgram.defaultPosterTemplate,
            );
            assert.deepEqual(
                shop.referralProgram.posterTemplateConfigs.map(item =>
                    comparablePoster(item, channel.shopOrigin || origin),
                ),
                admin.referralProgram.posterTemplateConfigs
                    .filter(item => item.enabled)
                    .map(item => comparablePoster(item, origin)),
            );
            for (const preset of referralPosterPresets) {
                const block = current.storefrontContentBlocks.find(
                    item => item.code === referralPosterContentCode(preset.id),
                );
                assert.ok(block, 'System content binding is missing');
                systemBlockInput(preset, block.imageAsset?.id, block);
                const assetId = media.results.find(
                    item => item.key === `${referralPosterContentCode(preset.id)}-v2`,
                )?.assetId;
                assert.ok(assetId, 'Published background is missing');
                assert.equal(block.imageAsset?.id, assetId);
                assert.equal(block.enabled, false, 'Poster content must not appear in page sections');
                for (const program of [admin.referralProgram, shop.referralProgram]) {
                    const poster = program.systemPosterTemplateConfigs.find(item => item.id === preset.id);
                    assert.ok(poster, 'System template did not reach both APIs');
                    assert.equal(poster.posterBackgroundAsset?.id, assetId);
                    assert.equal(poster.posterBackgroundAsset.width, 1080);
                    assert.equal(poster.posterBackgroundAsset.height, 1920);
                    assert.deepEqual(
                        Object.fromEntries(copyFields.map(field => [field, poster[field]])),
                        expectedCopy(block),
                    );
                    assert.equal(poster.foregroundColor, block.textColor || preset.foregroundColor);
                    assert.equal(poster.accentColor, block.settings.accentColor || preset.accentColor);
                    assert.deepEqual(poster.design, { ...preset.design, ...block.settings.design });
                    assert.equal(poster.enabled, program.posterTemplates.includes(preset.id));
                }
                assert.deepEqual(
                    comparablePoster(
                        shop.referralProgram.systemPosterTemplateConfigs.find(item => item.id === preset.id),
                        channel.shopOrigin || origin,
                    ),
                    comparablePoster(
                        admin.referralProgram.systemPosterTemplateConfigs.find(item => item.id === preset.id),
                        origin,
                    ),
                );
            }
        }
        if (channel.code === aiChannelCode) {
            const assetId = media.results.find(item => item.key === manifest.custom.key)?.assetId;
            const matches = current.referralProgram.posterTemplateConfigs.filter(
                item => item.posterBackgroundAsset?.id === assetId,
            );
            assert.equal(matches.length, 1, 'Expected one primary-store AI custom template');
            if (state.createdCustom) {
                assert.equal(matches[0].enabled, false);
                for (const [field, value] of Object.entries({
                    ...referralPosterCopy,
                    ...manifest.custom.copy,
                }))
                    assert.equal(matches[0][field], value, `AI copy mismatch: ${field}`);
            }
        }
    }

    async function restoreState(state) {
        const channel = state.channel;
        let current = (await request(stateQuery, {}, channel)).data;
        if (state.createdCustom) {
            const live = current.referralProgram.posterTemplateConfigs.find(
                item => item.id === state.createdCustom.id,
            );
            assert.deepEqual(live, state.createdCustom, 'Concurrent AI template edit; refusing to overwrite');
            const deleted = (
                await request(
                    'mutation PosterUndoCustom($id:ID!) { deleteReferralPosterTemplate(id:$id) { result } }',
                    { id: live.id },
                    channel,
                )
            ).data;
            assert.equal(deleted.deleteReferralPosterTemplate.result, 'DELETED');
        }
        const updates = [];
        for (const written of state.written) {
            const live = current.storefrontContentBlocks.find(item => item.id === written.id);
            assert.ok(
                live && live.updatedAt === written.updatedAt,
                'Concurrent content edit; refusing to overwrite',
            );
            const before = state.before.storefrontContentBlocks.find(item => item.id === written.id);
            if (before)
                updates.push({ id: live.id, expectedUpdatedAt: live.updatedAt, ...contentSnapshot(before) });
            else {
                const deleted = (
                    await request(
                        'mutation PosterUndoBlock($id:ID!) { deleteStorefrontContentBlock(id:$id) { result } }',
                        { id: live.id },
                        channel,
                    )
                ).data;
                assert.equal(deleted.deleteStorefrontContentBlock.result, 'DELETED');
            }
        }
        if (updates.length) {
            current = (await request(stateQuery, {}, channel)).data;
            await request(
                batchMutation,
                {
                    input: {
                        expectedBlocks: current.storefrontContentBlocks.map(block => ({
                            id: block.id,
                            expectedUpdatedAt: block.updatedAt,
                        })),
                        creates: [],
                        updates,
                    },
                },
                channel,
            );
        }
        current = (await request(stateQuery, {}, channel)).data;
        for (const written of state.written) {
            const before = state.before.storefrontContentBlocks.find(item => item.id === written.id);
            const restored = current.storefrontContentBlocks.find(item => item.id === written.id);
            if (before)
                assert.deepEqual(
                    contentSnapshot(restored),
                    contentSnapshot(before),
                    'Previous binding was not restored',
                );
            else assert.ok(!restored, 'New import content was not removed');
        }
        assert.deepEqual(
            current.referralProgram.posterTemplateConfigs,
            state.before.referralProgram.posterTemplateConfigs,
        );
        assert.deepEqual(
            current.referralProgram.posterTemplates,
            state.before.referralProgram.posterTemplates,
        );
        assert.equal(
            current.referralProgram.defaultPosterTemplate,
            state.before.referralProgram.defaultPosterTemplate,
        );
    }

    try {
        for (const state of states) {
            if (apply) {
                const { channel } = state;
                // Fence against edits during preflight and upload. The content API provides
                // an atomic five-block batch with optimistic versions for every current block.
                state.media = await mediaSync({
                    apiOrigin: origin,
                    username,
                    password,
                    channelCodes: [channel.code],
                    manifest: state.selected,
                    apply: true,
                    allowRemote,
                    production,
                    fetchImpl,
                });
                const creates = [];
                const updates = [];
                for (const preset of referralPosterPresets) {
                    const existing = state.before.storefrontContentBlocks.find(
                        block => block.code === referralPosterContentCode(preset.id),
                    );
                    const assetId = state.media.results.find(
                        item => item.key === `${referralPosterContentCode(preset.id)}-v2`,
                    ).assetId;
                    const input = systemBlockInput(preset, assetId, existing);
                    if (
                        existing &&
                        JSON.stringify(contentSnapshot(existing)) ===
                            JSON.stringify({
                                imageAssetId: input.imageAssetId,
                                imageUrl: existing.imageUrl ?? null,
                                enabled: input.enabled,
                                settings: input.settings,
                            })
                    )
                        continue;
                    input.settings = { ...input.settings, publisherMutationId: mutationId };
                    (existing ? updates : creates).push(input);
                    state.desired.push({ code: referralPosterContentCode(preset.id), input });
                }
                if (creates.length || updates.length) {
                    try {
                        const result = await request(
                            batchMutation,
                            {
                                input: {
                                    expectedBlocks: state.before.storefrontContentBlocks.map(block => ({
                                        id: block.id,
                                        expectedUpdatedAt: block.updatedAt,
                                    })),
                                    creates,
                                    updates,
                                },
                            },
                            channel,
                        );
                        state.written = result.data.applyStorefrontContentChanges.filter(block =>
                            state.desired.some(item => item.code === block.code),
                        );
                    } catch (error) {
                        // A lost HTTP response may follow a committed transaction. Recover
                        // only records marked by this exact invocation before undoing them.
                        const recovered = (await request(stateQuery, {}, channel)).data;
                        state.written = recovered.storefrontContentBlocks.filter(
                            block => block.settings?.publisherMutationId === mutationId,
                        );
                        throw error;
                    }
                }
                if (channel.code === aiChannelCode) {
                    const assetId = state.media.results.find(
                        item => item.key === manifest.custom.key,
                    ).assetId;
                    const live = (await request(stateQuery, {}, channel)).data.referralProgram;
                    assert.equal(
                        live.updatedAt,
                        state.before.referralProgram.updatedAt,
                        'Concurrent poster configuration change',
                    );
                    const matches = live.posterTemplateConfigs.filter(
                        item => item.posterBackgroundAsset?.id === assetId,
                    );
                    assert.ok(matches.length <= 1, 'Ambiguous custom AI template');
                    if (!matches.length) {
                        const input = {
                            ...referralPosterCopy,
                            ...manifest.custom.copy,
                            expectedUpdatedAt: live.updatedAt,
                            name: manifest.custom.name,
                            enabled: false,
                            position: 100,
                            layoutVariant: 'STANDARD_CENTER',
                            posterBackgroundAssetId: assetId,
                            shareBackgroundAssetId: null,
                            foregroundColor: manifest.custom.foregroundColor,
                            accentColor: manifest.custom.accentColor,
                            overlayOpacity: 0,
                        };
                        try {
                            const result = await request(
                                `mutation PosterCreateAi($input:CreateReferralPosterTemplateInput!) {
                                createReferralPosterTemplate(input:$input) { ${posterFields} } }`,
                                { input },
                                channel,
                            );
                            state.createdCustom = result.data.createReferralPosterTemplate;
                        } catch (error) {
                            const recovered = (await request(stateQuery, {}, channel)).data.referralProgram;
                            const recoveredMatches = recovered.posterTemplateConfigs.filter(
                                item =>
                                    item.posterBackgroundAsset?.id === assetId &&
                                    !state.before.referralProgram.posterTemplateConfigs.some(
                                        before => before.id === item.id,
                                    ),
                            );
                            if (
                                recoveredMatches.length === 1 &&
                                copyFields.every(field => recoveredMatches[0][field] === input[field]) &&
                                !recoveredMatches[0].enabled
                            )
                                state.createdCustom = recoveredMatches[0];
                            throw error;
                        }
                    }
                }
            }
            if (apply || verify) await verifyState(state);
        }
    } catch (error) {
        const rollbackErrors = [];
        for (const state of [...states].reverse()) {
            if (!state.written.length && !state.createdCustom) continue;
            try {
                await restoreState(state);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        if (rollbackErrors.length)
            throw new AggregateError(
                [error, ...rollbackErrors],
                'Poster publish failed; some bindings need recovery from the backup',
            );
        throw new Error(
            apply
                ? 'Poster publish failed; confirmed content changes were restored'
                : 'Poster verification failed',
            { cause: error },
        );
    }
    return {
        applied: apply,
        verified: apply || verify,
        scope: scope || null,
        channelCodes: channels.map(channel => channel.code),
        results: states.flatMap(state =>
            state.selected.map(item => ({
                channelCode: state.channel.code,
                templateId: item.templateId || null,
                kind: item.templateId ? 'system' : 'custom-ai',
                key: item.key,
                hash: item.hash,
                assetId: state.media.results.find(value => value.key === item.key)?.assetId ?? null,
            })),
        ),
    };
}

export function parsePosterArguments(args) {
    const options = { apply: false, allowRemote: false, verify: false, validate: false };
    for (const arg of args) {
        if (arg === '--apply') options.apply = true;
        else if (arg === '--verify') options.verify = true;
        else if (arg === '--dry-run') {
            options.apply = false;
            options.verify = false;
        } else if (arg === '--allow-remote') options.allowRemote = true;
        else if (arg === '--validate') options.validate = true;
        else throw new Error(`Unknown argument: ${arg}; use environment variables for targets`);
    }
    assert.ok(!(options.apply && options.verify), '--apply and --verify are mutually exclusive');
    return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const options = parsePosterArguments(process.argv.slice(2));
    const result = options.validate
        ? {
              validated: true,
              assets: (await prepareReferralPosters()).map(({ key, hash }) => ({
                  key,
                  hash,
                  width: 1080,
                  height: 1920,
              })),
          }
        : await syncReferralPosters({
              apiOrigin: process.env.VENDURE_API_ORIGIN,
              username: process.env.SUPERADMIN_USERNAME,
              password: process.env.SUPERADMIN_PASSWORD,
              scope: process.env.REFERRAL_POSTER_SCOPE,
              channelCodes: parseChannelCodes(process.env.REFERRAL_POSTER_CHANNEL_CODES || ''),
              aiChannelCode: process.env.REFERRAL_POSTER_AI_CHANNEL_CODE,
              backupFile: process.env.REFERRAL_POSTER_BACKUP_FILE,
              ...options,
          });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
