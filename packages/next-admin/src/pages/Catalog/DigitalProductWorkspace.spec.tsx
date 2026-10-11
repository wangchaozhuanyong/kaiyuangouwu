// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MIGRATE_DIGITAL_INVENTORY } from '../../graphql/product-domains.graphql';
import { resourceDomains } from '../../runtime/admin-resource-events';
import { DigitalProductWorkspace } from './DigitalProductWorkspace';

const mocks = vi.hoisted(() => ({
    read: vi.fn(),
    mutate: vi.fn(),
    refetch: vi.fn(),
    scope: 'fixture-store-a',
    productId: '6',
    dirty: false,
    deliveryMode: 'manual_service',
    draftOverrides: {} as Record<string, unknown>,
    baselineOverrides: {} as Record<string, unknown>,
    setVariants: vi.fn(),
    upload: vi.fn(),
}));
vi.mock('../../apollo', () => ({
    getAdminQueryScope: () => mocks.scope,
    uploadAdminFile: mocks.upload,
}));
vi.mock('@apollo/client/react', () => ({
    useMutation: () => [mocks.mutate, { loading: false }],
}));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminLazyQuery: () => [mocks.read, {}],
}));
vi.mock('../../hooks/use-admin-capabilities', () => ({
    useAdminCapabilities: () => ({ canUseCapability: () => true }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('./ProductAutoCardSetupPanel', () => ({ ProductAutoCardSetupPanel: () => null }));
vi.mock('./ProductEditorContext', () => ({
    useProductEditor: () => {
        const variant = {
            id: '12',
            sku: 'fixture-sku',
            name: '默认规格',
            digitalDeliveryMode: mocks.deliveryMode,
            digitalMigrationRequired: true,
            ...mocks.draftOverrides,
        };
        return {
            productId: mocks.productId,
            variants: [variant],
            baselineVariants: [{ ...variant, ...mocks.baselineOverrides }],
            setVariants: mocks.setVariants,
            handleVariantFieldChange: vi.fn(),
            formErrors: {},
            saving: false,
            isDirty: mocks.dirty,
            refetchWorkspace: mocks.refetch,
            handleSave: vi.fn(),
            refetchProduct: vi.fn(),
        };
    },
}));

const row = { id: '23', stockLocationId: '1', stockOnHand: 100, stockAllocated: 0 };
const reason = '经营者已确认该记录属于当前店铺';
const confirmation = { stockLevels: [row], reason };
function response(confirmed = false, ordinary = false) {
    return {
        data: {
            digitalInventoryMigrationPreview: {
                availableQuantity: confirmed ? 200 : 100,
                reservedQuantity: 0,
                conflicts: confirmed || ordinary ? [] : ['旧库存缺少店铺归属，请先核对'],
                alreadyMigrated: false,
                confirmableStockLevels: ordinary
                    ? []
                    : [{ ...row, __typename: 'DigitalInventoryLegacyStockLevel' }],
            },
        },
    };
}
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
    vi.clearAllMocks();
    mocks.scope = 'fixture-store-a';
    mocks.productId = '6';
    mocks.dirty = false;
    mocks.deliveryMode = 'manual_service';
    mocks.draftOverrides = {};
    mocks.baselineOverrides = {};
    mocks.read.mockImplementation(({ variables }) =>
        Promise.resolve(response(Boolean(variables.ownershipConfirmation))),
    );
    mocks.mutate.mockResolvedValue({
        data: { migrateDigitalInventory: { id: 'config-1', availableQuantity: 200 } },
    });
    mocks.refetch.mockResolvedValue({});
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<DigitalProductWorkspace />));
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
function button(name: string) {
    const found = [...host.querySelectorAll('button')].find(node => node.textContent?.trim() === name);
    if (!found) throw new Error(`Missing button ${name}`);
    return found;
}
async function click(name: string) {
    await act(async () => button(name).click());
}
async function setReason(value: string) {
    const input = host.querySelector<HTMLInputElement>('[aria-label="归属核对依据"]')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
async function confirmPreview() {
    await click('核对旧库存');
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await setReason(reason);
    await click('核验归属与库存');
}

it('requires explicit ownership and a fresh server preview, preserving row CAS fields without Apollo metadata', async () => {
    await click('核对旧库存');
    expect(button('确认核对并切换').disabled).toBe(true);
    expect(button('核验归属与库存').disabled).toBe(true);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(button('核验归属与库存').disabled).toBe(true);
    await setReason(reason);
    await click('核验归属与库存');
    expect(mocks.read.mock.calls[1][0].variables.ownershipConfirmation).toEqual(confirmation);
    expect(button('确认核对并切换').disabled).toBe(false);
    await click('确认核对并切换');
    expect(mocks.mutate).toHaveBeenCalledWith({
        variables: {
            productVariantId: '12',
            expectedAvailable: 200,
            expectedReserved: 0,
            ownershipConfirmation: confirmation,
        },
    });
});

it('invalidates verified ownership after either the checkbox or reason changes', async () => {
    await confirmPreview();
    await setReason('新的核对依据');
    expect(button('确认核对并切换').disabled).toBe(true);
    await click('核验归属与库存');
    expect(button('确认核对并切换').disabled).toBe(false);
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(button('确认核对并切换').disabled).toBe(true);
    await click('确认核对并切换');
    expect(mocks.mutate).not.toHaveBeenCalled();
});

it('keeps server conflicts blocking after a failed recheck and requires a new read', async () => {
    await confirmPreview();
    mocks.read.mockRejectedValueOnce(new Error('库存已变化'));
    await click('核验归属与库存');
    expect(button('确认核对并切换').disabled).toBe(true);
    expect(mocks.mutate).not.toHaveBeenCalled();
});

it('disables migration if the product draft becomes dirty after preview', async () => {
    await confirmPreview();
    mocks.dirty = true;
    await act(async () => root.render(<DigitalProductWorkspace />));
    expect(button('确认核对并切换').disabled).toBe(true);
    await click('确认核对并切换');
    expect(mocks.mutate).not.toHaveBeenCalled();
});

it('allows a dirty draft to review inventory and ownership without allowing migration writes', async () => {
    mocks.dirty = true;
    await act(async () => root.render(<DigitalProductWorkspace />));
    expect(button('核对旧库存').disabled).toBe(false);
    await confirmPreview();
    expect(button('核验归属与库存').disabled).toBe(false);
    expect(button('确认核对并切换').disabled).toBe(true);
    expect(mocks.mutate).not.toHaveBeenCalled();
});

it('disables unified file binding while any target SKU still has legacy inventory', async () => {
    mocks.deliveryMode = 'file_download';
    await act(async () => root.render(<DigitalProductWorkspace />));
    expect(host.querySelector<HTMLInputElement>('[aria-label="上传统一交付文件"]')?.disabled).toBe(true);
});

it('explicitly undoes legacy delivery input without writing or discarding name and cost drafts', async () => {
    mocks.dirty = true;
    mocks.draftOverrides = {
        name: 'Draft name',
        costPrice: '',
        supplierId: 'draft-supplier',
        digitalFileVersionId: 'draft-file',
        digitalFileName: 'draft.pdf',
        digitalAvailableQuantity: 99,
    };
    mocks.baselineOverrides = {
        name: 'Server name',
        costPrice: '5.00',
        digitalFileVersionId: 'old-file',
        digitalFileName: 'old.pdf',
        digitalAvailableQuantity: 14,
    };
    await act(async () => root.render(<DigitalProductWorkspace />));
    expect(host.textContent).toContain('仅撤回本规格的交付方式、销售数量、可售份数和文件绑定');
    await click('撤回未保存的交付修改');
    const update = mocks.setVariants.mock.calls[0][0];
    const current: Record<string, unknown> = {
        id: '12',
        sku: 'fixture-sku',
        digitalDeliveryMode: 'manual_service',
        digitalMigrationRequired: true,
        ...mocks.draftOverrides,
    };
    const restored = update([current]);
    expect(restored[0]).toMatchObject({
        name: 'Draft name',
        costPrice: '',
        supplierId: 'draft-supplier',
        digitalFileVersionId: 'old-file',
        digitalFileName: 'old.pdf',
        digitalAvailableQuantity: 14,
    });
    expect(current.digitalFileVersionId).toBe('draft-file');
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
});

it('does not offer delivery undo against a different store SKU baseline', async () => {
    mocks.draftOverrides = { digitalFileVersionId: 'draft-file' };
    mocks.baselineOverrides = { id: 'another-store-sku', digitalFileVersionId: 'old-file' };
    await act(async () => root.render(<DigitalProductWorkspace />));
    expect(host.textContent).not.toContain('撤回未保存的交付修改');
});

it('ignores a delivery undo click after store scope changed before rendering', async () => {
    mocks.draftOverrides = { digitalFileVersionId: 'draft-file' };
    mocks.baselineOverrides = { digitalFileVersionId: 'old-file' };
    await act(async () => root.render(<DigitalProductWorkspace />));
    mocks.scope = 'fixture-store-b';
    await click('撤回未保存的交付修改');
    expect(mocks.setVariants).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
});

it('separates saved migration from readback failure and only retries reading', async () => {
    await confirmPreview();
    mocks.refetch.mockRejectedValueOnce(new Error('读取失败'));
    await click('确认核对并切换');
    expect(host.textContent).toContain('迁移已成功，但最新库存读取失败');
    expect(button('核对旧库存').disabled).toBe(true);
    await click('重新读取最新库存');
    expect(mocks.refetch).toHaveBeenCalledTimes(2);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
});

it('does not replay an uncertain mutation result before reading current workspace', async () => {
    await confirmPreview();
    mocks.mutate.mockRejectedValueOnce(new Error('连接中断'));
    await click('确认核对并切换');
    expect(button('核对旧库存').disabled).toBe(true);
    await click('重新读取最新库存');
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
});

it('deduplicates rapid apply clicks while the mutation is unresolved', async () => {
    await confirmPreview();
    let finish!: (value: unknown) => void;
    mocks.mutate.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finish = resolve;
            }),
    );
    await act(async () => {
        button('确认核对并切换').click();
        button('确认核对并切换').click();
    });
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: { migrateDigitalInventory: { id: 'config-1' } } }));
});

