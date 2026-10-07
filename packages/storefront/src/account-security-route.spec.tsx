// @vitest-environment jsdom
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AccountSecurityRoutePage } from './route-pages/order-route-pages';

const testState = vi.hoisted(() => ({ runtime: null as Record<string, unknown> | null }));

vi.mock('./lazy-storefront-pages', () => ({
    LazyAccountSecurityPage: (props: {
        customer: { id: string };
        onDataExport?: (password: string) => Promise<unknown>;
        dataSubjectRequests: Array<{ id: string }>;
        dataSubjectLoading: boolean;
        fraudRiskCases: Array<{ id: string }>;
        fraudRiskLoading: boolean;
        loadError?: string;
        onRetry?: () => void;
        onAppealFraudRiskCase: (id: string, reason: string) => Promise<void>;
    }) => (
        <div data-security-page>
            {JSON.stringify({
                customer: props.customer?.id,
                exportEnabled: Boolean(props.onDataExport),
                requests: props.dataSubjectRequests.map(item => item.id),
                cases: props.fraudRiskCases.map(item => item.id),
                requestsBusy: props.dataSubjectLoading,
                casesBusy: props.fraudRiskLoading,
                error: props.loadError ?? '',
            })}
            {props.loadError && (
                <button data-retry-security onClick={props.onRetry}>
                    Retry security reads
                </button>
            )}
            <button
                data-security-appeal
                disabled={props.fraudRiskLoading}
                onClick={() => void props.onAppealFraudRiskCase('risk-confirmed', 'Fixture appeal')}
            >
                Appeal
            </button>
        </div>
    ),
    LazyAddressesPage: () => null,
    LazyLogisticsPage: () => null,
    LazyOrderDetailPage: () => null,
    LazyOrdersPage: () => null,
}));
vi.mock('./storefront-ui/page-shell', () => ({
    AuthPageBoundary: ({ children }: { children: unknown }) => children,
    AsyncRouteStatePage: (props: { state: string; error?: string; onRetry: () => void }) => (
        <div data-route-state={props.state}>
            {props.error}
            <button onClick={props.onRetry}>Retry initial reads</button>
        </div>
    ),
}));
vi.mock('./route-pages/shared', () => ({
    registerRoutePreload: () => vi.fn(),
    RouteGate: ({ children }: { children: unknown }) => children,
    useRouteRuntime: () => testState.runtime,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestRecord = { id: string };

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function testApi() {
    return {
        customerAvatarHistory: vi.fn(),
        dataSubjectRequests: vi.fn().mockResolvedValue([]),
        fraudRiskCases: vi.fn().mockResolvedValue([]),
        appealFraudRiskCase: vi.fn().mockResolvedValue(undefined),
        exportPersonalData: vi.fn(),
    };
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;

function render(visible = true) {
    act(() => {
        root.render(
            <QueryClientProvider client={client}>
                {visible && <AccountSecurityRoutePage />}
            </QueryClientProvider>,
        );
    });
}

async function expectEventually(assertion: () => void) {
    await vi.waitFor(async () => {
        await act(async () => {
            await new Promise(resolve => window.setTimeout(resolve, 0));
        });
        assertion();
    });
}

const page = () => host.querySelector('[data-security-page]');
const routeState = () => host.querySelector('[data-route-state]')?.getAttribute('data-route-state');

function runtime() {
    if (!testState.runtime) throw new Error('Expected the test runtime');
    return testState.runtime;
}

function button(selector: string) {
    const element = host.querySelector<HTMLButtonElement>(selector);
    if (!element) throw new Error(`Expected button: ${selector}`);
    return element;
}

beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false } },
    });
    testState.runtime = {
        language: 'zh',
        market: { code: 'store-a', currencyCode: 'MYR' },
        customer: { id: 'customer-a' },
        api: testApi(),
        goBack: vi.fn(),
        notify: vi.fn(),
        storefrontName: 'Fixture',
        contentQuery: { data: { settings: {} } },
    };
});

afterEach(() => {
    act(() => root.unmount());
    client.clear();
    onlineManager.setOnline(true);
    host.remove();
    testState.runtime = null;
});

it('waits for both initial security reads rather than briefly rendering an empty account card', async () => {
    const requests = deferred<TestRecord[]>();
    const risks = deferred<TestRecord[]>();
    const api = testApi();
    api.dataSubjectRequests.mockReturnValue(requests.promise);
    api.fraudRiskCases.mockReturnValue(risks.promise);
    runtime().api = api;
    render();
    expect(routeState()).toBe('loading');
    expect(page()).toBeNull();

    await act(() => Promise.resolve(requests.resolve([])));
    await expectEventually(() => {
        expect(routeState()).toBe('loading');
        expect(page()).toBeNull();
    });

    await act(() => Promise.resolve(risks.resolve([])));
    await expectEventually(() => {
        expect(page()).not.toBeNull();
        expect(routeState()).toBeUndefined();
        expect(host.textContent).toContain('"requests":[]');
        expect(host.textContent).toContain('"cases":[]');
    });
    expect(api.customerAvatarHistory).not.toHaveBeenCalled();
});

