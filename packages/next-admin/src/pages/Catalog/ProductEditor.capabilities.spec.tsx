// @vitest-environment jsdom
import type { DocumentNode } from 'graphql';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdminCapabilitySnapshot } from '../../../../common/src/admin-capabilities';
import { CREATE_PRODUCT, UPDATE_PRODUCT } from '../../graphql/catalog.graphql';
import { AdminCapabilitiesContext } from '../../hooks/use-admin-capabilities';
import { AdminPermissionsContext } from '../../hooks/use-admin-permissions';
import { hasAnyAdminPermission } from '../../utils/admin-permissions';
import { ProductEditor } from './ProductEditor';
import type { ProductEditorFormState } from './useProductEditorForm';
import { useProductEditorSave } from './useProductEditorSave';

type SaveInput = Parameters<typeof useProductEditorSave>[0];
const mocks = vi.hoisted(() => ({
    mutations: new Map<DocumentNode, ReturnType<typeof vi.fn>>(),
    query: vi.fn(),
    mutate: vi.fn(),
    saveInput: undefined as SaveInput | undefined,
    editor: undefined as ProductEditorFormState | undefined,
    save: undefined as ReturnType<typeof useProductEditorSave>['handleSave'] | undefined,
    queryScope: 'scope-a',
    channelToken: 'fixture-channel-a',
}));
vi.mock('@apollo/client/react', () => ({
    useMutation: (document: DocumentNode) => {
        if (!mocks.mutations.has(document)) mocks.mutations.set(document, vi.fn().mockResolvedValue({}));
        return [mocks.mutations.get(document), { loading: false }];
    },
}));
vi.mock('../../apollo', () => ({
    client: { query: mocks.query, mutate: mocks.mutate },
    sensitiveActionContext: vi.fn(),
    getAdminQueryScope: () => mocks.queryScope,
    getActiveChannelToken: () => mocks.channelToken,
    channelRequestContext: (token: string) => ({
        headers: { 'vendure-token': token },
        queryDeduplication: false,
    }),
}));
vi.mock('../../hooks/use-admin-query', () => ({
    useAdminQuery: () => ({ data: { productTypeChangeAllowed: true }, loading: false }),
}));
vi.mock('../../components/FeatureHelp', () => ({ FeatureHelpButton: () => null }));
vi.mock('../../extensions/extension-hosts', () => ({ NextAdminPageBlocks: () => null }));
vi.mock('./CatalogOperationsBlocks', () => ({ ProductPackagingBlock: () => null }));
vi.mock('./DigitalProductWorkspace', () => ({ DigitalProductWorkspace: () => <p>数字交付信息</p> }));
vi.mock('./PhysicalProductWorkspace', () => ({ PhysicalProductWorkspace: () => <p>实物库存信息</p> }));
vi.mock('./ProductFacetsCollectionsTab', () => ({ ProductFacetsCollectionsTab: () => null }));
vi.mock('./ProductCategorySummary', () => ({ ProductCategorySummary: () => null }));
vi.mock('./ProductMoreSettings', () => ({ ProductMoreSettings: () => null }));
vi.mock('./ProductSupplySettings', () => ({ ProductSupplySettings: () => null }));
vi.mock('./ProductAiImageDialog', () => ({ ProductAiImageDialog: () => <div role="dialog">AI 图像</div> }));
vi.mock('./useProductEditorForm', () => ({
    useProductEditorForm: () => {
        if (!mocks.saveInput || !mocks.editor) throw new Error('Missing product fixture');
        const { handleSave } = useProductEditorSave(mocks.saveInput);
        const [activeTab, setActiveTab] = useState('BASIC');
        const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
        mocks.save = handleSave;
        return {
            ...mocks.editor,
            handleSave,
            activeTab,
            setActiveTab,
            isAssetPickerOpen,
            setIsAssetPickerOpen,
        };
    },
}));

