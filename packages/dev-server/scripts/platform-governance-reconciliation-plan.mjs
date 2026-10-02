import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const digestGovernancePlan = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (type, id) => `${type}:${id}`;
const sorted = values => [...new Set(values.map(String))].sort((a, b) => Number(a) - Number(b));

/** Actual foreign keys establish usage. Names, labels and default-channel membership never establish ownership. */
export function buildGovernanceReconciliationPlan({ catalog, payment }) {
    assert.equal(catalog.schema, 'vendure-platform-catalog-data-plan-v2');
    const refs = catalog.referenceEvidence;
    const required = [
        'variantProducts',
        'assetKinds',
        'productGroups',
        'optionGroups',
        'variantOptions',
        'valueFacets',
        'productFacets',
        'variantFacets',
        'productAssets',
        'variantAssets',
        'productFeaturedAssets',
        'variantFeaturedAssets',
        'collectionFeaturedAssets',
        'assetTags',
        'profileAssets',
        'blockAssets',
        'itemAssets',
        'collectionFacetIds',
        'collectionFilterDigests',
    ];
    assert.ok(
        required.every(name => Array.isArray(refs[name])),
        'REFERENCE_EVIDENCE_MISSING',
    );
    const resources = new Map(catalog.resources.map(row => [key(row.resourceType, row.resourceId), row]));
    const owners = new Map();
    const blockers = [];
    const add = (type, id, channels) => {
        if (id == null) return;
        const identity = key(type, id);
        const row = resources.get(identity);
        if (!row) {
            blockers.push({ code: 'REFERENCE_RESOURCE_MISSING', identity });
            return;
        }
        const native = row.channelIds.filter(channelId => channelId !== catalog.defaultChannelId);
        // Historical import parents can omit a store even when their actual child values belong to it.
        // Copy that already-shared parent into the child's private store; never grant the source parent.
        const sharedFacetParent = type === 'Facet' && native.length > 1 && !row.proposedOwnerChannelId;
        for (const channel of channels) {
            if (String(channel) === catalog.defaultChannelId) continue;
            if (type !== 'Tag' && !native.includes(String(channel)) && !sharedFacetParent) {
                blockers.push({
                    code: 'REFERENCE_OUTSIDE_NATIVE_SCOPE',
                    identity,
                    channelId: String(channel),
                });
                continue;
            }
            const current = owners.get(identity) ?? new Set();
            current.add(String(channel));
            owners.set(identity, current);
        }
    };
    for (const row of resources.values())
        if (row.proposedOwnerChannelId) add(row.resourceType, row.resourceId, [row.proposedOwnerChannelId]);
    const get = (type, id) => [...(owners.get(key(type, id)) ?? [])];
    const productOwners = id => get('Product', id);
    const variantProducts = new Map(refs.variantProducts.map(row => [String(row.id), String(row.productId)]));
    const variantOwners = id => productOwners(variantProducts.get(String(id)));
    const optionGroups = new Map(refs.optionGroups.map(row => [String(row.id), String(row.groupId)]));
    for (const row of refs.productGroups)
        add('ProductOptionGroup', row.productOptionGroupId, productOwners(row.productId));
    for (const row of refs.variantOptions)
        add(
            'ProductOptionGroup',
            optionGroups.get(String(row.productOptionId)),
            variantOwners(row.productVariantId),
        );
    for (const row of refs.optionGroups) add('ProductOption', row.id, get('ProductOptionGroup', row.groupId));
    for (const row of refs.productFacets) add('FacetValue', row.facetValueId, productOwners(row.productId));
    for (const row of refs.variantFacets)
        add('FacetValue', row.facetValueId, variantOwners(row.productVariantId));
    for (const row of refs.collectionFacetIds)
        add('FacetValue', row.facetValueId, get('Collection', row.collectionId));
    for (const row of refs.valueFacets) add('Facet', row.facetId, get('FacetValue', row.id));
    for (const row of refs.productAssets) add('Asset', row.assetId, productOwners(row.productId));
    for (const row of refs.variantAssets) add('Asset', row.assetId, variantOwners(row.productVariantId));
    for (const row of refs.productFeaturedAssets) add('Asset', row.featuredAssetId, productOwners(row.id));
    for (const row of refs.variantFeaturedAssets) add('Asset', row.featuredAssetId, variantOwners(row.id));
    for (const row of refs.collectionFeaturedAssets)
        add('Asset', row.featuredAssetId, get('Collection', row.id));
    for (const row of refs.profileAssets)
        for (const field of ['logoAssetId', 'logoOnLightAssetId', 'logoOnDarkAssetId'])
            add('Asset', row[field], [String(row.channelId)]);
    for (const row of refs.blockAssets) add('Asset', row.imageAssetId, [String(row.channelId)]);
    const blockOwners = new Map(refs.blockAssets.map(row => [String(row.id), String(row.channelId)]));
    for (const row of refs.itemAssets)
        if (row.imageAssetId != null) {
            const channel = blockOwners.get(String(row.blockId));
            if (channel) add('Asset', row.imageAssetId, [channel]);
            else blockers.push({ code: 'CONTENT_PARENT_MISSING', id: String(row.id) });
        }
    for (const row of refs.assetTags) add('Tag', row.tagId, get('Asset', row.assetId));
    const assetKinds = new Map(refs.assetKinds.map(row => [String(row.id), row.type]));
    const operations = [];
    const held = [];
    const rank = {
        Product: 0,
        Collection: 1,
        ProductOptionGroup: 2,
        ProductOption: 3,
        Facet: 4,
        FacetValue: 5,
        Asset: 6,
        Tag: 7,
    };
    for (const row of [...resources.values()].sort(
        (a, b) => rank[a.resourceType] - rank[b.resourceType] || Number(a.resourceId) - Number(b.resourceId),
    )) {
        const targets = sorted(get(row.resourceType, row.resourceId));
        const registered = row.evidence === 'REGISTERED_RESOURCE_OWNERSHIP';
        if (registered) {
            if (targets.some(id => id !== String(row.proposedOwnerChannelId)))
                blockers.push({
                    code: 'REGISTERED_OWNER_CONFLICT',
                    identity: key(row.resourceType, row.resourceId),
                });
            continue;
        }
        if (targets.length === 0) {
            held.push({
                resourceType: row.resourceType,
                resourceId: row.resourceId,
                reason: 'NO_EXCLUSIVE_OWNER_OR_ACTUAL_USAGE_EVIDENCE',
            });
            continue;
        }
        if (
            targets.length > 1 &&
            (['Product', 'Collection'].includes(row.resourceType) ||
                (row.resourceType === 'Asset' && assetKinds.get(row.resourceId) !== 'IMAGE'))
        ) {
            blockers.push({
                code: 'PRIVATE_DELIVERY_OR_CANONICAL_OWNER_REVIEW',
                identity: key(row.resourceType, row.resourceId),
                targets,
            });
            continue;
        }
        operations.push({
            resourceType: row.resourceType,
            resourceId: row.resourceId,
            channelIds: row.channelIds,
            kind: targets.length === 1 ? 'REGISTER_OWNER' : 'COPY_PRIVATE_METADATA_AND_REMAP',
            ...(row.resourceType === 'Facet' && targets.length > 1
                ? { codePolicy: 'APPEND_STORE_SUFFIX' }
                : {}),
            targets,
            evidence: row.proposedOwnerChannelId
                ? 'EXCLUSIVE_NATIVE_OPERATING_RELATION'
                : 'ACTUAL_RESOURCE_REFERENCES',
        });
    }
    const entries = payment.entries;
    const platform = payment.platformChannelId;
    const globalReferral = entries.filter(
        row => row.code === 'referral-balance' && row.channelIds.includes(platform),
    );
    assert.ok(globalReferral.length <= 1, 'DUPLICATE_PLATFORM_REFERRAL');
    const payments = [];
    const switches = [];
    for (const method of entries.filter(row => row.code === 'referral-balance')) {
        const source = globalReferral[0];
        if (
            !source ||
            typeof source.configurationEvidence !== 'object' ||
            typeof method.configurationEvidence !== 'object' ||
            source.configurationEvidence.handlerDigest !== method.configurationEvidence.handlerDigest ||
            source.configurationEvidence.checkerDigest !== method.configurationEvidence.checkerDigest
        ) {
            blockers.push({ code: 'PAYMENT_CONFIGURATION_CONFLICT', methodId: String(method.id) });
            continue;
        }
        for (const channel of method.channelIds.filter(id => id !== platform))
            switches.push({
                channelId: channel,
                paymentMethodId: String(source.id),
                enabled: Boolean(method.enabled),
                sourceMethodId: String(method.id),
            });
    }
    const usdt = entries.filter(row => row.code === 'usdt-trc20');
    if (usdt.length > 1) blockers.push({ code: 'MULTIPLE_USDT_CONFIGURATIONS' });
    else if (usdt.length === 1 && !usdt[0].channelIds.includes(platform)) {
        payments.push({
            kind: 'ADD_PLATFORM_LINK',
            methodId: String(usdt[0].id),
            evidence: usdt[0].configurationEvidence,
        });
        for (const channel of payment.operatingChannels)
            switches.push({
                channelId: String(channel.id),
                paymentMethodId: String(usdt[0].id),
                enabled: usdt[0].channelIds.includes(String(channel.id)) && Boolean(usdt[0].enabled),
                sourceMethodId: String(usdt[0].id),
            });
    }
    const legacyTests = entries.filter(
        row =>
            row.configurationEvidence?.handlerCode === 'controlled-test-payment-handler' &&
            row.code !== 'controlled-test-payment-platform',
    );
    const activeTests = legacyTests.filter(row => Boolean(row.enabled));
    const globalTest = entries.find(row => row.code === 'controlled-test-payment-platform');
    if (!globalTest && legacyTests.length) {
        if (activeTests.length !== 1)
            blockers.push({
                code: 'SELECT_PLATFORM_TEST_PAYMENT_POLICY',
                methodIds: activeTests.map(row => String(row.id)),
            });
        else {
            payments.push({
                kind: 'COPY_GLOBAL_TEST_POLICY',
                sourceMethodId: String(activeTests[0].id),
                code: 'controlled-test-payment-platform',
                evidence: activeTests[0].configurationEvidence,
            });
            for (const method of legacyTests) {
                payments.push({
                    kind: 'REMOVE_LEGACY_PLATFORM_LINK',
                    methodId: String(method.id),
                    evidence: method.configurationEvidence,
                });
                for (const channel of method.channelIds.filter(id => id !== platform))
                    switches.push({
                        channelId: channel,
                        paymentMethodId: 'NEW_PLATFORM_TEST_METHOD',
                        enabled: Boolean(method.enabled),
                        sourceMethodId: String(method.id),
                    });
            }
        }
    }
    const plan = {
        schema: 'vendure-platform-governance-reconciliation-v1',
        platformChannelId: platform,
        resources: operations,
        held,
        paymentOperations: payments,
        paymentSwitches: switches,
        blockers,
        referencesDigest: digestGovernancePlan(refs),
        paymentEvidenceDigest: digestGovernancePlan(entries),
        safeguards: [
            'NO_PRODUCT_SALES_GRANTS',
            'NO_CARD_POOL_OR_DELIVERY_RESOURCE_COPY',
            'NO_ORDER_PAYMENT_HISTORY_CHANGES',
            'NO_ORIGINAL_RESOURCE_DELETION',
            'HOLD_UNRESOLVED_RESOURCES',
            'EXACT_PLAN_APPROVAL_AND_BACKUP_REQUIRED',
        ],
    };
    return { ...plan, planSha256: digestGovernancePlan(plan) };
}
