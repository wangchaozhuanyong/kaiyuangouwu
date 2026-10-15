import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    classifyDigitalMigrationPreview,
    generateDigitalInventoryMigrationReview,
} from './digital-inventory-review.mjs';

const previewQuery = `query DigitalInventoryBatchPreview($productVariantId: ID!) {
    activeChannel { id code }
    digitalInventoryMigrationPreview(productVariantId: $productVariantId) {
        productVariantId availableQuantity reservedQuantity alreadyMigrated conflicts
        confirmableStockLevels { id stockLocationId stockOnHand stockAllocated }
    }
}`;
const migrateMutation = `mutation DigitalInventoryBatchMigrate($productVariantId: ID!, $expectedAvailable: Int!, $expectedReserved: Int!) {
    migrateDigitalInventory(productVariantId: $productVariantId, expectedAvailable: $expectedAvailable, expectedReserved: $expectedReserved) {
        id productVariantId stockPolicy availableQuantity
    }
}`;
const readbackQuery = `query DigitalInventoryBatchReadback($productId: ID!) {
    activeChannel { id code }
    digitalProductWorkspace(productId: $productId) {
        productId
        variants { id migrationRequired stockPolicy availableQuantity inventory { source availableQuantity reservedQuantity consumedQuantity observedAt } }
    }
}`;

function checkChannel(data, channelId) {
    if (
        String(data.activeChannel?.id) !== String(channelId) ||
        !data.activeChannel?.code ||
        data.activeChannel.code === '__default_channel__'
    )
        throw new Error('CURRENT_STORE_SCOPE_MISMATCH');
}

function validatedPreview(data, channelId, variantId) {
    checkChannel(data, channelId);
    const preview = data.digitalInventoryMigrationPreview;
    if (
        String(preview?.productVariantId) !== String(variantId) ||
        !Array.isArray(preview?.conflicts) ||
        !Array.isArray(preview?.confirmableStockLevels) ||
        !Number.isSafeInteger(preview?.availableQuantity) ||
        !Number.isSafeInteger(preview?.reservedQuantity) ||
        preview.availableQuantity < 0 ||
        preview.reservedQuantity < 0
    )
        throw new Error('PREVIEW_DATA_MISSING');
    return preview;
}

async function readback(request, channelId, record) {
    const data = await request(readbackQuery, { productId: record.productId });
    checkChannel(data, channelId);
    if (String(data.digitalProductWorkspace?.productId) !== record.productId)
        throw new Error('WORKSPACE_DATA_MISSING');
    const variant = data.digitalProductWorkspace?.variants?.find(
        item => String(item.id) === record.productVariantId,
    );
    if (
        !variant ||
        variant.migrationRequired ||
        !variant.inventory ||
        variant.inventory.source === 'LEGACY_UNMIGRATED'
    )
        throw new Error('POST_WRITE_CONFIG_UNAVAILABLE');
    return variant;
}

function matchesExpected(variant, preview) {
    return (
        variant.availableQuantity === preview.availableQuantity &&
        (variant.stockPolicy !== 'limited' ||
            (variant.inventory.availableQuantity === preview.availableQuantity &&
                variant.inventory.reservedQuantity === preview.reservedQuantity))
    );
}

/** One native transaction per SKU. No page read or ordinary product save imports this executor. */
export async function runDigitalInventoryMigrationBatch({
    request,
    channelId,
    productIds,
    execute = false,
    observedAt,
}) {
    const review = await generateDigitalInventoryMigrationReview({
        request,
        channelId,
        productIds,
        observedAt,
    });
    const report = {
        ...review,
        mode: execute === true ? 'EXECUTE' : 'DRY_RUN',
        records: [],
        summary: null,
        attentionRequired: review.status !== 'COMPLETE',
    };
    if (review.status === 'DATA_MISSING') return report;
    for (const record of review.records) {
        if (record.status !== 'READY_FOR_MIGRATION' || execute !== true) {
            report.records.push(record);
            continue;
        }
        let fresh;
        try {
            fresh = validatedPreview(
                await request(previewQuery, { productVariantId: record.productVariantId }),
                channelId,
                record.productVariantId,
            );
        } catch {
            report.status = 'PARTIAL';
            report.records.push({
                ...record,
                status: 'READ_FAILED',
                reason: 'FRESH_PREVIEW_OR_STORE_SCOPE_UNAVAILABLE',
            });
            continue;
        }
        const status = classifyDigitalMigrationPreview(fresh);
        if (status !== 'READY_FOR_MIGRATION' || fresh.confirmableStockLevels.length) {
            report.records.push({
                ...record,
                status:
                    fresh.confirmableStockLevels.length && status === 'READY_FOR_MIGRATION'
                        ? 'NEEDS_REVIEW'
                        : status,
                availableQuantity: fresh.availableQuantity,
                reservedQuantity: fresh.reservedQuantity,
                conflicts: fresh.conflicts,
                confirmableStockLevels: fresh.confirmableStockLevels,
            });
            continue;
        }
        let writeAcknowledged = false;
        try {
            const data = await request(migrateMutation, {
                productVariantId: record.productVariantId,
                expectedAvailable: fresh.availableQuantity,
                expectedReserved: fresh.reservedQuantity,
            });
            if (String(data.migrateDigitalInventory?.productVariantId) !== record.productVariantId)
                throw new Error('MIGRATION_RESULT_UNAVAILABLE');
            writeAcknowledged = true;
        } catch {
            // A lost response may follow a committed transaction. Reconcile instead of replaying it.
        }
        try {
            const variant = await readback(request, channelId, record);
            const verified = matchesExpected(variant, fresh);
            if (!verified) report.status = 'PARTIAL';
            report.records.push({
                ...record,
                status: verified
                    ? writeAcknowledged
                        ? 'MIGRATED'
                        : 'ACTIVE_AFTER_RECONCILIATION'
                    : 'MIGRATED_REVIEW_REQUIRED',
                availableQuantity: fresh.availableQuantity,
                reservedQuantity: fresh.reservedQuantity,
                writeAcknowledged,
                verified,
                observedInventory: variant.inventory,
                ...(!verified ? { reason: 'POST_WRITE_STOCK_CHANGED_OR_UNVERIFIED' } : {}),
            });
        } catch {
            report.status = 'PARTIAL';
            report.records.push({
                ...record,
                status: writeAcknowledged ? 'MIGRATED_REVIEW_REQUIRED' : 'EXECUTION_UNCONFIRMED',
                writeAcknowledged,
                verified: false,
                reason: 'POST_WRITE_READ_UNAVAILABLE',
            });
        }
    }
    report.summary = report.records.reduce((counts, record) => {
        counts[record.status] = (counts[record.status] ?? 0) + 1;
        return counts;
    }, {});
    report.attentionRequired =
        report.status !== 'COMPLETE' ||
        report.records.some(
            record =>
                !['READY_FOR_MIGRATION', 'ACTIVE', 'MIGRATED', 'ACTIVE_AFTER_RECONCILIATION'].includes(
                    record.status,
                ),
        );
    return report;
}

