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
import {
    CatalogOperationsBlock,
    ProductPackagingBlock,
    ProductVariantCustomFieldsBlock,
} from './CatalogOperationsBlocks';
import { calculateDefaultExpiryDate } from './catalog-expiry';

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

describe('ProductVariantCustomFieldsBlock', () => {
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
