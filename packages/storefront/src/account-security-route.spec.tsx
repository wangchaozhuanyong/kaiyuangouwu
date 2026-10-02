// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { AccountSecurityRoutePage } from './route-pages/order-route-pages';

const testState = vi.hoisted(() => ({ runtime: null as Record<string, unknown> | null }));

vi.mock('./lazy-storefront-pages', () => ({
    LazyAccountSecurityPage: (props: {
        customer: { id: string };
        onDataExport?: (password: string) => Promise<unknown>;
        dataSubjectRequests: Array<{ id: string }>;
        fraudRiskCases: Array<{ id: string }>;
    }) => (
        <div>
            {JSON.stringify({
                customer: props.customer?.id,
                exportEnabled: Boolean(props.onDataExport),
                requests: props.dataSubjectRequests.map(item => item.id),
                cases: props.fraudRiskCases.map(item => item.id),
            })}
        </div>
    ),
    LazyAddressesPage: () => null,
    LazyLogisticsPage: () => null,
    LazyOrderDetailPage: () => null,
    LazyOrdersPage: () => null,
}));
vi.mock('./storefront-ui/page-shell', () => ({
    AuthPageBoundary: ({ children }: { children: unknown }) => children,
}));
vi.mock('./route-pages/shared', () => ({
    registerRoutePreload: () => vi.fn(),
    RouteGate: ({ children }: { children: unknown }) => children,
    useRouteRuntime: () => testState.runtime,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('does not display the previous customer security records while another account loads', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const firstApi = {
        customerAvatarHistory: vi.fn().mockResolvedValue([{ id: 'avatar-a-only' }]),
        dataSubjectRequests: vi.fn().mockResolvedValue([{ id: 'privacy-a-only' }]),
        fraudRiskCases: vi.fn().mockResolvedValue([{ id: 'risk-a-only' }]),
    };
    let resolveSecond!: (value: Array<{ id: string }>) => void;
    const secondPending = new Promise<Array<{ id: string }>>(resolve => {
        resolveSecond = resolve;
    });
    const secondApi = {
        customerAvatarHistory: vi.fn().mockReturnValue(secondPending),
        dataSubjectRequests: vi.fn().mockReturnValue(secondPending),
        fraudRiskCases: vi.fn().mockReturnValue(secondPending),
    };
    const base = { language: 'zh', goBack: vi.fn(), notify: vi.fn(), storefrontName: 'Fixture' };
    try {
        testState.runtime = { ...base, customer: { id: 'customer-a' }, api: firstApi };
        await act(async () => {
            root.render(<AccountSecurityRoutePage />);
            await Promise.resolve();
        });
        expect(firstApi.customerAvatarHistory).not.toHaveBeenCalled();
        expect(host.textContent).toContain('privacy-a-only');
        expect(host.textContent).toContain('risk-a-only');

        testState.runtime = { ...base, customer: { id: 'customer-b' }, api: secondApi };
        await act(async () => {
            root.render(<AccountSecurityRoutePage />);
            await Promise.resolve();
        });
        expect(host.textContent).toContain('customer-b');
        expect(host.textContent).not.toContain('a-only');

        await act(async () => {
            resolveSecond([{ id: 'b-only' }]);
            await Promise.resolve();
        });
        expect(host.textContent).toContain('b-only');
    } finally {
        act(() => root.unmount());
    }
});

it.each([undefined, false, true])(
    'uses the store export setting %s and updates on config changes',
    async enabled => {
        const host = document.createElement('div');
        const root = createRoot(host);
        const api = {
            dataSubjectRequests: vi.fn().mockResolvedValue([]),
            fraudRiskCases: vi.fn().mockResolvedValue([]),
            exportPersonalData: vi.fn(),
        };
        testState.runtime = {
            language: 'zh',
            customer: { id: 'customer-a' },
            api,
            notify: vi.fn(),
            contentQuery: { data: { settings: { personalDataExportEnabled: enabled } } },
        };
        try {
            await act(async () => {
                root.render(<AccountSecurityRoutePage />);
                await Promise.resolve();
            });
            expect(host.textContent).toContain(`"exportEnabled":${enabled === true}`);
            testState.runtime.contentQuery = { data: { settings: { personalDataExportEnabled: false } } };
            await act(async () => {
                root.render(<AccountSecurityRoutePage />);
                await Promise.resolve();
            });
            expect(host.textContent).toContain('"exportEnabled":false');
            expect(api.exportPersonalData).not.toHaveBeenCalled();
        } finally {
            act(() => root.unmount());
        }
    },
);
