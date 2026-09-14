import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DataSource, Table } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    applyImageBillingReview,
    billingEvidenceHash,
    inspectImageBillingTarget,
    validateBillingReview,
    type ImageBillingReview,
} from '../../image-generation-plugin/src/image-provider-billing-review';

import { AddImageProviderBillingAudit1789300800000 } from './1789300800000-add-image-provider-billing-audit';

const migration = new AddImageProviderBillingAudit1789300800000();

describe('image supplier billing audit migration', () => {
    it.each(process.env.DB === 'mysql' ? ['sqljs', 'mysql'] : ['sqljs'])(
        'keeps legacy rows intact and is repeatable (%s)',
        async type => {
            const fixture = await createFixture(type);
            const runner = fixture.source.createQueryRunner();
            try {
                const before = await rows(fixture.source, 'image_generation_cost_event');
                await migration.up(runner);
                await migration.up(runner);
                expect(await rows(fixture.source, 'image_generation_cost_event')).toEqual(before);
                expect(await rows(fixture.source, 'image_provider_cost_adjustment')).toEqual([]);
                await expect(migration.down()).rejects.toThrow('不可自动删除');
                expect(await runner.hasTable('image_provider_billing_link')).toBe(true);
            } finally {
                await runner.release();
                await fixture.close();
            }
        },
    );
});

