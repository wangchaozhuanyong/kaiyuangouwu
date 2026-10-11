// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DigitalWorkspaceVariant } from '../../graphql/product-domains.graphql';
import type { ProductDetailRecord } from './product-editor-types';
import { useProductEditorForm } from './useProductEditorForm';
import type { useProductEditorSave } from './useProductEditorSave';

const mocks = vi.hoisted(() => ({
    data: {} as Record<string, unknown>,
    fields: [],
    scope: 'store-a',
    productId: 'product-1',
    saveInput: null as unknown,
    noop: vi.fn(),
    canUseCapability: () => true,
}));
vi.mock('../../apollo', () => ({
    getAdminQueryScope: () => mocks.scope,
    sensitiveActionContext: mocks.noop,
}));
vi.mock('@apollo/client/react', () => ({ useMutation: () => [mocks.noop, { loading: false }] }));
vi.mock('react-router-dom', () => ({
    useParams: () => ({ id: mocks.productId }),
    useNavigate: () => mocks.noop,
}));
vi.mock('../../components/confirm-dialog-context', () => ({ useConfirmDialog: () => mocks.noop }));
vi.mock('../../custom-fields/custom-fields-context', () => ({
    useCustomFieldDefinitions: () => mocks.fields,
}));
vi.mock('../../hooks/use-admin-return', () => ({ useAdminReturn: () => ({ returnToList: mocks.noop }) }));
vi.mock('../../hooks/use-page-size', () => ({ usePageSize: () => [20, mocks.noop] }));
vi.mock('../../hooks/use-admin-capabilities', () => ({
    useAdminCapabilities: () => ({ canUseCapability: mocks.canUseCapability }),
}));
vi.mock('../../hooks/use-url-tab', async () => {
    const { useState } = await import('react');
    return { useUrlTab: () => useState('BASIC') };
});
vi.mock('./useProductEditorData', () => ({ useProductEditorData: () => mocks.data }));
vi.mock('./useProductEditorSave', () => ({
    useProductEditorSave: (input: unknown) => {
        mocks.saveInput = input;
        return { handleSave: mocks.noop };
    },
}));

