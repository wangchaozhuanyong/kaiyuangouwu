import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// This fixed local reader has no authentication/session tables or mutation input.
const columns = {
    channel: ['id', 'code', 'token', 'customFieldsStorefrontnamezh', 'customFieldsStorefrontnameen'],
    store_profile: [
        'id',
        'channelId',
        'status',
        'isPublished',
        'descriptionZh',
        'descriptionEn',
        'taglineZh',
        'taglineEn',
        'brandBackgroundColor',
        'brandPrimaryColor',
        'brandAccentColor',
        'brandHighlightColor',
        'logoAssetId',
        'logoOnLightAssetId',
        'logoOnDarkAssetId',
    ],
    store_domain: ['channelId', 'domain', 'isPrimary', 'status'],
    storefront_content_settings: ['id', 'channelId', 'heroAutoplayIntervalSeconds'],
    storefront_content_block: [
        'id',
        'channelId',
        'createdAt',
        'code',
        'internalName',
        'type',
        'layoutVariant',
        'enabled',
        'position',
        'startsAt',
        'endsAt',
        'imageUrl',
        'imageAssetId',
        'backgroundColor',
        'textColor',
        'targetType',
        'targetValue',
        'settings',
    ],
    storefront_content_item: [
        'id',
        'blockId',
        'createdAt',
        'enabled',
        'position',
        'imageUrl',
        'imageAssetId',
        'targetType',
        'targetValue',
        'settings',
    ],
    storefront_content_block_translation: [
        'id',
        'baseId',
        'languageCode',
        'title',
        'subtitle',
        'body',
        'ctaLabel',
    ],
    storefront_content_item_translation: ['id', 'baseId', 'languageCode', 'label', 'description'],
    referral_program_config: ['id', 'channelId', 'defaultPosterTemplate', 'posterTemplates'],
    referral_poster_template: [
        'id',
        'channelId',
        'name',
        'enabled',
        'position',
        'posterBackgroundAssetId',
        'shareBackgroundAssetId',
    ],
    asset: ['id', 'mimeType', 'source', 'preview'],
};
const quote = name => '`' + name + '`';
const id = value => String(value);
const same = (left, right) => id(left) === id(right);
const json = value => (typeof value === 'string' ? JSON.parse(value) : value);
const normalized = row =>
    Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
    );
const order = (a, b) =>
    a.position - b.position ||
    String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) ||
    id(a.id).localeCompare(id(b.id), 'en', { numeric: true });

