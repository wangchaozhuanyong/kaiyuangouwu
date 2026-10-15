import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataSource } from 'typeorm';

import {
    applyGeneratedReset,
    collectGeneratedResetPlan,
    publicGeneratedResetPlan,
} from './prelaunch-generated-data-reset.mjs';

async function fixture(extra = []) {
    const db = new DataSource({ type: 'sqljs', entities: [], synchronize: false });
    await db.initialize();
    const runner = db.createQueryRunner();
    for (const sql of [
        'PRAGMA foreign_keys=ON',
        'CREATE TABLE product(id INTEGER PRIMARY KEY,name TEXT)',
        "INSERT INTO product VALUES(1,'keep product')",
        'CREATE TABLE image_private_asset(id INTEGER PRIMARY KEY,path TEXT)',
        "INSERT INTO image_private_asset VALUES(99,'keep image')",
        'CREATE TABLE storefront_content_item(id INTEGER PRIMARY KEY,imageId INTEGER REFERENCES image_private_asset(id))',
        'INSERT INTO storefront_content_item VALUES(5,99)',
        'CREATE TABLE storefront_cart(id INTEGER PRIMARY KEY)',
        'INSERT INTO storefront_cart VALUES(1)',
        'CREATE TABLE storefront_cart_line(id INTEGER PRIMARY KEY,cartId INTEGER REFERENCES storefront_cart(id),productId INTEGER REFERENCES product(id))',
        'INSERT INTO storefront_cart_line VALUES(2,1,1)',
        'CREATE TABLE storefront_cart_command_receipt(id INTEGER PRIMARY KEY,cartId INTEGER REFERENCES storefront_cart(id))',
        'INSERT INTO storefront_cart_command_receipt VALUES(3,1)',
        'CREATE TABLE customer_coupon(id INTEGER PRIMARY KEY)',
        'INSERT INTO customer_coupon VALUES(4)',
        'CREATE TABLE coupon_ledger_entry(id INTEGER PRIMARY KEY,customerCouponId INTEGER REFERENCES customer_coupon(id))',
        'INSERT INTO coupon_ledger_entry VALUES(5,4)',
        'CREATE TABLE referral_wallet(id INTEGER PRIMARY KEY,availableBalance INTEGER,pendingBalance INTEGER,reservedBalance INTEGER,version INTEGER,customerId INTEGER)',
        'INSERT INTO referral_wallet VALUES(6,100,0,0,1,1)',
        'CREATE TABLE referral_ledger_entry(id INTEGER PRIMARY KEY,walletId INTEGER REFERENCES referral_wallet(id))',
        'INSERT INTO referral_ledger_entry VALUES(7,6)',
        'CREATE TABLE customer_operations_profile(id INTEGER PRIMARY KEY,orderCount INTEGER,lastOrderAt TEXT,' +
            'currencyMetricsJson TEXT,evaluationVersion TEXT,doNotContact INTEGER,note TEXT)',
        "INSERT INTO customer_operations_profile VALUES(8,5,'2026-10-01','{}','v1',1,'keep preference')",
        'CREATE TABLE job_record(id INTEGER PRIMARY KEY,state TEXT,queueName TEXT)',
        "INSERT INTO job_record VALUES(1,'COMPLETED','send-email'),(2,'RUNNING','product-translation'),(3,'RUNNING','send-email'),(4,'PENDING','product-import')",
        'CREATE TABLE image_generation_job(id INTEGER PRIMARY KEY,state TEXT,referenceAssetId INTEGER REFERENCES image_private_asset(id))',
        "INSERT INTO image_generation_job VALUES(10,'SUCCEEDED',99)",
        'CREATE TABLE image_generation_output(id INTEGER PRIMARY KEY,jobId INTEGER REFERENCES image_generation_job(id),' +
            'assetId INTEGER REFERENCES image_private_asset(id))',
        'INSERT INTO image_generation_output VALUES(11,10,99)',
        'CREATE TABLE image_generation_dispatch(id INTEGER PRIMARY KEY,outputId INTEGER REFERENCES image_generation_output(id))',
        'INSERT INTO image_generation_dispatch VALUES(12,11)',
        ...extra,
    ])
        await runner.query(sql);
    const metadata = await runner.getTables();
    const schemas = metadata.map(t => ({
        name: t.name,
        columns: t.columns.map(c => c.name),
        primaryKeys: t.primaryColumns.map(c => c.name),
        foreignKeys: t.foreignKeys.map(f => ({
            columns: f.columnNames,
            target: f.referencedTableName,
            targetColumns: f.referencedColumnNames,
        })),
    }));
    return {
        runner,
        schemas,
        close: async () => {
            await runner.release();
            await db.destroy();
        },
    };
}
test('generated reset removes history in FK order while keeping images, catalog, preferences and unfinished catalog work', async () => {
    const c = await fixture();
    try {
        const plan = await collectGeneratedResetPlan(c.runner, c.schemas);
        assert.equal(publicGeneratedResetPlan(plan).canApply, true, JSON.stringify(plan.blockers));
        await applyGeneratedReset(c.runner, plan, plan.planHash);
        for (const table of [
            'storefront_cart',
            'storefront_cart_line',
            'storefront_cart_command_receipt',
            'customer_coupon',
            'coupon_ledger_entry',
            'image_generation_job',
            'image_generation_output',
            'image_generation_dispatch',
            'referral_ledger_entry',
        ])
            assert.equal((await c.runner.query('SELECT COUNT(*) AS n FROM ' + table))[0].n, 0);
        assert.equal((await c.runner.query('SELECT name FROM product'))[0].name, 'keep product');
        assert.equal((await c.runner.query('SELECT path FROM image_private_asset'))[0].path, 'keep image');
        assert.equal((await c.runner.query('SELECT COUNT(*) AS n FROM storefront_content_item'))[0].n, 1);
        assert.deepEqual(
            (await c.runner.query('SELECT id FROM job_record ORDER BY id')).map(r => r.id),
            [2, 4],
        );
        assert.deepEqual(await c.runner.query('SELECT availableBalance,customerId FROM referral_wallet'), [
            { availableBalance: 0, customerId: 1 },
        ]);
        assert.deepEqual(
            await c.runner.query('SELECT orderCount,doNotContact,note FROM customer_operations_profile'),
            [{ orderCount: 0, doNotContact: 1, note: 'keep preference' }],
        );
    } finally {
        await c.close();
    }
});
test('unknown incoming dependencies block instead of relying on cascade deletion', async () => {
    const c = await fixture([
        'CREATE TABLE future_protected_link(id INTEGER PRIMARY KEY,cartId INTEGER REFERENCES storefront_cart(id))',
        'INSERT INTO future_protected_link VALUES(1,1)',
    ]);
    try {
        const p = await collectGeneratedResetPlan(c.runner, c.schemas);
        assert.ok(p.blockers.some(b => b.code === 'RETAINED_INCOMING_REFERENCE'));
        await assert.rejects(() => applyGeneratedReset(c.runner, p, p.planHash));
        assert.equal((await c.runner.query('SELECT COUNT(*) AS n FROM storefront_cart'))[0].n, 1);
    } finally {
        await c.close();
    }
});
test('SQL failure rolls back both baseline updates and earlier deletions', async () => {
    const c = await fixture([
        "CREATE TRIGGER fail_reset BEFORE DELETE ON customer_coupon BEGIN SELECT RAISE(ABORT,'forced fixture error'); END",
    ]);
    try {
        const p = await collectGeneratedResetPlan(c.runner, c.schemas);
        await assert.rejects(() => applyGeneratedReset(c.runner, p, p.planHash));
        assert.equal(
            (await c.runner.query('SELECT availableBalance FROM referral_wallet'))[0].availableBalance,
            100,
        );
        assert.equal((await c.runner.query('SELECT COUNT(*) AS n FROM image_generation_job'))[0].n, 1);
    } finally {
        await c.close();
    }
});
test('MySQL cast string IDs and native numeric IDs describe the same post-order graph', async () => {
    const c = await fixture();
    try {
        const plan = await collectGeneratedResetPlan(c.runner, c.schemas, {
            orderPlan: {
                planHash: 'fixture',
                deletes: [
                    { table: 'storefront_cart', identity: { id: '1' } },
                    { table: 'storefront_cart_line', identity: { id: '2' } },
                    { table: 'storefront_cart_command_receipt', identity: { id: '3' } },
                ],
                patches: [],
            },
        });
        assert.equal(plan.deletes.storefront_cart.length, 0);
        assert.equal(plan.deletes.storefront_cart_line.length, 0);
        assert.equal(plan.deletes.storefront_cart_command_receipt.length, 0);
    } finally {
        await c.close();
    }
});
test('new generated data after freeze rejects the plan before any write', async () => {
    const c = await fixture();
    try {
        const p = await collectGeneratedResetPlan(c.runner, c.schemas);
        await c.runner.query('INSERT INTO storefront_cart VALUES(9)');
        await assert.rejects(() => applyGeneratedReset(c.runner, p, p.planHash), /changed since/);
        assert.equal(
            (await c.runner.query('SELECT availableBalance FROM referral_wallet'))[0].availableBalance,
            100,
        );
    } finally {
        await c.close();
    }
});
