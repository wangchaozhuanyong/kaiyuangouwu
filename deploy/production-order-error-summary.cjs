'use strict';

const { closeSync, constants, fstatSync, openSync, readSync } = require('node:fs');

// Fixed shipped file names remain verifiable when this helper runs from the SSM temporary directory.
const frameFiles = new Set([
    'packages/core/src/service/services/order.service.ts',
    'packages/core/src/service/services/payment.service.ts',
    'packages/core/src/service/helpers/order-modifier/order-modifier.ts',
    'packages/core/src/service/helpers/order-state-machine/order-state-machine.ts',
    'packages/core/src/service/helpers/order-calculator/order-calculator.ts',
    'packages/core/src/api/resolvers/admin/order.resolver.ts',
    'packages/core/src/api/resolvers/admin/draft-order.resolver.ts',
    'packages/core/src/api/resolvers/shop/shop-order.resolver.ts',
    'packages/storefront-cart-plugin/src/storefront-cart.service.ts',
    'packages/commerce-fulfillment-plugin/src/digital-product.service.ts',
    'packages/commerce-fulfillment-plugin/src/order-fulfillment.resolver.ts',
    'packages/next-admin-plugin/src/service/order-events.service.ts',
    'packages/dev-server/index.ts',
    'packages/dev-server/index-worker.ts',
]);

function summarizeRecentOrderErrors(file) {
    const byteLimit = 128 * 1024;
    let descriptor;
    try {
        descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const metadata = fstatSync(descriptor);
        if (!metadata.isFile()) return { status: 'not-regular-file' };
        const start = Math.max(0, metadata.size - byteLimit);
        const buffer = Buffer.alloc(Math.min(metadata.size, byteLimit));
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
            const count = readSync(
                descriptor,
                buffer,
                bytesRead,
                buffer.length - bytesRead,
                start + bytesRead,
            );
            if (!count) break;
            bytesRead += count;
        }
        const after = fstatSync(descriptor);
        const evidence = {
            fileBytes: metadata.size,
            modifiedAt: metadata.mtime.toISOString(),
            bytesInspected: bytesRead,
            truncated: start > 0,
        };
        if (after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs)
            return { status: 'changed-during-read', ...evidence };
        let contents = buffer.subarray(0, bytesRead).toString('utf8');
        // Never classify a partial leading record after cutting the byte window.
        if (start > 0) contents = contents.includes('\n') ? contents.slice(contents.indexOf('\n') + 1) : '';
        const categories = [
            [
                'ORDER_OR_CART',
                /OrderModificationError|OrderStateTransitionError|OrderLimitError|OrderInterceptorError|CartCommandError/u,
            ],
            [
                'STOCK_OR_FULFILLMENT',
                /InsufficientStockError|InsufficientStock|DigitalStockError|FulfillmentStateTransitionError/u,
            ],
            [
                'PAYMENT_OR_ORDER_STATE',
                /PaymentFailedError|PaymentDeclinedError|PaymentStateTransitionError|OrderPaymentStateError/u,
            ],
            [
                'DATABASE_OR_CONCURRENCY',
                /QueryFailedError|ER_LOCK_DEADLOCK|ER_LOCK_WAIT_TIMEOUT|ER_DUP_ENTRY|SQLITE_BUSY|SQLITE_CONSTRAINT/u,
            ],
            [
                'INTERNAL_ERROR',
                /TypeError|ReferenceError|InternalServerError|INTERNAL_SERVER_ERROR|UnhandledPromiseRejection/u,
            ],
        ].map(([category, pattern]) => ({ category, pattern, count: 0 }));
        const frames = [];
        for (const line of contents.split(/\r?\n/u)) {
            for (const category of categories) if (category.pattern.test(line)) category.count++;
            if (frames.length === 5) continue;
            const match =
                /^\s*at [^\r\n]*?\b(packages\/(?:core|dev-server|storefront-cart-plugin|commerce-fulfillment-plugin|next-admin-plugin)\/[A-Za-z0-9_./-]+\.(?:js|ts)):([1-9][0-9]{0,6}):([1-9][0-9]{0,5})\)?\s*$/u.exec(
                    line,
                );
            if (!match || match[1].split('/').includes('..')) continue;
            const sourceFile = match[1]
                .replace(/^(packages\/dev-server)\/dist\//u, '$1/')
                .replace(/\/(?:dist|lib)\//u, '/src/')
                .replace(/\.js$/u, '.ts');
            if (!frameFiles.has(sourceFile)) continue;
            const frame = { file: match[1], line: Number(match[2]), column: Number(match[3]) };
            if (!frames.some(value => JSON.stringify(value) === JSON.stringify(frame))) frames.push(frame);
        }
        return {
            status: metadata.size === 0 ? 'empty' : 'available',
            ...evidence,
            categories: categories
                .filter(value => value.count)
                .map(({ category, count }) => ({ category, count })),
            frames,
        };
    } catch (error) {
        const statuses = {
            ENOENT: 'missing',
            ELOOP: 'symlink-refused',
            EACCES: 'permission-denied',
            EPERM: 'permission-denied',
        };
        return { status: statuses[error.code] ?? 'unavailable' };
    } finally {
        if (descriptor !== undefined) closeSync(descriptor);
    }
}

function inspectRecentOrderErrors(read = summarizeRecentOrderErrors) {
    return {
        maxBytesPerFile: 128 * 1024,
        countsAreMatchingLogLines: true,
        screenshotCorrelation: 'not-established',
        api: read('/home/ubuntu/.pm2/logs/vendure-api-error.log'),
        worker: read('/home/ubuntu/.pm2/logs/vendure-worker-error.log'),
    };
}

module.exports = { inspectRecentOrderErrors, summarizeRecentOrderErrors };
