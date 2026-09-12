import { DeletionResult, LogicalOperator, SortOrder } from '@vendure/common/lib/generated-types';
import { omit } from '@vendure/common/lib/omit';
import { pick } from '@vendure/common/lib/pick';
import {
    Asset,
    AssetEvent,
    AssetService,
    AssetType,
    ConfigService,
    DefaultJobQueuePlugin,
    EventBus,
    JobQueueService,
    mergeConfig,
    RequestContextService,
    TransactionalConnection,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import fs from 'fs-extra';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { ResultOf } from './graphql/graphql-admin';
import {
    createAssetsDocument,
    deleteAssetDocument,
    getAssetDocument,
    getAssetFragmentFirstDocument,
    getAssetListDocument,
    getProductWithVariantsDocument,
    updateAssetDocument,
} from './graphql/shared-definitions';

describe('Asset resolver', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [DefaultJobQueuePlugin.init({ pollInterval: 50 })],
            assetOptions: {
                permittedFileTypes: ['image/*', '.pdf', '.zip'],
            },
        }),
    );

    let firstAssetId: string;
    let createdAssetId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('assets', async () => {
        const { assets } = await adminClient.query(getAssetListDocument, {
            options: {
                sort: {
                    name: SortOrder.ASC,
                },
            },
        });

        expect(assets.totalItems).toBe(4);
        expect(assets.items.map(a => omit(a, ['id']))).toEqual([
            {
                fileSize: 1680,
                mimeType: 'image/jpeg',
                name: 'alexandru-acea-686569-unsplash.jpg',
                preview: 'test-url/test-assets/alexandru-acea-686569-unsplash__preview.jpg',
                source: 'test-url/test-assets/alexandru-acea-686569-unsplash.jpg',
                type: 'IMAGE',
            },
            {
                fileSize: 1680,
                mimeType: 'image/jpeg',
                name: 'derick-david-409858-unsplash.jpg',
                preview: 'test-url/test-assets/derick-david-409858-unsplash__preview.jpg',
                source: 'test-url/test-assets/derick-david-409858-unsplash.jpg',
                type: 'IMAGE',
            },
            {
                fileSize: 1680,
                mimeType: 'image/jpeg',
                name: 'florian-olivo-1166419-unsplash.jpg',
                preview: 'test-url/test-assets/florian-olivo-1166419-unsplash__preview.jpg',
                source: 'test-url/test-assets/florian-olivo-1166419-unsplash.jpg',
                type: 'IMAGE',
            },
            {
                fileSize: 1680,
                mimeType: 'image/jpeg',
                name: 'vincent-botta-736919-unsplash.jpg',
                preview: 'test-url/test-assets/vincent-botta-736919-unsplash__preview.jpg',
                source: 'test-url/test-assets/vincent-botta-736919-unsplash.jpg',
                type: 'IMAGE',
            },
        ]);

        firstAssetId = assets.items[0].id;
    });

    it('asset', async () => {
        const { asset } = await adminClient.query(getAssetDocument, {
            id: firstAssetId,
        });

        expect(asset).toEqual({
            fileSize: 1680,
            height: 48,
            id: firstAssetId,
            mimeType: 'image/jpeg',
            name: 'alexandru-acea-686569-unsplash.jpg',
            preview: 'test-url/test-assets/alexandru-acea-686569-unsplash__preview.jpg',
            source: 'test-url/test-assets/alexandru-acea-686569-unsplash.jpg',
            type: 'IMAGE',
            width: 48,
        });
    });

    /**
     * https://github.com/vendurehq/vendure/issues/459
     */
    it('transforms URL when fragment defined before query (GH issue #459)', async () => {
        const result = await adminClient.query(getAssetFragmentFirstDocument, {
            id: firstAssetId,
        });

        // @ts-expect-error
        expect(result.asset?.preview).toBe(
            'test-url/test-assets/alexandru-acea-686569-unsplash__preview.jpg',
        );
    });

    describe('createAssets', () => {
        type AssetResult = Extract<
            ResultOf<typeof createAssetsDocument>['createAssets'][number],
            { name: string }
        >;

        function isAsset(
            input: ResultOf<typeof createAssetsDocument>['createAssets'][number],
        ): input is AssetResult {
            return input.hasOwnProperty('name');
        }

        it('permitted types by mime type', async () => {
            const filesToUpload = [
                path.join(__dirname, 'fixtures/assets/pps1.jpg'),
                path.join(__dirname, 'fixtures/assets/pps2.jpg'),
            ];
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: filesToUpload,
                mapVariables: filePaths => ({
                    input: filePaths.map(p => ({ file: null })),
                }),
            });

            expect(createAssets.length).toBe(2);
            const results = createAssets.filter(isAsset);
            expect(
                results
                    .map((a: AssetResult) => omit(a, ['id']))
                    .sort((a: AssetResult, b: AssetResult) => (a.name < b.name ? -1 : 1)),
            ).toEqual([
                {
                    fileSize: 1680,
                    focalPoint: null,
                    mimeType: 'image/jpeg',
                    name: 'pps1.jpg',
                    preview: 'test-url/test-assets/pps1__preview.jpg',
                    source: 'test-url/test-assets/pps1.jpg',
                    tags: [],
                    type: 'IMAGE',
                },
                {
                    fileSize: 1680,
                    focalPoint: null,
                    mimeType: 'image/jpeg',
                    name: 'pps2.jpg',
                    preview: 'test-url/test-assets/pps2__preview.jpg',
                    source: 'test-url/test-assets/pps2.jpg',
                    tags: [],
                    type: 'IMAGE',
                },
            ]);

            createdAssetId = results[0].id;
        });

        it('permitted type by file extension', async () => {
            const filesToUpload = [path.join(__dirname, 'fixtures/assets/dummy.pdf')];
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: filesToUpload,
                mapVariables: filePaths => ({
                    input: filePaths.map(p => ({ file: null })),
                }),
            });

            expect(createAssets.length).toBe(1);
            const results = createAssets.filter(isAsset);
            expect(results.map((a: AssetResult) => omit(a, ['id']))).toEqual([
                {
                    fileSize: 1680,
                    focalPoint: null,
                    mimeType: 'application/pdf',
                    name: 'dummy.pdf',
                    preview: 'test-url/test-assets/dummy__preview.pdf.png',
                    source: 'test-url/test-assets/dummy.pdf',
                    tags: [],
                    type: 'BINARY',
                },
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/727
        it('file extension with shared type', async () => {
            const filesToUpload = [path.join(__dirname, 'fixtures/assets/dummy.zip')];
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: filesToUpload,
                mapVariables: filePaths => ({
                    input: filePaths.map(p => ({ file: null })),
                }),
            });

            expect(createAssets.length).toBe(1);

            expect(isAsset(createAssets[0])).toBe(true);
            const results = createAssets.filter(isAsset);
            expect(results.map((a: AssetResult) => omit(a, ['id']))).toEqual([
                {
                    fileSize: 1680,
                    focalPoint: null,
                    mimeType: 'application/zip',
                    name: 'dummy.zip',
                    preview: 'test-url/test-assets/dummy__preview.zip.png',
                    source: 'test-url/test-assets/dummy.zip',
                    tags: [],
                    type: 'BINARY',
                },
            ]);
        });

        it('not permitted type', async () => {
            const filesToUpload = [path.join(__dirname, 'fixtures/assets/dummy.txt')];
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: filesToUpload,
                mapVariables: filePaths => ({
                    input: filePaths.map(p => ({ file: null })),
                }),
            });

            expect(createAssets.length).toBe(1);
            expect(createAssets[0]).toEqual({
                message: 'The MIME type "text/plain" is not permitted.',
                mimeType: 'text/plain',
                fileName: 'dummy.txt',
            });
        });

        // GHSA-88rq-mq4v-frmm — the permitted-type check must not rely solely on the
        // client-supplied Content-Type header, which can be spoofed (e.g. via a proxy tool).
        it('rejects a dangerous extension even when the Content-Type header is spoofed', async () => {
            const filesToUpload = [path.join(__dirname, 'fixtures/assets/malicious.php')];
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: filesToUpload,
                // Spoof the part Content-Type to a permitted type, as an attacker would.
                contentTypeOverrides: { 0: 'image/jpeg' },
                mapVariables: filePaths => ({
                    input: filePaths.map(p => ({ file: null })),
                }),
            });

            expect(createAssets.length).toBe(1);
            expect(createAssets[0]).toEqual({
                message: 'The MIME type "application/x-httpd-php" is not permitted.',
                mimeType: 'application/x-httpd-php',
                fileName: 'malicious.php',
            });
        });

        // GHSA-88rq-mq4v-frmm — a file that cannot be positively identified as a permitted
        // type by either its extension or its contents must be rejected. `.phtml` has no
        // mime-types mapping and the text content has no magic bytes, so neither signal
        // confirms it is permitted.
        it('rejects an unrecognised extension with spoofed Content-Type and no detectable content type', async () => {
            const filesToUpload = [path.join(__dirname, 'fixtures/assets/malicious.phtml')];
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: filesToUpload,
                contentTypeOverrides: { 0: 'image/jpeg' },
                mapVariables: filePaths => ({
                    input: filePaths.map(p => ({ file: null })),
                }),
            });

            expect(createAssets.length).toBe(1);
            expect(createAssets[0]).toEqual({
                message: 'The MIME type "application/octet-stream" is not permitted.',
                mimeType: 'application/octet-stream',
                fileName: 'malicious.phtml',
            });
        });

        // GHSA-88rq-mq4v-frmm — the actual file contents (magic bytes) are validated, so a
        // disguised file whose extension and Content-Type are both permitted is still rejected
        // when its real content type is not permitted.
        it('rejects a file whose actual contents are a non-permitted type', async () => {
            const filesToUpload = [path.join(__dirname, 'fixtures/assets/disguised-gzip.jpg')];
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: filesToUpload,
                contentTypeOverrides: { 0: 'image/jpeg' },
                mapVariables: filePaths => ({
                    input: filePaths.map(p => ({ file: null })),
                }),
            });

            expect(createAssets.length).toBe(1);
            expect(createAssets[0]).toEqual({
                message: 'The MIME type "application/gzip" is not permitted.',
                mimeType: 'application/gzip',
                fileName: 'disguised-gzip.jpg',
            });
        });

        it('create with new tags', async () => {
            const filesToUpload = [path.join(__dirname, 'fixtures/assets/pps1.jpg')];
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: filesToUpload,
                mapVariables: filePaths => ({
                    input: filePaths.map(p => ({ file: null, tags: ['foo', 'bar'] })),
                }),
            });
            const results = createAssets.filter(isAsset);

            expect(results.map((a: AssetResult) => pick(a, ['id', 'name', 'tags']))).toEqual([
                {
                    id: 'T_9',
                    name: 'pps1.jpg',
                    tags: [
                        { id: 'T_1', value: 'foo' },
                        { id: 'T_2', value: 'bar' },
                    ],
                },
            ]);
        });

        it('create with existing tags', async () => {
            const filesToUpload = [path.join(__dirname, 'fixtures/assets/pps1.jpg')];
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: filesToUpload,
                mapVariables: filePaths => ({
                    input: filePaths.map(p => ({ file: null, tags: ['foo', 'bar'] })),
                }),
            });
            const results = createAssets.filter(isAsset);

            expect(results.map((a: AssetResult) => pick(a, ['id', 'name', 'tags']))).toEqual([
                {
                    id: 'T_10',
                    name: 'pps1.jpg',
                    tags: [
                        { id: 'T_1', value: 'foo' },
                        { id: 'T_2', value: 'bar' },
                    ],
                },
            ]);
        });

        it('create with new and existing tags', async () => {
            const filesToUpload = [path.join(__dirname, 'fixtures/assets/pps1.jpg')];
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: filesToUpload,
                mapVariables: filePaths => ({
                    input: filePaths.map(p => ({ file: null, tags: ['quux', 'bar'] })),
                }),
            });
            const results = createAssets.filter(isAsset);

            expect(results.map((a: AssetResult) => pick(a, ['id', 'name', 'tags']))).toEqual([
                {
                    id: 'T_11',
                    name: 'pps1.jpg',
                    tags: [
                        { id: 'T_3', value: 'quux' },
                        { id: 'T_2', value: 'bar' },
                    ],
                },
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/990
        it('errors if the filesize is too large', async () => {
            /**
             * Based on https://stackoverflow.com/a/49433633/772859
             */
            function createEmptyFileOfSize(fileName: string, sizeInBytes: number) {
                return new Promise((resolve, reject) => {
                    const fh = fs.openSync(fileName, 'w');
                    fs.writeSync(fh, 'ok', Math.max(0, sizeInBytes - 2));
                    fs.closeSync(fh);
                    resolve(true);
                });
            }

            const twentyOneMib = 22020096;
            const filename = path.join(__dirname, 'fixtures/assets/temp_large_file.pdf');
            await createEmptyFileOfSize(filename, twentyOneMib);

            try {
                await adminClient.fileUploadMutation({
                    mutation: createAssetsDocument,
                    filePaths: [filename],
                    mapVariables: filePaths => ({
                        input: filePaths.map(p => ({ file: null })),
                    }),
                });
                fail('Should have thrown');
            } catch (e: any) {
                expect(e.message).toContain('File truncated as it exceeds the 20971520 byte size limit');
            } finally {
                fs.rmSync(filename);
            }
        });
    });

    describe('filter by tags', () => {
        it('and', async () => {
            const { assets } = await adminClient.query(getAssetListDocument, {
                options: {
                    tags: ['foo', 'bar'],
                    tagsOperator: LogicalOperator.AND,
                },
            });

            expect(assets.items.map(i => i.id).sort()).toEqual(['T_10', 'T_9']);
        });

        it('or', async () => {
            const { assets } = await adminClient.query(getAssetListDocument, {
                options: {
                    tags: ['foo', 'bar'],
                    tagsOperator: LogicalOperator.OR,
                },
            });

            expect(assets.items.map(i => i.id).sort()).toEqual(['T_10', 'T_11', 'T_9']);
        });

        it('empty array', async () => {
            const { assets } = await adminClient.query(getAssetListDocument, {
                options: {
                    tags: [],
                },
            });

            expect(assets.totalItems).toBe(11);
        });
    });

    describe('updateAsset', () => {
        it('update name', async () => {
            const { updateAsset } = await adminClient.query(updateAssetDocument, {
                input: {
                    id: firstAssetId,
                    name: 'new name',
                },
            });

            expect(updateAsset.name).toEqual('new name');
        });

        it('update focalPoint', async () => {
            const { updateAsset } = await adminClient.query(updateAssetDocument, {
                input: {
                    id: firstAssetId,
                    focalPoint: {
                        x: 0.3,
                        y: 0.9,
                    },
                },
            });

            expect(updateAsset.focalPoint).toEqual({
                x: 0.3,
                y: 0.9,
            });
        });

        it('unset focalPoint', async () => {
            const { updateAsset } = await adminClient.query(updateAssetDocument, {
                input: {
                    id: firstAssetId,
                    focalPoint: null,
                },
            });

            expect(updateAsset.focalPoint).toEqual(null);
        });

        it('update tags', async () => {
            const { updateAsset } = await adminClient.query(updateAssetDocument, {
                input: {
                    id: firstAssetId,
                    tags: ['foo', 'quux'],
                },
            });

            expect(updateAsset.tags).toEqual([
                { id: 'T_1', value: 'foo' },
                { id: 'T_3', value: 'quux' },
            ]);
        });

        it('remove tags', async () => {
            const { updateAsset } = await adminClient.query(updateAssetDocument, {
                input: {
                    id: firstAssetId,
                    tags: [],
                },
            });

            expect(updateAsset.tags).toEqual([]);
        });
    });

    describe('deleteAsset', () => {
        let firstProduct: NonNullable<ResultOf<typeof getProductWithVariantsDocument>['product']>;

        const productGuard: ErrorResultGuard<
            NonNullable<ResultOf<typeof getProductWithVariantsDocument>['product']>
        > = createErrorResultGuard(input => input !== null);

        const featuredAssetGuard: ErrorResultGuard<
            NonNullable<
                NonNullable<ResultOf<typeof getProductWithVariantsDocument>['product']>['featuredAsset']
            >
        > = createErrorResultGuard(input => input !== null);

        beforeAll(async () => {
            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: 'T_1',
            });

            productGuard.assertSuccess(product);
            firstProduct = product;
        });

        it('non-featured asset', async () => {
            const { deleteAsset } = await adminClient.query(deleteAssetDocument, {
                input: {
                    assetId: createdAssetId,
                },
            });

            expect(deleteAsset.result).toBe(DeletionResult.DELETED);

            const { asset } = await adminClient.query(getAssetDocument, {
                id: createdAssetId,
            });
            expect(asset).toBeNull();
        });

        it('featured asset not deleted', async () => {
            featuredAssetGuard.assertSuccess(firstProduct.featuredAsset);
            const { deleteAsset } = await adminClient.query(deleteAssetDocument, {
                input: {
                    assetId: firstProduct.featuredAsset.id,
                },
            });

            expect(deleteAsset.result).toBe(DeletionResult.NOT_DELETED);
            expect(deleteAsset.message).toContain('The selected Asset is featured by 1 Product');

            const { asset } = await adminClient.query(getAssetDocument, {
                id: firstAssetId,
            });
            expect(asset).not.toBeNull();
        });

        it('featured asset force deleted', async () => {
            const { product: p1 } = await adminClient.query(getProductWithVariantsDocument, {
                id: firstProduct.id,
            });
            productGuard.assertSuccess(p1);
            expect(p1.assets.length).toEqual(1);

            featuredAssetGuard.assertSuccess(firstProduct.featuredAsset);
            const { deleteAsset } = await adminClient.query(deleteAssetDocument, {
                input: {
                    assetId: firstProduct.featuredAsset.id,
                    force: true,
                },
            });

            expect(deleteAsset.result).toBe(DeletionResult.DELETED);

            const { asset } = await adminClient.query(getAssetDocument, {
                id: firstAssetId,
            });
            expect(asset).not.toBeNull();

            const { product } = await adminClient.query(getProductWithVariantsDocument, {
                id: firstProduct.id,
            });
            productGuard.assertSuccess(product);
            expect(product.featuredAsset).toBeNull();
            expect(product.assets.length).toEqual(0);
        });
    });

    // Placed last because creating an asset advances the auto-increment id, which the
    // hardcoded-id assertions in the tests above rely on.
    describe('MIME type content validation (GHSA-88rq-mq4v-frmm)', () => {
        // An SVG that begins with an XML prolog is reported by `file-type` as the generic
        // `application/xml`, which must not cause the permitted `image/svg+xml` upload to be
        // rejected as a content/extension mismatch.
        it('accepts an SVG whose contents are detected as generic XML', async () => {
            const filesToUpload = [path.join(__dirname, 'fixtures/assets/test.svg')];
            const { createAssets } = await adminClient.fileUploadMutation({
                mutation: createAssetsDocument,
                filePaths: filesToUpload,
                mapVariables: filePaths => ({
                    input: filePaths.map(p => ({ file: null })),
                }),
            });

            expect(createAssets.length).toBe(1);
            // An Asset (with name/source), not a MimeTypeError, confirms the SVG was accepted.
            expect(createAssets[0]).toMatchObject({
                name: 'test.svg',
                source: expect.stringContaining('test.svg'),
            });
            expect(createAssets[0]).not.toHaveProperty('message');
        });
    });
    // AUD-004: exercise the real transaction and persisted job queue with synthetic files.
    describe('file deletion transaction boundary', () => {
        async function fixture() {
            const connection = server.app.get(TransactionalConnection);
            const ctx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
            const directory = await fs.mkdtemp(path.join(tmpdir(), 'asset-delete-'));
            const source = path.join(directory, 'original.txt');
            const preview = path.join(directory, 'preview.txt');
            await fs.writeFile(source, 'synthetic original');
            await fs.writeFile(preview, 'synthetic preview');
            const asset = await connection.getRepository(ctx, Asset).save(
                new Asset({
                    type: AssetType.BINARY,
                    mimeType: 'text/plain',
                    fileSize: 18,
                    source,
                    preview,
                    channels: [ctx.channel],
                    translations: [],
                }),
            );
            const storage = server.app.get(ConfigService).assetOptions.assetStorageStrategy;
            const exists = vi.spyOn(storage, 'fileExists').mockImplementation(file => fs.pathExists(file));
            const remove = vi.spyOn(storage, 'deleteFile').mockImplementation(file => fs.unlink(file));
            const service = server.app.get(AssetService);
            const removeAsset = (txCtx: typeof ctx) =>
                (service as any).deleteUnconditional(txCtx, [new Asset(asset)]);
            return {
                connection,
                ctx,
                asset,
                source,
                preview,
                remove,
                removeAsset,
                clean: async () => {
                    exists.mockRestore();
                    remove.mockRestore();
                    await fs.remove(directory);
                },
            };
        }

        it('preserves database row and both files when a blocking event aborts deletion', async () => {
            const f = await fixture();
            let abort = true;
            server.app.get(EventBus).registerBlockingEventHandler({
                event: AssetEvent,
                id: 'audit-asset-delete-failure',
                handler: event => {
                    if (abort && event.type === 'deleted' && String(event.entity.id) === String(f.asset.id))
                        throw new Error('injected event failure');
                },
            });
            try {
                await expect(f.removeAsset(f.ctx)).rejects.toThrow('injected event failure');
                expect(
                    await f.connection.getRepository(f.ctx, Asset).findOneBy({ id: f.asset.id }),
                ).not.toBeNull();
                expect(await fs.pathExists(f.source)).toBe(true);
                expect(await fs.pathExists(f.preview)).toBe(true);
                expect(f.remove).not.toHaveBeenCalled();
            } finally {
                abort = false;
                await f.clean();
            }
        });

        it('keeps files and the row when an outer transaction rolls back after enqueue', async () => {
            const f = await fixture();
            try {
                await expect(
                    f.connection.withTransaction(f.ctx, async ctx => {
                        await f.removeAsset(ctx);
                        expect(await fs.pathExists(f.source)).toBe(true);
                        throw new Error('injected outer rollback');
                    }),
                ).rejects.toThrow('injected outer rollback');
                await server.app.get(JobQueueService).start();
                expect(
                    await f.connection.getRepository(f.ctx, Asset).findOneBy({ id: f.asset.id }),
                ).not.toBeNull();
                expect(f.remove).not.toHaveBeenCalled();
            } finally {
                await f.clean();
            }
        });

        it('retries a partial storage failure after commit without losing the cleanup job', async () => {
            const f = await fixture();
            let failPreview = true;
            f.remove.mockImplementation(async file => {
                if (file === f.preview && failPreview) {
                    failPreview = false;
                    throw new Error('synthetic transient storage failure');
                }
                await fs.unlink(file);
            });
            try {
                await f.removeAsset(f.ctx);
                await vi.waitFor(
                    async () => {
                        expect(await fs.pathExists(f.source)).toBe(false);
                        expect(await fs.pathExists(f.preview)).toBe(false);
                    },
                    { timeout: 10000 },
                );
                expect(
                    await f.connection.getRepository(f.ctx, Asset).findOneBy({ id: f.asset.id }),
                ).toBeNull();
                expect(f.remove.mock.calls.filter(([file]) => file === f.source)).toHaveLength(1);
                expect(f.remove.mock.calls.filter(([file]) => file === f.preview)).toHaveLength(2);
            } finally {
                await f.clean();
            }
        });
    });
});