function fixture(): SaveInput {
    const baseline: SaveInput['draft'] = {
        productName: '商品A',
        slug: 'product-a',
        description: '原详情',
        enabled: true,
        fulfillmentType: 'physical',
        refundPolicy: 'MERCHANT_REVIEW',
        manualDeliverySlaMinutes: 1440,
        featuredAssetId: 'asset-a',
        selectedAssetIds: ['asset-a'],
        selectedFacetValueIds: [],
        selectedCollectionIds: [],
        selectedChannelIds: [],
        selectedOptionGroupIds: [],
        dynamicCustomFields: {},
        variants: [
            {
                id: 'variant-a',
                sku: 'SKU-A',
                name: '规格A',
                price: '10.00',
                stockOnHand: 5,
                stockAllocated: 0,
                enabled: true,
                digitalDeliveryMode: 'manual_service',
                digitalStockPolicy: 'limited',
                optionIds: [],
            },
        ],
    };
    const product: NonNullable<SaveInput['data']['productData']>['product'] = {
        id: 'product-a',
        createdAt: '2026-10-07T00:00:00Z',
        enabled: true,
        name: baseline.productName,
        slug: baseline.slug,
        description: baseline.description,
        customFields: { fulfillmentType: 'physical' },
        featuredAsset: { id: 'asset-a', name: '原主图', preview: '/assets/own.png' },
        assets: [{ id: 'asset-a', name: '原详情图', preview: '/assets/own.png' }],
        facetValues: [],
        optionGroups: [],
        collections: [],
        channels: [],
        translations: [
            {
                id: 'translation-a',
                languageCode: 'zh_Hans',
                name: baseline.productName,
                slug: baseline.slug,
                description: baseline.description,
            },
        ],
        variants: [
            {
                id: 'variant-a',
                name: '规格A',
                sku: 'SKU-A',
                price: 1000,
                stockOnHand: 5,
                stockAllocated: 0,
                enabled: true,
                trackInventory: 'INHERIT',
                options: [],
                translations: [],
            },
        ],
    };
    return {
        productId: 'product-a',
        productExtensionFields: [],
        baselineDraft: baseline,
        activeCurrencyCode: 'CNY',
        draft: { ...baseline, description: '更新详情' },
        data: {
            productData: { product },
            catalogChannelsData: undefined,
            refetchProduct: vi.fn().mockResolvedValue({ data: { product } }),
            refetchCollections: vi.fn().mockResolvedValue({}),
            defaultStockLocationId: 'stock-a',
            refetchWorkspace: vi.fn().mockResolvedValue({}),
        },
        controls: {
            requestConfirmation: vi.fn().mockResolvedValue(null),
            navigate: vi.fn(),
            setActiveTab: vi.fn(),
            setErrorMessage: vi.fn(),
            setFormErrors: vi.fn(),
            setSaving: vi.fn(),
            showError: vi.fn(),
            showNotice: vi.fn(),
        },
    };
}
function snapshot(
    scope: 'PLATFORM' | 'STORE',
    canWrite: boolean,
    channelId = 'store-a',
): AdminCapabilitySnapshot {
    return {
        channelId: scope === 'PLATFORM' ? 'platform' : channelId,
        channelCode: scope === 'PLATFORM' ? '__default_channel__' : channelId,
        scope,
        commerceMode: scope === 'PLATFORM' ? null : 'PHYSICAL_ONLY',
        capabilities: [
            { id: '/catalog/products', state: 'READY', canRead: true, canWrite, canConfigure: false },
            {
                id: '/catalog/products/new',
                state: canWrite ? 'READY' : 'FORBIDDEN',
                canRead: canWrite,
                canWrite,
                canConfigure: false,
            },
        ],
    };
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    mocks.mutations.clear();
    mocks.query.mockReset();
    mocks.mutate.mockReset();
    mocks.queryScope = 'scope-a';
    mocks.channelToken = 'fixture-channel-a';
    mocks.saveInput = fixture();
    const product = mocks.saveInput.data.productData?.product;
    mocks.editor = {
        ...mocks.saveInput.draft,
        ...mocks.saveInput.data,
        isCreateMode: false,
        productData: { product },
        effectiveFulfillmentType: 'physical',
        fixedFulfillmentType: 'physical',
        activeTab: 'BASIC',
        saving: false,
        isDirty: true,
        activeCurrencyCode: 'CNY',
        formErrors: {},
        knownOptionGroups: {},
        knownAssets: {
            'asset-a': { id: 'asset-a', name: '原主图', preview: '/assets/own.png', type: 'IMAGE' },
        },
        featuredAssetPreview: '/assets/own.png',
        catalogChannelsData: { activeChannel: { code: 'store-a' } },
        optionGroupsData: { productOptionGroups: { items: [] } },
        leaveToProductList: vi.fn(),
        setEnabled: vi.fn(),
        setFeaturedAssetId: vi.fn(),
        setFeaturedAssetPreview: vi.fn(),
        setKnownAssets: vi.fn(),
        setAssetPickerMode: vi.fn(),
        setFulfillmentType: vi.fn(),
        navigate: vi.fn(),
        setErrorMessage: vi.fn(),
        dynamicCustomFieldValues: {},
        setProductName: vi.fn(),
        setSlug: vi.fn(),
        setFormErrors: vi.fn(),
        setDescription: vi.fn(),
        setSelectedAssetIds: vi.fn(),
        setVariants: vi.fn(),
        handleApplyOptionGroup: vi.fn(),
        handleVariantFieldChange: vi.fn(),
        handleDeleteVariant: vi.fn(),
        assetsData: { assets: { items: [], totalItems: 0 } },
        assetsLoading: false,
        assetSearch: '',
        assetPage: 0,
        assetPageSize: 10,
        setAssetSearch: vi.fn(),
        setAssetPage: vi.fn(),
        setAssetPageSize: vi.fn(),
        refetchAssets: vi.fn(),
    } as unknown as ProductEditorFormState;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
async function render(capabilities: AdminCapabilitySnapshot, permissions: string[]) {
    await act(async () =>
        root.render(
            <MemoryRouter initialEntries={['/catalog/products/product-a']}>
                <AdminPermissionsContext.Provider
                    value={{
                        permissions,
                        hasAnyPermission: required => hasAnyAdminPermission(permissions, required),
                    }}
                >
                    <AdminCapabilitiesContext.Provider value={capabilities}>
                        <ProductEditor />
                    </AdminCapabilitiesContext.Provider>
                </AdminPermissionsContext.Provider>
            </MemoryRouter>,
        ),
    );
}
function button(label: string) {
    const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
        candidate =>
            candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
    );
    if (!node) throw new Error(`Missing button: ${label}`);
    return node;
}
function expectNoWrites() {
    for (const mutation of mocks.mutations.values()) expect(mutation).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
}

