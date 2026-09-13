import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    closeSync,
    fsyncSync,
    ftruncateSync,
    openSync,
    readFileSync,
    writeFileSync,
    writeSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DataSource } from 'typeorm';

import {
    applyImageBillingReview,
    BillingReviewTarget,
    ImageBillingReview,
    inspectImageBillingTarget,
    validateBillingReview,
} from './image-provider-billing-review';

export function parseBillingReviewArguments(args: string[]) {
    const { values } = parseArgs({
        args,
        strict: true,
        options: {
            manifest: { type: 'string' },
            output: { type: 'string' },
            inspect: { type: 'boolean', default: false },
            apply: { type: 'boolean', default: false },
            'allow-remote': { type: 'boolean', default: false },
            'confirm-manifest-sha': { type: 'string' },
        },
    });
    assert.ok(values.manifest && path.isAbsolute(values.manifest), '必须指定清单绝对路径 --manifest');
    assert.ok(values.output && path.isAbsolute(values.output), '必须指定结果绝对路径 --output');
    assert.ok(!values.inspect || !values.apply, 'inspect 不能与 apply 同时使用');
    assert.ok(
        !values.apply || /^[a-f0-9]{64}$/u.test(values['confirm-manifest-sha'] ?? ''),
        '写入需要明确确认清单 SHA256',
    );
    return { ...values, manifest: values.manifest, output: values.output };
}

type Options = ReturnType<typeof parseBillingReviewArguments>;
type Target = { channelId: string; recordType: BillingReviewTarget; recordId: string };

export function verifyBillingReviewManifest(bytes: Buffer, options: Partial<Options>) {
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (options.apply) assert.equal(digest, options['confirm-manifest-sha'], '清单已变化，拒绝写入');
    const manifest = JSON.parse(bytes.toString('utf8'));
    assert.equal(manifest.version, 1, '清单版本无效');
    const entries = options.inspect ? manifest.targets : manifest.reviews;
    assert.ok(
        Array.isArray(entries) && entries.length > 0 && entries.length <= 500,
        '清单必须限定 1–500 条目标',
    );
    const keys = new Set<string>();
    const supplierBills = new Set<string>();
    for (const entry of entries) {
        assert.ok(['IMAGE_COST_EVENT', 'LEGACY_PROMPT'].includes(entry.recordType), '目标类型无效');
        assert.ok(
            typeof entry.channelId === 'string' && typeof entry.recordId === 'string',
            '目标编号必须为字符串',
        );
        const key = JSON.stringify([entry.channelId, entry.recordType, entry.recordId]);
        assert.ok(!keys.has(key), '一批不能重复审定同一目标');
        keys.add(key);
        if (!options.inspect && Array.isArray(entry.bills))
            for (const bill of entry.bills) {
                const billKey = JSON.stringify([bill.supplierScope, bill.billId]);
                assert.ok(!supplierBills.has(billKey), '同一批次不能把一张账单用于多个目标');
                supplierBills.add(billKey);
            }
    }
    return { digest, entries: entries as Array<Target & ImageBillingReview> };
}

export function billingReviewConnectionOptions(environment: NodeJS.ProcessEnv, options: Partial<Options>) {
    const host = environment.DB_HOST || '127.0.0.1';
    assert.ok(
        ['localhost', '127.0.0.1', '::1'].includes(host) || options['allow-remote'],
        '远程数据库需要明确 --allow-remote',
    );
    assert.ok(
        environment.DB_NAME && environment.DB_USERNAME && environment.DB_PASSWORD,
        '必须通过运行环境提供数据库连接信息',
    );
    return {
        type: 'mysql' as const,
        host,
        port: Number(environment.DB_PORT || 3306),
        database: environment.DB_NAME,
        username: environment.DB_USERNAME,
        password: environment.DB_PASSWORD,
        entities: [],
        synchronize: false,
        migrationsRun: false,
    };
}

