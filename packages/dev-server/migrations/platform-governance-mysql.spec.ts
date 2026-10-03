import { CatalogResourceOwnership, Product, ProductVariant, RequestContext } from '@vendure/core';
import { spawn } from 'node:child_process';
import { Duplex } from 'node:stream';
import { DataSource, EntitySchema } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { CatalogGovernanceAccessStrategy } from '../../store-management-plugin/src/catalog-governance-access.strategy';
// @ts-ignore Fixed CI fixture only connects to the disposable loopback runner service.
import { createCiGovernanceDatabase } from '../scripts/platform-governance-ci-fixture.mjs';
import {
    connectCase,
    createCase,
    createLab,
    stopLab,
    verifyLab,
} from '../scripts/store-isolation-mysql-lab.mjs';

import { AddPlatformCatalogGovernance1790913600000 } from './1790913600000-add-platform-catalog-governance';
import { AddStorePaymentMethodState1790917200000 } from './1790917200000-add-store-payment-method-state';
// @ts-ignore Project-owned JavaScript lab validates its container, transport and manifest before opening it.

// Test only an owned synthetic MySQL container with no published ports or production credentials.
describe('platform governance MySQL schema rehearsal and row isolation', () => {
    it('rehearses the actual incremental migration, large receipts, scoped variant grants and atomic pool allocation', async () => {
        const ciFixture = process.env.PLATFORM_GOVERNANCE_CI_MYSQL === '1';
        const lab = ciFixture ? undefined : await createLab({ subnet: 'synthetic-auto' });
        let ds: DataSource | undefined;
        try {
            let databaseOptions;
            if (ciFixture) {
                databaseOptions = await createCiGovernanceDatabase();
            } else {
                if (!lab) throw new Error('Owned fixture lab missing');
                const file = await createCase(lab);
                const opened = await connectCase(file);
                const database = opened.manifest.database;
                await opened.connection.end();
                const descriptor = await verifyLab(lab);
                const stream = () => {
                    const child = spawn(
                        'docker',
                        [
                            '--host',
                            descriptor.endpoint,
                            'exec',
                            '-i',
                            descriptor.containerId,
                            'bash',
                            '-c',
                            'exec 3<>/dev/tcp/127.0.0.1/3306 || exit 1; cat <&3 & reader=$!; cat >&3; kill "$reader" 2>/dev/null; wait',
                        ],
                        { stdio: ['pipe', 'pipe', 'ignore'] },
                    );
                    const duplex = Duplex.from({ readable: child.stdout, writable: child.stdin });
                    child.once('error', e => duplex.destroy(e));
                    duplex.once('close', () => child.kill());
                    return duplex;
                };
                databaseOptions = {
                    type: 'mysql' as const,
                    connectorPackage: 'mysql2',
                    database,
                    username: 'root',
                    password: '',
                    extra: { stream, connectionLimit: 3 },
                };
            }
            // Minimal schemas exercise the actual ACL SQL against native table/column names.
            const entities = [
                new EntitySchema({
                    name: 'Product',
                    target: Product,
                    tableName: 'product',
                    columns: { id: { type: Number, primary: true } },
                }),
                new EntitySchema({
                    name: 'ProductVariant',
                    target: ProductVariant,
                    tableName: 'product_variant',
                    columns: { id: { type: Number, primary: true }, productId: { type: Number } },
                }),
                new EntitySchema({
                    name: 'CatalogResourceOwnership',
                    target: CatalogResourceOwnership,
                    tableName: 'catalog_resource_ownership',
                    columns: {
                        id: { type: Number, primary: true },
                        resourceType: { type: String },
                        resourceId: { type: Number },
                        ownerChannelId: { type: Number },
                        scope: { type: String },
                    },
                }),
            ];
            ds = new DataSource({
                ...databaseOptions,
                entities,
                synchronize: false,
                logging: false,
            });
            await ds.initialize();
            const runner = ds.createQueryRunner();
            const migration = new AddPlatformCatalogGovernance1790913600000();
            await migration.up(runner);
            await new AddStorePaymentMethodState1790917200000().up(runner);
            await new AddStorePaymentMethodState1790917200000().up(runner);
            expect(await runner.hasTable('store_payment_method_state')).toBe(true);
            await migration.up(runner); // Resuming schema setup must retain all prior data.
            const metadata = await runner.getTable('catalog_distribution_batch');
            expect(metadata?.findColumnByName('items')?.type).toBe('longtext');
            const huge = JSON.stringify(
                Array.from({ length: 10000 }, (_, i) => ({
                    productId: String(i),
                    channelId: '3',
                    fingerprint: 'a'.repeat(64),
                })),
            );
            await runner.query(
                "INSERT INTO catalog_distribution_batch(idempotencyKey,actorUserId,inputHash,state,input,items,results) VALUES (?,1,?,'PREVIEW','{}',?,'[]')",
                ['mysql-governance-proof', 'a'.repeat(64), huge],
            );
            expect(
                Number(
                    (
                        await runner.query(
                            'SELECT OCTET_LENGTH(items) AS bytes FROM catalog_distribution_batch',
                        )
                    )[0].bytes,
                ),
            ).toBeGreaterThan(65535);
            await runner.query(
                "INSERT INTO catalog_resource_ownership(resourceType,resourceId,ownerChannelId,scope) VALUES ('Product',100,2,'STORE')",
            );
            await runner.query(
                'INSERT INTO product_sales_authorization' +
                    '(productId,channelId,sourceChannelId,state,variantIds,pendingVariantIds,version) ' +
                    `VALUES (100,3,2,'ACTIVE','["101","102"]','["102"]',1)`,
            );
            // Add fixture identities in tables with a minimal select surface, never overwrite existing fixture rows.
            if (!(await runner.hasTable('product')))
                await runner.query('CREATE TABLE product (id INT PRIMARY KEY)');
            if (!(await runner.hasTable('product_channels_channel')))
                await runner.query('CREATE TABLE product_channels_channel (productId INT, channelId INT)');
            if (!(await runner.hasTable('channel')))
                await runner.query('CREATE TABLE channel (id INT PRIMARY KEY, code VARCHAR(255))');
            if (!(await runner.hasTable('product_variant')))
                await runner.query('CREATE TABLE product_variant (id INT PRIMARY KEY, productId INT)');
            if (!(await runner.hasTable('product_variant_channels_channel')))
                await runner.query(
                    'CREATE TABLE product_variant_channels_channel (productVariantId INT, channelId INT)',
                );
            const originalProducts = await runner.query('SELECT id FROM product WHERE id=100');
            if (!originalProducts.length) await runner.query('INSERT INTO product(id) VALUES (100)');
            // QueryBuilder SQL is validated by MySQL (not by a string assertion or a mocked database).
            const strategy = new CatalogGovernanceAccessStrategy();
            const ctx = { channelId: 3, channel: { id: 3, code: 'b' }, apiType: 'shop' } as RequestContext;
            const qb = ds.getRepository(Product).createQueryBuilder('product');
            strategy.applyAccessControl(qb, Product, ctx);
            expect((await qb.getMany()).map(p => p.id)).toContain(100);
            await runner.query(
                "UPDATE product_sales_authorization SET state='PAUSED' WHERE productId=100 AND channelId=3",
            );
            const paused = ds.getRepository(Product).createQueryBuilder('product');
            strategy.applyAccessControl(paused, Product, ctx);
            expect((await paused.getMany()).map(p => p.id)).not.toContain(100);
            const variantSql = ds.getRepository(ProductVariant).createQueryBuilder('variant');
            strategy.applyAccessControl(variantSql, ProductVariant, ctx);
            await variantSql.getMany(); // JSON_CONTAINS and pending scope must execute successfully.
            // Actual InnoDB conditional allocation: two simultaneous sales can consume one available record once.
            await runner.query(
                'CREATE TABLE governance_pool_probe (id INT PRIMARY KEY, state VARCHAR(16), deliveryId INT NULL) ENGINE=InnoDB',
            );
            await runner.query("INSERT INTO governance_pool_probe VALUES (1,'AVAILABLE',NULL)");
            const races = await Promise.all([
                ds.query(
                    "UPDATE governance_pool_probe SET state='ASSIGNED',deliveryId=1 WHERE id=1 AND state='AVAILABLE'",
                ),
                ds.query(
                    "UPDATE governance_pool_probe SET state='ASSIGNED',deliveryId=2 WHERE id=1 AND state='AVAILABLE'",
                ),
            ]);
            expect(races.reduce((n, r) => n + r.affectedRows, 0)).toBe(1);
            const after = await runner.query('SELECT state,deliveryId FROM governance_pool_probe');
            expect(after[0].state).toBe('ASSIGNED');
            await runner.release();
        } finally {
            await ds?.destroy();
            if (lab) await stopLab(lab);
        }
    }, 120000);
});
