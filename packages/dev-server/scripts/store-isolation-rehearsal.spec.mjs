import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createSyntheticRehearsalSource, openSyntheticRehearsal } from './store-isolation-rehearsal.mjs';

const fixturePromise = createSyntheticRehearsalSource();
async function engineForTest() {
    const fixture = await fixturePromise;
    return openSyntheticRehearsal(fixture.source, fixture.manifest);
}

test('default plan makes no database change and refuses arbitrary database handles or production modes', async () => {
    const fixture = await fixturePromise;
    const engine = await engineForTest();
    try {
        const before = engine.summary();
        assert.equal(engine.plan().mode, 'plan-only');
        assert.deepEqual(engine.summary(), before);
        assert.throws(
            () => openSyntheticRehearsal({ database: '/production.sqlite' }, fixture.manifest),
            /internally generated/u,
        );
        assert.throws(
            () => openSyntheticRehearsal(fixture.source, { ...fixture.manifest, mode: 'apply' }),
            /No production/u,
        );
    } finally {
        engine.close();
    }
});

test('precise transaction changes only approved references and preserves all original rows, money, ledger, stock and iCloud data', async () => {
    const engine = await engineForTest();
    try {
        const before = engine.summary();
        const receipt = engine.rehearse();
        const after = engine.summary();
        assert.notEqual(after.sha256, before.sha256);
        assert.equal(receipt.operations.length, 21);
        assert.deepEqual(after.rows, before.rows);
        assert.deepEqual(after.protected, before.protected);
        assert.deepEqual(after.protected.walletsByCurrency, { MYR: [5, 0, 0], USD: [17, 3, 2] });
        for (const table of [
            'order',
            'address',
            'referral_wallet',
            'referral_ledger_entry',
            'stock_level',
            'stock_movement',
            'customer_coupon',
            'coupon_ledger_entry',
            'coupon_order_allocation',
            'after_sales_request',
            'customer_delivery_email',
            'icloud_primary_account',
            'user',
            'authentication_method',
            'session',
            'api_key',
        ])
            assert.equal(after.protected.tableDigests[table], before.protected.tableDigests[table], table);
        assert.equal(after.originalSourceUnchanged, true);
        assert.equal(receipt.productionReady, false);
        assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_|passwordHash|verificationToken|apiKeyHash/u);
    } finally {
        engine.close();
    }
});

test('same manifest repeats without another update and returned journal cannot mutate internal state', async () => {
    const engine = await engineForTest();
    try {
        const original = engine.summary();
        const receipt = engine.rehearse();
        const applied = engine.summary();
        const retry = engine.rehearse();
        assert.equal(retry.status, 'already-applied');
        retry.operations[0].after = 999;
        assert.deepEqual(engine.summary(), applied);
        engine.rollback(receipt);
        assert.deepEqual(engine.summary(), original);
    } finally {
        engine.close();
    }
});

test('every injected partial transaction failure rolls back all prior updates', async () => {
    const { manifest } = await fixturePromise;
    for (const index of [1, Math.floor(manifest.operations.length / 2), manifest.operations.length]) {
        const engine = await engineForTest();
        try {
            const before = engine.summary();
            assert.throws(
                () => engine.rehearse({ failAfterWrite: index }),
                /Injected synthetic transaction failure/u,
            );
            assert.deepEqual(engine.summary(), before);
            assert.equal(engine.rehearse().status, 'applied');
        } finally {
            engine.close();
        }
    }
});

test('baseline drift prevents both planning and writes', async () => {
    const engine = await engineForTest();
    try {
        engine.simulateSyntheticDrift();
        const drifted = engine.summary();
        assert.throws(() => engine.plan(), /Baseline drift/u);
        assert.throws(() => engine.rehearse(), /Baseline drift/u);
        assert.deepEqual(engine.summary(), drifted);
    } finally {
        engine.close();
    }
});

test('post-commit rollback is exact and a failed rollback preserves the complete committed state', async () => {
    const engine = await engineForTest();
    try {
        const before = engine.summary();
        const receipt = engine.rehearse();
        const applied = engine.summary();
        assert.throws(
            () => engine.rollback(receipt, { failAfterWrite: 7 }),
            /Injected synthetic rollback failure/u,
        );
        assert.deepEqual(engine.summary(), applied);
        const result = engine.rollback(receipt);
        assert.equal(result.restoredSha256, before.sha256);
        assert.deepEqual(engine.summary(), before);
        assert.throws(() => engine.rollback(receipt), /No committed rehearsal/u);
    } finally {
        engine.close();
    }
});

test('later business changes prevent automatic retry and rollback rather than overwriting new data', async () => {
    const engine = await engineForTest();
    try {
        const receipt = engine.rehearse();
        engine.simulateSyntheticDrift();
        const drifted = engine.summary();
        assert.throws(() => engine.rehearse(), /State drift after commit/u);
        assert.throws(() => engine.rollback(receipt), /later changes/u);
        assert.deepEqual(engine.summary(), drifted);
    } finally {
        engine.close();
    }
});

test('unknown fields, dependencies, ambiguous ownership, partial mappings and credential or balance writes are rejected', async () => {
    const fixture = await fixturePromise;
    const edits = [
        plan => {
            plan.review.unreviewedFields = ['address.customFields'];
        },
        plan => {
            plan.review.unknownDependencies = ['unknown.customerId'];
        },
        plan => {
            plan.operations[0].channelId = null;
        },
        plan => {
            plan.operations.pop();
        },
        plan => {
            plan.operations.push({ ...plan.operations[0] });
        },
        plan => {
            plan.operations[0].table = 'user';
            plan.operations[0].column = 'passwordHash';
        },
        plan => {
            plan.operations[0].table = 'referral_wallet';
            plan.operations[0].column = 'availableBalance';
        },
        plan => {
            plan.icloud.policy = 'per-channel';
        },
    ];
    for (const edit of edits) {
        const plan = structuredClone(fixture.manifest);
        edit(plan);
        assert.throws(
            () => openSyntheticRehearsal(fixture.source, plan),
            /not the reviewed synthetic mapping/u,
        );
    }
});

test('tampered reverse journals are rejected and unrelated original files remain byte-identical', async () => {
    const parent = fileURLToPath(
        new URL('../../../reports/pending-migrations-20260913/fixtures/', import.meta.url),
    );
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'executor-'));
    const original = path.join(root, 'original-delivery.txt');
    await writeFile(original, 'SYNTHETIC_ORIGINAL_DELIVERY');
    const hash = async () =>
        createHash('sha256')
            .update(await readFile(original))
            .digest('hex');
    const beforeHash = await hash();
    const engine = await engineForTest();
    try {
        const receipt = engine.rehearse();
        assert.throws(
            () => engine.rollback({ ...receipt, beforeSha256: '0'.repeat(64) }),
            /changed rollback journal/u,
        );
        engine.rollback(receipt);
        assert.equal(await hash(), beforeHash);
    } finally {
        engine.close();
        await rm(root, { recursive: true, force: true });
    }
});
