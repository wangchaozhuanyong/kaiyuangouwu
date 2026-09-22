import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assertMoveTargetAvailable,
    migrationDigest,
    publicMigrationPlan,
} from './moyao-default-store-migration.mjs';

function fixture() {
    return {
        sourceChannelId: '1',
        targetChannelId: '3',
        sourceSellerId: '2',
        targetSellerId: '5',
        sourceSellerOtherChannelIds: [],
        targetSellerOtherChannelIds: [],
        sellerSeparationAction: 'SWAP_EXISTING_SELLERS',
        missingTargetRoleIds: ['71', '72'],
        sourceProfileVersion: '2026-09-20T00:00:00.000Z',
        targetProfileVersion: '2026-09-20T01:00:00.000Z',
        profileDigest: 'a'.repeat(64),
        targetProfileDigest: 'b'.repeat(64),
        relationEntityIds: {
            customer_channels_channel: ['21', '22'],
            product_channels_channel: ['31'],
        },
        sourceRelationEntityIds: {
            customer_channels_channel: ['21', '22'],
            product_channels_channel: ['31', '32'],
        },
        crossStoreRelationEntityIds: {
            customer_channels_channel: [],
            product_channels_channel: [],
        },
        copiedEntityIds: { customer_store_entry: ['21'] },
        sourceCustomerStoreEntryIds: ['21', '22'],
        movedRows: {
            storefront_content_block: ['10', '11'],
            storefront_promotion_page: ['41'],
        },
        existingTargetRowCounts: {
            storefront_content_block: 0,
            storefront_promotion_page: 0,
        },
        orderSalesOwnerIds: ['51'],
        sourceOrderMembershipIds: ['51', '52'],
        sourceHeroAutoplayIntervalSeconds: 5,
        targetHeroAutoplayIntervalSeconds: 6,
    };
}

void test('review digest is stable across object key order', () => {
    const details = fixture();
    const reordered = {
        ...details,
        relationEntityIds: {
            product_channels_channel: ['31'],
            customer_channels_channel: ['21', '22'],
        },
    };
    assert.equal(migrationDigest(details), migrationDigest(reordered));
});

void test('public migration plan exposes aggregates but no database identifiers', () => {
    const details = fixture();
    const plan = publicMigrationPlan(details);
    assert.equal(plan.contentBlockCount, 2);
    assert.deepEqual(plan.addedRelations, {
        customer_channels_channel: 2,
        product_channels_channel: 1,
    });
    assert.deepEqual(plan.removedDefaultRelations, {
        customer_channels_channel: 2,
        product_channels_channel: 2,
    });
    assert.deepEqual(plan.crossStoreRelationConflicts, {
        customer_channels_channel: 0,
        product_channels_channel: 0,
    });
    assert.deepEqual(plan.copiedChannelRows, { customer_store_entry: 1 });
    assert.equal(plan.removedDefaultCustomerStoreEntries, 2);
    assert.equal(plan.removedDefaultOrderMemberships, 2);
    assert.deepEqual(plan.movedChannelRows, {
        storefront_content_block: 2,
        storefront_promotion_page: 1,
    });
    assert.equal(plan.orderSalesOwnerCount, 1);
    assert.equal(plan.profileWillChange, true);
    assert.equal(plan.contentSettingsWillChange, true);
    assert.equal(plan.sellerWillChange, true);
    assert.equal(plan.sellerSeparationAction, 'SWAP_EXISTING_SELLERS');
    assert.equal(plan.sellerIsolationConflictCount, 0);
    assert.equal(plan.addedRequiredRoleAssignments, 2);
    assert.match(plan.operationDigest, /^[a-f0-9]{64}$/u);
    const output = JSON.stringify(plan);
    for (const privateId of ['10', '11', '21', '22', '31', '32', '41', '51', '52', '71', '72'])
        assert.equal(output.includes(`\"${privateId}\"`), false);
});

void test('public plan supports a completed data move with a pending Seller repair', () => {
    const details = fixture();
    details.movedRows.storefront_content_block = [];
    details.movedRows.storefront_promotion_page = [];
    details.existingTargetRowCounts.storefront_content_block = 2;
    details.existingTargetRowCounts.storefront_promotion_page = 1;
    const plan = publicMigrationPlan(details);
    assert.equal(plan.contentBlockCount, 2);
    assert.equal(plan.movedChannelRows.storefront_content_block, 0);
    assert.equal(plan.sellerWillChange, true);
});

void test('completed Seller separation is idempotent', () => {
    const details = fixture();
    details.sellerSeparationAction = 'NONE';
    const plan = publicMigrationPlan(details);
    assert.equal(plan.sellerWillChange, false);
    assert.equal(plan.sellerSeparationAction, 'NONE');
});

void test('target-only state does not block unrelated migration rows', () => {
    assert.doesNotThrow(() => assertMoveTargetAvailable('safe_table', [], ['target-only']));
    assert.doesNotThrow(() => assertMoveTargetAvailable('safe_table', ['source'], []));
    assert.throws(
        () => assertMoveTargetAvailable('conflicting_table', ['source'], ['target']),
        /conflicting_table already contains target Channel data/u,
    );
});
