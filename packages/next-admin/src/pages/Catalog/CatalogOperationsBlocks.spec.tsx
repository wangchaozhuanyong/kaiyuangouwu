// @vitest-environment jsdom

import { MockedProvider } from '@apollo/client/testing/react';
import type { DocumentNode } from 'graphql';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CustomFieldsContext } from '../../custom-fields/custom-fields-context';
import type { NextAdminPageBlockContext } from '../../extensions/extension-api';
import {
    CATALOG_PRODUCT_WORKSPACE_QUERY,
    PRODUCT_PACKAGING_WORKSPACE_QUERY,
} from '../../graphql/catalog-operations.graphql';
import { calculateDefaultExpiryDate } from './catalog-expiry';
import {
    CatalogOperationsBlock,
    ProductPackagingBlock,
    ProductVariantCustomFieldsBlock,
    ProductVariantPricesBlock,
} from './CatalogOperationsBlocks';
import { ProductEditorProvider } from './ProductEditorContext';
import type { ProductEditorFormState } from './useProductEditorForm';

const mocks = vi.hoisted(() => ({ query: vi.fn(), update: vi.fn(), refetch: vi.fn() }));
vi.mock('@apollo/client/react', () => ({
    useQuery: (document: DocumentNode, options: unknown) => mocks.query(document, options),
    useMutation: () => [mocks.update, { loading: false }],
}));
vi.mock('../../hooks/use-admin-query', () => import('../../test/admin-query-mock'));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));

let root: Root | undefined;
let host: HTMLDivElement;
beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.query.mockReset().mockReturnValue({ loading: true, refetch: mocks.refetch });
    mocks.update.mockReset().mockResolvedValue({});
    mocks.refetch.mockReset().mockResolvedValue({});
});
afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    host?.remove();
});
async function mount(node: ReactNode) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(node));
}
const context = (fulfillmentType: 'digital' | 'physical'): NextAdminPageBlockContext => ({
    pageId: 'product-detail',
    entity: { id: '11', name: '测试商品', customFields: { fulfillmentType } },
});
const workspace = {
    productId: '11',
    channelId: '1',
    currencyCode: 'MYR',
    stockLocations: [{ id: 'warehouse', name: '默认仓库' }],
    variants: [
        {
            id: 'sku-1',
            name: '测试规格',
            enabled: true,
            sku: 'SKU-1',
            barcode: '',
            specification: '',
            saleUnit: '件',
            purchaseUnit: '箱',
            packageQuantity: 12,
            shelfLifeDays: 365,
            sellingPrice: 1000,
            currencyCode: 'MYR',
            purchaseCostMicrounits: 1000,
            supplier: null,
            lots: [],
            stockLevels: [
                { stockLocationId: 'warehouse', stockOnHand: 10, minimumStock: null, maximumStock: null },
            ],
        },
    ],
};

