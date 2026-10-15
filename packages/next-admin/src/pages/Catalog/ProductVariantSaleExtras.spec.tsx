// @vitest-environment jsdom
import {
    act,
    createContext,
    useContext,
    useEffect,
    useState,
    type Dispatch,
    type SetStateAction,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '../../custom-fields/custom-field-types';
import { ProductVariantSaleExtras } from './ProductVariantSaleExtras';
import type { ProductEditorFormErrors, ProductVariantState } from './product-editor-types';

const mocks = vi.hoisted(() => ({
    variants: [] as ProductVariantState[],
    renderedVariants: [] as ProductVariantState[],
    fields: [] as CustomFieldDefinition[],
    errors: {} as ProductEditorFormErrors,
    type: 'digital',
    saving: false,
}));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => true }),
}));
vi.mock('../../hooks/use-admin-capabilities', () => ({
    useAdminCapabilities: () => ({ canUseCapability: () => true }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: () => ({
        data: { catalogSuppliers: { items: [{ id: 'supplier-a', name: '供货商A', enabled: true }] } },
        loading: false,
        error: undefined,
    }),
}));
const SharedEditorContext = createContext<ReturnType<typeof editorState> | null>(null);
vi.mock('./ProductEditorContext', () => ({ useProductEditor: () => useContext(SharedEditorContext)! }));
function editorState(
    variants: ProductVariantState[],
    setVariants: Dispatch<SetStateAction<ProductVariantState[]>>,
) {
    return {
        variants,
        variantExtensionFields: mocks.fields,
        availableCurrencyCodes: ['CNY', 'MYR', 'USD', 'MYR'],
        activeCurrencyCode: 'CNY',
        effectiveFulfillmentType: mocks.type,
        saving: mocks.saving,
        formErrors: mocks.errors,
        productData: {
            product: {
                translations: [{ languageCode: 'zh_Hans' }, { languageCode: 'en' }, { languageCode: 'en' }],
            },
        },
        handleVariantFieldChange: (index: number, field: keyof ProductVariantState, value: unknown) =>
            setVariants(current =>
                current.map((variant, row) => (row === index ? { ...variant, [field]: value } : variant)),
            ),
    };
}
function SharedEditorHarness({ variantIndex }: { variantIndex: number }) {
    const [variants, setVariants] = useState(mocks.variants);
    useEffect(() => {
        mocks.renderedVariants = variants;
    }, [variants]);
    return (
        <SharedEditorContext.Provider value={editorState(variants, setVariants)}>
            <ProductVariantSaleExtras variantIndex={variantIndex} />
        </SharedEditorContext.Provider>
    );
}

function definition(
    name: string,
    type = 'string',
    rest: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition {
    return {
        name,
        type,
        list: false,
        nullable: true,
        label: [{ languageCode: 'zh_Hans', value: name }],
        ...rest,
    };
}
function variant(index: number): ProductVariantState {
    return {
        id: `id-${index}`,
        name: `规格-${index}`,
        sku: `sku-${index}`,
        price: '100',
        costPrice: '20',
        currencyPrices: { MYR: `${50 + index}`, USD: `${20 + index}` },
        variantCustomFields: {
            version: '原版',
            note: { zh_Hans: '中文说明', en: 'English note' },
            barcode: '123456',
        },
        stockOnHand: 0,
        stockAllocated: 0,
        enabled: true,
        digitalDeliveryMode: 'manual_service',
        digitalStockPolicy: 'limited',
        optionIds: [],
    };
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    vi.clearAllMocks();
    mocks.variants = [variant(0), variant(1)];
    mocks.fields = [definition('version'), definition('note', 'localeString')];
    mocks.errors = {};
    mocks.type = 'digital';
    mocks.saving = false;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
async function mount(index = 1) {
    await act(async () => root.render(<SharedEditorHarness variantIndex={index} />));
}
function customInput(label: string) {
    return [...host.querySelectorAll('label')]
        .find(node => node.querySelector('.admin-field-label')?.textContent === label)!
        .querySelector<HTMLInputElement>('input')!;
}
async function change(input: HTMLInputElement | HTMLSelectElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(
            input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
            'value',
        )!.set!.call(input, value);
        input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    });
}
describe('ProductVariantSaleExtras shared product draft', () => {
    it('shows only other currencies once, within the original SKU, without extra save controls', async () => {
        await mount();
        expect(host.querySelector('[aria-label="规格 2 CNY 售价"]')).toBeNull();
        expect(host.querySelectorAll('[aria-label="规格 2 MYR 售价"]')).toHaveLength(1);
        expect(host.querySelector<HTMLInputElement>('[aria-label="规格 2 MYR 售价"]')!.value).toBe('51');
        expect(host.querySelector('[aria-label="规格 1 MYR 售价"]')).toBeNull();
        expect(host.querySelectorAll('button')).toHaveLength(0);
    });
    it('updates only the other-currency map and preserves current-currency price, unrelated SKU and other prices', async () => {
        await mount();
        await change(host.querySelector<HTMLInputElement>('[aria-label="规格 2 MYR 售价"]')!, '83.50');
        expect(mocks.renderedVariants[0]).toEqual(mocks.variants[0]);
        expect(mocks.renderedVariants[1].currencyPrices).toEqual({ MYR: '83.50', USD: '21' });
        expect(mocks.renderedVariants[1].price).toBe('100');
    });
    it('uses the existing compact dynamic fields and preserves sibling and localized values on edit', async () => {
        await mount();
        await change(customInput('version'), '新版');
        expect(mocks.renderedVariants[1].variantCustomFields).toEqual({
            ...mocks.variants[1].variantCustomFields,
            version: '新版',
        });
        const language = host.querySelector<HTMLSelectElement>('[aria-label="note语言"]')!;
        expect([...language.options].map(option => option.value)).toEqual(['zh_Hans', 'en']);
        await change(language, 'en');
        expect(customInput('note').value).toBe('English note');
        await change(customInput('note'), 'Updated English note');
        expect(mocks.renderedVariants[1].variantCustomFields?.note).toEqual({
            zh_Hans: '中文说明',
            en: 'Updated English note',
        });
        expect(mocks.renderedVariants[0]).toEqual(mocks.variants[0]);
    });
    it('hides irrelevant physical attributes and dashboard-hidden fields for digital goods', async () => {
        mocks.fields = [
            definition('version'),
            definition('barcode'),
            definition('purchaseUnit'),
            definition('saleUnit'),
            definition('internalValue', 'string', { internal: true }),
            definition('hiddenValue', 'string', { ui: { dashboard: false } }),
        ];
        await mount();
        expect(host.textContent).toContain('version');
        for (const name of ['barcode', 'purchaseUnit', 'saleUnit', 'internalValue', 'hiddenValue'])
            expect(host.textContent).not.toContain(name);
    });
    it('preserves barcode and unit fields for physical goods', async () => {
        mocks.type = 'physical';
        mocks.fields = [definition('barcode'), definition('purchaseUnit'), definition('saleUnit')];
        await mount();
        expect(customInput('barcode').value).toBe('123456');
        expect(customInput('purchaseUnit')).not.toBeNull();
        expect(customInput('saleUnit')).not.toBeNull();
    });
    it('exposes the main save error as an invalid focusable target linked to currency inputs', async () => {
        mocks.errors = { variants: { 1: { details: 'MYR 售价必须大于等于零' } } };
        await mount();
        const error = host.querySelector<HTMLElement>('[role="alert"]')!;
        expect(error.textContent).toBe('MYR 售价必须大于等于零');
        expect(error.getAttribute('aria-invalid')).toBe('true');
        expect(error.tabIndex).toBe(-1);
        expect(host.querySelector('[aria-label="规格 2 MYR 售价"]')!.getAttribute('aria-describedby')).toBe(
            error.id,
        );
    });
    it('disables all editable price and dynamic field controls during the shared save', async () => {
        mocks.saving = true;
        await mount();
        expect([...host.querySelectorAll<HTMLInputElement>('input')].every(input => input.disabled)).toBe(
            true,
        );
    });
    it('renders nothing when the requested SKU no longer exists', async () => {
        await mount(9);
        expect(host.innerHTML).toBe('');
    });
});

it('stores the scoped supplier selection in the shared SKU draft', async () => {
    await mount();
    await change(host.querySelector<HTMLSelectElement>('[aria-label="规格 2 供货来源"]')!, 'supplier-a');
    expect(mocks.renderedVariants[1].supplierId).toBe('supplier-a');
    expect(mocks.renderedVariants[0].supplierId).toBeUndefined();
    expect(mocks.renderedVariants[1].currencyPrices).toEqual(mocks.variants[1].currencyPrices);
    expect(host.querySelector('[aria-label="规格 1 供货来源"]')).toBeNull();
});
