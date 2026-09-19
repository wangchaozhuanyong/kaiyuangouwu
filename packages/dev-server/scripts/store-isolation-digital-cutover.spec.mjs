import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { migrateDigitalDeliveryFiles } from './migrate-digital-delivery-files.mjs';

const candidate = '0c4b3cedc820a9c28356d331fb194a14c22b05a1';
const reportRoot = fileURLToPath(new URL('../../../reports/pending-migrations-20260913/', import.meta.url));
const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const hash = value => createHash('sha256').update(value).digest('hex');

test('verified copies integrate with the current channel-scoped download code while preserving legacy files', async () => {
    await mkdir(path.join(reportRoot, 'fixtures'), { recursive: true });
    const directory = await mkdtemp(path.join(reportRoot, 'fixtures', 'digital-cutover-'));
    const runtimeDirectory = path.join(directory, 'runtime');
    const filesDirectory = path.join(directory, 'files');
    await mkdir(runtimeDirectory);
    await mkdir(filesDirectory);
    const sourceHashes = {};
    try {
        // Compile only the three current source files needed for this contract. No Git history or dependency installation is required.
        const ts = require('typescript');
        for (const name of [
            'digital-delivery-token.service',
            'digital-delivery.service',
            'fulfillment-classification',
        ]) {
            const relative = `packages/commerce-fulfillment-plugin/src/${name}.ts`;
            const source = await readFile(path.join(projectRoot, relative), 'utf8');
            sourceHashes[relative] = hash(source);
            const compiled = ts.transpileModule(source, {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES2022,
                    experimentalDecorators: true,
                    esModuleInterop: true,
                },
                fileName: `${name}.ts`,
                reportDiagnostics: true,
            });
            assert.ok(
                !compiled.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error),
                'Candidate transpilation failed',
            );
            await writeFile(path.join(runtimeDirectory, `${name}.js`), compiled.outputText);
        }
        const { DigitalDeliveryTokenService } = require(
            path.join(runtimeDirectory, 'digital-delivery-token.service.js'),
        );
        const { DigitalDeliveryService } = require(
            path.join(runtimeDirectory, 'digital-delivery.service.js'),
        );
        const original = Buffer.from('synthetic paid store-a delivery');
        const shared = Buffer.from('synthetic explicitly assigned two-store document');
        await writeFile(path.join(filesDirectory, 'SKU-A.txt'), original);
        await writeFile(path.join(filesDirectory, 'SKU-SHARED.pdf'), shared);
        const manifest = {
            format: 1,
            files: [
                { fileName: 'SKU-A.txt', sha256: hash(original), channelIds: ['a'] },
                { fileName: 'SKU-SHARED.pdf', sha256: hash(shared), channelIds: ['a', 'b'] },
            ],
        };
        const secret = randomBytes(32).toString('hex'); // Ephemeral synthetic signing only; never written or printed.
        const tokens = new DigitalDeliveryTokenService({
            rootDirectory: filesDirectory,
            signingSecret: secret,
        });
        const order = {
            id: 'synthetic-order-a',
            salesChannelId: 'a',
            state: 'PaymentSettled',
            active: false,
            totalWithTax: 100,
            channels: [{ id: 'a' }],
            payments: [{ state: 'Settled', amount: 100, refunds: [] }],
            lines: [
                {
                    id: 'synthetic-line-a',
                    quantity: 1,
                    customFields: {
                        fulfillmentTypeSnapshot: 'digital',
                        digitalDeliveryModeSnapshot: 'file_download',
                    },
                    productVariant: { sku: 'SKU-A', name: 'Synthetic download' },
                },
            ],
        };
        const connection = {
            getEntityOrThrow: async (ctx, entity, id, options) => {
                assert.equal(id, order.id);
                assert.equal(ctx.channelId, order.salesChannelId);
                assert.ok(options.relations.includes('lines.productVariant'));
                return order;
            },
            rawConnection: { getRepository: () => ({ findOne: async () => order }) },
        };
        const service = new DigitalDeliveryService(connection, tokens);
        const context = {
            channelId: 'a',
            req: { headers: { host: 'a.example.invalid' } },
            languageCode: 'en',
        };
        assert.equal((await service.deliveriesForOrder(context, order.id))[0].status, 'FILE_MISSING');
        assert.equal(
            tokens.resourceForSku('a', 'SKU-A'),
            undefined,
            'Legacy root must never serve as a scoped fallback',
        );
        const copied = await migrateDigitalDeliveryFiles({
            rootDirectory: filesDirectory,
            manifest,
            apply: true,
        });
        assert.equal(copied.copiedCount, 3);
        assert.equal(copied.readyForScopedRead, true);
        assert.equal(copied.runtimeSwitched, false);
        const delivery = (await service.deliveriesForOrder(context, order.id))[0];
        assert.equal(delivery.status, 'READY');
        const token = decodeURIComponent(delivery.downloadUrl.split('/').at(-1));
        const authorized = await service.authorizeDownload(token, 'a.example.invalid');
        assert.ok(authorized);
        assert.deepEqual(await readFile(authorized.resource.path), original);
        assert.equal(await service.authorizeDownload(token, 'b.example.invalid'), undefined);
        assert.equal(tokens.resourceForSku('b', 'SKU-A'), undefined);
        for (const channel of ['a', 'b'])
            assert.deepEqual(await readFile(tokens.resourceForSku(channel, 'SKU-SHARED').path), shared);
        const wrongScope = tokens.createToken({
            orderId: order.id,
            orderLineId: order.lines[0].id,
            channelId: 'b',
            host: 'b.example.invalid',
            sku: 'SKU-A',
        });
        assert.equal(await service.authorizeDownload(wrongScope.token, 'b.example.invalid'), undefined);
        order.payments = [];
        assert.equal((await service.deliveriesForOrder(context, order.id))[0].status, 'PAYMENT_REQUIRED');
        assert.equal(await service.authorizeDownload(token, 'a.example.invalid'), undefined);
        const oldPayload = Buffer.from(
            JSON.stringify({
                orderId: order.id,
                orderLineId: order.lines[0].id,
                sku: 'SKU-A',
                expiresAt: Math.floor(Date.now() / 1000) + 60,
            }),
        ).toString('base64url');
        const oldToken = `${oldPayload}.${createHmac('sha256', secret).update(oldPayload).digest('base64url')}`;
        assert.equal(
            tokens.verifyToken(oldToken),
            undefined,
            'Legacy unscoped URLs need reissuance from the existing order',
        );
        assert.deepEqual(await readFile(path.join(filesDirectory, 'SKU-A.txt')), original);
        assert.deepEqual(await readFile(path.join(filesDirectory, 'SKU-SHARED.pdf')), shared);
        assert.equal(
            (await migrateDigitalDeliveryFiles({ rootDirectory: filesDirectory, manifest, apply: true }))
                .copiedCount,
            0,
        );
        await writeFile(
            path.join(reportRoot, 'digital-cutover-candidate-evidence.json'),
            `${JSON.stringify(
                {
                    scope: 'synthetic-files-and-locally-integrated-runtime-with-mocked-order-repository',
                    candidate,
                    sourceHashes,
                    migrationScriptSha256: hash(
                        await readFile(new URL('./migrate-digital-delivery-files.mjs', import.meta.url)),
                    ),
                    copiedFiles: 3,
                    oldSourceFilesPreserved: true,
                    crossStoreDenied: true,
                    unpaidDenied: true,
                    legacyUnscopedTokenRejected: true,
                    duplicateCopies: 0,
                    runtimeSwitched: false,
                    productionReady: false,
                },
                null,
                2,
            )}\n`,
            { mode: 0o600 },
        );
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