describe('digital product inventory controls', () => {
    beforeEach(() => {
        mocks.query.mockImplementation((document: DocumentNode) => ({
            data:
                document === CATALOG_PRODUCT_WORKSPACE_QUERY
                    ? { catalogProductWorkspace: workspace }
                    : { catalogSuppliers: { items: [] } },
            loading: false,
            refetch: mocks.refetch,
        }));
    });

    it('hides packaging, shelf life and lot controls, including when the product type changes', async () => {
        await mount(<CatalogOperationsBlock context={context('physical')} />);
        expect(host.textContent).toContain('包装换算');
        expect(host.textContent).toContain('默认保质期');
        expect(host.textContent).toContain('新增库存批次');
        expect(host.textContent).toContain('库存批次与效期');

        await act(async () => root?.render(<CatalogOperationsBlock context={context('digital')} />));
        expect(host.textContent).not.toContain('包装换算');
        expect(host.textContent).not.toContain('保质期');
        expect(host.textContent).not.toContain('批次');
        expect(host.textContent).toBe('');

        await act(async () => root?.render(<CatalogOperationsBlock context={context('physical')} />));
        expect(host.textContent).toContain('库存批次与效期');
    });

    it('does not query or save warehouse purchasing data for digital products', async () => {
        await mount(<CatalogOperationsBlock context={context('digital')} />);
        expect(host.textContent).toBe('');
        expect(mocks.query).toHaveBeenCalledWith(
            CATALOG_PRODUCT_WORKSPACE_QUERY,
            expect.objectContaining({ skip: true }),
        );
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('retains physical packaging and shelf life in the save payload', async () => {
        await mount(<CatalogOperationsBlock context={context('physical')} />);
        await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
        const save = [...host.querySelectorAll('button')].find(button =>
            button.textContent?.includes('保存供应链信息'),
        )!;
        await act(async () => save.click());
        expect(mocks.update.mock.calls[0][0].variables.input).toMatchObject({
            packageQuantity: 12,
            shelfLifeDays: 365,
        });
    });

    it.each([
        ['', null],
        ['0', 0],
    ])('persists cleared and zero cost from the existing operations editor: %s', async (value, expected) => {
        await mount(<CatalogOperationsBlock context={context('physical')} />);
        const costInput = [...host.querySelectorAll<HTMLInputElement>('input')].find(input =>
            input.closest('label')?.textContent?.includes('采购成本'),
        )!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(costInput, value);
            costInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const save = [...host.querySelectorAll('button')].find(button =>
            button.textContent?.includes('保存供应链信息'),
        )!;
        expect(host.textContent).toContain(expected == null ? '毛利 —' : '毛利 100.0%');
        await act(async () => save.click());
        expect(mocks.update.mock.calls[0][0].variables.input.purchaseCostMicrounits).toBe(expected);
    });

    it('does not display or load automatic unpacking for digital products', () => {
        expect(renderToStaticMarkup(<ProductPackagingBlock context={context('digital')} />)).toBe('');
        expect(mocks.query).toHaveBeenCalledWith(
            PRODUCT_PACKAGING_WORKSPACE_QUERY,
            expect.objectContaining({ skip: true }),
        );
    });
});

describe('calculateDefaultExpiryDate', () => {
    it('calculates the real lot expiry date from its production date and default shelf life', () => {
        expect(calculateDefaultExpiryDate('2028-02-28', 2)).toBe('2028-03-01');
    });

    it('does not invent an expiry date without a production date or valid shelf life', () => {
        expect(calculateDefaultExpiryDate('', 30)).toBe('');
        expect(calculateDefaultExpiryDate('2026-09-10', null)).toBe('');
        expect(calculateDefaultExpiryDate('2026-09-10', -1)).toBe('');
        expect(calculateDefaultExpiryDate('2026-02-31', 30)).toBe('');
    });
});

describe('ProductVariantPricesBlock editor draft continuity', () => {
    const priceData = {
        activeChannel: {
            id: 'store-1',
            code: 'store-1',
            defaultCurrencyCode: 'MYR',
            availableCurrencyCodes: ['MYR', 'USD'],
        },
        product: {
            id: '11',
            variants: [
                {
                    id: 'sku-1',
                    name: '已保存旧名称',
                    sku: 'SAVED-SKU',
                    currencyCode: 'MYR',
                    price: 1000,
                    prices: [
                        { currencyCode: 'MYR', price: 1000 },
                        { currencyCode: 'USD', price: 300 },
                    ],
                },
            ],
        },
    };
    const editorDraft = (overrides: Partial<ProductEditorFormState> = {}): ProductEditorFormState =>
        ({
            isCreateMode: false,
            productId: '11',
            productName: '正在编辑的商品标题',
            activeCurrencyCode: 'MYR',
            productData: { product: { id: '11' } },
            saving: false,
            variants: [{ id: 'sku-1', name: '草稿规格名称', sku: 'DRAFT-SKU', price: '25.50' }],
            ...overrides,
        }) as ProductEditorFormState;
    const editorBlock = (editor: ProductEditorFormState) => (
        <ProductEditorProvider value={editor}>
            <ProductVariantPricesBlock context={context('digital')} />
        </ProductEditorProvider>
    );
    const currencyInput = (sku: string, currency: string) => {
        const input = host.querySelector<HTMLInputElement>(`input[aria-label="${sku} ${currency} 价格"]`);
        if (!input) throw new Error(`Missing ${sku} ${currency} price`);
        return input;
    };
    const changePrice = async (input: HTMLInputElement, value: string) => {
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };
    const savePrices = () => {
        const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item =>
            item.textContent?.includes('保存价格'),
        );
        if (!button) throw new Error('Missing currency save button');
        return button;
    };
    beforeEach(() => {
        mocks.query.mockReturnValue({ data: priceData, loading: false, refetch: mocks.refetch });
        mocks.update.mockResolvedValue({ data: { updateProductVariants: [{ id: 'sku-1' }] } });
    });

    it('shows the live editor SKU name and price instead of the saved query snapshot', async () => {
        await mount(editorBlock(editorDraft()));
        expect(host.textContent).toContain('草稿规格名称');
        expect(host.textContent).not.toContain('已保存旧名称');
        expect(currencyInput('DRAFT-SKU', 'MYR').value).toBe('25.50');
        const currentPrice = currencyInput('DRAFT-SKU', 'MYR');
        expect(currentPrice.readOnly || currentPrice.disabled).toBe(true);
        await act(async () =>
            root?.render(
                editorBlock(
                    editorDraft({
                        variants: [
                            { id: 'sku-1', name: '再次改名', sku: 'DRAFT-SKU', price: '31.25' },
                        ] as never,
                    }),
                ),
            ),
        );
        expect(host.textContent).toContain('再次改名');
        expect(currencyInput('DRAFT-SKU', 'MYR').value).toBe('31.25');
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('preserves another-currency draft when the main editor price changes', async () => {
        await mount(editorBlock(editorDraft()));
        await changePrice(currencyInput('DRAFT-SKU', 'USD'), '8.75');
        await act(async () =>
            root?.render(
                editorBlock(
                    editorDraft({
                        variants: [
                            { id: 'sku-1', name: '草稿规格名称', sku: 'DRAFT-SKU', price: '44.00' },
                        ] as never,
                    }),
                ),
            ),
        );
        expect(currencyInput('DRAFT-SKU', 'MYR').value).toBe('44.00');
        expect(currencyInput('DRAFT-SKU', 'USD').value).toBe('8.75');
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('saves only other currencies so stale data cannot overwrite the main editor price', async () => {
        await mount(editorBlock(editorDraft()));
        await changePrice(currencyInput('DRAFT-SKU', 'USD'), '8.75');
        await act(async () => savePrices().click());
        expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
            variables: {
                input: [{ id: 'sku-1', prices: [{ currencyCode: 'USD', price: 875 }] }],
            },
        });
    });

    it('keeps each variant name by ID instead of replacing all rows with the product title', async () => {
        const secondVariant = {
            ...priceData.product.variants[0],
            id: 'sku-2',
            name: '旧第二规格',
            sku: 'SKU-2',
        };
        mocks.query.mockReturnValue({
            data: {
                ...priceData,
                product: { ...priceData.product, variants: [...priceData.product.variants, secondVariant] },
            },
            loading: false,
            refetch: mocks.refetch,
        });
        await mount(
            editorBlock(
                editorDraft({
                    variants: [
                        { id: 'sku-2', name: '专业版', sku: 'SKU-2', price: '50.00' },
                        { id: 'sku-1', name: '基础版', sku: 'DRAFT-SKU', price: '25.50' },
                    ] as never,
                }),
            ),
        );
        const rows = [...host.querySelectorAll('tbody tr')];
        expect(rows[0].textContent).toContain('基础版');
        expect(rows[1].textContent).toContain('专业版');
        expect(rows.some(row => row.textContent?.includes('正在编辑的商品标题'))).toBe(false);
        expect(currencyInput('DRAFT-SKU', 'MYR').value).toBe('25.50');
        expect(currencyInput('SKU-2', 'MYR').value).toBe('50.00');
    });

    it('retains independent currency editing when mounted without an editor provider', async () => {
        await mount(<ProductVariantPricesBlock context={context('digital')} />);
        const currentPrice = currencyInput('SAVED-SKU', 'MYR');
        expect(currentPrice.readOnly || currentPrice.disabled).toBe(false);
        await changePrice(currentPrice, '12.50');
        await act(async () => savePrices().click());
        expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
            variables: {
                input: [
                    {
                        id: 'sku-1',
                        prices: [
                            { currencyCode: 'MYR', price: 1250 },
                            { currencyCode: 'USD', price: 300 },
                        ],
                    },
                ],
            },
        });
    });
});

describe('ProductVariantCustomFieldsBlock', () => {
    it('updates the linked product and SKU labels without replacing custom-field input', async () => {
        mocks.query.mockReturnValue({
            data: {
                product: {
                    id: '11',
                    variants: [
                        {
                            id: 'sku-1',
                            sku: 'OLD-SKU',
                            name: '原规格',
                            translations: [],
                            customFields: { deliveryNote: '原交付说明' },
                        },
                    ],
                },
            },
            loading: false,
            refetch: mocks.refetch,
        });
        const render = (name: string, skuName: string, sku: string) => (
            <ProductEditorProvider
                value={
                    {
                        productId: '11',
                        productName: name,
                        variants: [{ id: 'sku-1', name: skuName, sku }],
                    } as ProductEditorFormState
                }
            >
                <CustomFieldsContext.Provider
                    value={{
                        availableLanguages: ['zh_Hans'],
                        entities: [
                            {
                                entityName: 'ProductVariant',
                                customFields: [
                                    {
                                        name: 'deliveryNote',
                                        type: 'string',
                                        list: false,
                                        label: [{ languageCode: 'zh_Hans', value: '交付说明' }],
                                    },
                                ],
                            },
                        ],
                    }}
                >
                    <ProductVariantCustomFieldsBlock context={context('digital')} />
                </CustomFieldsContext.Provider>
            </ProductEditorProvider>
        );
        await mount(render('新商品名', '新规格名', 'NEW-SKU'));
        const input = host.querySelector<HTMLInputElement>('input');
        if (!input) throw new Error('Missing custom-field input');
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                input,
                '未保存的交付说明',
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => root?.render(render('再次改商品名', '再次改规格名', 'NEXT-SKU')));
        expect(host.querySelector('h2')?.textContent).toContain('再次改商品名');
        const selector = host.querySelector<HTMLSelectElement>('[aria-label="选择补充资料规格"]');
        expect(selector?.selectedOptions[0]?.textContent).toContain('再次改规格名 · NEXT-SKU');
        expect(host.querySelector<HTMLInputElement>('input')?.value).toBe('未保存的交付说明');
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('omits physical fields from the digital SKU editor and its mutation while preserving other fields', async () => {
        const fields = [
            {
                name: 'packageQuantity',
                type: 'float',
                list: false,
                label: [{ languageCode: 'zh_Hans', value: '包装换算数量' }],
            },
            {
                name: 'shelfLifeDays',
                type: 'int',
                list: false,
                label: [{ languageCode: 'zh_Hans', value: '默认保质期（天）' }],
            },
            {
                name: 'deliveryNote',
                type: 'string',
                list: false,
                label: [{ languageCode: 'zh_Hans', value: '交付说明' }],
            },
        ];
        mocks.query.mockReturnValue({
            data: {
                product: {
                    variants: [
                        {
                            id: 'sku-1',
                            sku: 'SKU-1',
                            name: '测试规格',
                            translations: [],
                            customFields: {
                                packageQuantity: 12,
                                shelfLifeDays: 365,
                                deliveryNote: '账号交付',
                            },
                        },
                    ],
                },
            },
            loading: false,
            refetch: mocks.refetch,
        });
        mocks.update.mockResolvedValue({ data: { updateProductVariants: [{ id: 'sku-1' }] } });
        const editor = (type: 'physical' | 'digital') => (
            <CustomFieldsContext.Provider
                value={{
                    availableLanguages: ['zh_Hans'],
                    entities: [{ entityName: 'ProductVariant', customFields: fields }],
                }}
            >
                <ProductVariantCustomFieldsBlock context={context(type)} />
            </CustomFieldsContext.Provider>
        );
        await mount(editor('physical'));
        expect(host.querySelectorAll('h2')).toHaveLength(1);
        expect(host.textContent?.match(/测试商品/g)).toHaveLength(1);
        expect(host.querySelector<HTMLSelectElement>('[aria-label="选择补充资料规格"]')?.value).toBe('sku-1');
        expect(host.textContent).not.toContain('包装换算数量');
        expect(host.textContent).not.toContain('默认保质期');
        await act(async () => root?.render(editor('digital')));
        expect(host.textContent).not.toContain('包装换算');
        expect(host.textContent).not.toContain('保质期');
        expect(host.textContent).toContain('交付说明');
        const save = [...host.querySelectorAll('button')].find(button =>
            button.textContent?.includes('保存字段'),
        )!;
        await act(async () => save.click());
        expect(mocks.update.mock.calls[0][0].variables.input[0].customFields).toEqual({
            deliveryNote: '账号交付',
        });
    });

    it('does not render the generic editor when every SKU field is hidden or malformed', () => {
        const html = renderToStaticMarkup(
            <MockedProvider>
                <CustomFieldsContext.Provider
                    value={{
                        availableLanguages: ['zh_Hans', 'en'],
                        entities: [
                            {
                                entityName: 'ProductVariant',
                                customFields: [
                                    {
                                        name: 'digitalDeliveryMode',
                                        type: 'string',
                                        list: false,
                                        ui: { dashboard: false },
                                    },
                                    {
                                        name: undefined as unknown as string,
                                        type: 'string',
                                        list: false,
                                    },
                                    {
                                        name: 'restrictedField',
                                        type: 'string',
                                        list: false,
                                        requiresPermission: ['SuperAdmin'],
                                    },
                                ],
                            },
                        ],
                    }}
                >
                    <ProductVariantCustomFieldsBlock context={{ entity: { id: '11' } } as never} />
                </CustomFieldsContext.Provider>
            </MockedProvider>,
        );

        expect(html).toBe('');
    });

    it('renders the product name in header when product name is provided', () => {
        const html = renderToStaticMarkup(
            <MockedProvider>
                <CustomFieldsContext.Provider
                    value={{
                        availableLanguages: ['zh_Hans', 'en'],
                        entities: [
                            {
                                entityName: 'ProductVariant',
                                customFields: [
                                    {
                                        name: 'testCustomField',
                                        type: 'string',
                                        list: false,
                                    },
                                ],
                            },
                        ],
                    }}
                >
                    <ProductVariantCustomFieldsBlock
                        context={
                            {
                                entity: {
                                    id: '11',
                                    name: '黄鹤楼1916',
                                },
                            } as never
                        }
                    />
                </CustomFieldsContext.Provider>
            </MockedProvider>,
        );

        expect(html).toContain('黄鹤楼1916');
    });
});