export async function readSavedStorefrontConfiguration(connection) {
    let active = false;
    let total = 0;
    const rows = {};
    const read = async (table, where = '', parameters = []) => {
        assert.ok(Object.hasOwn(columns, table));
        const fields = columns[table].map(quote).join(',');
        const ordering = quote(table === 'store_domain' ? 'channelId' : 'id');
        const statement = `SELECT /*+ MAX_EXECUTION_TIME(3000) */ ${fields} FROM ${quote(table)} ${where} ORDER BY ${ordering} LIMIT 10001`;
        const [data] = await connection.query(statement, parameters);
        assert.ok(
            data.length <= 10000 && (total += data.length) <= 50000,
            'Configuration read budget exceeded',
        );
        rows[table] = data.map(normalized);
        return rows[table];
    };
    try {
        await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        await connection.query('SET SESSION TRANSACTION READ ONLY');
        await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        active = true;
        const channels = await read('channel');
        const profiles = await read('store_profile');
        const domains = await read('store_domain');
        const operational = profiles.flatMap(profile => {
            const channel = channels.find(c => same(c.id, profile.channelId));
            assert.ok(channel, 'Storefront Channel is missing');
            const primary = domains.filter(
                d => same(d.channelId, profile.channelId) && Boolean(d.isPrimary) && d.status === 'ACTIVE',
            );
            assert.ok(primary.length <= 1, 'Primary storefront domain is ambiguous');
            // Same CLOSED/PREVIEW/LIVE predicate as StorefrontActivationService.
            const open =
                channel.code !== '__default_channel__' &&
                primary.length === 1 &&
                (profile.status === 'ACTIVE' || (profile.status === 'DRAFT' && Boolean(profile.isPublished)));
            if (!open) return [];
            const host = primary[0].domain;
            assert.ok(host && new URL('https://' + host).hostname === host, 'Invalid storefront domain');
            return [{ profile, channel, host }];
        });
        assert.ok(operational.length > 0, 'Production preflight cannot access any storefronts');
        const channelIds = operational.map(s => s.channel.id);
        const defaultChannel = channels.find(c => c.code === '__default_channel__');
        assert.ok(defaultChannel, 'Default Channel is missing');
        const scoped = (field, values) => ({
            where: `WHERE ${quote(field)} IN (${values.map(() => '?').join(',')})`,
            parameters: values,
        });
        const selected = async (table, field, values) => {
            if (!values.length) {
                rows[table] = [];
                return [];
            }
            const scope = scoped(field, values);
            return read(table, scope.where, scope.parameters);
        };
        const settings = await selected('storefront_content_settings', 'channelId', channelIds);
        const blocks = await selected('storefront_content_block', 'channelId', channelIds);
        const items = await selected(
            'storefront_content_item',
            'blockId',
            blocks.map(b => b.id),
        );
        await selected(
            'storefront_content_block_translation',
            'baseId',
            blocks.map(b => b.id),
        );
        await selected(
            'storefront_content_item_translation',
            'baseId',
            items.map(i => i.id),
        );
        await selected('referral_program_config', 'channelId', channelIds);
        const templates = await selected('referral_poster_template', 'channelId', [
            ...channelIds,
            defaultChannel.id,
        ]);
        const assetIds = [
            ...new Set(
                [
                    ...profiles.flatMap(p => [p.logoAssetId, p.logoOnLightAssetId, p.logoOnDarkAssetId]),
                    ...blocks.map(b => b.imageAssetId),
                    ...items.map(i => i.imageAssetId),
                    ...templates.flatMap(t => [t.posterBackgroundAssetId, t.shareBackgroundAssetId]),
                ]
                    .filter(v => v != null)
                    .map(id),
            ),
        ];
        const assets = await selected('asset', 'id', assetIds);
        const asset = value =>
            value == null
                ? null
                : (assets.find(a => same(a.id, value)) ?? assert.fail('Saved image binding is missing'));
        const image = row => ({
            ...row,
            enabled: Boolean(row.enabled),
            ...(Object.hasOwn(row, 'settings')
                ? { settings: row.settings == null ? null : json(row.settings) }
                : {}),
            imageAsset: asset(row.imageAssetId),
        });
        const result = operational.map(({ profile, channel, host }) => {
            const ownBlocks = blocks.filter(b => same(b.channelId, channel.id));
            const ownItems = items.filter(i => ownBlocks.some(b => same(b.id, i.blockId)));
            const ownTemplates = templates.filter(t => same(t.channelId, channel.id));
            const systemTemplates = templates.filter(t => same(t.channelId, defaultChannel.id));
            const program = rows.referral_program_config.find(p => same(p.channelId, channel.id));
            assert.ok(program, 'Saved referral configuration is missing');
            const setting = settings.find(s => same(s.channelId, channel.id));
            assert.ok(setting, 'Saved storefront settings are missing');
            const boundTemplates = list =>
                list.map(t => ({
                    ...t,
                    enabled: Boolean(t.enabled),
                    posterBackgroundAsset: asset(t.posterBackgroundAssetId),
                    shareBackgroundAsset: asset(t.shareBackgroundAssetId),
                }));
            // sourceRows also seal disabled/private configuration and system image bindings.
            // Channel/session tokens are deliberately absent from every saved snapshot.
            const sourceRows = {
                profile,
                channel: {
                    id: channel.id,
                    code: channel.code,
                    customFieldsStorefrontnamezh: channel.customFieldsStorefrontnamezh,
                    customFieldsStorefrontnameen: channel.customFieldsStorefrontnameen,
                },
                domains: domains.filter(d => same(d.channelId, channel.id)),
                settings: [setting],
                blocks: ownBlocks,
                items: ownItems,
                blockTranslations: rows.storefront_content_block_translation.filter(t =>
                    ownBlocks.some(b => same(t.baseId, b.id)),
                ),
                itemTranslations: rows.storefront_content_item_translation.filter(t =>
                    ownItems.some(i => same(t.baseId, i.id)),
                ),
                program,
                templates: [...ownTemplates, ...systemTemplates],
                assets,
            };
            return {
                channelId: id(channel.id),
                channelCode: channel.code,
                channelToken: channel.token,
                profile: {
                    ...profile,
                    id: id(profile.id),
                    isOperational: true,
                    primaryDomain: host,
                    channel: {
                        id: id(channel.id),
                        code: channel.code,
                        customFields: {
                            storefrontNameZh: channel.customFieldsStorefrontnamezh,
                            storefrontNameEn: channel.customFieldsStorefrontnameen,
                        },
                    },
                    logoAsset: asset(profile.logoAssetId),
                    logoOnLightAsset: asset(profile.logoOnLightAssetId),
                    logoOnDarkAsset: asset(profile.logoOnDarkAssetId),
                },
                blocks: ownBlocks
                    .filter(b => b.code !== 'storefront-visual-preset')
                    .sort(order)
                    .map(b => ({
                        ...image(b),
                        id: id(b.id),
                        translations: rows.storefront_content_block_translation.filter(t =>
                            same(t.baseId, b.id),
                        ),
                        items: ownItems
                            .filter(i => same(i.blockId, b.id))
                            .sort(order)
                            .map(i => ({
                                ...image(i),
                                id: id(i.id),
                                translations: rows.storefront_content_item_translation.filter(t =>
                                    same(t.baseId, i.id),
                                ),
                            })),
                    })),
                settings: {
                    heroAutoplayIntervalSeconds: setting.heroAutoplayIntervalSeconds,
                    configuredBlockTypes: [
                        ...new Set(
                            ownBlocks.filter(b => b.code !== 'storefront-visual-preset').map(b => b.type),
                        ),
                    ].sort(),
                },
                sharing: {
                    defaultPosterTemplate: program.defaultPosterTemplate,
                    posterTemplates: program.posterTemplates
                        ? String(program.posterTemplates).split(',')
                        : [],
                    posterTemplateConfigs: boundTemplates(ownTemplates),
                    systemPosterTemplateConfigs: boundTemplates(systemTemplates),
                },
                sourceRows,
            };
        });
        await connection.query('ROLLBACK');
        active = false;
        return result;
    } finally {
        if (active) await connection.query('ROLLBACK');
    }
}

export async function loadSavedStorefrontConfiguration(environment = process.env) {
    let connection;
    try {
        const require = createRequire('/var/www/kaiyuangouwu-current/packages/dev-server/package.json');
        const { createConnection } = require('mysql2/promise');
        connection = await createConnection({
            host: environment.DB_HOST,
            port: Number(environment.DB_PORT || 3306),
            user: environment.DB_USERNAME,
            password: environment.DB_PASSWORD,
            database: environment.DB_NAME,
        });
        return await readSavedStorefrontConfiguration(connection);
    } catch {
        throw new Error('STOREFRONT_CONFIGURATION_DATABASE_READ_FAILED');
    } finally {
        await connection?.end();
    }
}
