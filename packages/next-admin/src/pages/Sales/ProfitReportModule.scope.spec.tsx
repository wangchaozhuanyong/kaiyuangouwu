// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdminCapabilitySnapshot } from '../../../../common/src/admin-capabilities';
import type { CatalogProfitReportSummary } from '../../graphql/catalog-operations.graphql';
import { AdminCapabilitiesContext } from '../../hooks/use-admin-capabilities';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { ProfitReportModule } from './ProfitReportModule';

vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
let host: HTMLDivElement;
let root: Root;
let client: ApolloClient;
let requests: Record<string, unknown>[];
let snapshot: AdminCapabilitySnapshot;
const summary = (currencyCode: string): CatalogProfitReportSummary => ({
    currencyCode,
    orderCount: 0,
    quantity: 0,
    settledRevenueMicrounits: 0,
    refundedRevenueMicrounits: 0,
    netRevenueMicrounits: 0,
    shippingRevenueMicrounits: 0,
    grossSalesMicrounits: 0,
    discountMicrounits: 0,
    taxMicrounits: 0,
    productCostMicrounits: 0,
    grossProfitMicrounits: 0,
    grossMargin: 0,
    missingCostOrderCount: 0,
    missingCostLineCount: 0,
    estimatedCostOrderCount: 0,
    estimatedCostLineCount: 0,
    carrierShippingCostMicrounits: 0,
    carrierShippingCostApplicable: false,
    paymentFeeMicrounits: 0,
    chargebackMicrounits: 0,
    netProfitMicrounits: 0,
    netMargin: 0,
    missingCarrierShippingCostOrderCount: 0,
    missingPaymentFeeOrderCount: 0,
    missingChargebackOrderCount: 0,
    includesCarrierShippingCost: false,
    includesPaymentFees: true,
    includesChargebacks: true,
});
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    requests = [];
    snapshot = {
        channelId: 'platform',
        channelCode: '__default_channel__',
        scope: 'PLATFORM',
        commerceMode: null,
        capabilities: [
            { id: '/sales/profit', state: 'READY', canRead: true, canWrite: false, canConfigure: false },
        ],
    };
    client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    const timer = setTimeout(() => {
                        if (operation.operationName === 'NextAdminProfitReportChannels') {
                            observer.next({
                                data: {
                                    manageableChannels: [
                                        {
                                            id: 'a',
                                            code: 'a',
                                            defaultCurrencyCode: 'CNY',
                                            customFields: { storefrontNameZh: '甲店', storefrontNameEn: 'A' },
                                        },
                                        {
                                            id: 'b',
                                            code: 'b',
                                            defaultCurrencyCode: 'MYR',
                                            customFields: { storefrontNameZh: '乙店', storefrontNameEn: 'B' },
                                        },
                                    ],
                                },
                            });
                        } else {
                            requests.push(operation.variables.input);
                            const currency =
                                operation.variables.input.targetChannelId === 'b' ? 'MYR' : 'CNY';
                            observer.next({
                                data: {
                                    catalogProfitReport: {
                                        summary: summary(currency),
                                        items: [],
                                        totalItems: 0,
                                    },
                                },
                            });
                        }
                        observer.complete();
                    }, 5);
                    return () => clearTimeout(timer);
                }),
        ),
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.stop();
    host.remove();
});
async function settle() {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
    });
}
async function render() {
    await act(async () =>
        root.render(
            <ApolloProvider client={client}>
                <AdminPermissionsContext.Provider
                    value={{ permissions: ['SuperAdmin'], hasAnyPermission: () => true }}
                >
                    <AdminCapabilitiesContext.Provider value={snapshot}>
                        <MemoryRouter initialEntries={['/sales/profit']}>
                            <ProfitReportModule />
                        </MemoryRouter>
                    </AdminCapabilitiesContext.Provider>
                </AdminPermissionsContext.Provider>
            </ApolloProvider>,
        ),
    );
    await settle();
}
async function selectStore(id: string) {
    await act(async () => {
        const select = host.querySelector('select')!;
        select.value = id;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
}

it('waits for an explicit target and changes the report scope and currency together', async () => {
    await render();
    expect(requests).toHaveLength(0);
    expect(host.textContent).toContain('平台监督为只读');
    expect(host.textContent).not.toContain('批量补费用');
    await selectStore('a');
    expect(requests.at(-1)).toMatchObject({ targetChannelId: 'a' });
    expect(host.textContent).toContain(
        new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: 'CNY',
            minimumFractionDigits: 2,
            maximumFractionDigits: 3,
        }).format(0),
    );
    await selectStore('b');
    expect(requests.at(-1)).toMatchObject({ targetChannelId: 'b' });
    expect(host.textContent).toContain(
        new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: 'MYR',
            minimumFractionDigits: 2,
            maximumFractionDigits: 3,
        }).format(0),
    );
    await selectStore('');
    expect(requests).toHaveLength(2);
    expect(
        [...host.querySelectorAll('button')].find(button => button.textContent?.includes('刷新'))?.disabled,
    ).toBe(true);
});

it('the store report sends no cross-store override and offers no store selector', async () => {
    snapshot = {
        ...snapshot,
        channelId: 'a',
        channelCode: 'a',
        scope: 'STORE',
        commerceMode: 'HYBRID',
        capabilities: [
            { id: '/sales/profit', state: 'READY', canRead: true, canWrite: true, canConfigure: true },
        ],
    };
    await render();
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty('targetChannelId');
    expect(host.querySelector('select')).toBeNull();
});
