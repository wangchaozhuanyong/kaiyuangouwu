/* eslint-disable no-console -- CLI report output */
import assert from 'node:assert/strict';
import { createSign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Search Console has no anonymous access: the operator supplies a service-account JSON that
// already has access to the property. Nothing here runs without --credentials.
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function base64url(value) {
    return Buffer.from(value)
        .toString('base64')
        .replace(/=+$/u, '')
        .replace(/\+/gu, '-')
        .replace(/\//gu, '_');
}

/** Claims used for the OAuth assertion; exported so the shape can be asserted offline. */
export function buildAssertionClaims({ email, scope = SCOPE, now = Date.now(), lifetimeSeconds = 3600 }) {
    const issuedAt = Math.floor(now / 1000);
    return {
        iss: email,
        scope,
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + lifetimeSeconds,
    };
}

export function signAssertion({ email, privateKey, now = Date.now() }) {
    assert.ok(email && privateKey, 'Service account email and private key are required');
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify(buildAssertionClaims({ email, now })));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claims}`);
    return `${header}.${claims}.${base64url(signer.sign(privateKey))}`;
}

export async function accessToken({ email, privateKey, fetchImpl = fetch }) {
    const assertion = signAssertion({ email, privateKey });
    const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion,
        }),
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Token endpoint returned ${response.status}`);
    const payload = await response.json();
    assert.ok(payload.access_token, 'Token endpoint returned no access token');
    return payload.access_token;
}

export function dateRange({ days = 28, today = new Date() }) {
    const end = new Date(today);
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const iso = value => value.toISOString().slice(0, 10);
    return { startDate: iso(start), endDate: iso(end) };
}

/** Keep the report shape stable even when Google returns fewer dimensions. */
export function normalizeRows(rows = []) {
    return rows.map(row => ({
        keys: Array.isArray(row.keys) ? row.keys : [],
        clicks: Number(row.clicks ?? 0),
        impressions: Number(row.impressions ?? 0),
        ctr: Number(row.ctr ?? 0),
        position: Number(row.position ?? 0),
    }));
}

export function renderGscMarkdown(
    { site, startDate, endDate, rows },
    { generatedAt = new Date().toISOString() } = {},
) {
    const lines = [
        '# Search Console 周报',
        '',
        `站点：\`${site}\``,
        `区间：${startDate} → ${endDate}`,
        `生成时间：${generatedAt}`,
        '',
    ];
    if (!rows.length) {
        lines.push('该区间没有可用的 Search Analytics 数据（可能是新站或权限不足）。');
        return `${lines.join('\n')}\n`;
    }
    const totals = rows.reduce(
        (sum, row) => ({ clicks: sum.clicks + row.clicks, impressions: sum.impressions + row.impressions }),
        { clicks: 0, impressions: 0 },
    );
    lines.push(
        `合计：**${totals.clicks}** 次点击 / **${totals.impressions}** 次展现 / CTR ${
            totals.impressions ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : '0.00'
        }%`,
        '',
        '| 关键词/页面 | 点击 | 展现 | CTR | 平均位置 |',
        '| --- | --- | --- | --- | --- |',
    );
    for (const row of rows.slice(0, 50)) {
        lines.push(
            `| ${row.keys.join(' · ') || '（未提供维度）'} | ${row.clicks} | ${row.impressions} | ${(
                row.ctr * 100
            ).toFixed(2)}% | ${row.position.toFixed(1)} |`,
        );
    }
    return `${lines.join('\n')}\n`;
}

export async function querySearchAnalytics({
    site,
    token,
    startDate,
    endDate,
    dimensions = ['query'],
    fetchImpl = fetch,
}) {
    const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, dimensions, rowLimit: 200 }),
        signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Search Console returned ${response.status}`);
    const payload = await response.json();
    return normalizeRows(payload.rows ?? []);
}

export async function main(argv = process.argv.slice(2)) {
    const options = { credentials: null, site: null, days: 28, dimensions: ['query'], out: null };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--help' || argument === '-h') {
            console.log(
                [
                    'Usage: node scripts/seo-gsc-report.mjs --credentials FILE --site PROPERTY',
                    '                                            [--days 28] [--dimension query|page] [--out FILE]',
                    '',
                    'PROPERTY is the exact Search Console property, for example sc-domain:moyaoai.com.',
                    'Requires a service-account JSON that is already a user of the property.',
                ].join('\n'),
            );
            return null;
        }
        if (argument === '--credentials') options.credentials = argv[++index];
        else if (argument === '--site') options.site = argv[++index];
        else if (argument === '--days') options.days = Number(argv[++index]);
        else if (argument === '--dimension') options.dimensions = [argv[++index]];
        else if (argument === '--out') options.out = argv[++index];
        else throw new Error(`Unknown argument: ${argument}`);
    }
    assert.ok(options.credentials, 'Missing --credentials');
    assert.ok(options.site, 'Missing --site');
    assert.ok(
        Number.isSafeInteger(options.days) && options.days > 0 && options.days <= 480,
        'Invalid --days',
    );
    for (const dimension of options.dimensions)
        assert.ok(['query', 'page', 'country', 'device'].includes(dimension), 'Invalid dimension');

    const account = JSON.parse(await readFile(options.credentials, 'utf8'));
    assert.ok(account.client_email && account.private_key, 'Credentials are not a service account');
    const token = await accessToken({ email: account.client_email, privateKey: account.private_key });
    const range = dateRange({ days: options.days });
    const rows = await querySearchAnalytics({
        site: options.site,
        token,
        ...range,
        dimensions: options.dimensions,
    });
    const markdown = renderGscMarkdown({ site: options.site, ...range, rows });
    const outFile =
        options.out ??
        path.join(project, 'tmp/seo-gsc', `${new Date().toISOString().replace(/[:.]/gu, '-')}.md`);
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, markdown, { flag: 'wx' });
    console.log(`Rows: ${rows.length}`);
    console.log(`Report: ${outFile}`);
    return { range, rows, markdown, outFile };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main().catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
