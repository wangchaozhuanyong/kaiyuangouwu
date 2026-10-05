import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AdminButton } from '../../src/components/AdminControls';
import { FeatureHelpProvider } from '../../src/components/FeatureHelp';
import '../../src/index.css';
import { OrderExpenseImportDialog } from '../../src/pages/Sales/OrderExpenseImportDialog';
import { OrderProfitExpensePanel } from '../../src/pages/Sales/OrderProfitExpensePanel';

// Synthetic UI acceptance: no HTTP link, no production order or credential, writes only affect this fixture.
const params = new URLSearchParams(location.search);
const type = (params.get('type') ?? 'DIGITAL').toUpperCase();
const applicability = { fulfillmentType: type, carrierShippingCostApplicable: type !== 'DIGITAL' };
const fixture = { writes: [] as Array<{ operation: string; input: Record<string, unknown> }> };
let saved = params.has('legacy')
    ? {
          __typename: 'CatalogOrderProfitExpense',
          id: 'expense-1',
          orderId: 'fixture-order',
          currencyCode: 'MYR',
          createdAt: '2026-10-04T00:00:00.000Z',
          updatedAt: '2026-10-04T00:00:00.000Z',
          carrierShippingCostMicrounits: 5000,
          paymentFeeMicrounits: null as number | null,
          chargebackMicrounits: null as number | null,
          note: '',
          source: 'MANUAL',
          sourceReference: null,
      }
    : null;
let revision = 0;
const client = new ApolloClient({
    cache: new InMemoryCache(),
    link: new ApolloLink(
        operation =>
            new Observable(observer => {
                const name = operation.operationName;
                const input = operation.variables.input;
                if (name === 'NextAdminCatalogOrderProfitExpense') {
                    if (params.has('readback-failure') && fixture.writes.length) {
                        observer.error(new Error('合成费用回读失败'));
                        return;
                    }
                    observer.next({
                        data: {
                            catalogOrderProfitExpenseApplicability: applicability,
                            catalogOrderProfitExpense: saved,
                            catalogOrderProfitExpenseEvents: [],
                        },
                    });
                } else if (name === 'NextAdminSaveCatalogOrderProfitExpense') {
                    fixture.writes.push({ operation: name, input });
                    saved = {
                        __typename: 'CatalogOrderProfitExpense',
                        id: 'expense-1',
                        orderId: 'fixture-order',
                        currencyCode: 'MYR',
                        createdAt: '2026-10-04T00:00:00.000Z',
                        updatedAt: `2026-10-04T00:00:0${++revision}.000Z`,
                        carrierShippingCostMicrounits: null,
                        paymentFeeMicrounits: null,
                        chargebackMicrounits: null,
                        note: '',
                        source: 'MANUAL',
                        sourceReference: null,
                        ...saved,
                        ...input,
                    };
                    observer.next({ data: { saveCatalogOrderProfitExpense: saved } });
                } else if (name === 'NextAdminValidateCatalogOrderProfitExpenses') {
                    observer.next({
                        data: {
                            validateCatalogOrderProfitExpenses: {
                                rows: input.rows.map((row: Record<string, unknown>) => ({
                                    rowNumber: row.rowNumber,
                                    orderCode: row.orderCode,
                                    ...applicability,
                                    error:
                                        type === 'DIGITAL' && row.carrierShippingCostMicrounits !== undefined
                                            ? '纯数字订单不适用承运商物流成本，请移除该费用字段'
                                            : null,
                                })),
                            },
                        },
                    });
                } else if (name === 'NextAdminImportCatalogOrderProfitExpenses') {
                    fixture.writes.push({ operation: name, input });
                    observer.next({
                        data: {
                            importCatalogOrderProfitExpenses: {
                                totalRows: input.rows.length,
                                createdCount: input.rows.length,
                                updatedCount: 0,
                            },
                        },
                    });
                } else {
                    observer.error(new Error('费用验收未配置操作：' + name));
                    return;
                }
                observer.complete();
            }),
    ),
});
Object.assign(window, { expenseFixture: fixture });
function Fixture() {
    const [importOpen, setImportOpen] = React.useState(params.has('import'));
    return (
        <div className="min-h-screen bg-slate-50 p-4">
            <p className="mb-4 rounded-lg bg-amber-100 p-3 text-xs text-amber-900">
                订单费用合成验收 · 没有生产连接 · 仅使用正式费用组件
            </p>
            <div className="mx-auto max-w-3xl">
                <OrderProfitExpensePanel
                    orderId="fixture-order"
                    currencyCode="MYR"
                    canRead={!params.has('no-read')}
                    canUpdate={!params.has('readonly')}
                />
            </div>
            <AdminButton
                onClick={() => setImportOpen(true)}
                className="mt-4 rounded bg-slate-900 px-4 py-2 text-white"
            >
                打开费用导入
            </AdminButton>
            {importOpen && (
                <OrderExpenseImportDialog
                    currencyCode="MYR"
                    onClose={() => setImportOpen(false)}
                    onImported={() => undefined}
                />
            )}
        </div>
    );
}
createRoot(document.getElementById('root')!).render(
    <ApolloProvider client={client}>
        <MemoryRouter>
            <FeatureHelpProvider>
                <Fixture />
            </FeatureHelpProvider>
        </MemoryRouter>
    </ApolloProvider>,
);
