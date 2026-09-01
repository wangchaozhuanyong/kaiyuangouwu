import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const SHOP_API_PROBE = Object.freeze({ query: '{__typename}' });
const ENTRY_COOKIE_NAME = 'storefront-entry';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_DASHBOARD_ASSETS = 500;

function decodeHtmlAttribute(value) {
    return value
        .replace(/&#x([0-9a-f]+);/giu, (_match, codePoint) =>
            String.fromCodePoint(Number.parseInt(codePoint, 16)),
        )
        .replace(/&#([0-9]+);/gu, (_match, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 10)))
        .replace(/&quot;/giu, '"')
        .replace(/&#39;|&apos;/giu, "'")
        .replace(/&lt;/giu, '<')
        .replace(/&gt;/giu, '>')
        .replace(/&amp;/giu, '&');
}

function readHtmlAttribute(tag, attributeName) {
    const quoted = tag.match(new RegExp(`\\b${attributeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu'));
    if (quoted) {
        return decodeHtmlAttribute(quoted[1] ?? quoted[2] ?? '');
    }
    const unquoted = tag.match(new RegExp(`\\b${attributeName}\\s*=\\s*([^\\s>]+)`, 'iu'));
    return unquoted ? decodeHtmlAttribute(unquoted[1]) : undefined;
}

export function extractEntryTicket(html) {
    for (const match of html.matchAll(/<input\b[^>]*>/giu)) {
        if (readHtmlAttribute(match[0], 'name') === 'ticket') {
            const ticket = readHtmlAttribute(match[0], 'value');
            if (ticket) {
                return ticket;
            }
        }
    }
    throw new Error('Promotion page does not contain a non-empty signed entry ticket');
}

export function extractEntryCookie(headers) {
    const setCookieHeaders =
        typeof headers.getSetCookie === 'function'
            ? headers.getSetCookie()
            : [headers.get('set-cookie')].filter(Boolean);
    for (const header of setCookieHeaders) {
        const match = header.match(new RegExp(`(?:^|,\\s*)${ENTRY_COOKIE_NAME}=([^;,\\s]+)`, 'u'));
        if (match) {
            return `${ENTRY_COOKIE_NAME}=${match[1]}`;
        }
    }
    throw new Error(`Promotion entry response did not set the ${ENTRY_COOKIE_NAME} cookie`);
}

export function extractStorefrontAssetUrl(html, storefrontUrl) {
    const storefrontOrigin = new URL(storefrontUrl).origin;
    for (const match of html.matchAll(/<(?:link|script)\b[^>]*>/giu)) {
        const reference = readHtmlAttribute(match[0], 'href') ?? readHtmlAttribute(match[0], 'src');
        if (!reference) {
            continue;
        }
        const assetUrl = new URL(reference, storefrontUrl);
        if (
            assetUrl.origin === storefrontOrigin &&
            assetUrl.pathname.startsWith('/assets/') &&
            /\.(?:css|js)$/u.test(assetUrl.pathname)
        ) {
            return assetUrl;
        }
    }
    throw new Error('Authenticated storefront HTML does not reference a same-origin JS or CSS asset');
}

export function extractDashboardAssetUrls(html, dashboardUrl) {
    const dashboard = normalizeDashboardUrl(dashboardUrl);
    const urls = [];
    for (const match of html.matchAll(/<(?:link|script)\b[^>]*>/giu)) {
        const reference = readHtmlAttribute(match[0], 'href') ?? readHtmlAttribute(match[0], 'src');
        if (!reference) continue;
        const assetUrl = new URL(reference, dashboard);
        if (
            assetUrl.origin === dashboard.origin &&
            assetUrl.pathname.startsWith('/dashboard/assets/') &&
            /\.(?:css|js)$/u.test(assetUrl.pathname)
        ) {
            urls.push(assetUrl);
        }
    }
    const unique = [...new Map(urls.map(url => [url.href, url])).values()];
    if (!unique.length) {
        throw new Error('Dashboard HTML does not reference a same-origin JS or CSS asset');
    }
    return unique;
}

function normalizeStorefrontUrl(value) {
    const url = new URL(value);
    if (url.username || url.password) {
        throw new Error('Storefront URL must not contain credentials');
    }
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url;
}

function normalizeDashboardUrl(value) {
    const url = new URL(value);
    if (url.username || url.password) {
        throw new Error('Dashboard URL must not contain credentials');
    }
    url.hash = '';
    return url;
}

function dashboardAssetReferences(source, dashboard) {
    const references = [];
    for (const match of source.matchAll(
        /(?:^|["'`(])((?:\.\/)?assets\/[A-Za-z0-9_.-]+\.(?:js|css))(?![A-Za-z0-9_.-])/gu,
    )) {
        const reference = match[1].replace(/^\.\//u, '');
        const assetUrl = new URL(reference, dashboard);
        if (assetUrl.origin === dashboard.origin && assetUrl.pathname.startsWith('/dashboard/assets/')) {
            references.push(assetUrl);
        }
    }
    return references;
}

function cacheBustedUrl(url, releaseId) {
    const result = new URL(url);
    result.searchParams.set('__release', releaseId);
    return result;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
    try {
        return await fetchImpl(url, {
            ...init,
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error) {
        throw new Error(`Request failed for ${url.origin}${url.pathname}: ${error.message}`, {
            cause: error,
        });
    }
}

function expectStatus(response, expectedStatus, label) {
    if (response.status !== expectedStatus) {
        throw new Error(`${label}: expected HTTP ${expectedStatus}, received ${response.status}`);
    }
}

function expectDashboardAssetContentType(response, assetUrl) {
    const contentType = response.headers.get('content-type') ?? '';
    const expected = assetUrl.pathname.endsWith('.css') ? /text\/css/iu : /javascript|ecmascript/iu;
    if (!expected.test(contentType)) {
        throw new Error(
            `Dashboard asset ${assetUrl.pathname}: unexpected content-type ${contentType || '(missing)'}`,
        );
    }
}

export async function verifyDashboardAssets({
    dashboardUrl,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    releaseId = String(Date.now()),
}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('This verifier requires a Node.js runtime with global fetch support');
    }
    const dashboard = normalizeDashboardUrl(dashboardUrl);
    const dashboardResponse = await fetchWithTimeout(
        fetchImpl,
        cacheBustedUrl(dashboard, releaseId),
        { redirect: 'follow', headers: { 'cache-control': 'no-cache' } },
        timeoutMs,
    );
    expectStatus(dashboardResponse, 200, 'Dashboard');
    const queue = extractDashboardAssetUrls(await dashboardResponse.text(), dashboard);
    const discovered = new Map(queue.map(url => [url.href, url]));
    const verified = new Set();

    while (queue.length) {
        if (discovered.size > MAX_DASHBOARD_ASSETS) {
            throw new Error(`Dashboard asset graph exceeds ${MAX_DASHBOARD_ASSETS} files`);
        }
        const assetUrl = queue.shift();
        if (!assetUrl || verified.has(assetUrl.href)) continue;
        const response = await fetchWithTimeout(
            fetchImpl,
            cacheBustedUrl(assetUrl, releaseId),
            { redirect: 'manual', headers: { 'cache-control': 'no-cache' } },
            timeoutMs,
        );
        expectStatus(response, 200, `Dashboard asset ${assetUrl.pathname}`);
        expectDashboardAssetContentType(response, assetUrl);
        const source = await response.text();
        verified.add(assetUrl.href);
        if (!assetUrl.pathname.endsWith('.js')) continue;
        for (const referencedUrl of dashboardAssetReferences(source, dashboard)) {
            if (!discovered.has(referencedUrl.href)) {
                discovered.set(referencedUrl.href, referencedUrl);
                queue.push(referencedUrl);
            }
        }
    }
    return { assetCount: verified.size };
}

async function readJson(response, label) {
    try {
        return await response.json();
    } catch (error) {
        throw new Error(`${label}: response was not valid JSON`, { cause: error });
    }
}

function shopApiRequest(cookie) {
    return {
        method: 'POST',
        redirect: 'manual',
        headers: {
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(SHOP_API_PROBE),
    };
}

export async function verifyProductionRelease({
    storefrontUrl,
    dashboardUrl,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    releaseId = String(Date.now()),
}) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('This verifier requires a Node.js runtime with global fetch support');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        throw new Error('timeoutMs must be a positive integer');
    }

    const storefront = normalizeStorefrontUrl(storefrontUrl);
    const dashboard = normalizeDashboardUrl(dashboardUrl);
    const checks = [];

    const healthUrl = new URL('/health', storefront);
    const healthResponse = await fetchWithTimeout(fetchImpl, healthUrl, { redirect: 'manual' }, timeoutMs);
    expectStatus(healthResponse, 200, 'Public health endpoint');
    const health = await readJson(healthResponse, 'Public health endpoint');
    if (health?.status !== 'ok') {
        throw new Error('Public health endpoint: expected JSON status "ok"');
    }
    checks.push('public health');

    const dashboardHealthUrl = new URL('/health', dashboard);
    const dashboardHealthResponse = await fetchWithTimeout(
        fetchImpl,
        dashboardHealthUrl,
        { redirect: 'manual' },
        timeoutMs,
    );
    expectStatus(dashboardHealthResponse, 200, 'Dashboard health endpoint');
    const dashboardHealth = await readJson(dashboardHealthResponse, 'Dashboard health endpoint');
    if (dashboardHealth?.status !== 'ok') {
        throw new Error('Dashboard health endpoint: expected JSON status "ok"');
    }
    checks.push('dashboard health');

    const shopApiUrl = new URL('/shop-api', storefront);
    const publicShopResponse = await fetchWithTimeout(fetchImpl, shopApiUrl, shopApiRequest(), timeoutMs);
    expectStatus(publicShopResponse, 200, 'Public Shop API');
    const publicShopBody = await readJson(publicShopResponse, 'Public Shop API');
    if (publicShopBody?.data?.__typename !== 'Query') {
        throw new Error('Public Shop API: GraphQL probe did not return Query');
    }
    checks.push('public Shop API');

    const storefrontResponse = await fetchWithTimeout(
        fetchImpl,
        storefront,
        { redirect: 'manual' },
        timeoutMs,
    );
    expectStatus(storefrontResponse, 200, 'Direct storefront');
    const storefrontHtml = await storefrontResponse.text();
    const assetUrl = extractStorefrontAssetUrl(storefrontHtml, storefront);
    checks.push('direct storefront');

    const promotionUrl = new URL('/promo', storefront);
    const promotionResponse = await fetchWithTimeout(
        fetchImpl,
        promotionUrl,
        { redirect: 'manual' },
        timeoutMs,
    );
    expectStatus(promotionResponse, 200, 'Promotion entry page');
    const ticket = extractEntryTicket(await promotionResponse.text());
    checks.push('optional promotion page');

    const enterUrl = new URL('/promo/enter', storefront);
    const enterResponse = await fetchWithTimeout(
        fetchImpl,
        enterUrl,
        {
            method: 'POST',
            redirect: 'manual',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ ticket }).toString(),
        },
        timeoutMs,
    );
    expectStatus(enterResponse, 303, 'Promotion entry submission');
    if (enterResponse.headers.get('location') !== '/') {
        throw new Error('Promotion entry submission: expected redirect location /');
    }
    extractEntryCookie(enterResponse.headers);
    checks.push('optional promotion entry');

    const assetResponse = await fetchWithTimeout(fetchImpl, assetUrl, { redirect: 'manual' }, timeoutMs);
    expectStatus(assetResponse, 200, 'Storefront build asset');
    await assetResponse.body?.cancel();
    checks.push('storefront build asset');

    await verifyDashboardAssets({ dashboardUrl: dashboard, fetchImpl, timeoutMs, releaseId });
    checks.push('dashboard asset graph');

    const adminApiUrl = new URL('/admin-api', storefront);
    const adminApiResponse = await fetchWithTimeout(fetchImpl, adminApiUrl, shopApiRequest(), timeoutMs);
    expectStatus(adminApiResponse, 404, 'Public Admin API');
    await adminApiResponse.body?.cancel();
    checks.push('public Admin API denial');

    return checks;
}

async function main() {
    const { values } = parseArgs({
        options: {
            'storefront-url': { type: 'string' },
            'dashboard-url': { type: 'string' },
            'timeout-ms': { type: 'string', default: String(DEFAULT_TIMEOUT_MS) },
            'release-id': { type: 'string', default: String(Date.now()) },
        },
        strict: true,
    });
    if (!values['storefront-url'] || !values['dashboard-url']) {
        throw new Error(
            'Usage: node deploy/verify-production-release.mjs --storefront-url <url> --dashboard-url <url>',
        );
    }
    const timeoutMs = Number(values['timeout-ms']);
    const checks = await verifyProductionRelease({
        storefrontUrl: values['storefront-url'],
        dashboardUrl: values['dashboard-url'],
        timeoutMs,
        releaseId: values['release-id'],
    });
    for (const check of checks) {
        process.stdout.write(`[pass] ${check}\n`);
    }
    process.stdout.write(`Production release verification passed (${checks.length} checks)\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch(error => {
        process.stderr.write(`Production release verification failed: ${error.message}\n`);
        process.exitCode = 1;
    });
}