describe.skipIf(process.env.DB !== 'mysql')('image billing review transactions (local MySQL)', () => {
    let fixture: Awaited<ReturnType<typeof createFixture>>;
    let source: DataSource;
    beforeEach(async () => {
        fixture = await createFixture('mysql');
        source = fixture.source;
    });
    afterEach(async () => {
        await fixture?.close();
    });

    it('defaults to dry-run and changes no money or audit rows', async () => {
        const review = await reviewFor(source);
        const before = await rows(source, 'image_generation_cost_event');
        expect(await applyImageBillingReview(source, review)).toMatchObject({ status: 'DRY_RUN' });
        expect(await rows(source, 'image_generation_cost_event')).toEqual(before);
        expect(await rows(source, 'image_provider_cost_adjustment')).toEqual([]);
        expect(await rows(source, 'image_provider_billing_link')).toEqual([]);
    });

    it('persists provenance exactly once without changing timestamps, provider evidence or customer charge', async () => {
        const review = await reviewFor(source);
        const before = (await rows(source, 'image_generation_cost_event'))[0];
        const result = await applyImageBillingReview(source, review, true);
        expect(result.status).toBe('APPLIED');
        expect(await applyImageBillingReview(source, review, true)).toMatchObject({
            status: 'ALREADY_APPLIED',
            superseded: false,
        });
        const target = (await rows(source, 'image_generation_cost_event'))[0];
        expect(target).toEqual({ ...before, actualCostMicrounits: 1250, costCurrency: 'USD' });
        const audits = await rows(source, 'image_provider_cost_adjustment');
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
            oldCostMicrounits: null,
            newCostMicrounits: 1250,
            reviewer: 'test-reviewer',
            authorizationRef: 'test-approval',
            matchingStatus: 'CROSS_MATCH_REVIEWED',
        });
        expect(JSON.parse(audits[0].supplierBills)).toEqual(review.bills);
        expect(await rows(source, 'image_provider_billing_link')).toHaveLength(1);
    });

    it('executes the built operator CLI with a digest-bound manifest and separate receipts', async () => {
        const directory = mkdtempSync(path.join(process.cwd(), '.billing-cli-fixture-'));
        try {
            const review = await reviewFor(source);
            const bytes = JSON.stringify({ version: 1, reviews: [review] });
            const manifest = path.join(directory, 'review.json');
            writeFileSync(manifest, bytes);
            const script = path.resolve('../image-generation-plugin/dist/image-provider-billing-cli.js');
            const dbOptions = source.options as { database: string };
            const environment = {
                ...process.env,
                DB_HOST: '127.0.0.1',
                DB_PORT: String(process.env.E2E_MYSQL_PORT ?? 13370),
                DB_USERNAME: 'root',
                DB_PASSWORD: 'password',
                DB_NAME: dbOptions.database,
            };
            const execute = (name: string, extra: string[] = []) => {
                const output = path.join(directory, name);
                execFileSync(
                    process.execPath,
                    [script, '--manifest', manifest, '--output', output, ...extra],
                    { env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
                );
                return JSON.parse(readFileSync(output, 'utf8'));
            };
            expect(execute('dry-run.json').mode).toBe('DRY_RUN');
            expect(await rows(source, 'image_provider_cost_adjustment')).toEqual([]);
            const flags = [
                '--apply',
                '--confirm-manifest-sha',
                createHash('sha256').update(bytes).digest('hex'),
            ];
            expect(execute('apply.json', flags).results[0].status).toBe('APPLIED');
            expect(execute('repeat.json', flags).results[0].status).toBe('ALREADY_APPLIED');
            expect(await rows(source, 'image_provider_cost_adjustment')).toHaveLength(1);
            expect(statSync(path.join(directory, 'apply.json')).mode % 0o1000).toBe(0o600);
            const journal = readFileSync(path.join(directory, 'apply.json.journal.jsonl'), 'utf8')
                .trim()
                .split('\n')
                .map(line => JSON.parse(line));
            expect(journal[0]).toMatchObject({ status: 'RUNNING', results: [] });
            expect(journal.at(-1)).toMatchObject({ status: 'COMPLETE', activeTarget: null });
            expect(journal.some(item => item.activeTarget?.recordId === review.recordId)).toBe(true);
        } finally {
            rmSync(directory, { recursive: true });
        }
    });

    it('rejects unavailable or already-owned receipt paths before applying any costs', async () => {
        await withCliFixture(source, [await reviewFor(source)], async ({ directory, execute }) => {
            const reserved = path.join(directory, 'reserved.json');
            writeFileSync(reserved, 'original receipt');
            const target = path.join(directory, 'symlink.json');
            symlinkSync(reserved, target);
            writeFileSync(path.join(directory, 'journal-conflict.json.journal.jsonl'), 'original journal');
            for (const name of [
                'missing-parent/result.json',
                'reserved.json',
                'symlink.json',
                'journal-conflict.json',
            ]) {
                expect(execute(name).status).not.toBe(0);
                expect(await rows(source, 'image_provider_cost_adjustment')).toEqual([]);
                expect(await rows(source, 'image_provider_billing_link')).toEqual([]);
                expect(
                    (await rows(source, 'image_generation_cost_event'))[0].actualCostMicrounits,
                ).toBeNull();
            }
            expect(readFileSync(reserved, 'utf8')).toBe('original receipt');
            expect(readFileSync(path.join(directory, 'journal-conflict.json.journal.jsonl'), 'utf8')).toBe(
                'original journal',
            );
        });
    });

    it('keeps partial receipts when a later transaction fails and resumes without duplicate bills', async () => {
        const first = await reviewFor(source, '1');
        const second = await reviewFor(source, '2');
        second.bills[0].billId = 'client:second-fixture-bill';
        await source.query(`CREATE TRIGGER billing_cli_failure BEFORE UPDATE ON image_generation_cost_event
            FOR EACH ROW BEGIN IF NEW.id = 2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fixture failure'; END IF; END`);
        await withCliFixture(source, [first, second], async ({ directory, execute }) => {
            expect(execute('partial.json').status).toBe(1);
            const report = JSON.parse(readFileSync(path.join(directory, 'partial.json'), 'utf8'));
            expect(report).toMatchObject({
                status: 'FAILED',
                error: 'ER_SIGNAL_EXCEPTION',
                activeTarget: { recordId: '2' },
            });
            expect(report.results).toHaveLength(1);
            expect(report.results[0].status).toBe('APPLIED');
            const journal = readFileSync(path.join(directory, 'partial.json.journal.jsonl'), 'utf8')
                .trim()
                .split('\n')
                .map(line => JSON.parse(line));
            expect(
                journal.some(
                    item =>
                        item.status === 'RUNNING' && item.results.length === 1 && item.activeTarget === null,
                ),
            ).toBe(true);
            expect(await rows(source, 'image_provider_cost_adjustment')).toHaveLength(1);
            expect(await rows(source, 'image_provider_billing_link')).toHaveLength(1);
            await source.query('DROP TRIGGER billing_cli_failure');
            expect(execute('resumed.json').status).toBe(0);
            const resumed = JSON.parse(readFileSync(path.join(directory, 'resumed.json'), 'utf8'));
            expect(resumed.results.map((item: { status: string }) => item.status)).toEqual([
                'ALREADY_APPLIED',
                'APPLIED',
            ]);
            expect(await rows(source, 'image_provider_cost_adjustment')).toHaveLength(2);
            expect(await rows(source, 'image_provider_billing_link')).toHaveLength(2);
        });
    });

    it('records a database connection failure without losing the startup receipt', async () => {
        await withCliFixture(source, [await reviewFor(source)], async ({ directory, execute }) => {
            const result = execute('connection-failure.json', {
                DB_NAME: `missing_billing_fixture_${randomUUID().replaceAll('-', '')}`,
            });
            expect(result.status).toBe(1);
            const receipt = JSON.parse(readFileSync(path.join(directory, 'connection-failure.json'), 'utf8'));
            expect(receipt).toMatchObject({
                status: 'FAILED',
                error: 'ER_BAD_DB_ERROR',
                activeTarget: null,
                results: [],
            });
            expect(receipt.completedAt).toBeTruthy();
            expect(await rows(source, 'image_provider_cost_adjustment')).toEqual([]);
        });
    });

    it('reviews completed prompt attempts through the CLI and derives the parent cost without changing business fields', async () => {
        const first = await reviewFor(source, '1', 'PROMPT_ATTEMPT');
        const second = await reviewFor(source, '2', 'PROMPT_ATTEMPT');
        second.bills[0].billId = 'client:second-prompt-bill';
        const beforeAttempts = await rows(source, 'image_prompt_optimization_attempt');
        const beforeParent = (await rows(source, 'image_prompt_optimization'))[1];
        await withCliFixture(source, [first, second], ({ execute }) => {
            expect(execute('prompt-apply.json').status).toBe(0);
            expect(execute('prompt-repeat.json').status).toBe(0);
        });
        expect((await rows(source, 'image_prompt_optimization'))[1]).toEqual({
            ...beforeParent,
            actualCostMicrounits: 2500,
            costCurrency: 'USD',
        });
        expect(await rows(source, 'image_prompt_optimization_attempt')).toEqual(
            beforeAttempts.map(attempt => ({
                ...attempt,
                actualCostMicrounits: 1250,
                costCurrency: 'USD',
            })),
        );
        const revert = {
            ...first,
            ...(await reviewFor(source, '1', 'PROMPT_ATTEMPT')),
            batchId: 'prompt-revert',
            newCostMicrounits: null,
            newCurrency: null,
            bills: first.bills,
        };
        await applyImageBillingReview(source, revert, true);
        expect((await rows(source, 'image_prompt_optimization'))[1]).toEqual(beforeParent);
        expect(await rows(source, 'image_provider_cost_adjustment')).toHaveLength(3);
        expect(await rows(source, 'image_provider_billing_link')).toHaveLength(2);
    });

    it('serializes concurrent reviews of different attempts under the same prompt', async () => {
        const first = await reviewFor(source, '1', 'PROMPT_ATTEMPT');
        const second = await reviewFor(source, '2', 'PROMPT_ATTEMPT');
        second.bills[0].billId = 'client:parallel-prompt-bill';
        await Promise.all([
            applyImageBillingReview(source, first, true),
            applyImageBillingReview(source, second, true),
        ]);
        expect((await rows(source, 'image_prompt_optimization'))[1]).toMatchObject({
            actualCostMicrounits: 2500,
            costCurrency: 'USD',
        });
        const results = await Promise.all([
            applyImageBillingReview(source, first, true),
            applyImageBillingReview(source, second, true),
        ]);
        expect(results.every(result => result.status === 'ALREADY_APPLIED')).toBe(true);
        expect(await rows(source, 'image_provider_cost_adjustment')).toHaveLength(2);
    });

    it('keeps partial, mixed-currency and overflowing prompt totals unknown', async () => {
        const first = await reviewFor(source, '1', 'PROMPT_ATTEMPT');
        const second = await reviewFor(source, '2', 'PROMPT_ATTEMPT');
        second.bills[0] = { ...second.bills[0], billId: 'client:euro-prompt-bill', currency: 'EUR' };
        second.newCurrency = 'EUR';
        await applyImageBillingReview(source, first, true);
        expect((await rows(source, 'image_prompt_optimization'))[1]).toMatchObject({
            actualCostMicrounits: null,
            costCurrency: null,
        });
        await applyImageBillingReview(source, second, true);
        expect((await rows(source, 'image_prompt_optimization'))[1]).toMatchObject({
            actualCostMicrounits: null,
            costCurrency: null,
        });
        const changed = await reviewFor(source, '2', 'PROMPT_ATTEMPT');
        changed.batchId = 'large-prompt-correction';
        changed.newCurrency = 'USD';
        changed.newCostMicrounits = 2_147_483_647;
        changed.bills = [{ ...second.bills[0], currency: 'USD', amountMicrounits: 2_147_483_647 }];
        await applyImageBillingReview(source, changed, true);
        expect((await rows(source, 'image_prompt_optimization'))[1]).toMatchObject({
            actualCostMicrounits: null,
            costCurrency: 'USD',
        });
    });

    it('rejects active, incomplete, legacy or foreign prompt parents and an externally changed aggregate', async () => {
        const first = await reviewFor(source, '1', 'PROMPT_ATTEMPT');
        for (const patch of [
            { source: 'PENDING' },
            { upstreamCallCount: 3 },
            { attemptLedgerVersion: null },
            { channelId: 2 },
        ]) {
            await source
                .createQueryBuilder()
                .update('image_prompt_optimization')
                .set(patch)
                .where('id = 2')
                .execute();
            await expect(applyImageBillingReview(source, first, true)).rejects.toThrow();
            await source
                .createQueryBuilder()
                .update('image_prompt_optimization')
                .set({ source: 'MODEL', upstreamCallCount: 2, attemptLedgerVersion: 1, channelId: 1 })
                .where('id = 2')
                .execute();
        }
        await source.query('UPDATE image_prompt_optimization_attempt SET completedAt = NULL WHERE id = 2');
        await expect(applyImageBillingReview(source, first, true)).rejects.toThrow('已结束');
        await source.query(
            'UPDATE image_prompt_optimization_attempt SET completedAt = updatedAt WHERE id = 2',
        );
        expect(await rows(source, 'image_provider_cost_adjustment')).toHaveLength(0);
        await applyImageBillingReview(source, first, true);
        await source.query(
            "UPDATE image_prompt_optimization SET actualCostMicrounits = 1, costCurrency = 'USD' WHERE id = 2",
        );
        await expect(applyImageBillingReview(source, first, true)).rejects.toThrow('汇总被外部更改');
    });

    it('rolls back the attempt, bill ownership and audit when its parent update fails', async () => {
        const first = await reviewFor(source, '1', 'PROMPT_ATTEMPT');
        await source.query(`CREATE TRIGGER prompt_parent_failure BEFORE UPDATE ON image_prompt_optimization
            FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fixture parent failure'`);
        const before = await rows(source, 'image_prompt_optimization_attempt');
        await expect(applyImageBillingReview(source, first, true)).rejects.toThrow('fixture parent failure');
        expect(await rows(source, 'image_prompt_optimization_attempt')).toEqual(before);
        expect(await rows(source, 'image_provider_cost_adjustment')).toHaveLength(0);
        expect(await rows(source, 'image_provider_billing_link')).toHaveLength(0);
    });

    it('rejects changed evidence, cross-channel targeting, changed batch content and reused bills', async () => {
        const review = await reviewFor(source);
        await expect(
            applyImageBillingReview(source, { ...review, expectedSnapshotHash: 'f'.repeat(64) }, true),
        ).rejects.toThrow('旧值');
        await expect(applyImageBillingReview(source, { ...review, channelId: '2' }, true)).rejects.toThrow(
            '频道',
        );
        await applyImageBillingReview(source, review, true);
        await expect(applyImageBillingReview(source, { ...review, reason: 'changed' }, true)).rejects.toThrow(
            '批次内容',
        );
        await expect(applyImageBillingReview(source, await reviewFor(source, '2'), true)).rejects.toThrow(
            '归属其他',
        );
        expect(await rows(source, 'image_provider_cost_adjustment')).toHaveLength(1);
    });

    it('rejects unapproved, incomplete, fractional, negative and mixed-currency reviews', async () => {
        const review = await reviewFor(source);
        for (const patch of [
            { reviewStatus: 'PENDING' },
            { completeRange: false },
            { newCostMicrounits: -1 },
            { newCostMicrounits: 1.5 },
            { newCurrency: 'EUR' },
            { bills: [review.bills[0], review.bills[0]] },
            { newCostMicrounits: 0 },
        ]) {
            expect(() => validateBillingReview({ ...review, ...patch } as ImageBillingReview)).toThrow();
        }
        expect(await rows(source, 'image_provider_cost_adjustment')).toEqual([]);
    });

    it('serializes concurrent submissions for the same target', async () => {
        const review = await reviewFor(source);
        const results = await Promise.all([
            applyImageBillingReview(source, review, true),
            applyImageBillingReview(source, review, true),
        ]);
        expect(results.map(result => result.status).sort()).toEqual(['ALREADY_APPLIED', 'APPLIED']);
        expect(await rows(source, 'image_provider_cost_adjustment')).toHaveLength(1);
    });

    it('rolls back the losing concurrent claim of a supplier bill', async () => {
        const reviews = await Promise.all([reviewFor(source, '1'), reviewFor(source, '2')]);
        const results = await Promise.allSettled(
            reviews.map(review => applyImageBillingReview(source, review, true)),
        );
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(await rows(source, 'image_provider_cost_adjustment')).toHaveLength(1);
        expect(await rows(source, 'image_provider_billing_link')).toHaveLength(1);
        expect(
            (await rows(source, 'image_generation_cost_event')).filter(
                row => row.actualCostMicrounits !== null,
            ),
        ).toHaveLength(1);
    });

    it('rolls back audit and bill ownership when the final business update fails', async () => {
        const review = await reviewFor(source);
        await source.query(
            'CREATE TRIGGER fixture_reject_cost BEFORE UPDATE ON image_generation_cost_event ' +
                "FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fixture update rejected'",
        );
        await expect(applyImageBillingReview(source, review, true)).rejects.toThrow(
            'fixture update rejected',
        );
        expect(await rows(source, 'image_provider_cost_adjustment')).toEqual([]);
        expect(await rows(source, 'image_provider_billing_link')).toEqual([]);
        expect((await rows(source, 'image_generation_cost_event'))[0].actualCostMicrounits).toBeNull();
    });

    it('appends corrections and restoration to unknown while retaining initial bill ownership', async () => {
        const first = await reviewFor(source);
        const applied = await applyImageBillingReview(source, first, true);
        const correction = {
            ...(await reviewFor(source)),
            batchId: 'correction',
            newCostMicrounits: 1500,
            bills: [{ ...first.bills[0], amountMicrounits: 1500, evidenceHash: 'c'.repeat(64) }],
        };
        await applyImageBillingReview(source, correction, true);
        expect(await applyImageBillingReview(source, first, true)).toMatchObject({
            status: 'ALREADY_APPLIED',
            superseded: true,
        });
        const stale = { ...correction, batchId: 'stale-correction' };
        await expect(applyImageBillingReview(source, stale, true)).rejects.toThrow('版本已变化');
        const revert = {
            ...(await reviewFor(source)),
            batchId: 'restore-unknown',
            newCostMicrounits: null,
            newCurrency: null,
            bills: correction.bills,
        };
        await applyImageBillingReview(source, revert, true);
        const audits = await rows(source, 'image_provider_cost_adjustment');
        expect(audits).toHaveLength(3);
        expect(audits[2]).toMatchObject({
            oldCostMicrounits: 1500,
            newCostMicrounits: null,
            matchingStatus: 'COST_REVERTED',
        });
        expect((await rows(source, 'image_provider_billing_link'))[0].adjustmentIdSnapshot).toBe(
            applied.adjustmentId,
        );
        expect((await rows(source, 'image_generation_cost_event'))[0].actualCostMicrounits).toBeNull();
    });

    it('does not allow corrections to replace bill ownership or hide external cost edits', async () => {
        const review = await reviewFor(source);
        await applyImageBillingReview(source, review, true);
        const correction = {
            ...(await reviewFor(source)),
            batchId: 'correction',
            bills: [{ ...review.bills[0], billId: 'different' }],
        };
        await expect(applyImageBillingReview(source, correction, true)).rejects.toThrow('原账单归属');
        await source.query('UPDATE image_generation_cost_event SET actualCostMicrounits=999 WHERE id=1');
        await expect(applyImageBillingReview(source, review, true)).rejects.toThrow('外部更改');
    });

    it('keeps supplier account scopes and bill ID case distinct', async () => {
        const first = await reviewFor(source);
        const second = {
            ...(await reviewFor(source, '2')),
            bills: [{ ...first.bills[0], supplierScope: 'supplier:account:2' }],
        };
        await applyImageBillingReview(source, first, true);
        await applyImageBillingReview(source, second, true);
        expect(await rows(source, 'image_provider_billing_link')).toHaveLength(2);
    });

    it('reviews legacy prompt aggregate without fabricating attempts and rejects new-ledger or incomplete rows', async () => {
        const review = await reviewFor(source, '1', 'LEGACY_PROMPT');
        await applyImageBillingReview(source, review, true);
        expect((await rows(source, 'image_prompt_optimization'))[0]).toMatchObject({
            actualCostMicrounits: 1250,
            attemptLedgerVersion: null,
            upstreamCallCount: 2,
            providerRequestId: 'old-model-id',
        });
        for (const id of ['2', '3', '4'])
            await expect(reviewFor(source, id, 'LEGACY_PROMPT')).rejects.toThrow('旧提示词');
    });
});

