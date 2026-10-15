// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CATALOG_SUPPLIERS_QUERY } from '../../graphql/catalog-operations.graphql';
import { ProductSupplySettings } from './ProductSupplySettings';

const mocks = vi.hoisted(() => ({
    canRead: true,
    saving: false,
    loading: false,
    error: undefined as Error | undefined,
    read: vi.fn(),
    rendered: [] as Array<{ id: string; name: string; supplierId: string | null }>,
    items: [] as Array<{ id: string; name: string; enabled: boolean }>,
}));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: () => mocks.canRead }),
}));
vi.mock('../../hooks/use-admin-capabilities', () => ({
    useAdminCapabilities: () => ({ canUseCapability: () => true }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: (query: unknown, options: unknown) => {
        mocks.read(query, options);
        return {
            data: { catalogSuppliers: { items: mocks.items } },
            loading: mocks.loading,
            error: mocks.error,
        };
    },
}));
vi.mock('./ProductEditorContext', () => ({
    useProductEditor: () => {
        const [variants, setVariants] = useState([
            { id: 'first', name: '第一规格', supplierId: 'supplier-a' as string | null },
            { id: 'second', name: '第二规格', supplierId: 'disabled-supplier' as string | null },
        ]);
        mocks.rendered = variants;
        return {
            variants,
            saving: mocks.saving,
            handleVariantFieldChange: (index: number, _field: string, value: string | null) =>
                setVariants(current =>
                    current.map((variant, row) =>
                        row === index ? { ...variant, supplierId: value } : variant,
                    ),
                ),
        };
    },
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
    vi.clearAllMocks();
    mocks.canRead = true;
    mocks.saving = false;
    mocks.loading = false;
    mocks.error = undefined;
    mocks.items = [
        { id: 'supplier-a', name: '供货商A', enabled: true },
        { id: 'disabled-supplier', name: '停用供货商', enabled: false },
        { id: 'another-disabled', name: '其他停用供货商', enabled: false },
    ];
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
async function mount(index: number | undefined = 1) {
    await act(async () =>
        root.render(<ProductSupplySettings variantIndex={index} inline={index !== undefined} />),
    );
}
async function select(value: string) {
    const input = host.querySelector<HTMLSelectElement>('[aria-label="规格 2 供货来源"]')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}
it('scopes supplier controls to the original SKU and retains its disabled selected supplier only', async () => {
    await mount();
    expect(host.querySelector('[aria-label="规格 1 供货来源"]')).toBeNull();
    const input = host.querySelector<HTMLSelectElement>('[aria-label="规格 2 供货来源"]')!;
    expect(input.value).toBe('disabled-supplier');
    expect([...input.options].map(option => option.value)).toEqual(['', 'supplier-a', 'disabled-supplier']);
    expect(mocks.read).toHaveBeenCalledWith(CATALOG_SUPPLIERS_QUERY, {
        skip: false,
        variables: { options: { skip: 0, take: 100 } },
    });
});
it('updates and clears only the scoped original SKU supplier', async () => {
    await mount();
    await select('supplier-a');
    expect(mocks.rendered[1].supplierId).toBe('supplier-a');
    expect(mocks.rendered[0].supplierId).toBe('supplier-a');
    await select('');
    expect(mocks.rendered[1].supplierId).toBeNull();
    expect(mocks.rendered[0].supplierId).toBe('supplier-a');
});
it('preserves the old unscoped mode with one field per SKU', async () => {
    await act(async () => root.render(<ProductSupplySettings />));
    expect(host.querySelectorAll('select')).toHaveLength(2);
    expect(host.textContent).toContain('第一规格');
    expect(host.textContent).toContain('第二规格');
});
it('keeps unauthorized supplier reads skipped and renders no supplier data', async () => {
    mocks.canRead = false;
    await mount();
    expect(host.innerHTML).toBe('');
    expect(mocks.read.mock.calls[0][1].skip).toBe(true);
});
it('skips supplier reads if the scoped SKU has disappeared', async () => {
    await mount(9);
    expect(host.innerHTML).toBe('');
    expect(mocks.read.mock.calls[0][1].skip).toBe(true);
});
it('preserves the selected supplier while loading or saving disables editing', async () => {
    mocks.loading = true;
    await mount();
    expect(host.querySelector<HTMLSelectElement>('select')!.disabled).toBe(true);
    expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe('disabled-supplier');
    mocks.loading = false;
    mocks.saving = true;
    await mount();
    expect(host.querySelector<HTMLSelectElement>('select')!.disabled).toBe(true);
});
it('keeps an association visible when the supplier is outside the current returned list', async () => {
    mocks.items = [];
    await mount();
    expect(host.querySelector<HTMLSelectElement>('select')!.value).toBe('disabled-supplier');
    expect(host.textContent).toContain('已关联供货商');
});
