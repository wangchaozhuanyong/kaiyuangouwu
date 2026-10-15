import { getOperationAST, parse } from 'graphql';
import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
    parseDigitalInventoryBatchArguments,
    runDigitalInventoryMigrationBatch,
} from './digital-inventory-migration-batch.mjs';

function fixture(options = {}) {
    const channel = { id: 'T_2', code: 'current-store' };
    const state = {
        active: Boolean(options.active),
        available: 7,
        reserved: 2,
        previewCount: 0,
        operations: [],
        writes: [],
    };
    const request = async (query, variables) => {
        const operation = getOperationAST(parse(query));
        state.operations.push(operation.name.value);
        assert.equal(query.includes('ownershipConfirmation'), false);
        if (operation.name.value === 'DigitalInventoryReviewWorkspace')
            return {
                activeChannel: channel,
                digitalProductWorkspace: {
                    productId: 'T_3',
                    variants: [{ id: 'T_4', sku: 'SKU', migrationRequired: !state.active }],
                },
            };
        if (
            operation.name.value === 'DigitalInventoryReviewPreview' ||
            operation.name.value === 'DigitalInventoryBatchPreview'
        ) {
            state.previewCount++;
            const preview = {
                productVariantId: 'T_4',
                availableQuantity: state.available,
                reservedQuantity: state.reserved,
                alreadyMigrated: state.active,
                conflicts: [],
                confirmableStockLevels: [],
            };
            if (operation.name.value === 'DigitalInventoryBatchPreview') options.onFresh?.(preview);
            return {
                activeChannel:
                    options.switchStore && operation.name.value === 'DigitalInventoryBatchPreview'
                        ? { id: 'other', code: 'other' }
                        : channel,
                digitalInventoryMigrationPreview: preview,
            };
        }
        if (operation.name.value === 'DigitalInventoryBatchMigrate') {
            assert.equal(operation.operation, 'mutation');
            state.writes.push(variables);
            if (options.rejectWrite) throw new Error('synthetic write rejected');
            state.active = true;
            state.available = variables.expectedAvailable;
            state.reserved = variables.expectedReserved;
            if (options.lostResponse) throw new Error('synthetic lost acknowledgment');
            return {
                migrateDigitalInventory: {
                    id: 'config',
                    productVariantId: 'T_4',
                    stockPolicy: 'limited',
                    availableQuantity: state.available,
                },
            };
        }
        if (operation.name.value === 'DigitalInventoryBatchReadback') {
            if (options.failReadback) throw new Error('synthetic read unavailable');
            return {
                activeChannel: channel,
                digitalProductWorkspace: {
                    productId: 'T_3',
                    variants: [
                        {
                            id: 'T_4',
                            migrationRequired: !state.active,
                            stockPolicy: 'limited',
                            availableQuantity: state.available,
                            inventory: {
                                source: state.active ? 'LIMITED_QUOTA' : 'LEGACY_UNMIGRATED',
                                availableQuantity: options.changedAfterWrite ? 6 : state.available,
                                reservedQuantity: state.reserved,
                                consumedQuantity: 0,
                                observedAt: 'now',
                            },
                        },
                    ],
                },
            };
        }
        throw new Error('Unexpected operation');
    };
    const run = (execute = false) =>
        runDigitalInventoryMigrationBatch({ request, channelId: channel.id, productIds: ['T_3'], execute });
    return { state, run };
}

test('CLI requires an explicit channel and product list and only --execute enables writes', () => {
    assert.throws(() => parseDigitalInventoryBatchArguments([]), /EXPLICIT_CHANNEL/);
    assert.throws(() => parseDigitalInventoryBatchArguments(['--channel', 'T_2']), /EXPLICIT_CHANNEL/);
    assert.throws(
        () => parseDigitalInventoryBatchArguments(['--channel', 'T_2', '--product']),
        /ARGUMENT_VALUE_MISSING/,
    );
    assert.throws(
        () =>
            parseDigitalInventoryBatchArguments([
                '--channel',
                'T_2',
                '--product',
                'T_3',
                '--token',
                'secret',
            ]),
        /UNKNOWN_ARGUMENT/,
    );
    assert.equal(
        parseDigitalInventoryBatchArguments(['--channel', 'T_2', '--product', 'T_3']).execute,
        false,
    );
    assert.deepEqual(
        parseDigitalInventoryBatchArguments([
            '--channel',
            'T_2',
            '--product',
            'T_3',
            '--product',
            'T_4',
            '--execute',
        ]).productIds,
        ['T_3', 'T_4'],
    );
});

