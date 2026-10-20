import { TRAFFIC_OPT_OUT_KEY } from '../../src/storefront-traffic.ts';
import { fixtureData } from '../visual-presets/fixtures.mjs';

// Loopback-only synthetic data. Product-view bookkeeping is acknowledged locally;
// business writes are rejected and no request is sent to a real service.
export async function installSiteFixture(context, origin, { customer = true, intercept } = {}) {
    const source = fixtureData('neo-minimalist', customer);
    const evidence = {
        reads: [],
        canceledReads: [],
        rejectedWrites: [],
        externalRequests: [],
        fixtureErrors: [],
        simulatedActivityWrites: [],
    };
    await context.addInitScript(key => localStorage.setItem(key, '1'), TRAFFIC_OPT_OUT_KEY);
    await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== origin) {
            evidence.externalRequests.push({ origin: url.origin, path: url.pathname });
            return route.abort('blockedbyclient');
        }
        const graph = url.pathname === '/shop-api' ? request.postDataJSON() : null;
        if (/^mutation RecordMyProductVisit\(/u.test(graph?.query?.trim() ?? '')) {
            evidence.simulatedActivityWrites.push('RecordMyProductVisit');
            return route.fulfill({
                json: { data: { recordMyProductVisit: { favoriteProductIds: [], recentProductVisits: [] } } },
            });
        }
        if (graph && /\b(?:mutation|subscription)\b/u.test(graph.query ?? '')) {
            evidence.rejectedWrites.push({
                query: graph.query.match(/\b(?:mutation|subscription)\s+(\w+)/u)?.[1] ?? 'unnamed',
            });
            return route.fulfill({ status: 405, json: { errors: [{ message: 'Read-only local fixture' }] } });
        }
        if (graph)
            evidence.reads.push({
                query: graph.query.match(/\bquery\s+(\w+)/u)?.[1],
                variables: graph.variables,
            });
        if (await intercept?.({ route, request, url, graph, source, evidence })) return;
        if (graph) {
            const response = await route.fetch();
            const json = await response.json();
            if (Object.hasOwn(json.data ?? {}, 'activeCustomer'))
                json.data.activeCustomer = source.activeCustomer;
            const extras = {
                gptRechargeConfig: { enabled: true, maintenance: false },
                myCustomerProductActivity: { favoriteProductIds: [], recentProductVisits: [] },
                storefrontDailyRecommendations: {
                    businessDate: '2026-10-19',
                    expiresAt: '2099-01-01T00:00:00Z',
                    items: [],
                },
                myDataSubjectRequests: [],
                myFraudRiskCases: [],
            };
            for (const [key, value] of Object.entries(extras))
                if (Object.hasOwn(json.data ?? {}, key)) json.data[key] = value;
            try {
                return await route.fulfill({ response, json });
            } catch (error) {
                // A route change may abort a read while its synthetic response is prepared.
                if (request.failure())
                    evidence.canceledReads.push({ path: url.pathname, failure: request.failure() });
                else
                    evidence.fixtureErrors.push({
                        path: url.pathname,
                        query: graph.query.match(/query\s+(\w+)/u)?.[1],
                        error: error.message,
                        document: request.frame().url(),
                    });
                return;
            }
        }
        return route.continue();
    });
    return evidence;
}
