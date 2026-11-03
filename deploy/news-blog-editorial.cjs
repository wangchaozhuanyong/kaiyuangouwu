'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

function decodeRequest(raw) {
    assert.ok(Buffer.byteLength(raw, 'utf8') <= 45000, 'Editorial request too large');
    const request = JSON.parse(raw);
    assert.ok(['inspect', 'publish', 'rewrite'].includes(request.mode), 'Unknown editorial operation');
    if (request.mode !== 'inspect') {
        assert.match(request.expectedRuntimeSha, /^[a-f0-9]{40}$/u);
        assert.ok(request.payload && typeof request.payload === 'object');
        const entries = request.mode === 'rewrite' ? request.payload : [request.payload];
        assert.ok(Array.isArray(entries) && entries.length > 0 && entries.length <= 4);
        for (const entry of entries) {
            assert.match(entry.requestKey, /^codex-skill:[a-zA-Z0-9:_-]{8,120}$/u);
            if (request.mode === 'rewrite')
                assert.ok(
                    entry.articleId && entry.expectedVersion > 0,
                    'Rewrite only accepts existing articles',
                );
        }
    }
    return request;
}
function assertRuntime(request, runningSha) {
    if (request.mode !== 'inspect')
        assert.equal(runningSha, request.expectedRuntimeSha, 'Runtime changed since inspection');
}
async function importEditorial(writer, cache, ctx, payload) {
    const receipt = await writer.import(ctx, payload);
    // Event subscribers run asynchronously; a short-lived worker must await the shared revision write.
    await cache.invalidate(ctx.channelId);
    return receipt;
}
async function worker(request) {
    // All credentials remain inside the existing runtime. Never return its environment.
    const runtime = createRequire(path.join(process.cwd(), 'package.json'));
    runtime('dotenv').config({ path: '/var/www/kaiyuangouwu/packages/dev-server/.env', quiet: true });
    process.env.NODE_ENV = 'production';
    process.env.RUN_MIGRATIONS = 'false';
    process.env.RUN_JOB_QUEUE = '0';
    process.env.IMAGE_PROMPT_SKILL_AUTO_ACTIVATE = 'false';
    process.env.STORE_DOMAIN_AUTOMATION_MODE = 'manual';
    process.env.VENDURE_DISABLE_TELEMETRY = 'true';
    const core = runtime('@vendure/core');
    const { devConfig } = runtime(path.join(process.cwd(), 'packages/dev-server/dist/dev-config.js'));
    devConfig.logger = new core.DefaultLogger({ level: core.LogLevel.Error });
    devConfig.dbConnectionOptions.synchronize = false;
    devConfig.dbConnectionOptions.migrationsRun = false;
    devConfig.schedulerOptions = { ...devConfig.schedulerOptions, tasks: [] };
    // Plugin configuration can append tasks; removing the scheduler prevents them from starting.
    devConfig.plugins = devConfig.plugins.filter(
        plugin => (plugin.module ?? plugin).name !== 'DefaultSchedulerPlugin',
    );
    const { app } = await core.bootstrapWorker(devConfig);
    try {
        const plugin = runtime('@vendure/news-blog-plugin');
        const { StorefrontPublicCacheService } = runtime('@vendure/store-management-plugin');
        assert.equal(typeof plugin.BlogSkillEditorialService, 'function', 'Editorial runtime not deployed');
        const connection = app.get(core.TransactionalConnection);
        const channel = await connection.rawConnection
            .getRepository(core.Channel)
            .findOneByOrFail({ code: 'moyao-ai' });
        const ctx = await app.get(core.RequestContextService).create({
            apiType: 'admin',
            channelOrToken: channel,
            languageCode: 'zh_Hans',
        });
        const settings = await connection
            .getRepository(ctx, plugin.BlogSettings)
            .findOneByOrFail({ channelId: channel.id });
        assert.equal(settings.enabled, true, 'MOYAO blog disabled');
        if (request.mode === 'inspect') {
            const rows = await connection.getRepository(ctx, plugin.BlogArticle).find({
                where: { channelId: channel.id, publishedCategory: 'skills' },
                order: { publishedAt: 'DESC' },
            });
            return {
                schemaVersion: 1,
                channelCode: channel.code,
                runtimeSha: request.runtimeSha,
                settingsVersion: settings.version,
                configuration: (({ skillEnabled, freeMode, skillEditorialMode, coverMode }) => ({
                    skillEnabled,
                    freeMode,
                    skillEditorialMode,
                    coverMode,
                }))(app.get(plugin.BlogService).config(settings)),
                articles: rows
                    .filter(x => x.publishedJson)
                    .map(x => ({
                        id: String(x.id),
                        slug: x.slug,
                        version: x.version,
                        state: x.state,
                        title: JSON.parse(x.publishedJson).title,
                        skill: (({
                            name,
                            identity,
                            repository,
                            repositoryId,
                            directoryUrl,
                            sourceCommit,
                        }) => ({ name, identity, repository, repositoryId, directoryUrl, sourceCommit }))(
                            JSON.parse(x.publishedJson).skill,
                        ),
                        hasProfile: Boolean(JSON.parse(x.publishedJson).skillProfile),
                    })),
            };
        }
        const backupDirectory = '/var/www/kaiyuangouwu/backups/news-blog-editorial';
        mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
        const receipts = [];
        for (const payload of request.mode === 'rewrite' ? request.payload : [request.payload]) {
            try {
                const before = payload.articleId
                    ? await connection
                          .getRepository(ctx, plugin.BlogArticle)
                          .findOneByOrFail({ id: payload.articleId, channelId: channel.id })
                    : null;
                const backupName = payload.requestKey.replaceAll(':', '-') + '-' + Date.now() + '.json';
                writeFileSync(
                    path.join(backupDirectory, backupName),
                    JSON.stringify({ schemaVersion: 1, runtimeSha: request.runtimeSha, article: before }),
                    { mode: 0o600, flag: 'wx' },
                );
                const receipt = await importEditorial(
                    app.get(plugin.BlogSkillEditorialService),
                    app.get(StorefrontPublicCacheService),
                    ctx,
                    payload,
                );
                receipts.push({ requestKey: payload.requestKey, receipt });
            } catch (error) {
                if (request.mode !== 'rewrite') throw error;
                receipts.push({ requestKey: payload.requestKey, error: error.message });
            }
        }
        return {
            schemaVersion: 1,
            channelCode: channel.code,
            runtimeSha: request.runtimeSha,
            ...(request.mode === 'rewrite'
                ? { receipts, failed: receipts.filter(x => x.error).length }
                : { receipt: receipts[0].receipt }),
        };
    } finally {
        await app.close();
    }
}
async function main() {
    const request = decodeRequest(readFileSync(0, 'utf8'));
    if (process.argv.includes('--runtime-worker')) {
        const result = await worker(request);
        process.stdout.write('NEWS_BLOG_EDITORIAL_RESULT ' + JSON.stringify(result) + '\n');
        return;
    }
    const retention = require('./systemd/vendure-production-release-retention.cjs');
    const pm2Processes = JSON.parse(
        execFileSync('sudo', ['-n', '-H', '-u', 'ubuntu', 'pm2', 'jlist'], {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
        }),
    );
    const state = retention.inspectReleaseState({ pm2Processes });
    assertRuntime(request, state.markerSha);
    const result = spawnSync('sudo', ['-n', '-H', '-u', 'ubuntu', 'node', __filename, '--runtime-worker'], {
        cwd: state.currentRuntime,
        input: JSON.stringify({ ...request, runtimeSha: state.markerSha }),
        encoding: 'utf8',
        timeout: 180000,
        maxBuffer: 2 * 1024 * 1024,
    });
    if (result.status !== 0)
        throw new Error('Editorial runtime operation failed: ' + (result.stderr ?? '').slice(-1500));
    const receipt = result.stdout.split('\n').find(x => x.startsWith('NEWS_BLOG_EDITORIAL_RESULT '));
    assert.ok(receipt, 'Missing content publication receipt');
    process.stdout.write(receipt + '\n');
}
module.exports = { decodeRequest, assertRuntime, importEditorial };
if (require.main === module)
    main().catch(error => {
        process.stderr.write(error.message + '\n');
        process.exitCode = 1;
    });