it.each([
    ['PLATFORM', ['SuperAdmin']],
    ['STORE', ['ReadProduct']],
] as const)(
    'keeps %s product reads and tabs without exposing or submitting writes',
    async (scope, permissions) => {
        await render(snapshot(scope, false), [...permissions]);
        expect(host.textContent).toContain('商品A');
        expect(host.textContent).toContain('更新详情');
        expect(host.querySelector('img[alt="商品主图预览"]')).not.toBeNull();
        expect(host.textContent).not.toContain('保存商品');
        expect(host.textContent).not.toContain('AI 生成主图');
        expect(host.textContent).not.toContain('复制基础资料创建');
        expect(host.querySelector('input[type="file"]')).toBeNull();
        expect(host.querySelector('[aria-label="启用商品"]')).toBeNull();
        expect(host.querySelectorAll('[role="tabpanel"] fieldset[disabled]')).toHaveLength(4);
        expect(host.querySelector('[role="dialog"]')).toBeNull();
        await act(async () => {
            for (const control of host.querySelectorAll<HTMLButtonElement>('[role="tabpanel"] button')) {
                expect(control.matches(':disabled')).toBe(true);
                control.click();
            }
        });
        expect(mocks.editor?.handleDeleteVariant).not.toHaveBeenCalled();
        await act(async () => button('01商品信息').click());
        await act(async () => button('02规格与价格').click());
        expect(button('02规格与价格').getAttribute('aria-selected')).toBe('true');
        const price = host.querySelector<HTMLInputElement>('[aria-label="批量售价"]');
        expect(price?.matches(':disabled')).toBe(true);
        await act(async () => {
            if (!mocks.save) throw new Error('Missing save');
            await mocks.save();
        });
        expect(mocks.saveInput?.controls.showError).toHaveBeenCalledWith('当前商品仅可查看，不能保存修改。');
        expectNoWrites();
    },
);

it('lets an authorized store save and removes already opened writing tools when permission is revoked', async () => {
    await render(snapshot('STORE', true), ['ReadProduct', 'UpdateProduct', 'CreateAsset']);
    expect(button('保存商品').disabled).toBe(false);
    await act(async () => button('保存商品').click());
    expect(mocks.mutations.get(UPDATE_PRODUCT)).toHaveBeenCalledOnce();
    expect(mocks.mutations.get(UPDATE_PRODUCT)).toHaveBeenCalledWith(
        expect.objectContaining({
            context: { headers: { 'vendure-token': 'fixture-channel-a' }, queryDeduplication: false },
        }),
    );
    expect(mocks.saveInput?.data.refetchProduct).toHaveBeenCalledOnce();
    await act(async () => button('更换主图').click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    const retainedSave = mocks.save;
    mocks.mutations.forEach(mutation => mutation.mockClear());
    await render(snapshot('STORE', false), ['ReadProduct']);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).not.toContain('保存商品');
    await act(async () => {
        if (!retainedSave) throw new Error('Missing save');
        await retainedSave();
    });
    expectNoWrites();
});

