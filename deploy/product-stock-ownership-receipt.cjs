'use strict';

const assert = require('node:assert/strict');

function stockOwnershipEvidence(product) {
    const ownership = product.stockOwnership;
    const invalid = 'Invalid stock ownership evidence';
    const validId = value => typeof value === 'string' && /^[1-9][0-9]*$/u.test(value);
    const unique = values => new Set(values).size === values.length;
    assert.ok(ownership && Array.isArray(ownership.variantIds) && Array.isArray(ownership.levels), invalid);
    assert.ok(Array.isArray(product.related.variants), invalid);
    const relatedIds = product.related.variants.map(item => item?.id);
    const variantIds = ownership.variantIds;
    const variantSet = new Set(variantIds);
    assert.ok(
        [...variantIds, ...relatedIds].every(validId) &&
            unique(variantIds) &&
            unique(relatedIds) &&
            variantIds.length === relatedIds.length &&
            relatedIds.every(id => variantSet.has(id)),
        invalid,
    );
    const levels = ownership.levels.map(level => {
        assert.ok(
            level &&
                [level.id, level.productVariantId, level.stockLocationId].every(validId) &&
                variantSet.has(level.productVariantId) &&
                Number.isSafeInteger(level.stockOnHand) &&
                Number.isSafeInteger(level.stockAllocated) &&
                typeof level.stockLocationExists === 'boolean' &&
                Array.isArray(level.channels),
            invalid,
        );
        const channels = level.channels.map(channel => {
            assert.ok(
                channel && validId(channel.id) && (channel.code === null || typeof channel.code === 'string'),
                invalid,
            );
            return { id: channel.id, code: channel.code };
        });
        assert.ok(unique(channels.map(channel => channel.id)), invalid);
        return {
            id: level.id,
            productVariantId: level.productVariantId,
            stockLocationId: level.stockLocationId,
            stockOnHand: level.stockOnHand,
            stockAllocated: level.stockAllocated,
            stockLocationExists: level.stockLocationExists,
            channelCount: channels.length,
            channels: channels.slice(0, 10),
            channelsTruncated: channels.length > 10,
        };
    });
    assert.ok(unique(levels.map(level => level.id)), invalid);
    return {
        variantCount: variantIds.length,
        variantIds: variantIds.slice(0, 50),
        variantIdsTruncated: variantIds.length > 50,
        levelCount: levels.length,
        levels: levels.slice(0, 50),
        levelsTruncated: levels.length > 50,
        detailsTruncated:
            variantIds.length > 50 || levels.length > 50 || levels.some(level => level.channelsTruncated),
    };
}

module.exports = stockOwnershipEvidence;