it('discards a late preview after store or product identity changes', async () => {
    let finish!: (value: unknown) => void;
    mocks.read.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                finish = resolve;
            }),
    );
    await click('核对旧库存');
    mocks.scope = 'fixture-store-b';
    mocks.productId = '9';
    await act(async () => root.render(<DigitalProductWorkspace />));
    await act(async () => finish(response()));
    expect(host.querySelector('[aria-label="数字库存迁移核对"]')).toBeNull();
    expect(mocks.mutate).not.toHaveBeenCalled();
});

it('does not use a verified preview after the store scope changes before rendering', async () => {
    await confirmPreview();
    mocks.scope = 'fixture-store-b';
    await click('确认核对并切换');
    expect(mocks.mutate).not.toHaveBeenCalled();
});

it('retains the existing owned-warehouse path without requiring a confirmation', async () => {
    mocks.read.mockResolvedValueOnce(response(false, true));
    await click('核对旧库存');
    expect(host.querySelector('[aria-label="归属核对依据"]')).toBeNull();
    await click('确认核对并切换');
    expect(mocks.mutate.mock.calls[0][0].variables.ownershipConfirmation).toBeUndefined();
});

it('invalidates catalog, reservation and governance reads after the same native migration mutation', () => {
    expect(resourceDomains(MIGRATE_DIGITAL_INVENTORY)).toEqual(['catalog', 'orders', 'settings']);
});