test('default mode only reviews and retains READY without any mutation', async () => {
    const scenario = fixture();
    const report = await scenario.run();
    assert.equal(report.mode, 'DRY_RUN');
    assert.equal(report.records[0].status, 'READY_FOR_MIGRATION');
    assert.equal(scenario.state.writes.length, 0);
    assert.equal(scenario.state.previewCount, 1);
});

test('execution obtains a fresh preview and submits its latest quantities through the existing mutation', async () => {
    const scenario = fixture({
        onFresh: preview => {
            preview.availableQuantity = 6;
        },
    });
    const report = await scenario.run(true);
    assert.equal(report.records[0].status, 'MIGRATED');
    assert.equal(report.records[0].verified, true);
    assert.deepEqual(report.summary, { MIGRATED: 1 });
    assert.equal(report.attentionRequired, false);
    assert.deepEqual(scenario.state.writes, [
        { productVariantId: 'T_4', expectedAvailable: 6, expectedReserved: 2 },
    ]);
    assert.equal(scenario.state.previewCount, 2);
});

test.each([
    [
        'conflicts',
        preview => {
            preview.conflicts = ['该商品有结算或修改中的订单，请先确认付款与占用结果'];
        },
        'DEFERRED',
    ],
    [
        'unconfirmed ownership rows',
        preview => {
            preview.confirmableStockLevels = [{ id: 'unowned' }];
        },
        'NEEDS_REVIEW',
    ],
])('blocks fresh %s without claiming ownership or attempting writes', async (_name, onFresh, expected) => {
    const scenario = fixture({ onFresh });
    const report = await scenario.run(true);
    assert.equal(report.records[0].status, expected);
    assert.equal(report.attentionRequired, true);
    assert.equal(scenario.state.writes.length, 0);
});

test('already active configurations are skipped without preview or write', async () => {
    const scenario = fixture({ active: true });
    const report = await scenario.run(true);
    assert.equal(report.records[0].status, 'ACTIVE');
    assert.equal(scenario.state.previewCount, 0);
    assert.equal(scenario.state.writes.length, 0);
});

test('reconciles a lost successful response and rerunning never repeats the migration', async () => {
    const scenario = fixture({ lostResponse: true });
    const report = await scenario.run(true);
    assert.equal(report.records[0].status, 'ACTIVE_AFTER_RECONCILIATION');
    assert.equal(report.records[0].writeAcknowledged, false);
    assert.equal(report.records[0].verified, true);
    const repeated = await scenario.run(true);
    assert.equal(repeated.records[0].status, 'ACTIVE');
    assert.equal(scenario.state.writes.length, 1);
});

test('rejects a changed store or malformed fresh quantity before writing', async () => {
    for (const options of [
        { switchStore: true },
        {
            onFresh: preview => {
                preview.reservedQuantity = -1;
            },
        },
    ]) {
        const scenario = fixture(options);
        const report = await scenario.run(true);
        assert.equal(report.status, 'PARTIAL');
        assert.equal(report.records[0].status, 'READ_FAILED');
        assert.equal(scenario.state.writes.length, 0);
    }
});

test('a rejected transaction remains unconfirmed and is never blindly retried', async () => {
    const scenario = fixture({ rejectWrite: true });
    const report = await scenario.run(true);
    assert.equal(report.status, 'PARTIAL');
    assert.equal(report.records[0].status, 'EXECUTION_UNCONFIRMED');
    assert.equal(scenario.state.writes.length, 1);
});

test.each([{ failReadback: true }, { changedAfterWrite: true }])(
    'records a committed write requiring verification for %j',
    async options => {
        const scenario = fixture(options);
        const report = await scenario.run(true);
        assert.equal(report.status, 'PARTIAL');
        assert.equal(report.records[0].status, 'MIGRATED_REVIEW_REQUIRED');
        assert.equal(report.records[0].writeAcknowledged, true);
        assert.equal(report.records[0].verified, false);
        assert.equal(scenario.state.writes.length, 1);
    },
);

test('without a current read session execution reports DATA_MISSING and performs nothing', async () => {
    const report = await runDigitalInventoryMigrationBatch({
        channelId: 'T_2',
        productIds: ['T_3'],
        execute: true,
    });
    assert.equal(report.status, 'DATA_MISSING');
    assert.deepEqual(report.records, []);
});
