import { getOperationAST, OperationTypeNode, parse } from 'graphql';
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { generateDigitalInventoryMigrationReview } from './digital-inventory-review.mjs';

const channel = { id: 'store-a', code: 'merchant' };
const preview = (id, conflicts = []) => ({
    productVariantId: id,
    availableQuantity: 100,
    reservedQuantity: 2,
    conflicts,
    alreadyMigrated: false,
    confirmableStockLevels: [],
});

test('without an authorized read session the report is explicitly data missing', async () => {
    assert.deepEqual(
        await generateDigitalInventoryMigrationReview({
            channelId: 'store-a',
            productIds: ['1'],
            observedAt: 'now',
        }),
        {
            channelId: 'store-a',
            observedAt: 'now',
            status: 'DATA_MISSING',
            reason: 'READ_CREDENTIALS_MISSING',
            records: [],
        },
    );
});

test('classifies exact existing preview conflicts and only ever issues queries without ownership confirmation', async () => {
    const operations = [];
    const previews = [
        preview('ready'),
        preview('owner', ['旧库存或未完成订单缺少店铺归属，请先核对，不能自动迁移']),
        preview('deferred', ['该商品有结算或修改中的订单，请先确认付款与占用结果']),
        preview('mixed', [
            '该商品有结算或修改中的订单，请先确认付款与占用结果',
            '仓库共享归属或未完成订单占用数量不一致，需要核对后迁移',
        ]),
        { ...preview('raced'), alreadyMigrated: true },
    ];
    const request = async (query, variables) => {
        operations.push({ query, variables });
        assert.equal(getOperationAST(parse(query)).operation, OperationTypeNode.QUERY);
        assert.equal(query.includes('ownershipConfirmation'), false);
        if (variables.productId)
            return {
                activeChannel: channel,
                digitalProductWorkspace: {
                    productId: '1',
                    variants: [
                        { id: 'active', sku: 'active', migrationRequired: false },
                        ...previews.map(item => ({
                            id: item.productVariantId,
                            sku: item.productVariantId,
                            migrationRequired: true,
                        })),
                    ],
                },
            };
        return {
            activeChannel: channel,
            digitalInventoryMigrationPreview: previews.find(
                item => item.productVariantId === variables.productVariantId,
            ),
        };
    };
    const result = await generateDigitalInventoryMigrationReview({
        request,
        channelId: 'store-a',
        productIds: ['1', '1'],
    });
    assert.equal(result.status, 'COMPLETE');
    assert.deepEqual(
        result.records.map(record => record.status),
        ['ACTIVE', 'READY_FOR_MIGRATION', 'NEEDS_REVIEW', 'DEFERRED', 'NEEDS_REVIEW', 'ACTIVE'],
    );
    assert.equal(operations.length, 6);
});

test('refuses cross-store and default-channel reads and never exposes request error secrets', async () => {
    for (const activeChannel of [
        { id: 'store-b', code: 'other' },
        { id: 'store-a', code: '__default_channel__' },
    ]) {
        const scopedResult = await generateDigitalInventoryMigrationReview({
            channelId: 'store-a',
            productIds: ['1'],
            request: async () => ({ activeChannel }),
        });
        assert.equal(scopedResult.status, 'PARTIAL');
        assert.equal(scopedResult.records[0].status, 'READ_FAILED');
    }
    const result = await generateDigitalInventoryMigrationReview({
        channelId: 'store-a',
        productIds: ['1'],
        request: async () => {
            throw new Error('Bearer SECRET');
        },
    });
    assert.equal(JSON.stringify(result).includes('SECRET'), false);
    assert.equal(result.records[0].status, 'READ_FAILED');
});

test('retains other records when one preview fails, without inventing numeric zero', async () => {
    const result = await generateDigitalInventoryMigrationReview({
        channelId: 'store-a',
        productIds: ['1'],
        request: async (_query, variables) => {
            if (variables.productId)
                return {
                    activeChannel: channel,
                    digitalProductWorkspace: {
                        productId: '1',
                        variants: [
                            { id: 'bad', sku: 'bad', migrationRequired: true },
                            { id: 'good', sku: 'good', migrationRequired: true },
                        ],
                    },
                };
            if (variables.productVariantId === 'bad') throw new Error('unavailable');
            return { activeChannel: channel, digitalInventoryMigrationPreview: preview('good') };
        },
    });
    assert.equal(result.status, 'PARTIAL');
    assert.equal(result.records[0].status, 'READ_FAILED');
    assert.equal('availableQuantity' in result.records[0], false);
    assert.equal(result.records[1].status, 'READY_FOR_MIGRATION');
});