it('stops a pending store-A confirmation after selection switches to writable store-B', async () => {
    if (!mocks.saveInput) throw new Error('Missing save fixture');
    mocks.saveInput.draft.enabled = false;
    let approve: (
        value: Awaited<ReturnType<SaveInput['controls']['requestConfirmation']>>,
    ) => void = () => {};
    vi.mocked(mocks.saveInput.controls.requestConfirmation).mockReturnValue(
        new Promise(resolve => {
            approve = resolve;
        }),
    );
    await render(snapshot('STORE', true), ['ReadProduct', 'UpdateProduct']);
    let pending: Promise<void> | undefined;
    await act(async () => {
        pending = mocks.save?.();
    });
    expect(mocks.saveInput.controls.requestConfirmation).toHaveBeenCalledOnce();
    mocks.queryScope = 'scope-b';
    mocks.channelToken = 'fixture-channel-b';
    await render(snapshot('STORE', true, 'store-b'), ['ReadProduct', 'UpdateProduct']);
    await act(async () => {
        approve({});
        await pending;
    });
    expectNoWrites();
});

it('rejects an unmounted store-A create handler after switching to writable store-B', async () => {
    if (!mocks.saveInput || !mocks.editor) throw new Error('Missing save fixture');
    mocks.saveInput.productId = 'new';
    mocks.saveInput.baselineDraft = null;
    mocks.editor.isCreateMode = true;
    await render(snapshot('STORE', true), ['ReadProduct', 'CreateProduct']);
    const retainedSave = mocks.save;
    await act(async () => root.render(null));
    mocks.queryScope = 'scope-b';
    mocks.channelToken = 'fixture-channel-b';
    await render(snapshot('STORE', true, 'store-b'), ['ReadProduct', 'CreateProduct']);
    await act(async () => {
        if (!retainedSave) throw new Error('Missing retained save');
        await retainedSave();
    });
    expectNoWrites();
    expect(mocks.saveInput.controls.showError).toHaveBeenCalledWith(
        '店铺已切换，请在当前店铺重新打开商品后保存。',
    );
});

it('keeps the first create request in store-A and stops remaining stages after switching to store-B', async () => {
    if (!mocks.saveInput || !mocks.editor) throw new Error('Missing save fixture');
    mocks.saveInput.productId = 'new';
    mocks.saveInput.baselineDraft = null;
    mocks.editor.isCreateMode = true;
    let complete: (value: { data: { createProduct: { id: string } } }) => void = () => {};
    const create = vi.fn().mockReturnValue(
        new Promise(resolve => {
            complete = resolve;
        }),
    );
    mocks.mutations.set(CREATE_PRODUCT, create);
    await render(snapshot('STORE', true), ['ReadProduct', 'CreateProduct']);
    let pending: Promise<void> | undefined;
    await act(async () => {
        pending = mocks.save?.();
    });
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
            context: { headers: { 'vendure-token': 'fixture-channel-a' }, queryDeduplication: false },
        }),
    );
    mocks.queryScope = 'scope-b';
    mocks.channelToken = 'fixture-channel-b';
    await act(async () => {
        complete({ data: { createProduct: { id: 'created-in-a' } } });
        await pending;
    });
    for (const [document, mutation] of mocks.mutations) {
        if (document !== CREATE_PRODUCT) expect(mutation).not.toHaveBeenCalled();
    }
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.saveInput.controls.navigate).not.toHaveBeenCalled();
});

it('cancels a pending availability confirmation when the product becomes read-only', async () => {
    if (!mocks.saveInput) throw new Error('Missing save fixture');
    mocks.saveInput.draft.enabled = false;
    let approve: (
        value: Awaited<ReturnType<SaveInput['controls']['requestConfirmation']>>,
    ) => void = () => {};
    vi.mocked(mocks.saveInput.controls.requestConfirmation).mockReturnValue(
        new Promise(resolve => {
            approve = resolve;
        }),
    );
    await render(snapshot('STORE', true), ['ReadProduct', 'UpdateProduct']);
    let pending: Promise<void> | undefined;
    await act(async () => {
        pending = mocks.save?.();
    });
    expect(mocks.saveInput.controls.requestConfirmation).toHaveBeenCalledOnce();
    await render(snapshot('STORE', false), ['ReadProduct']);
    await act(async () => {
        approve({});
        await pending;
    });
    expectNoWrites();
});