it('keeps confirmed empty data on a return visit while starting fresh background reads', async () => {
    const api = testApi();
    runtime().api = api;
    render();
    await expectEventually(() => expect(page()).not.toBeNull());
    render(false);

    const requests = deferred<TestRecord[]>();
    const risks = deferred<TestRecord[]>();
    api.dataSubjectRequests.mockReturnValue(requests.promise);
    api.fraudRiskCases.mockReturnValue(risks.promise);
    render();
    expect(page()).not.toBeNull();
    expect(routeState()).toBeUndefined();
    expect(host.textContent).toContain('"requests":[]');
    expect(host.textContent).toContain('"cases":[]');
    expect(host.textContent).toContain('"requestsBusy":true');
    expect(host.textContent).toContain('"casesBusy":true');
    expect(api.dataSubjectRequests).toHaveBeenCalledTimes(2);
    expect(api.fraudRiskCases).toHaveBeenCalledTimes(2);

    await act(() => {
        requests.resolve([]);
        risks.resolve([]);
        return Promise.resolve();
    });
    await expectEventually(() => {
        expect(host.textContent).toContain('"requestsBusy":false');
        expect(host.textContent).toContain('"casesBusy":false');
        expect(routeState()).toBeUndefined();
    });
});

it('preserves confirmed security records after background failure and retries the reads', async () => {
    const api = testApi();
    api.dataSubjectRequests.mockResolvedValue([{ id: 'privacy-confirmed' }]);
    api.fraudRiskCases.mockResolvedValue([{ id: 'risk-confirmed' }]);
    runtime().api = api;
    render();
    await expectEventually(() => expect(host.textContent).toContain('risk-confirmed'));
    render(false);

    api.dataSubjectRequests.mockRejectedValue(new Error('Background security read failed'));
    api.fraudRiskCases.mockRejectedValue(new Error('Background security read failed'));
    render();
    await expectEventually(() => expect(host.querySelector('[data-retry-security]')).not.toBeNull());
    expect(page()).not.toBeNull();
    expect(routeState()).toBeUndefined();
    expect(host.textContent).toContain('privacy-confirmed');
    expect(host.textContent).toContain('risk-confirmed');
    expect(host.textContent).toContain('"requestsBusy":true');
    expect(host.textContent).toContain('"casesBusy":true');

    api.dataSubjectRequests.mockResolvedValue([{ id: 'privacy-refreshed' }]);
    api.fraudRiskCases.mockResolvedValue([{ id: 'risk-refreshed' }]);
    act(() => button('[data-retry-security]').click());
    await expectEventually(() => {
        expect(host.textContent).toContain('privacy-refreshed');
        expect(host.textContent).toContain('risk-refreshed');
        expect(host.textContent).toContain('"error":""');
        expect(host.textContent).toContain('"requestsBusy":false');
        expect(host.textContent).toContain('"casesBusy":false');
    });
    expect(api.dataSubjectRequests).toHaveBeenCalledTimes(3);
    expect(api.fraudRiskCases).toHaveBeenCalledTimes(3);
});

it('cancels a read started before a successful write and confirms the new state with a fresh read', async () => {
    const write = deferred<void>();
    const staleRead = deferred<TestRecord[]>();
    let staleReadSignal: AbortSignal | undefined;
    const api = testApi();
    api.appealFraudRiskCase.mockReturnValue(write.promise);
    api.fraudRiskCases
        .mockResolvedValueOnce([{ id: 'risk-confirmed' }])
        .mockImplementationOnce((signal: AbortSignal) => {
            staleReadSignal = signal;
            return staleRead.promise;
        })
        .mockResolvedValueOnce([{ id: 'risk-after-appeal' }]);
    runtime().api = api;
    render();
    await expectEventually(() => expect(host.textContent).toContain('risk-confirmed'));

    act(() => button('[data-security-appeal]').click());
    expect(api.appealFraudRiskCase).toHaveBeenCalledOnce();
    expect(api.appealFraudRiskCase).toHaveBeenCalledWith('risk-confirmed', 'Fixture appeal');
    act(() => {
        void client.refetchQueries({
            predicate: query => query.queryKey.at(-1) === 'fraud-risk-cases',
            type: 'active',
        });
    });
    await expectEventually(() => expect(api.fraudRiskCases).toHaveBeenCalledTimes(2));
    expect(staleReadSignal?.aborted).toBe(false);

    await act(() => Promise.resolve(write.resolve()));
    await expectEventually(() => {
        expect(staleReadSignal?.aborted).toBe(true);
        expect(api.fraudRiskCases).toHaveBeenCalledTimes(3);
        expect(host.textContent).toContain('risk-after-appeal');
        expect(host.textContent).toContain('"casesBusy":false');
    });

    // Even a transport that finishes after its abort must not overwrite the post-write result.
    await act(() => Promise.resolve(staleRead.resolve([{ id: 'risk-before-write-stale' }])));
    await expectEventually(() => {
        expect(host.textContent).toContain('risk-after-appeal');
        expect(host.textContent).not.toContain('risk-before-write-stale');
    });
    expect(api.appealFraudRiskCase).toHaveBeenCalledOnce();
    expect(api.dataSubjectRequests).toHaveBeenCalledOnce();
});

