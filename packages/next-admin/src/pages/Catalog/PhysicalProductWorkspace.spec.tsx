// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PhysicalProductWorkspace } from './PhysicalProductWorkspace';

const mocks = vi.hoisted(() => ({ change: vi.fn() }));
vi.mock('./ProductEditorContext', () => ({
    useProductEditor: () => ({
        variants: [
            { id: 'first', name: '第一规格', stockOnHand: 100, stockAllocated: 4 },
            {
                id: 'second',
                name: '第二规格',
                stockOnHand: 20,
                stockAllocated: 7,
                physicalSettings: { packageQuantity: 2, shelfLifeDays: 30 },
            },
        ],
        saving: false,
        formErrors: {},
        handleVariantFieldChange: mocks.change,
    }),
}));
vi.mock('../../hooks/use-admin-capabilities', () => ({
    useAdminCapabilities: () => ({ canUseCapability: () => true }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
    vi.clearAllMocks();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
        root.render(
            <MemoryRouter>
                <PhysicalProductWorkspace variantIndex={1} inline />
            </MemoryRouter>,
        ),
    );
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
it('shows scoped read-only warehouse counts and keeps operational stock entry in inventory management', () => {
    expect(host.querySelector('[aria-label="规格 2 库存统计"]')!.textContent).toContain(
        '可售 13 · 在库 20 · 订单占用 7',
    );
    expect(host.textContent).not.toContain('第一规格');
    expect(host.querySelector('[aria-label="规格 1 包装换算"]')).toBeNull();
    expect(
        [...host.querySelectorAll('a')].some(link => link.getAttribute('href') === '/catalog/inventory'),
    ).toBe(true);
    expect(mocks.change).not.toHaveBeenCalled();
});
it('updates packaging for the scoped original SKU index without editing stock', async () => {
    const input = host.querySelector<HTMLInputElement>('[aria-label="规格 2 包装换算"]')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '6');
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(mocks.change).toHaveBeenCalledWith(1, 'physicalSettings', {
        packageQuantity: 6,
        shelfLifeDays: 30,
    });
    expect(mocks.change).toHaveBeenCalledTimes(1);
});