const product: ProductDetailRecord = {
    id: 'product-1',
    createdAt: '2026-10-11T00:00:00Z',
    enabled: true,
    name: 'Original',
    slug: 'original',
    description: 'Original description',
    translations: [
        {
            id: 'zh',
            languageCode: 'zh_Hans',
            name: 'Original',
            slug: 'original',
            description: 'Original description',
        },
    ],
    assets: [],
    facetValues: [],
    collections: [],
    channels: [{ id: 'store-a', code: 'store-a' }],
    optionGroups: [],
    customFields: { fulfillmentType: 'digital' },
    variants: [
        {
            id: 'sku-1',
            name: 'Original SKU',
            sku: 'SKU-1',
            price: 1000,
            enabled: true,
            stockOnHand: 10,
            stockAllocated: 0,
            trackInventory: 'INHERIT',
            options: [],
            translations: [{ languageCode: 'zh_Hans', name: 'Original SKU' }],
        },
    ],
};
const workspace: DigitalWorkspaceVariant = {
    id: 'sku-1',
    sku: 'SKU-1',
    deliveryMode: 'file_download',
    stockPolicy: 'limited',
    availableQuantity: 10,
    migrationRequired: true,
    purchaseCostMicrounits: 5000,
    fileVersion: { id: 'file-old', fileName: 'old.pdf' },
};
let host: HTMLDivElement;
let root: Root;
let editor: ReturnType<typeof useProductEditorForm>;
function Fixture() {
    const snapshot = useProductEditorForm();
    useLayoutEffect(() => {
        editor = snapshot;
    }, [snapshot]);
    return <div>{snapshot.productName}</div>;
}
const rerender = () => act(async () => root.render(<Fixture />));
beforeEach(async () => {
    vi.clearAllMocks();
    mocks.scope = 'store-a';
    mocks.productId = 'product-1';
    mocks.data = {
        productData: { product },
        productLoading: false,
        activeCurrencyCode: 'MYR',
        commerceMode: 'DIGITAL',
        fixedFulfillmentType: 'digital',
        workspaceVariants: [workspace],
        defaultStockLocationId: 'stock-1',
        catalogChannelsData: { activeChannel: { id: 'store-a' }, channels: { items: [], totalItems: 0 } },
        refetchProduct: mocks.noop,
        refetchWorkspace: mocks.noop,
    };
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await rerender();
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

it('preserves names, cleared cost and channel draft through a Product-object change during workspace reading', async () => {
    await act(async () => {
        editor.setProductName('Draft name');
        editor.setDescription('Typed during inventory review');
        editor.setSelectedChannelIds(['store-a', 'store-b']);
        editor.setVariants(current =>
            current.map(variant => ({ ...variant, costPrice: '', digitalFileVersionId: 'file-draft' })),
        );
    });
    mocks.data.productData = {
        product: { ...product, translations: [{ ...product.translations[0], name: 'Remote name' }] },
    };
    mocks.data.workspaceVariants = [
        {
            ...workspace,
            availableQuantity: 14,
            migrationRequired: false,
            purchaseCostMicrounits: 8000,
            fileVersion: { id: 'file-server', fileName: 'server.pdf' },
        },
    ];
    await rerender();
    expect(editor).toMatchObject({
        productName: 'Draft name',
        description: 'Typed during inventory review',
        selectedChannelIds: ['store-a', 'store-b'],
        isDirty: true,
    });
    expect(editor.variants[0]).toMatchObject({
        costPrice: '',
        digitalFileVersionId: 'file-draft',
        digitalAvailableQuantity: 14,
        digitalMigrationRequired: false,
    });
});

it('keeps dirty state registered while a background product read is loading', async () => {
    await act(async () => editor.setDescription('Uncommitted description'));
    mocks.data.productLoading = true;
    await rerender();
    expect(editor.isDirty).toBe(true);
    expect(editor.description).toBe('Uncommitted description');
});

it('uses the accepted save snapshot to protect input entered while readback is pending', async () => {
    await act(async () => editor.setProductName('Submitted name'));
    const submitted = mocks.saveInput as Parameters<typeof useProductEditorSave>[0];
    await act(async () => editor.setProductName('New input while waiting'));
    await act(async () => submitted.controls.acceptSavedDraft?.(submitted.draft));
    mocks.data.productData = {
        product: { ...product, translations: [{ ...product.translations[0], name: 'Submitted name' }] },
    };
    mocks.data.workspaceVariants = [{ ...workspace, purchaseCostMicrounits: null, availableQuantity: 12 }];
    await rerender();
    expect(editor.productName).toBe('New input while waiting');
    expect(editor.variants[0]).toMatchObject({ costPrice: '', digitalAvailableQuantity: 12 });
    expect(editor.isDirty).toBe(true);
});

it('waits for current-store digital workspace IDs before exposing persisted variants', async () => {
    mocks.scope = 'store-b';
    mocks.data.workspaceVariants = undefined;
    mocks.data.productLoading = true;
    await rerender();
    expect(editor.variants).toEqual([]);
    mocks.data.workspaceVariants = [workspace];
    mocks.data.productLoading = false;
    await rerender();
    expect(editor.variants.map(variant => variant.id)).toEqual(['sku-1']);
    expect(editor.isDirty).toBe(false);
});

it('claims a newly created SKU ID without accepting unsaved costs or replacing later input', async () => {
    await act(async () =>
        editor.setVariants([
            {
                ...editor.variants[0],
                id: undefined,
                sku: 'NEW',
                isNew: true,
                name: 'Submitted row',
                costPrice: '6.00',
            },
        ]),
    );
    const submitted = mocks.saveInput as Parameters<typeof useProductEditorSave>[0];
    await act(async () =>
        editor.setVariants(current =>
            current.map(row => ({ ...row, name: 'Typed while cost is failing', costPrice: '' })),
        ),
    );
    await act(async () =>
        submitted.controls.acceptSavedVariantIdentities?.([{ id: 'created-1', sku: 'NEW' }]),
    );
    expect(editor.variants[0]).toMatchObject({
        id: 'created-1',
        isNew: false,
        name: 'Typed while cost is failing',
        costPrice: '',
    });
    expect(editor.isDirty).toBe(true);
});

it('keeps equivalent cost formatting and optional digital readback values clean', async () => {
    mocks.data.workspaceVariants = [
        {
            ...workspace,
            stockPolicy: 'unlimited',
            availableQuantity: null,
            purchaseCostMicrounits: 0,
            fileVersion: null,
        },
    ];
    await rerender();
    await act(async () =>
        editor.setVariants(current =>
            current.map(row => ({
                ...row,
                costPrice: '0',
                supplierId: undefined,
                digitalFileVersionId: undefined,
                digitalAvailableQuantity: undefined,
            })),
        ),
    );
    expect(editor.isDirty).toBe(false);
});