export function parseDigitalInventoryBatchArguments(args) {
    const options = { execute: false, productIds: [] };
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === '--execute') options.execute = true;
        else if (argument === '--help') options.help = true;
        else if (['--channel', '--product', '--endpoint', '--output'].includes(argument)) {
            const value = args[++index];
            if (!value || value.startsWith('--')) throw new Error('ARGUMENT_VALUE_MISSING');
            if (argument === '--product') options.productIds.push(value);
            else
                options[
                    { '--channel': 'channelId', '--endpoint': 'endpoint', '--output': 'output' }[argument]
                ] = value;
        } else throw new Error('UNKNOWN_ARGUMENT');
    }
    if (!options.help && (!options.channelId || !options.productIds.length))
        throw new Error('EXPLICIT_CHANNEL_AND_PRODUCT_SCOPE_REQUIRED');
    return options;
}

const artifactRoot = fileURLToPath(
    new URL('../../../artifacts/product-unified-sales-20261016/', import.meta.url),
);

async function main() {
    const options = parseDigitalInventoryBatchArguments(process.argv.slice(2));
    if (options.help) {
        process.stdout.write(
            [
                'Usage: node digital-inventory-migration-batch.mjs --channel <API channel ID> --product <API product ID>',
                '  [--product <ID>] [--endpoint <admin API URL>] [--execute] [--output <project artifact JSON>]',
                'Uses existing VENDURE_ADMIN_BEARER_TOKEN and VENDURE_CHANNEL_TOKEN in memory. Default is read-only.',
                '',
            ].join('\n'),
        );
        return;
    }
    const endpoint =
        options.endpoint ??
        process.env.VITE_VENDURE_ADMIN_API_URL ??
        (process.env.VENDURE_API_ORIGIN
            ? `${process.env.VENDURE_API_ORIGIN.replace(/\/$/u, '')}/admin-api`
            : undefined);
    const output = path.resolve(
        options.output ?? path.join(artifactRoot, `history-batch-${Date.now()}.json`),
    );
    const relative = path.relative(artifactRoot, output);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
        throw new Error('OUTPUT_MUST_STAY_IN_PROJECT_TASK_ARTIFACTS');
    const authToken = process.env.VENDURE_ADMIN_BEARER_TOKEN;
    const channelToken = process.env.VENDURE_CHANNEL_TOKEN;
    let request;
    if (endpoint && authToken && channelToken) {
        const url = new URL(endpoint);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Error('INVALID_ADMIN_ENDPOINT');
        request = async (query, variables) => {
            const response = await fetch(url, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(30_000),
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${authToken}`,
                    'vendure-token': channelToken,
                },
                body: JSON.stringify({ query, variables }),
            });
            const body = await response.json();
            if (!response.ok || body.errors?.length || !body.data)
                throw new Error('ADMIN_API_REQUEST_FAILED');
            return body.data;
        };
    }
    const result = await runDigitalInventoryMigrationBatch({ ...options, request });
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(
        JSON.stringify({
            mode: result.mode,
            status: result.status,
            recordCount: result.records.length,
            summary: result.summary,
            attentionRequired: result.attentionRequired,
            report: output,
        }) + '\n',
    );
    if (result.status !== 'COMPLETE' || result.attentionRequired) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
    main().catch(() => {
        process.stderr.write(
            'Digital inventory batch could not complete. Check explicit scope, existing read session, endpoint and project output path.\n' +
                'No credentials are included in this message.\n',
        );
        process.exitCode = 1;
    });
}
