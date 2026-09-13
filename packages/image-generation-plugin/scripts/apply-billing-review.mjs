import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DataSource } from 'typeorm';

export function parseBillingReviewArguments(args) {
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
    return values;
}

export function verifyBillingReviewManifest(bytes, options) {
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (options.apply) assert.equal(digest, options['confirm-manifest-sha'], '清单已变化，拒绝写入');
    const manifest = JSON.parse(bytes.toString('utf8'));
    assert.equal(manifest.version, 1, '清单版本无效');
    const entries = options.inspect ? manifest.targets : manifest.reviews;
    assert.ok(
        Array.isArray(entries) && entries.length > 0 && entries.length <= 500,
        '清单必须限定 1–500 条目标',
    );
    const keys = new Set();
    const supplierBills = new Set();
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
    return { digest, entries };
}

export function billingReviewConnectionOptions(environment, options) {
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
        type: 'mysql',
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

export async function runBillingReview(args) {
    const options = parseBillingReviewArguments(args);
    assert.ok(!existsSync(options.output), '结果文件已存在，请指定新的项目内路径');
    const { digest, entries } = verifyBillingReviewManifest(readFileSync(options.manifest), options);
    const { applyImageBillingReview, inspectImageBillingTarget, validateBillingReview } =
        await import('../dist/image-provider-billing-review.js');
    if (!options.inspect) entries.forEach(validateBillingReview);
    const source = await new DataSource(billingReviewConnectionOptions(process.env, options)).initialize();
    const report = {
        manifestSha256: digest,
        mode: options.inspect ? 'INSPECT' : options.apply ? 'APPLY' : 'DRY_RUN',
        startedAt: new Date().toISOString(),
        completedAt: null,
        status: 'RUNNING',
        results: [],
    };
    try {
        // Check every entry before applying any. Each actual write rechecks under its own target lock.
        if (!options.inspect) for (const review of entries) await applyImageBillingReview(source, review);
        for (const entry of entries) {
            const result = options.inspect
                ? await inspectImageBillingTarget(source, entry.channelId, entry.recordType, entry.recordId)
                : await applyImageBillingReview(source, entry, options.apply);
            report.results.push({
                channelId: entry.channelId,
                recordType: entry.recordType,
                recordId: entry.recordId,
                ...result,
            });
        }
        report.status = 'COMPLETE';
    } catch (error) {
        report.status = 'FAILED';
        // SQL errors can contain queries and values. Preserve only the database code in operator receipts.
        report.error = error?.code ? String(error.code) : String(error?.message || '审定执行失败');
        process.exitCode = 1;
    } finally {
        await source.destroy();
        report.completedAt = new Date().toISOString();
        writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
    return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runBillingReview(process.argv.slice(2))
        .then(report => {
            process.stdout.write(`${report.mode}: ${report.status}, ${report.results.length} entries\n`);
        })
        .catch(error => {
            process.stderr.write(
                `${error?.code ? String(error.code) : String(error?.message || '审定工具启动失败')}\n`,
            );
            process.exitCode = 1;
        });
}