async function reviewFor(
    source: DataSource,
    id = '1',
    type: ImageBillingReview['recordType'] = 'IMAGE_COST_EVENT',
): Promise<ImageBillingReview> {
    const snapshot = await inspectImageBillingTarget(source, '1', type, id);
    return {
        batchId: 'review-batch',
        channelId: '1',
        recordType: type,
        recordId: id,
        expectedSnapshotHash: snapshot.snapshotHash,
        previousAdjustmentId: snapshot.previousAdjustmentId,
        sourceHash: billingEvidenceHash('fixture-source'),
        reviewer: 'test-reviewer',
        authorizationRef: 'test-approval',
        reviewedAt: '2026-09-13T13:00:00Z',
        reason: 'Test fixture cross-match reviewed by operator',
        reviewStatus: 'APPROVED',
        completeRange: true,
        newCostMicrounits: 1250,
        newCurrency: 'USD',
        bills: [
            {
                supplierScope: 'supplier:account:1',
                billId: 'client:fixture-bill',
                amountMicrounits: 1250,
                currency: 'USD',
                billedAt: '2026-09-12T12:00:00Z',
                displayedTime: '2026/09/12 12:00:00',
                timeZone: 'UTC',
                evidenceHash: 'b'.repeat(64),
            },
        ],
    };
}
async function rows(source: DataSource, table: string) {
    return source.createQueryBuilder().select('*').from(table, 'item').orderBy('item.id', 'ASC').getRawMany();
}
async function withCliFixture(
    source: DataSource,
    reviews: ImageBillingReview[],
    check: (fixture: {
        directory: string;
        execute: (name: string, environment?: NodeJS.ProcessEnv) => ReturnType<typeof spawnSync>;
    }) => void | Promise<void>,
) {
    const directory = mkdtempSync(path.join(process.cwd(), '.billing-cli-fixture-'));
    try {
        const bytes = JSON.stringify({ version: 1, reviews });
        const manifest = path.join(directory, 'review.json');
        writeFileSync(manifest, bytes);
        const execute = (name: string, environment: NodeJS.ProcessEnv = {}) =>
            spawnSync(
                process.execPath,
                [
                    path.resolve('../image-generation-plugin/dist/image-provider-billing-cli.js'),
                    '--manifest',
                    manifest,
                    '--output',
                    path.join(directory, name),
                    '--apply',
                    '--confirm-manifest-sha',
                    createHash('sha256').update(bytes).digest('hex'),
                ],
                {
                    env: {
                        ...process.env,
                        DB_HOST: '127.0.0.1',
                        DB_PORT: String(process.env.E2E_MYSQL_PORT ?? 13370),
                        DB_USERNAME: 'root',
                        DB_PASSWORD: 'password',
                        DB_NAME: source.options.database as string,
                        ...environment,
                    },
                    encoding: 'utf8',
                },
            );
        await check({ directory, execute });
    } finally {
        rmSync(directory, { recursive: true });
    }
}
async function createFixture(type: string) {
    const database = `image_billing_test_${randomUUID().replaceAll('-', '')}`;
    const options = {
        type: 'mysql' as const,
        host: '127.0.0.1',
        port: Number(process.env.E2E_MYSQL_PORT ?? 13370),
        username: 'root',
        password: 'password',
        entities: [],
        synchronize: false,
    };
    const admin =
        type === 'mysql' ? await new DataSource({ ...options, database: 'mysql' }).initialize() : null;
    if (admin) await admin.query(`CREATE DATABASE ${database}`);
    const source = await new DataSource(
        type === 'mysql' ? { ...options, database } : { type: 'sqljs', entities: [] },
    ).initialize();
    const runner = source.createQueryRunner();
    const common = [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'channelId', type: 'integer' },
        ...['createdAt', 'updatedAt'].map(name => ({ name, type: 'datetime' })),
        { name: 'actualCostMicrounits', type: 'int', isNullable: true },
        ...['costCurrency', 'providerRequestId'].map(name => ({
            name,
            type: 'varchar',
            length: '200',
            isNullable: true,
        })),
        { name: 'chargedAmount', type: 'int', default: 30 },
        { name: 'credentialCodeSnapshot', type: 'varchar', length: '64' },
    ];
    await runner.createTable(
        new Table({
            name: 'image_generation_cost_event',
            columns: [
                ...common,
                { name: 'attemptNumber', type: 'int' },
                ...[
                    'jobIdSnapshot',
                    'outputIdSnapshot',
                    'modelCodeSnapshot',
                    'outcome',
                    'costSource',
                    'callId',
                    'headerRequestId',
                    'modelResponseId',
                ].map(name => ({ name, type: 'varchar', length: '200', isNullable: true })),
            ],
        }),
    );
    await runner.createTable(
        new Table({
            name: 'image_prompt_optimization',
            columns: [
                ...common,
                ...['source', 'optimizerModelId'].map(name => ({ name, type: 'varchar', length: '160' })),
                { name: 'attemptLedgerVersion', type: 'int', isNullable: true },
                { name: 'upstreamCallCount', type: 'int' },
            ],
        }),
    );
    await runner.createTable(
        new Table({
            name: 'image_prompt_optimization_attempt',
            columns: [
                ...common,
                { name: 'attemptNumber', type: 'int' },
                { name: 'completedAt', type: 'datetime', isNullable: true },
                ...[
                    'optimizationIdSnapshot',
                    'stage',
                    'outcome',
                    'modelId',
                    'costSource',
                    'callId',
                    'headerRequestId',
                    'modelResponseId',
                ].map(name => ({ name, type: 'varchar', length: '200', isNullable: true })),
            ],
        }),
    );
    for (const id of [1, 2])
        await source
            .createQueryBuilder()
            .insert()
            .into('image_prompt_optimization_attempt')
            .values({
                id,
                channelId: 1,
                optimizationIdSnapshot: '2',
                attemptNumber: id,
                stage: id === 1 ? 'INITIAL' : 'REPAIR',
                outcome: id === 1 ? 'FAILED' : 'SUCCEEDED',
                modelId: 'fixture-prompt-model',
                credentialCodeSnapshot: 'fixture',
                callId: `fixture-prompt-${id}`,
                headerRequestId: `fixture-header-${id}`,
                modelResponseId: `fixture-model-${id}`,
                createdAt: new Date('2026-09-12T12:00:00Z'),
                updatedAt: new Date('2026-09-12T12:01:00Z'),
                completedAt: new Date('2026-09-12T12:01:00Z'),
            })
            .execute();
    for (const id of [1, 2, 3])
        await source
            .createQueryBuilder()
            .insert()
            .into('image_generation_cost_event')
            .values({
                id,
                channelId: id === 3 ? 2 : 1,
                createdAt: new Date('2026-09-12T12:00:00Z'),
                updatedAt: new Date('2026-09-12T12:01:00Z'),
                credentialCodeSnapshot: 'fixture',
                attemptNumber: 1,
                modelCodeSnapshot: 'GEMINI_FLASH',
                outcome: 'SUCCEEDED',
                jobIdSnapshot: String(id),
                outputIdSnapshot: String(id),
                providerRequestId: 'model-response-id',
                callId: 'local-id',
                headerRequestId: 'header-id',
                modelResponseId: 'model-response-id',
                costSource: 'RESPONSE',
            })
            .execute();
    for (const id of [1, 2, 3, 4])
        await source
            .createQueryBuilder()
            .insert()
            .into('image_prompt_optimization')
            .values({
                id,
                channelId: 1,
                createdAt: new Date('2026-09-12T12:00:00Z'),
                updatedAt: new Date('2026-09-12T12:01:00Z'),
                credentialCodeSnapshot: 'fixture',
                source: id === 3 ? 'PENDING' : 'MODEL',
                optimizerModelId: 'gemini-flash',
                attemptLedgerVersion: id === 2 ? 1 : null,
                upstreamCallCount: id === 4 ? 0 : 2,
                providerRequestId: 'old-model-id',
            })
            .execute();
    await migration.up(runner);
    await runner.release();
    return {
        source,
        close: async () => {
            await source.destroy();
            if (admin) {
                await admin.query(`DROP DATABASE ${database}`);
                await admin.destroy();
            }
        },
    };
}
