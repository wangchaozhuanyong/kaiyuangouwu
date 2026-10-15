/** Read-only adapter: reuse an authenticated, current-store request function; never persist credentials. */
const workspaceQuery = `query DigitalInventoryReviewWorkspace($productId: ID!) {
    activeChannel { id code }
    digitalProductWorkspace(productId: $productId) {
        productId
        variants { id sku migrationRequired }
    }
}`;
const previewQuery = `query DigitalInventoryReviewPreview($productVariantId: ID!) {
    activeChannel { id code }
    digitalInventoryMigrationPreview(productVariantId: $productVariantId) {
        productVariantId availableQuantity reservedQuantity conflicts alreadyMigrated
        confirmableStockLevels { id stockLocationId stockOnHand stockAllocated }
    }
}`;
const deferredConflict = '该商品有结算或修改中的订单，请先确认付款与占用结果';

export function classifyDigitalMigrationPreview(preview) {
    if (preview.alreadyMigrated) return 'ACTIVE';
    if (!preview.conflicts.length) return 'READY_FOR_MIGRATION';
    return preview.conflicts.every(reason => reason === deferredConflict) ? 'DEFERRED' : 'NEEDS_REVIEW';
}

function requireCurrentChannel(data, expectedChannelId) {
    if (
        String(data.activeChannel?.id) !== String(expectedChannelId) ||
        !data.activeChannel?.code ||
        data.activeChannel.code === '__default_channel__'
    )
        throw new Error('CURRENT_STORE_SCOPE_MISMATCH');
}

/**
 * request(query, variables) returns GraphQL data and must reject GraphQL errors.
 * The caller supplies the explicitly reviewed product ID list and writes the returned report inside
 * its project artifacts directory. No login, mutations, ownership confirmations, files, or env reads.
 */
export async function generateDigitalInventoryMigrationReview({
    request,
    channelId,
    productIds,
    observedAt = new Date().toISOString(),
}) {
    const report = { status: 'COMPLETE', channelId: channelId ?? null, observedAt, records: [] };
    if (typeof request !== 'function' || !channelId) {
        return { ...report, status: 'DATA_MISSING', reason: 'READ_CREDENTIALS_MISSING' };
    }
    if (!Array.isArray(productIds) || !productIds.length) {
        return { ...report, status: 'DATA_MISSING', reason: 'PRODUCT_SCOPE_MISSING' };
    }
    for (const productId of [...new Set(productIds.map(String))]) {
        let workspace;
        try {
            const data = await request(workspaceQuery, { productId });
            requireCurrentChannel(data, channelId);
            workspace = data.digitalProductWorkspace;
            if (String(workspace?.productId) !== productId || !Array.isArray(workspace?.variants))
                throw new Error('WORKSPACE_DATA_MISSING');
        } catch {
            report.status = 'PARTIAL';
            report.records.push({
                productId,
                status: 'READ_FAILED',
                reason: 'WORKSPACE_OR_STORE_SCOPE_UNAVAILABLE',
            });
            continue;
        }
        for (const variant of workspace.variants) {
            const record = { productId, productVariantId: String(variant.id), sku: variant.sku };
            if (!variant.migrationRequired) {
                report.records.push({ ...record, status: 'ACTIVE' });
                continue;
            }
            try {
                const data = await request(previewQuery, { productVariantId: String(variant.id) });
                requireCurrentChannel(data, channelId);
                const preview = data.digitalInventoryMigrationPreview;
                if (
                    String(preview?.productVariantId) !== String(variant.id) ||
                    !Array.isArray(preview?.conflicts)
                )
                    throw new Error('PREVIEW_DATA_MISSING');
                report.records.push({
                    ...record,
                    status: classifyDigitalMigrationPreview(preview),
                    availableQuantity: preview.availableQuantity,
                    reservedQuantity: preview.reservedQuantity,
                    conflicts: preview.conflicts,
                    confirmableStockLevels: preview.confirmableStockLevels,
                });
            } catch {
                report.status = 'PARTIAL';
                report.records.push({
                    ...record,
                    status: 'READ_FAILED',
                    reason: 'PREVIEW_OR_STORE_SCOPE_UNAVAILABLE',
                });
            }
        }
    }
    return report;
}
