/* eslint-disable no-console -- CLI report output */
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// Reads the access log produced by log_format vendure_access. The crawler field is a
// class token mapped in Nginx; raw user agents never reach this file.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const CRAWLER_CLASSES = [
    'googlebot',
    'bingbot',
    'yandexbot',
    'applebot',
    'duckduckbot',
    'openai',
    'anthropic',
    'perplexity',
];

/** One log line at a time; anything that is not a public request entry is ignored. */
export function parseAccessLine(line) {
    const text = String(line).trim();
    if (!text.startsWith('{')) return null;
    let entry;
    try {
        entry = JSON.parse(text);
    } catch {
        return null;
    }
    if (!entry || typeof entry !== 'object') return null;
    const status = Number(entry.status);
    if (!Number.isFinite(status) || typeof entry.path !== 'string') return null;
    const crawler = typeof entry.crawler === 'string' && entry.crawler ? entry.crawler : '-';
    return {
        crawler,
        path: entry.path,
        status,
        requestTime: Number(entry.request_time ?? 0),
        upstreamTime: Number(String(entry.upstream_response_time ?? '').split(',')[0]) || 0,
        host: typeof entry.host === 'string' ? entry.host : '',
    };
}

export function aggregateCrawlerLines(entries, { crawler = null, top = 10 } = {}) {
    const report = {
        total: 0,
        crawlers: {},
        statusByCrawler: {},
        paths: {},
    };
    for (const entry of entries) {
        if (!entry || entry.crawler === '-') continue;
        if (crawler && entry.crawler !== crawler) continue;
        report.total += 1;
        report.crawlers[entry.crawler] = (report.crawlers[entry.crawler] ?? 0) + 1;
        const bucket = (report.statusByCrawler[entry.crawler] ??= {});
        const statusKey = `${Math.floor(entry.status / 100)}xx`;
        bucket[statusKey] = (bucket[statusKey] ?? 0) + 1;
        const pathKey = `${entry.path}`;
        const current = (report.paths[pathKey] ??= { count: 0, errors: 0 });
        current.count += 1;
        if (entry.status >= 400) current.errors += 1;
    }
    const rankedPaths = Object.entries(report.paths)
        .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
        .slice(0, top)
        .map(([urlPath, value]) => ({ path: urlPath, ...value }));
    return {
        total: report.total,
        crawlers: report.crawlers,
        statusByCrawler: report.statusByCrawler,
        paths: rankedPaths,
    };
}

export function renderCrawlerMarkdown(report, { generatedAt = new Date().toISOString() } = {}) {
    const lines = [
        `# 爬虫抓取报告`,
        '',
        `生成时间：${generatedAt}`,
        '',
        `抓取请求总数：**${report.total}**`,
        '',
    ];
    const crawlers = Object.entries(report.crawlers);
    if (!crawlers.length) {
        lines.push('没有发现爬虫请求。确认日志里出现 `crawler` 字段，且日志时间范围包含一次抓取。');
        return `${lines.join('\n')}\n`;
    }
    lines.push('| 爬虫 | 请求数 | 状态分布 |', '| --- | --- | --- |');
    for (const [name, count] of crawlers.sort((left, right) => right[1] - left[1])) {
        const distribution = Object.entries(report.statusByCrawler[name] ?? {})
            .map(([status, value]) => `${status}: ${value}`)
            .join('，');
        lines.push(`| ${name} | ${count} | ${distribution} |`);
    }
    lines.push('', '| 路径 | 请求数 | 4xx/5xx |', '| --- | --- | --- |');
    for (const item of report.paths) lines.push(`| ${item.path} | ${item.count} | ${item.errors} |`);
    return `${lines.join('\n')}\n`;
}

async function readLines(input) {
    const stream = input === '-' ? process.stdin : createReadStream(input, 'utf8');
    const lines = [];
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) lines.push(line);
    return lines;
}

export async function main(argv = process.argv.slice(2)) {
    const options = { input: null, out: null, crawler: null, top: 10 };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--help' || argument === '-h') {
            console.log(
                [
                    'Usage: node scripts/seo-crawl-report.mjs --input FILE|- [--crawler googlebot]',
                    '                                          [--top N] [--out FILE]',
                    '',
                    'Reads the JSON access log (moyao-storefront-access.log).',
                    'Use "-" to read stdin, for example: journalctl -u nginx -o cat | node ... --input -',
                ].join('\n'),
            );
            return null;
        }
        if (argument === '--input') options.input = argv[++index];
        else if (argument === '--out') options.out = argv[++index];
        else if (argument === '--crawler') options.crawler = argv[++index];
        else if (argument === '--top') options.top = Number(argv[++index]);
        else throw new Error(`Unknown argument: ${argument}`);
    }
    assert.ok(options.input, 'Missing --input');
    if (options.crawler) assert.ok(CRAWLER_CLASSES.includes(options.crawler), 'Unknown crawler class');
    assert.ok(Number.isSafeInteger(options.top) && options.top > 0, 'Invalid --top');

    const entries = (await readLines(options.input)).map(parseAccessLine).filter(Boolean);
    const report = aggregateCrawlerLines(entries, { crawler: options.crawler, top: options.top });
    const markdown = renderCrawlerMarkdown(report);
    const outFile =
        options.out ??
        path.join(project, 'tmp/seo-crawl', `${new Date().toISOString().replace(/[:.]/gu, '-')}.md`);
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, markdown, { flag: 'wx' });
    console.log(`Crawler requests: ${report.total}`);
    console.log(`Report: ${outFile}`);
    return { report, markdown, outFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main().catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
