import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGovernanceReconciliationPlan } from './platform-governance-reconciliation-plan.mjs';

export function fixture() {
    const rows = [
        ['Product', 10, [2]],
        ['Product', 20, [5]],
        ['Collection', 70, [2]],
        ['ProductOptionGroup', 30, [2, 5]],
        ['ProductOption', 31, [2, 5]],
        ['Facet', 40, [2, 5]],
        ['FacetValue', 41, [2, 5]],
        ['FacetValue', 42, [2, 5]],
        ['Asset', 50, [2, 5]],
        ['Tag', 60, []],
        ['Tag', 61, []],
    ];
    const resource = (type, id, channels) => ({
        resourceType: type,
        resourceId: String(id),
        channelIds: ['1', ...channels.map(String)],
        proposedOwnerChannelId: channels.length === 1 ? String(channels[0]) : null,
        evidence: channels.length === 1 ? 'EXCLUSIVE_NATIVE_OPERATING_RELATION' : 'REVIEW_REQUIRED',
    });
    const evidence = (id, handler = 'referral-balance-payment', digest = 'a'.repeat(64)) => ({
        id,
        handlerCode: handler,
        handlerDigest: digest,
        checkerDigest: 'b'.repeat(64),
    });
    const method = (id, code, enabled, channels, config = evidence(id)) => ({
        id,
        code,
        enabled,
        channelIds: channels.map(String),
        configurationEvidence: config,
    });
    return {
        catalog: {
            schema: 'vendure-platform-catalog-data-plan-v2',
            defaultChannelId: '1',
            resources: rows.map(row => resource(...row)),
            referenceEvidence: {
                variantProducts: [
                    { id: 11, productId: 10, deletedAt: null },
                    { id: 21, productId: 20, deletedAt: null },
                ],
                assetKinds: [{ id: 50, type: 'IMAGE', mimeType: 'image/png' }],
                productGroups: [
                    { productId: 10, productOptionGroupId: 30 },
                    { productId: 20, productOptionGroupId: 30 },
                ],
                optionGroups: [{ id: 31, groupId: 30 }],
                variantOptions: [
                    { productVariantId: 11, productOptionId: 31 },
                    { productVariantId: 21, productOptionId: 31 },
                ],
                valueFacets: [
                    { id: 41, facetId: 40 },
                    { id: 42, facetId: 40 },
                ],
                productFacets: [
                    { productId: 10, facetValueId: 41 },
                    { productId: 20, facetValueId: 42 },
                ],
                variantFacets: [],
                productAssets: [],
                variantAssets: [],
                productFeaturedAssets: [
                    { id: 10, featuredAssetId: 50 },
                    { id: 20, featuredAssetId: 50 },
                ],
                variantFeaturedAssets: [],
                collectionFeaturedAssets: [],
                assetTags: [{ assetId: 50, tagId: 60 }],
                profileAssets: [],
                blockAssets: [],
                itemAssets: [],
                collectionFacetIds: [{ collectionId: 70, facetValueId: 42 }],
                collectionFilterDigests: [{ id: 70, filtersDigest: 'c'.repeat(64) }],
            },
        },
        payment: {
            platformChannelId: '1',
            operatingChannels: [
                { id: 2, code: 'a' },
                { id: 5, code: 'b' },
                { id: 8, code: 'c' },
            ],
            switches: [],
            entries: [
                method(1, 'referral-balance', 1, [2]),
                method(4, 'referral-balance', 1, [1]),
                method(7, 'referral-balance', 1, [5]),
                method(9, 'referral-balance', 1, [8]),
                method(2, 'usdt-trc20', 1, [], evidence(2, 'usdt-trc20-chain-handler')),
                method(
                    3,
                    'controlled-test-payment-2',
                    0,
                    [1, 2],
                    evidence(3, 'controlled-test-payment-handler', 'c'.repeat(64)),
                ),
                method(
                    8,
                    'controlled-test-payment-5',
                    0,
                    [1, 5],
                    evidence(8, 'controlled-test-payment-handler', 'd'.repeat(64)),
                ),
                method(
                    10,
                    'controlled-test-payment-8',
                    1,
                    [1, 8],
                    evidence(10, 'controlled-test-payment-handler', 'e'.repeat(64)),
                ),
            ],
        },
    };
}
test('derives private copies from actual product and collection references while holding unattached tags', () => {
    const plan = buildGovernanceReconciliationPlan(fixture());
    assert.deepEqual(plan.blockers, []);
    assert.equal(
        plan.resources.find(row => row.resourceType === 'ProductOptionGroup').kind,
        'COPY_PRIVATE_METADATA_AND_REMAP',
    );
    assert.deepEqual(plan.resources.find(row => row.resourceType === 'Asset').targets, ['2', '5']);
    assert.deepEqual(
        plan.resources.find(row => row.resourceType === 'FacetValue' && row.resourceId === '41').targets,
        ['2'],
    );
    assert.deepEqual(
        plan.resources.find(row => row.resourceType === 'FacetValue' && row.resourceId === '42').targets,
        ['2', '5'],
    );
    assert.ok(plan.held.some(row => row.resourceType === 'Tag' && row.resourceId === '61'));
    assert.ok(plan.safeguards.includes('NO_PRODUCT_SALES_GRANTS'));
});
test('preserves existing store payment intent and selects the single active QA policy without exposing arguments', () => {
    const plan = buildGovernanceReconciliationPlan(fixture());
    assert.equal(
        plan.paymentOperations.find(row => row.kind === 'COPY_GLOBAL_TEST_POLICY').sourceMethodId,
        '10',
    );
    assert.deepEqual(
        plan.paymentSwitches
            .filter(row => row.paymentMethodId === 'NEW_PLATFORM_TEST_METHOD')
            .map(row => [row.channelId, row.enabled]),
        [
            ['2', false],
            ['5', false],
            ['8', true],
        ],
    );
    assert.ok(plan.paymentSwitches.filter(row => row.paymentMethodId === '4').every(row => row.enabled));
    assert.ok(plan.paymentSwitches.filter(row => row.paymentMethodId === '2').every(row => !row.enabled));
    assert.ok(!JSON.stringify(plan).includes('arguments'));
});
test('blocks ambiguous payment policies, mismatched credentials and private file copying', () => {
    const source = fixture();
    source.payment.entries.find(row => row.id === 3).enabled = 1;
    assert.ok(
        buildGovernanceReconciliationPlan(source).blockers.some(
            row => row.code === 'SELECT_PLATFORM_TEST_PAYMENT_POLICY',
        ),
    );
    const source2 = fixture();
    source2.payment.entries[0].configurationEvidence.handlerDigest = 'f'.repeat(64);
    assert.ok(
        buildGovernanceReconciliationPlan(source2).blockers.some(
            row => row.code === 'PAYMENT_CONFIGURATION_CONFLICT',
        ),
    );
    const source3 = fixture();
    source3.catalog.referenceEvidence.assetKinds[0].type = 'BINARY';
    assert.ok(
        buildGovernanceReconciliationPlan(source3).blockers.some(
            row => row.code === 'PRIVATE_DELIVERY_OR_CANONICAL_OWNER_REVIEW',
        ),
    );
});
test('binds every relationship to the approved manifest and rejects missing evidence and foreign native scope', () => {
    const source = fixture();
    const before = buildGovernanceReconciliationPlan(source).planSha256;
    source.catalog.referenceEvidence.variantOptions.pop();
    assert.notEqual(buildGovernanceReconciliationPlan(source).planSha256, before);
    source.catalog.referenceEvidence.assetKinds = null;
    assert.throws(() => buildGovernanceReconciliationPlan(source), /REFERENCE_EVIDENCE_MISSING/);
    const scope = fixture();
    scope.catalog.resources.find(row => row.resourceType === 'Asset').channelIds = ['1', '2'];
    assert.ok(
        buildGovernanceReconciliationPlan(scope).blockers.some(
            row => row.code === 'REFERENCE_OUTSIDE_NATIVE_SCOPE',
        ),
    );
});
test('copies a historically shared facet parent for its store-owned child without granting the source parent', () => {
    const source = fixture();
    source.catalog.resources.push({
        resourceType: 'FacetValue',
        resourceId: '43',
        channelIds: ['1', '8'],
        proposedOwnerChannelId: '8',
        evidence: 'EXCLUSIVE_NATIVE_OPERATING_RELATION',
    });
    source.catalog.referenceEvidence.valueFacets.push({ id: 43, facetId: 40 });
    const plan = buildGovernanceReconciliationPlan(source);
    assert.deepEqual(plan.blockers, []);
    const parent = plan.resources.find(row => row.resourceType === 'Facet');
    assert.deepEqual(parent.targets, ['2', '5', '8']);
    assert.equal(parent.codePolicy, 'APPEND_STORE_SUFFIX');
    assert.equal(parent.kind, 'COPY_PRIVATE_METADATA_AND_REMAP');
});
