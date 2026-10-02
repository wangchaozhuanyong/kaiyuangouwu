import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStoreIsolationAdapter, safeReadOnlyAuditFailure } from './store-isolation-data-preflight.mjs';

// Fixed table whitelist. No customer, credential, card-payload or file-content reads.
const resources = {
    Product: ['product', 'product_channels_channel', 'productId'],
    Collection: ['collection', 'collection_channels_channel', 'collectionId'],
    ProductOptionGroup: [
        'product_option_group',
        'product_option_group_channels_channel',
        'productOptionGroupId',
    ],
    ProductOption: ['product_option', 'product_option_channels_channel', 'productOptionId'],
    Facet: ['facet', 'facet_channels_channel', 'facetId'],
    FacetValue: ['facet_value', 'facet_value_channels_channel', 'facetValueId'],
    Asset: ['asset', 'asset_channels_channel', 'assetId'],
    Tag: ['tag', null, null],
};
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function collectPlatformCatalogDataPlan(adapter, mapping = []) {
    if (
        !Array.isArray(mapping) ||
        mapping.some(
            m =>
                !resources[m.resourceType] ||
                !/^\d+$/.test(String(m.resourceId)) ||
                !/^\d+$/.test(String(m.ownerChannelId)) ||
                !String(m.evidence ?? '').trim(),
        )
    )
        throw new Error('MAPPING_REQUIRES_RESOURCE_ID_AND_EVIDENCE');
    const channels = await adapter.query('SELECT id, code FROM channel ORDER BY id');
    const defaultId = channels.find(c => c.code === '__default_channel__')?.id;
    if (defaultId == null) throw new Error('DEFAULT_CHANNEL_MISSING');
    const optional = async (table, columns) => {
        if (
            !(await adapter.tableExists(table)) ||
            (adapter.columnExists &&
                !(await Promise.all(columns.map(c => adapter.columnExists(table, c)))).every(Boolean))
        )
            return null;
        return adapter.query(`SELECT ${columns.map(c => `\`${c}\``).join(', ')} FROM \`${table}\``);
    };
    const ownership = await optional('catalog_resource_ownership', [
        'resourceType',
        'resourceId',
        'ownerChannelId',
        'scope',
    ]);
    const grants = await optional('product_sales_authorization', [
        'productId',
        'channelId',
        'sourceChannelId',
        'state',
        'variantIds',
    ]);
    const variants = await optional('product_variant', ['id', 'productId', 'deletedAt']);
    const variantChannels = await optional('product_variant_channels_channel', [
        'productVariantId',
        'channelId',
    ]);
    const prices = await optional('product_variant_price', [
        'id',
        'variantId',
        'channelId',
        'currencyCode',
        'price',
    ]);
    const cardConfigs = await optional('auto_card_config', [
        'id',
        'channelId',
        'productVariantId',
        'enabled',
    ]);
    const supply = await optional('auto_card_supply_grant', [
        'id',
        'channelId',
        'productVariantId',
        'sourceChannelId',
        'configId',
        'enabled',
    ]);
    const result = [];
    for (const [resourceType, [table, relation, column]] of Object.entries(resources)) {
        if (!(await adapter.tableExists(table)) || (relation && !(await adapter.tableExists(relation)))) {
            result.push({ resourceType, status: 'DATA_MISSING' });
            continue;
        }
        const rows = relation
            ? await adapter.query(
                  `SELECT r.id, c.channelId FROM \`${table}\` r LEFT JOIN \`${relation}\` c ON c.\`${column}\` = r.id ORDER BY r.id, c.channelId`,
              )
            : await adapter.query('SELECT id FROM tag ORDER BY id');
        const byId = new Map();
        for (const row of rows) {
            const entry = byId.get(String(row.id)) ?? {
                resourceType,
                resourceId: String(row.id),
                channelIds: [],
            };
            if (row.channelId != null) entry.channelIds.push(String(row.channelId));
            byId.set(entry.resourceId, entry);
        }
        for (const entry of byId.values()) {
            const operating = entry.channelIds.filter(id => id !== String(defaultId));
            const registered = ownership?.find(
                o => o.resourceType === resourceType && String(o.resourceId) === entry.resourceId,
            );
            const explicit = mapping.find(
                m => m.resourceType === resourceType && String(m.resourceId) === entry.resourceId,
            );
            if (
                explicit &&
                ((resourceType !== 'Tag' && !operating.includes(String(explicit.ownerChannelId))) ||
                    !channels.some(c => String(c.id) === String(explicit.ownerChannelId)) ||
                    String(explicit.ownerChannelId) === String(defaultId))
            )
                throw new Error('MAPPING_OWNER_NOT_IN_OPERATING_RELATIONS');
            if (
                registered &&
                explicit &&
                String(registered.ownerChannelId) !== String(explicit.ownerChannelId)
            )
                throw new Error('MAPPING_CONFLICTS_WITH_REGISTERED_OWNER');
            entry.proposedOwnerChannelId = registered
                ? String(registered.ownerChannelId)
                : explicit
                  ? String(explicit.ownerChannelId)
                  : operating.length === 1
                    ? operating[0]
                    : null;
            entry.evidence = registered
                ? 'REGISTERED_RESOURCE_OWNERSHIP'
                : explicit
                  ? String(explicit.evidence)
                  : operating.length === 1
                    ? 'EXCLUSIVE_NATIVE_OPERATING_RELATION'
                    : 'REVIEW_REQUIRED';
            entry.status = registered
                ? 'REGISTERED_OWNER_RELATION_REVIEW'
                : explicit
                  ? 'EXPLICIT_MAPPING_REVIEW'
                  : operating.length === 1
                    ? 'OWNER_CANDIDATE_REVIEW'
                    : 'SHARED_SPLIT_OR_OWNER_REVIEW';
            entry.registeredScope = registered?.scope ?? null;
            entry.proposedActions = [];
            if (entry.proposedOwnerChannelId && !registered)
                entry.proposedActions.push({
                    kind: 'REGISTER_OWNER',
                    scope: 'STORE',
                    ownerChannelId: entry.proposedOwnerChannelId,
                });
            const sales =
                resourceType === 'Product'
                    ? (grants ?? []).filter(
                          g => String(g.productId) === entry.resourceId && g.state !== 'REVOKED',
                      )
                    : [];
            entry.existingSalesAuthorizations = sales;
            const authorizedShared =
                registered &&
                resourceType === 'Product' &&
                operating.every(
                    id =>
                        id === String(registered.ownerChannelId) ||
                        sales.some(
                            g =>
                                String(g.channelId) === id &&
                                String(g.sourceChannelId) === String(registered.ownerChannelId),
                        ),
                );
            if (authorizedShared) entry.status = 'REGISTERED_AUTHORIZED_SALES';
            if (operating.length > 1 && !authorizedShared)
                entry.proposedActions.push({
                    kind: ['ProductOptionGroup', 'ProductOption', 'Facet', 'FacetValue'].includes(
                        resourceType,
                    )
                        ? 'COPY_AND_REMAP_PRIVATE_REFERENCES'
                        : 'REVIEW_SALES_AUTHORIZATION',
                    channelIds: operating,
                });
            // Default relation removal requires an explicit product mapping and verified delivery completeness.
            // This script intentionally does not infer card/file/manual delivery health from a product name.
            if (resourceType === 'Product' && entry.channelIds.includes(String(defaultId)))
                entry.defaultAssociationCleanup = {
                    status: 'BLOCKED_DELIVERY_AND_VARIANT_REVIEW',
                    preserveDefaultChannel: true,
                    preserveHistoricalOrders: true,
                    variants:
                        variants == null
                            ? 'DATA_MISSING'
                            : variants
                                  .filter(v => String(v.productId) === entry.resourceId && !v.deletedAt)
                                  .map(v => ({
                                      variantId: String(v.id),
                                      channelIds:
                                          variantChannels == null
                                              ? 'DATA_MISSING'
                                              : variantChannels
                                                    .filter(c => String(c.productVariantId) === String(v.id))
                                                    .map(c => String(c.channelId)),
                                      prices:
                                          prices == null
                                              ? 'DATA_MISSING'
                                              : prices
                                                    .filter(p => String(p.variantId) === String(v.id))
                                                    .map(p => ({
                                                        channelId: String(p.channelId),
                                                        currencyCode: p.currencyCode,
                                                        price: p.price,
                                                    })),
                                      originalCardConfigs:
                                          cardConfigs == null
                                              ? 'DATA_MISSING'
                                              : cardConfigs.filter(
                                                    c => String(c.productVariantId) === String(v.id),
                                                ),
                                      supplyGrants:
                                          supply == null
                                              ? 'DATA_MISSING'
                                              : supply.filter(
                                                    g => String(g.productVariantId) === String(v.id),
                                                ),
                                  })),
                    requiredEvidence: [
                        'CONFIRMED_OWNER_ID',
                        'COMPLETE_VARIANT_SCOPE',
                        'SELLING_STORE_PRICES',
                        'CARD_OR_OWN_FILE_OR_MANUAL_DELIVERY_VERIFIED',
                        'BACKUP_RECEIPT',
                        'EXACT_CLEANUP_MANIFEST_APPROVAL',
                    ],
                };
            result.push(entry);
        }
    }
    const unknown = mapping.filter(
        m => !result.some(r => r.resourceType === m.resourceType && r.resourceId === String(m.resourceId)),
    );
    if (unknown.length) throw new Error('MAPPING_RESOURCE_NOT_FOUND');
    const snapshotHash = digest({
        channels: channels.map(c => ({ id: String(c.id), isDefault: c.code === '__default_channel__' })),
        resources: result,
    });
    return {
        schema: 'vendure-platform-catalog-data-plan-v2',
        mode: 'READ_ONLY',
        productionApply: false,
        defaultChannelId: String(defaultId),
        snapshotHash,
        resources: result,
        safeguards: [
            'NO_AUTOMATIC_CROSS_STORE_GRANTS',
            'NO_CHANNEL_DELETION',
            'NO_HISTORY_DELETION',
            'BACKUP_AND_EXACT_MANIFEST_APPROVAL_REQUIRED',
        ],
        validation: {
            ownershipMapping: digest(mapping),
            governanceMetadata: {
                ownership: ownership == null ? 'DATA_MISSING' : 'READ',
                sales: grants == null ? 'DATA_MISSING' : 'READ',
            },
            dataMissing: result.filter(r => r.status === 'DATA_MISSING').map(r => r.resourceType),
        },
    };
}
async function main() {
    const args = process.argv.slice(2);
    const get = key => args[args.indexOf(key) + 1];
    if (!args.includes('--output')) throw new Error('PROJECT_OUTPUT_PATH_REQUIRED');
    const project = await realpath(fileURLToPath(new URL('../../../', import.meta.url)));
    const output = path.resolve(get('--output'));
    const parent = await realpath(path.dirname(output));
    if (!parent.startsWith(project + path.sep)) throw new Error('OUTPUT_OUTSIDE_PROJECT');
    const mapping = args.includes('--mapping-file')
        ? JSON.parse(await readFile(get('--mapping-file'), 'utf8'))
        : [];
    const adapter = await createStoreIsolationAdapter(process.env);
    try {
        const plan = await collectPlatformCatalogDataPlan(adapter, mapping);
        await writeFile(output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        process.stdout.write('READ_ONLY_PLAN_SAVED\n');
    } finally {
        await adapter.close();
    }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(e => {
        process.stderr.write(`${safeReadOnlyAuditFailure(e)}\n`);
        process.exitCode = 1;
    });