it('does not treat a failed initial read as a successful empty state and can retry', async () => {
    const api = testApi();
    api.fraudRiskCases.mockRejectedValue(new Error('Initial risk read failed'));
    runtime().api = api;
    render();
    await expectEventually(() => expect(routeState()).toBe('error'));
    expect(page()).toBeNull();

    api.fraudRiskCases.mockResolvedValue([]);
    act(() => button('button').click());
    await expectEventually(() => {
        expect(page()).not.toBeNull();
        expect(routeState()).toBeUndefined();
        expect(host.textContent).toContain('"cases":[]');
    });
});

it('shows an unresolved offline read as paused and recovers when the connection returns', async () => {
    const api = testApi();
    runtime().api = api;
    onlineManager.setOnline(false);
    render();
    expect(routeState()).toBe('paused');
    expect(page()).toBeNull();
    expect(api.dataSubjectRequests).not.toHaveBeenCalled();
    expect(api.fraudRiskCases).not.toHaveBeenCalled();

    await act(() => Promise.resolve(onlineManager.setOnline(true)));
    await expectEventually(() => {
        expect(page()).not.toBeNull();
        expect(routeState()).toBeUndefined();
    });
});

it('keeps cached records while offline and disables their actions until revalidation succeeds', async () => {
    const api = testApi();
    api.dataSubjectRequests.mockResolvedValue([{ id: 'privacy-confirmed' }]);
    api.fraudRiskCases.mockResolvedValue([{ id: 'risk-confirmed' }]);
    runtime().api = api;
    render();
    await expectEventually(() => expect(host.textContent).toContain('risk-confirmed'));
    render(false);
    onlineManager.setOnline(false);
    render();
    expect(page()).not.toBeNull();
    expect(routeState()).toBeUndefined();
    expect(host.textContent).toContain('privacy-confirmed');
    expect(host.textContent).toContain('risk-confirmed');
    expect(host.textContent).toContain('"requestsBusy":true');
    expect(host.textContent).toContain('"casesBusy":true');

    await act(() => Promise.resolve(onlineManager.setOnline(true)));
    await expectEventually(() => {
        expect(host.textContent).toContain('"requestsBusy":false');
        expect(host.textContent).toContain('"casesBusy":false');
        expect(host.textContent).toContain('"error":""');
    });
});

it.each([
    ['customer', { customer: { id: 'customer-b' } }],
    ['store', { market: { code: 'store-b', currencyCode: 'MYR' } }],
    ['currency', { market: { code: 'store-a', currencyCode: 'USD' } }],
    ['language', { language: 'en' }],
] as const)('never leaks old security records across a %s change', async (_name, nextScope) => {
    const firstApi = testApi();
    firstApi.dataSubjectRequests.mockResolvedValue([{ id: 'privacy-scope-a-only' }]);
    firstApi.fraudRiskCases.mockResolvedValue([{ id: 'risk-scope-a-only' }]);
    runtime().api = firstApi;
    render();
    await expectEventually(() => expect(host.textContent).toContain('risk-scope-a-only'));

    const pending = deferred<TestRecord[]>();
    const secondApi = testApi();
    secondApi.dataSubjectRequests.mockReturnValue(pending.promise);
    secondApi.fraudRiskCases.mockReturnValue(pending.promise);
    testState.runtime = { ...testState.runtime, ...nextScope, api: secondApi };
    render();
    expect(routeState()).toBe('loading');
    expect(page()).toBeNull();
    expect(host.textContent).not.toContain('scope-a-only');

    await act(() => Promise.resolve(pending.resolve([{ id: 'scope-b-only' }])));
    await expectEventually(() => {
        expect(host.textContent).toContain('scope-b-only');
        expect(host.textContent).not.toContain('scope-a-only');
    });
});

it.each([undefined, false, true])(
    'uses the store export setting %s and updates on config changes',
    async enabled => {
        const api = testApi();
        runtime().api = api;
        runtime().contentQuery = { data: { settings: { personalDataExportEnabled: enabled } } };
        render();
        await expectEventually(() => {
            expect(host.textContent).toContain('"exportEnabled":' + (enabled === true));
        });
        runtime().contentQuery = { data: { settings: { personalDataExportEnabled: false } } };
        render();
        expect(host.textContent).toContain('"exportEnabled":false');
        expect(api.exportPersonalData).not.toHaveBeenCalled();
    },
);