interface BillingReport {
    manifestSha256: string;
    mode: 'INSPECT' | 'APPLY' | 'DRY_RUN';
    startedAt: string;
    completedAt: string | null;
    status: 'RUNNING' | 'COMPLETE' | 'FAILED';
    activeTarget: Target | null;
    results: Array<Record<string, unknown>>;
    error?: string;
    cleanupError?: string;
}

function errorCode(error: unknown) {
    // Database errors may embed SQL and values. Use the code whenever one is available.
    if (error && typeof error === 'object' && 'code' in error) return String(error.code);
    return error instanceof Error ? error.message : '审定执行失败';
}

function openReceipt(output: string) {
    // Reserve both files before opening a DB connection. Existing files and symlinks fail closed.
    const summary = openSync(output, 'wx', 0o600);
    let journal: number;
    try {
        journal = openSync(`${output}.journal.jsonl`, 'wx', 0o600);
    } catch (error) {
        closeSync(summary);
        throw error;
    }
    return {
        checkpoint(report: BillingReport) {
            // Append and flush first: if the process stops while updating the summary, the last
            // complete journal line still identifies completed work and the in-flight target.
            writeFileSync(journal, `${JSON.stringify(report)}\n`);
            fsyncSync(journal);
            const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
            let offset = 0;
            while (offset < bytes.length)
                offset += writeSync(summary, bytes, offset, bytes.length - offset, offset);
            ftruncateSync(summary, bytes.length);
            fsyncSync(summary);
        },
        close() {
            try {
                closeSync(journal);
            } finally {
                closeSync(summary);
            }
        },
    };
}

export async function runBillingReview(args: string[]) {
    const options = parseBillingReviewArguments(args);
    const { digest, entries } = verifyBillingReviewManifest(readFileSync(options.manifest), options);
    if (!options.inspect) entries.forEach(validateBillingReview);
    const source = new DataSource(billingReviewConnectionOptions(process.env, options));
    const report: BillingReport = {
        manifestSha256: digest,
        mode: options.inspect ? 'INSPECT' : options.apply ? 'APPLY' : 'DRY_RUN',
        startedAt: new Date().toISOString(),
        completedAt: null,
        status: 'RUNNING',
        activeTarget: null,
        results: [],
    };
    const receipt = openReceipt(options.output);
    try {
        receipt.checkpoint(report);
        await source.initialize();
        // Check the whole batch first; each write rechecks inside its own locked transaction.
        if (!options.inspect) for (const review of entries) await applyImageBillingReview(source, review);
        for (const entry of entries) {
            const target = {
                channelId: entry.channelId,
                recordType: entry.recordType,
                recordId: entry.recordId,
            };
            report.activeTarget = target;
            receipt.checkpoint(report);
            const result = options.inspect
                ? await inspectImageBillingTarget(source, entry.channelId, entry.recordType, entry.recordId)
                : await applyImageBillingReview(source, entry, options.apply);
            report.results.push({ ...target, ...result });
            report.activeTarget = null;
            receipt.checkpoint(report);
        }
        report.status = 'COMPLETE';
    } catch (error) {
        report.status = 'FAILED';
        report.error = errorCode(error);
    } finally {
        try {
            if (source.isInitialized) await source.destroy();
        } catch (error) {
            report.status = 'FAILED';
            report.cleanupError = errorCode(error);
        }
        report.completedAt = new Date().toISOString();
        try {
            receipt.checkpoint(report);
        } finally {
            receipt.close();
        }
    }
    return report;
}

export async function runBillingReviewCli(args: string[]) {
    // Loading the plugin must not load a dotenv file or start an operator command.
    try {
        await import('dotenv/config');
        const report = await runBillingReview(args);
        process.stdout.write(`${report.mode}: ${report.status}, ${report.results.length} entries\n`);
        if (report.status !== 'COMPLETE') process.exitCode = 1;
    } catch (error) {
        process.stderr.write(`${errorCode(error)}\n`);
        process.exitCode = 1;
    }
}

if (require.main === module) void runBillingReviewCli(process.argv.slice(2));
