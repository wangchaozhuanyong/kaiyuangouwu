// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DigitalProductWorkspace } from './DigitalProductWorkspace';
import type { ProductVariantState } from './product-editor-types';

const mocks = vi.hoisted(() => ({
    variants: [] as ProductVariantState[],
    renderedVariants: [] as ProductVariantState[],
    read: vi.fn(),
    mutate: vi.fn(),
    upload: vi.fn(),
    cardMount: vi.fn(),
}));
vi.mock('../../apollo', () => ({ getAdminQueryScope: () => 'store-a', uploadAdminFile: mocks.upload }));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.mutate, { loading: false }] }));
vi.mock('../../hooks/use-admin-query', () => ({ useAdminLazyQuery: () => [mocks.read, {}] }));
vi.mock('../../hooks/use-admin-capabilities', () => ({
    useAdminCapabilities: () => ({ canUseCapability: () => true }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('./ProductAutoCardSetupPanel', () => ({
    ProductAutoCardSetupPanel: ({ variants }: { variants: ProductVariantState[] }) => {
        mocks.cardMount(variants);
        return <div data-auto-card-sku={variants[0].sku}>卡密设置草稿</div>;
    },
}));
vi.mock('./ProductEditorContext', () => ({
    useProductEditor: () => {
        const [variants, setVariants] = useState(mocks.variants);
        mocks.renderedVariants = variants;
        return {
            productId: 'product-a',
            variants,
            baselineVariants: mocks.variants,
            setVariants,
            handleVariantFieldChange: (index: number, field: keyof ProductVariantState, value: unknown) =>
                setVariants(current =>
                    current.map((variant, row) => (row === index ? { ...variant, [field]: value } : variant)),
                ),
            formErrors: {},
            saving: false,
            isDirty: false,
            refetchWorkspace: vi.fn(),
            handleSave: vi.fn(),
            refetchProduct: vi.fn(),
        };
    },
}));
function variant(id: string, overrides: Partial<ProductVariantState> = {}): ProductVariantState {
    return {
        id,
        name: id,
        sku: `sku-${id}`,
        price: '100',
        stockOnHand: 300,
        stockAllocated: 7,
        enabled: true,
        optionIds: [],
        digitalDeliveryMode: 'manual_service',
        digitalStockPolicy: 'limited',
        digitalAvailableQuantity: 50,
        digitalMigrationRequired: false,
        ...overrides,
    };
}
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
    vi.clearAllMocks();
    mocks.variants = [variant('first'), variant('second')];
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
    await act(async () => root.render(<DigitalProductWorkspace variantIndex={index} inline />));
}
async function change(label: string, value: string) {
    const control = host.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(
            control.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
            'value',
        )!.set!.call(control, value);
        control.dispatchEvent(
            new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
        );
    });
}
describe('per-SKU digital sales row', () => {
    it('edits only the scoped original index, preserving unrelated SKU and physical stock', async () => {
        await mount();
        expect(host.querySelector('[aria-label="统一交付方式"]')).toBeNull();
        expect(host.querySelector('[aria-label="规格 1 可售份数"]')).toBeNull();
        await change('规格 2 可售份数', '28');
        expect(mocks.renderedVariants[0]).toEqual(mocks.variants[0]);
        expect(mocks.renderedVariants[1].digitalAvailableQuantity).toBe(28);
        expect(mocks.renderedVariants[1].stockOnHand).toBe(300);
        await change('规格 2 交付方式', 'auto_card');
        expect(mocks.renderedVariants[1].digitalStockPolicy).toBe('pool_derived');
        expect(mocks.renderedVariants[0].digitalDeliveryMode).toBe('manual_service');
        expect(mocks.mutate).not.toHaveBeenCalled();
    });
    it('renders real zero stock without subtracting reservations or falling back to the quota draft', async () => {
        mocks.variants[1] = variant('second', {
            inventorySummary: {
                source: 'LIMITED_QUOTA',
                availableQuantity: 0,
                reservedQuantity: 3,
                consumedQuantity: 9,
                observedAt: '2026-10-16T00:00:00.000Z',
            },
        });
        await mount();
        const stats = host.querySelector('[aria-label="规格 2 库存统计"]')!;
        expect(stats.textContent).toContain('可售 0');
        expect(stats.textContent).toContain('订单占用 3');
        expect(stats.textContent).toContain('已扣减 9');
        expect(stats.textContent).not.toContain('50');
    });
    it('keeps unavailable statistics unknown rather than replacing them with editable configuration', async () => {
        mocks.variants[1] = variant('second', {
            inventorySummary: {
                source: 'LIMITED_QUOTA',
                availableQuantity: null,
                reservedQuantity: null,
                consumedQuantity: null,
                observedAt: '2026-10-16T00:00:00.000Z',
            },
        });
        await mount();
        expect(host.querySelector('[aria-label="规格 2 库存统计"]')!.textContent).toContain('可售 待更新');
        expect(host.querySelector('[aria-label="规格 2 库存统计"]')!.textContent).toContain(
            '订单占用 待更新',
        );
    });
    it('keeps migration controls inside a closed exception disclosure without reading or writing on mount', async () => {
        mocks.variants[1] = variant('second', { digitalMigrationRequired: true });
        await mount();
        const details = host.querySelector('details')!;
        expect(details.open).toBe(false);
        expect(details.querySelector('summary')!.textContent).toContain('查看异常');
        expect(host.querySelector('[aria-label="规格 2 可售份数"]')).toBeNull();
        expect(mocks.read).not.toHaveBeenCalled();
        expect(mocks.mutate).not.toHaveBeenCalled();
    });
    it('does not mount card configuration until expanded and retains it when collapsed', async () => {
        mocks.variants[1] = variant('second', {
            digitalDeliveryMode: 'auto_card',
            digitalStockPolicy: 'pool_derived',
            autoCardAvailableStock: 0,
        });
        await mount();
        expect(mocks.cardMount).not.toHaveBeenCalled();
        const details = host.querySelector<HTMLDetailsElement>('.product-editor-variant-resources')!;
        await act(async () => {
            details.open = true;
            details.dispatchEvent(new Event('toggle'));
        });
        expect(host.querySelector('[data-auto-card-sku="sku-second"]')).not.toBeNull();
        const panel = host.querySelector('[data-auto-card-sku="sku-second"]');
        await act(async () => {
            details.open = false;
            details.dispatchEvent(new Event('toggle'));
        });
        expect(host.querySelector('[data-auto-card-sku="sku-second"]')).toBe(panel);
    });
    it('shows only the scoped file and changes only that SKU when a file is uploaded', async () => {
        mocks.variants[1] = variant('second', {
            digitalDeliveryMode: 'file_download',
            digitalFileName: 'second.zip',
        });
        mocks.upload.mockResolvedValue({
            uploadDigitalDeliveryFile: { id: 'file-2', fileName: 'replacement.zip' },
        });
        await mount();
        expect(host.textContent).toContain('second.zip');
        const input = host.querySelector<HTMLInputElement>('[aria-label="规格 2 交付文件"]')!;
        Object.defineProperty(input, 'files', {
            configurable: true,
            value: [new File(['data'], 'replacement.zip')],
        });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        expect(mocks.renderedVariants[1].digitalFileVersionId).toBe('file-2');
        expect(mocks.renderedVariants[0].digitalFileVersionId).toBeUndefined();
        expect(mocks.mutate).not.toHaveBeenCalled();
    });
});
