import { FeatureHelpProvider } from '../../components/FeatureHelp';
// @vitest-environment jsdom

import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogContext } from '../../components/confirm-dialog-context';
import { InventoryControlModule } from './InventoryControlModule';
import {
    InventoryLotDialog,
    InventoryWarehouseModule,
    validateInventoryLotDraft,
} from './InventoryWarehouseModule';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    mutate: vi.fn(),
    refetch: vi.fn(),
    readOperations: vi.fn(),
}));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: mocks.query,
    useAdminLazyQuery: () => [mocks.readOperations, {}],
}));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.mutate, { loading: false }] }));

const validDraft = {
    productVariantId: 'variant-1',
    stockLocationId: 'location-1',
    lotCode: 'LOT-001',
    manufacturedAt: '2026-09-01',
    expiresAt: '2027-09-01',
    quantityOnHand: '12',
    purchaseCost: '2.5',
    reason: '到货入库',
};

const mounted: Array<{ container: HTMLDivElement; unmount: () => void }> = [];

afterEach(async () => {
    await act(async () => mounted.splice(0).forEach(({ unmount }) => unmount()));
});

describe('inventory lot transfer recovery', () => {
    it('shows after-sales replacement stock deductions with a readable ledger type', async () => {
        mocks.query.mockReturnValue({
            loading: false,
            refetch: mocks.refetch,
            data: {
                catalogInventoryReconciliation: { items: [], totalItems: 0 },
                catalogInventoryOperations: {
                    totalItems: 1,
                    items: [
                        {
                            id: 'replacement-operation',
                            code: 'INV-ASR-1',
                            type: 'AFTER_SALES_REPLACEMENT',
                            status: 'POSTED',
                            reason: '售后换补发',
                            reference: 'AFTER-SALES-FIXTURE',
                            postedAt: '2026-10-08T00:00:00Z',
                            createdAt: '2026-10-08T00:00:00Z',
                            lines: [
                                {
                                    id: 'movement-1',
                                    quantityDelta: -1,
                                    previousLotQuantity: 10,
                                    resultingLotQuantity: 9,
                                    previousStockOnHand: 10,
                                    resultingStockOnHand: 9,
                                    variant: { id: 'variant-1', name: 'Fixture variant', sku: 'SKU-1' },
                                    stockLocation: { id: 'warehouse-1', name: 'Fixture warehouse' },
                                    inventoryLot: { id: 'lot-1', lotCode: 'LOT-1' },
                                },
                            ],
                        },
                    ],
                },
            },
        });
        const html = renderToStaticMarkup(
            <FeatureHelpProvider>
                <InventoryControlModule />
            </FeatureHelpProvider>,
        );
        expect(html).toContain('换货／补发出库');
        expect(html).toContain('SKU-1');
        expect(html).toContain('-1');
        expect(html).not.toContain('AFTER_SALES_REPLACEMENT');
    });

    async function mountTransfer() {
        mocks.mutate.mockReset();
        mocks.refetch.mockReset().mockResolvedValue(undefined);
        mocks.readOperations
            .mockReset()
            .mockResolvedValue({ data: { catalogInventoryOperations: { items: [], totalItems: 0 } } });
        mocks.query.mockReturnValue({
            loading: false,
            refetch: mocks.refetch,
            data: {
                productVariants: { items: [], totalItems: 0 },
                globalSettings: { trackInventory: true },
                stockLocations: {
                    items: [
                        { id: 'source-1', name: 'Source' },
                        { id: 'target-1', name: 'Target' },
                    ],
                    totalItems: 2,
                },
                catalogExportRows: {
                    totalItems: 1,
                    items: [
                        {
                            productId: 'product-1',
                            productName: 'Fixture product',
                            variantId: 'variant-1',
                            sku: 'SKU-1',
                            currencyCode: 'MYR',
                            stockLevels: [],
                            lots: [
                                {
                                    id: 'lot-1',
                                    lotCode: 'LOT-1',
                                    stockLocationId: 'source-1',
                                    stockLocationName: 'Source',
                                    quantityOnHand: 10,
                                    currencyCode: 'MYR',
                                    purchaseCostMicrounits: null,
                                    state: 'ACTIVE',
                                    manufacturedAt: null,
                                    expiresAt: null,
                                },
                            ],
                        },
                    ],
                },
            },
        });
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        mounted.push({
            container,
            unmount: () => {
                root.unmount();
                container.remove();
            },
        });
        await act(async () =>
            root.render(
                <MemoryRouter initialEntries={['/catalog/inventory?tab=lots']}>
                    <ConfirmDialogContext.Provider value={async () => false}>
                        <FeatureHelpProvider>
                            <InventoryWarehouseModule />
                        </FeatureHelpProvider>
                    </ConfirmDialogContext.Provider>
                </MemoryRouter>,
            ),
        );
        const button = (label: string) => {
            const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
                item => item.textContent?.trim() === label,
            );
            expect(found, label).toBeDefined();
            return found!;
        };
        await act(async () => button('转仓').click());
        const dialog = container.querySelector('[role="dialog"]')!;
        const input = [...dialog.querySelectorAll<HTMLInputElement>('input')].at(-1)!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                input,
                'fixture transfer',
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        return { container, dialog, button };
    }

    it('keeps the original payload and key after a lost response, verifies without writing, and safely retries the original request', async () => {
        const { container, dialog, button } = await mountTransfer();
        mocks.mutate
            .mockRejectedValueOnce(new Error('Failed to fetch'))
            .mockResolvedValue({ data: { transferCatalogInventoryLot: { id: 'operation-1' } } });
        await act(async () => button('确认转仓').click());
        const original = mocks.mutate.mock.calls[0][0].variables.input;
        expect(dialog.textContent).toContain('原转仓结果待核对');
        expect(button('取消').disabled).toBe(true);
        expect(dialog.querySelector('fieldset')?.disabled).toBe(true);
        await act(async () => button('核对转仓结果').click());
        expect(mocks.mutate).toHaveBeenCalledTimes(1);
        expect(dialog.textContent).toContain('结果仍待核对');
        await act(async () => button('重试原转仓请求').click());
        expect(mocks.mutate).toHaveBeenCalledTimes(2);
        expect(mocks.mutate.mock.calls[1][0].variables.input).toEqual(original);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('finds the exact posted receipt across pages and keeps acknowledged read failure locked until a read succeeds', async () => {
        const { container, dialog, button } = await mountTransfer();
        mocks.mutate.mockRejectedValue(new Error('Failed to fetch'));
        await act(async () => button('确认转仓').click());
        const original = mocks.mutate.mock.calls[0][0].variables.input;
        mocks.readOperations
            .mockResolvedValueOnce({
                data: {
                    catalogInventoryOperations: {
                        items: Array.from({ length: 200 }, (_, id) => ({
                            id: String(id),
                            type: 'LOT_TRANSFER',
                            status: 'POSTED',
                            reference: 'other',
                        })),
                        totalItems: 201,
                    },
                },
            })
            .mockResolvedValueOnce({
                data: {
                    catalogInventoryOperations: {
                        items: [
                            {
                                id: 'operation-1',
                                type: 'LOT_TRANSFER',
                                status: 'POSTED',
                                reference: original.reference,
                            },
                        ],
                        totalItems: 201,
                    },
                },
            });
        mocks.refetch.mockRejectedValueOnce(new Error('fixture latest inventory read failure'));
        await act(async () => button('核对转仓结果').click());
        expect(mocks.readOperations.mock.calls.map(call => call[0].variables.skip)).toEqual([0, 200]);
        expect(dialog.textContent).toContain('原转仓已入账');
        expect(dialog.textContent).toContain('操作已完成，但最新数据读取失败');
        expect(
            [...dialog.querySelectorAll('button')].some(item => item.textContent?.includes('重试原转仓请求')),
        ).toBe(false);
        await act(async () => button('核对转仓结果').click());
        expect(mocks.readOperations).toHaveBeenCalledTimes(2);
        expect(mocks.mutate).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it('keeps a known rejected first request editable rather than falsely calling it an unknown write', async () => {
        const { dialog, button } = await mountTransfer();
        mocks.mutate.mockRejectedValue(
            new CombinedGraphQLErrors({
                errors: [{ message: '目标仓库无效', extensions: { code: 'USER_INPUT_ERROR' } }],
            }),
        );
        await act(async () => button('确认转仓').click());
        expect(dialog.textContent).toContain('目标仓库无效');
        expect(dialog.textContent).not.toContain('原转仓结果待核对');
        expect(dialog.querySelector('fieldset')?.disabled).toBe(false);
        expect(button('取消').disabled).toBe(false);
    });

    it('prevents same-turn duplicate submits even before mutation loading renders', async () => {
        const { button } = await mountTransfer();
        let resolve!: (value: unknown) => void;
        mocks.mutate.mockImplementation(
            () =>
                new Promise(done => {
                    resolve = done;
                }),
        );
        await act(async () => {
            button('确认转仓').click();
            button('确认转仓').click();
        });
        expect(mocks.mutate).toHaveBeenCalledTimes(1);
        expect(button('取消').disabled).toBe(true);
        await act(async () => resolve({ data: { transferCatalogInventoryLot: { id: 'operation-1' } } }));
    });
});

function mountDialog(saving = false) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onClose = vi.fn();
    const onSave = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({
        container,
        unmount: () => {
            root.unmount();
            container.remove();
        },
    });
    act(() => {
        root.render(
            <FeatureHelpProvider>
                <InventoryLotDialog
                    draft={validDraft}
                    variants={[]}
                    saving={saving}
                    onChange={vi.fn()}
                    onClose={onClose}
                    onSave={onSave}
                />
            </FeatureHelpProvider>,
        );
    });
    return { container, onClose, onSave };
}

describe('inventory batch dialog validation', () => {
    const invalidDraftCases: [typeof validDraft, { variantId: string }[], string][] = [
        [{ ...validDraft, lotCode: '   ' }, [{ variantId: 'variant-1' }], '请选择 SKU 并填写批次号'],
        [
            { ...validDraft, productVariantId: 'missing' },
            [{ variantId: 'variant-1' }],
            '请选择 SKU 并填写批次号',
        ],
        [
            { ...validDraft, quantityOnHand: '' },
            [{ variantId: 'variant-1' }],
            '批次数量必须是不小于 0 的整数',
        ],
        [
            { ...validDraft, quantityOnHand: '-1' },
            [{ variantId: 'variant-1' }],
            '批次数量必须是不小于 0 的整数',
        ],
        [
            { ...validDraft, quantityOnHand: '1.5' },
            [{ variantId: 'variant-1' }],
            '批次数量必须是不小于 0 的整数',
        ],
        [{ ...validDraft, purchaseCost: '-0.1' }, [{ variantId: 'variant-1' }], '请输入有效的非负批次成本'],
        [
            { ...validDraft, purchaseCost: 'invalid' },
            [{ variantId: 'variant-1' }],
            '请输入有效的非负批次成本',
        ],
        [{ ...validDraft, reason: '  ' }, [{ variantId: 'variant-1' }], '请填写库存调整原因'],
    ];
    it.each(invalidDraftCases)(
        'rejects invalid input without allowing a save: %#',
        (draft, variants, message) => {
            expect(validateInventoryLotDraft(draft, variants)).toBe(message);
        },
    );

    it('accepts a valid batch with zero quantity and an omitted optional cost', () => {
        expect(
            validateInventoryLotDraft({ ...validDraft, quantityOnHand: '0', purchaseCost: '' }, [
                { variantId: 'variant-1' },
            ]),
        ).toBeUndefined();
    });

    it('cancel closes without saving and save dispatches once', () => {
        const { container, onClose, onSave } = mountDialog();
        const cancel = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === '取消',
        );
        const save = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === '保存批次',
        );
        expect(cancel).toBeTruthy();
        expect(save).toBeTruthy();
        act(() => cancel!.click());
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onSave).not.toHaveBeenCalled();
        act(() => save!.click());
        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('locks both save and close while a batch mutation is pending', () => {
        const { container, onClose, onSave } = mountDialog(true);
        const close = container.querySelector<HTMLButtonElement>('[aria-label="关闭批次编辑"]');
        const cancel = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === '取消',
        );
        const save = Array.from(container.querySelectorAll('button')).find(
            button => button.textContent?.trim() === '保存中…',
        );
        expect(close?.disabled).toBe(true);
        expect(cancel?.disabled).toBe(true);
        expect(save?.disabled).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
        expect(onSave).not.toHaveBeenCalled();
    });

    it.each(['请选择 SKU 并填写批次号', '库存批次保存失败，请检查输入后重试'])(
        'shows the error inside the active modal: %s',
        error => {
            const html = renderToStaticMarkup(
                <FeatureHelpProvider>
                    <InventoryLotDialog
                        draft={{
                            productVariantId: '27',
                            stockLocationId: '7',
                            lotCode: '',
                            manufacturedAt: '',
                            expiresAt: '',
                            quantityOnHand: '0',
                            purchaseCost: '',
                            reason: '月底盘点',
                        }}
                        variants={[]}
                        saving={false}
                        error={error}
                        onChange={vi.fn()}
                        onClose={vi.fn()}
                        onSave={vi.fn()}
                    />
                </FeatureHelpProvider>,
            );
            expect(html).toContain('role="dialog"');
            expect(html).toContain(`role="alert"`);
            expect(html).toContain(error);
            expect(html.indexOf(error)).toBeLessThan(html.indexOf('保存批次'));
        },
    );
});
