// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '../../custom-fields/custom-field-types';
import type { DigitalWorkspaceVariant } from '../../graphql/product-domains.graphql';
import { hasCreatedProductDraft, retainCreatedProductDraft } from './product-editor-draft';
import type { ProductDetailRecord } from './product-editor-types';
import { useProductEditorForm } from './useProductEditorForm';
import type { useProductEditorSave } from './useProductEditorSave';

const mocks = vi.hoisted(() => ({
    data: {} as Record<string, unknown>,
    fields: [] as CustomFieldDefinition[],
    variantFields: [] as CustomFieldDefinition[],
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
    useCustomFieldDefinitions: (entity: string) =>
        entity === 'ProductVariant' ? mocks.variantFields : mocks.fields,
}));
vi.mock('../../hooks/use-admin-return', () => ({ useAdminReturn: () => ({ returnToList: mocks.noop }) }));
vi.mock('../../hooks/use-page-size', () => ({ usePageSize: () => [20, mocks.noop] }));
vi.mock('../../hooks/use-admin-capabilities', () => ({
    useAdminCapabilities: () => ({ canUseCapability: mocks.canUseCapability }),
}));
vi.mock('../../hooks/use-admin-permissions', () => ({
    useAdminPermissions: () => ({ hasAnyPermission: mocks.canUseCapability }),
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
    mocks.fields = [];
    mocks.variantFields = [];
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
    vi.restoreAllMocks();
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

it('resets a successfully created product for the next entry and keeps the current store and defaults', async () => {
    mocks.productId = 'new';
    mocks.data.productData = undefined;
    mocks.data.workspaceVariants = [];
    await rerender();
    const initialVariant = { ...editor.variants[0] };
    const initialDefaults = {
        enabled: editor.enabled,
        fulfillmentType: editor.fulfillmentType,
        refundPolicy: editor.refundPolicy,
        manualDeliverySlaMinutes: editor.manualDeliverySlaMinutes,
    };
    const originalSku = initialVariant.sku;
    const initialCreateRevision = editor.createDraftRevision;
    const draftAsset = { id: 'draft-image', name: 'draft.png', preview: '/draft.png', type: 'IMAGE' };
    await act(async () => {
        editor.setProductName('刚刚创建的商品');
        editor.setSlug('created-product');
        editor.setDescription('下一件商品不能沿用这些详情');
        editor.setEnabled(false);
        editor.setRefundPolicy('NON_REFUNDABLE');
        editor.setManualDeliverySlaMinutes(90);
        editor.setDynamicCustomFieldValues({ pricingMode: 'QUOTE' });
        editor.setFeaturedAssetId(draftAsset.id);
        editor.setFeaturedAssetPreview(draftAsset.preview);
        editor.setSelectedAssetIds([draftAsset.id]);
        editor.setKnownAssets({ [draftAsset.id]: draftAsset });
        editor.setSelectedFacetValueIds(['facet-draft']);
        editor.setSelectedCollectionIds(['collection-draft']);
        editor.setSelectedChannelIds(['store-a', 'store-b']);
        editor.setSelectedOptionGroupIds(['group-draft']);
        editor.setKnownOptionGroups({
            'group-draft': { id: 'group-draft', code: 'versions', name: '版本', options: [] },
        });
        editor.setVariants([
            {
                ...initialVariant,
                id: 'created-sku',
                sku: 'JUST-CREATED',
                name: '刚创建的规格',
                price: '29.90',
                costPrice: '12',
                supplierId: 'supplier-draft',
                digitalDeliveryMode: 'file_download',
                digitalFileVersionId: 'file-draft',
                digitalAvailableQuantity: 50,
                digitalStockPolicy: 'limited',
                optionIds: ['option-draft'],
                isNew: false,
            },
        ]);
        editor.setAssetSearch('previous image search');
        editor.setAssetCategory('PRODUCT');
        editor.setAssetPage(3);
        editor.setAssetPickerMode('GALLERY');
        editor.setIsAssetPickerOpen(true);
        editor.setFacetSearch('previous facet search');
        editor.setFacetPage(2);
        editor.setCollectionSearch('previous category search');
        editor.setOptionGroupSearch('previous option search');
        editor.setOptionGroupPage(4);
        editor.setIsOptionTemplatesOpen(true);
        editor.setIsQuickCreateSpecOpen(true);
        editor.setFormErrors({ name: '旧错误', variants: { 0: { price: '旧售价错误' } } });
        editor.setErrorMessage('旧保存错误');
        editor.setActiveTab('DELIVERY');
    });
    expect(editor.isDirty).toBe(true);
    const saved = mocks.saveInput as Parameters<typeof useProductEditorSave>[0];
    expect(saved.controls.onProductCreated).toBeTypeOf('function');

    await act(async () => saved.controls.onProductCreated?.('created-product-id'));

    expect(editor).toMatchObject({
        ...initialDefaults,
        isCreateMode: true,
        productName: '',
        slug: '',
        description: '',
        dynamicCustomFieldValues: {},
        featuredAssetId: null,
        featuredAssetPreview: null,
        selectedAssetIds: [],
        knownAssets: {},
        selectedFacetValueIds: [],
        selectedCollectionIds: [],
        selectedChannelIds: ['store-a'],
        selectedOptionGroupIds: [],
        knownOptionGroups: {},
        assetSearch: '',
        assetCategory: 'ALL',
        assetPage: 0,
        assetPickerMode: 'FEATURED',
        isAssetPickerOpen: false,
        facetSearch: '',
        facetPage: 0,
        collectionSearch: '',
        optionGroupSearch: '',
        optionGroupPage: 0,
        isOptionTemplatesOpen: false,
        isQuickCreateSpecOpen: false,
        formErrors: {},
        errorMessage: '',
        activeTab: 'BASIC',
        isDirty: false,
    });
    expect(editor.createDraftRevision).toBe(initialCreateRevision + 1);
    expect(editor.variants).toEqual([{ ...initialVariant, sku: expect.any(String) }]);
    expect(editor.variants[0].sku).not.toBe(originalSku);
    expect(editor.variants[0].sku).not.toBe('JUST-CREATED');

    const nextSku = editor.variants[0].sku;
    mocks.data = {
        ...mocks.data,
        productData: undefined,
        workspaceVariants: [],
        catalogChannelsData: {
            activeChannel: { id: 'store-a' },
            channels: { items: [], totalItems: 0 },
        },
    };
    await rerender();
    expect(editor.productName).toBe('');
    expect(editor.description).toBe('');
    expect(editor.selectedAssetIds).toEqual([]);
    expect(editor.variants[0].sku).toBe(nextSku);
    expect(editor.isDirty).toBe(false);
    expect(mocks.noop).not.toHaveBeenCalled();
});

it('generates a fresh SKU on consecutive successful creates even when the clock has not advanced', async () => {
    mocks.productId = 'new';
    mocks.data.productData = undefined;
    mocks.data.workspaceVariants = [];
    await rerender();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    await act(async () => editor.setProductName('第一件商品'));
    const first = mocks.saveInput as Parameters<typeof useProductEditorSave>[0];
    expect(first.controls.onProductCreated).toBeTypeOf('function');
    await act(async () => first.controls.onProductCreated?.('first-created-id'));
    const firstResetSku = editor.variants[0].sku;
    await act(async () => editor.setProductName('第二件商品'));
    const second = mocks.saveInput as Parameters<typeof useProductEditorSave>[0];
    await act(async () => second.controls.onProductCreated?.('second-created-id'));
    expect(editor.variants[0].sku).not.toBe(firstResetSku);
    expect(editor.productName).toBe('');
    expect(editor.isDirty).toBe(false);
});

it('keeps a failed create draft intact until the successful-create callback is invoked', async () => {
    mocks.productId = 'new';
    mocks.data.productData = undefined;
    mocks.data.workspaceVariants = [];
    await rerender();
    await act(async () => {
        editor.setProductName('创建失败也要保留');
        editor.setDescription('待修正后再提交的详情');
        editor.setSelectedAssetIds(['unsaved-image']);
        editor.setVariants(rows => rows.map(row => ({ ...row, price: '18.50', costPrice: '5' })));
    });
    const failed = mocks.saveInput as Parameters<typeof useProductEditorSave>[0];
    const draftBeforeFailure = structuredClone(failed.draft);
    await act(async () => failed.controls.showError('售价保存失败，请稍后重试'));
    mocks.data = { ...mocks.data, workspaceVariants: [] };
    await rerender();

    const current = mocks.saveInput as Parameters<typeof useProductEditorSave>[0];
    expect(current.draft).toEqual(draftBeforeFailure);
    expect(editor.errorMessage).toBe('售价保存失败，请稍后重试');
    expect(editor.isDirty).toBe(true);
});

it('does not reset an existing product when a successful-create callback is received', async () => {
    await act(async () => {
        editor.setProductName('现有商品的修改草稿');
        editor.setDescription('编辑模式需要保留');
        editor.setSelectedAssetIds(['existing-draft-image']);
        editor.setVariants(rows => rows.map(row => ({ ...row, price: '39', costPrice: '7' })));
    });
    const submitted = mocks.saveInput as Parameters<typeof useProductEditorSave>[0];
    const draft = structuredClone(submitted.draft);
    expect(submitted.controls.onProductCreated).toBeTypeOf('function');
    await act(async () => submitted.controls.onProductCreated?.('unexpected-created-id'));

    expect((mocks.saveInput as Parameters<typeof useProductEditorSave>[0]).draft).toEqual(draft);
    expect(editor.isCreateMode).toBe(false);
    expect(editor.isDirty).toBe(true);
});

it('ignores an old-store successful-create callback after a new-store draft has been entered', async () => {
    mocks.productId = 'new';
    mocks.data.productData = undefined;
    mocks.data.workspaceVariants = [];
    await rerender();
    await act(async () => editor.setProductName('旧店铺创建中的商品'));
    const oldStore = mocks.saveInput as Parameters<typeof useProductEditorSave>[0];

    mocks.scope = 'store-b';
    mocks.data = {
        ...mocks.data,
        catalogChannelsData: {
            activeChannel: { id: 'store-b' },
            channels: { items: [], totalItems: 0 },
        },
    };
    await rerender();
    await act(async () => {
        editor.setProductName('新店铺尚未保存的商品');
        editor.setDescription('旧请求完成不能清掉新店铺的输入');
        editor.setVariants(rows => rows.map(row => ({ ...row, price: '42' })));
    });
    const current = mocks.saveInput as Parameters<typeof useProductEditorSave>[0];
    const draft = structuredClone(current.draft);
    const revision = editor.createDraftRevision;
    await act(async () => oldStore.controls.onProductCreated?.('old-store-created-id'));

    expect((mocks.saveInput as Parameters<typeof useProductEditorSave>[0]).draft).toEqual(draft);
    expect(editor.selectedChannelIds).toEqual(['store-b']);
    expect(editor.createDraftRevision).toBe(revision);
    expect(editor.isDirty).toBe(true);
});

it('syncs a single default variant when the product name is changed without replacing its other fields', async () => {
    expect(editor.productName).toBe('Original');
    expect(editor.variants[0].name).toBe('Original SKU');
    const originalVariant = structuredClone(editor.variants[0]);

    await act(async () => editor.setProductName('统一的商品名称'));

    expect(editor.productName).toBe('统一的商品名称');
    expect(editor.variants).toEqual([{ ...originalVariant, name: '统一的商品名称' }]);
    expect(editor.isDirty).toBe(true);
});

it('supports queued functional product-name updates while keeping the single default variant in sync', async () => {
    await act(async () => {
        editor.setProductName(current => `${current} A`);
        editor.setProductName(current => `${current} B`);
    });

    expect(editor.productName).toBe('Original A B');
    expect(editor.variants[0].name).toBe('Original A B');
});

it('syncs the product name when its single default variant is renamed', async () => {
    const originalVariant = structuredClone(editor.variants[0]);
    const originalSlug = editor.slug;
    const originalDescription = editor.description;

    await act(async () => editor.handleVariantFieldChange(0, 'name', '从规格统一名称'));

    expect(editor.productName).toBe('从规格统一名称');
    expect(editor.variants).toEqual([{ ...originalVariant, name: '从规格统一名称' }]);
    expect(editor.slug).toBe(originalSlug);
    expect(editor.description).toBe(originalDescription);
    expect(editor.isDirty).toBe(true);
});

it('preserves independent names for multiple variants when either the product or a variant is renamed', async () => {
    const first = { ...editor.variants[0], name: '标准版' };
    const second = { ...first, id: 'sku-2', sku: 'SKU-2', name: '专业版' };
    await act(async () => editor.setVariants([first, second]));

    await act(async () => editor.setProductName('多规格商品的新名称'));

    expect(editor.variants).toEqual([first, second]);
    await act(async () => editor.handleVariantFieldChange(0, 'name', '新版标准版'));
    expect(editor.productName).toBe('多规格商品的新名称');
    expect(editor.variants).toEqual([{ ...first, name: '新版标准版' }, second]);
});

it('preserves the independent name of a sole variant that already has specification options', async () => {
    const optionVariant = { ...editor.variants[0], name: '标准版年度', optionIds: ['option-year'] };
    await act(async () => editor.setVariants([optionVariant]));

    await act(async () => editor.setProductName('带规格选项商品的新名称'));

    expect(editor.variants).toEqual([optionVariant]);
    await act(async () => editor.handleVariantFieldChange(0, 'name', '专业版年度'));
    expect(editor.productName).toBe('带规格选项商品的新名称');
    expect(editor.variants).toEqual([{ ...optionVariant, name: '专业版年度' }]);
});

it('applies late new-product defaults without clearing entered values and keeps them after successful create', async () => {
    mocks.productId = 'new';
    mocks.data.productData = undefined;
    mocks.data.workspaceVariants = [];
    await rerender();
    await act(async () => editor.setProductName('已输入名称'));
    mocks.fields = [{ name: 'pricingMode', type: 'string', list: false, nullable: true }];
    await rerender();
    expect(editor.productName).toBe('已输入名称');
    expect(editor.dynamicCustomFieldValues.pricingMode).toBe('FIXED');
    expect(editor.variants[0]).toMatchObject({
        digitalDeliveryMode: 'manual_service',
        digitalStockPolicy: 'limited',
        digitalAvailableQuantity: 0,
    });
    await act(async () => editor.setDynamicCustomFieldValues({ pricingMode: 'INQUIRY' }));
    await rerender();
    expect(editor.dynamicCustomFieldValues.pricingMode).toBe('INQUIRY');
    await act(async () =>
        (mocks.saveInput as Parameters<typeof useProductEditorSave>[0]).controls.onProductCreated?.(
            'created',
        ),
    );
    expect(editor.dynamicCustomFieldValues.pricingMode).toBe('FIXED');
    expect(editor.isDirty).toBe(false);
});

it('preserves the existing saved sale mode when custom definitions arrive late', async () => {
    mocks.data.productData = {
        product: { ...product, customFields: { ...product.customFields, pricingMode: 'INQUIRY' } },
    };
    mocks.fields = [{ name: 'pricingMode', type: 'string', list: false, nullable: true }];
    await rerender();
    expect(editor.dynamicCustomFieldValues.pricingMode).toBe('INQUIRY');
    expect(editor.isDirty).toBe(false);
});

it('keeps other-currency and custom-field edits when inventory refreshes and does not dirty the draft for a stock summary alone', async () => {
    const inventory = {
        source: 'LIMITED_QUOTA',
        availableQuantity: 10,
        reservedQuantity: 2,
        consumedQuantity: 3,
        observedAt: '2026-10-16T00:00:00Z',
    };
    mocks.data.workspaceVariants = [{ ...workspace, inventory }];
    await rerender();
    expect(editor.isDirty).toBe(false);
    mocks.data.workspaceVariants = [
        {
            ...workspace,
            inventory: { ...inventory, reservedQuantity: 3, observedAt: '2026-10-16T01:00:00Z' },
        },
    ];
    await rerender();
    expect(editor.isDirty).toBe(false);
    await act(async () => editor.handleVariantFieldChange(0, 'currencyPrices', { CNY: '20.00' }));
    await act(async () =>
        editor.handleVariantFieldChange(0, 'variantCustomFields', { specification: '已输入规格' }),
    );
    mocks.data.workspaceVariants = [{ ...workspace, inventory: { ...inventory, reservedQuantity: 4 } }];
    await rerender();
    expect(editor.variants[0]).toMatchObject({
        currencyPrices: { CNY: '20.00' },
        variantCustomFields: { specification: '已输入规格' },
        inventorySummary: { reservedQuantity: 4 },
    });
    expect(editor.isDirty).toBe(true);
});

it('carries a failed new-product draft across identity only after real store SKU data is readable', async () => {
    mocks.productId = 'new';
    mocks.data.productData = undefined;
    mocks.data.workspaceVariants = [];
    mocks.variantFields = [{ name: 'notes', type: 'localeString', list: false, nullable: true }];
    await rerender();
    await act(async () => {
        editor.setProductName('待继续商品');
        editor.setDescription('已经创建的商品描述');
        editor.setSelectedCollectionIds(['pending-category']);
        editor.setVariants(current =>
            current.map(variant => ({
                ...variant,
                price: '25.00',
                costPrice: '9.00',
                currencyPrices: { CNY: '22.00' },
                variantCustomFields: { notes: { zh_Hans: '规格说明', en: 'Variant note' } },
                digitalStockPolicy: 'limited',
                digitalAvailableQuantity: 40,
            })),
        );
    });
    const submitted = (mocks.saveInput as Parameters<typeof useProductEditorSave>[0]).draft;
    const sku = submitted.variants[0].sku;
    retainCreatedProductDraft('store-a', 'partial-created', submitted, [{ id: 'created-sku', sku }]);
    mocks.productId = 'partial-created';
    mocks.data.productData = {
        product: {
            ...product,
            id: 'partial-created',
            slug: 'saved-slug',
            translations: [
                {
                    ...product.translations[0],
                    name: '待继续商品',
                    slug: 'saved-slug',
                    description: '已经创建的商品描述',
                },
            ],
            variants: [
                {
                    ...product.variants[0],
                    id: 'created-sku',
                    sku,
                    price: 2500,
                    currencyCode: 'MYR',
                    prices: [{ currencyCode: 'MYR', price: 2500 }],
                    translations: [
                        { languageCode: 'zh_Hans', name: '待继续商品', customFields: { notes: '规格说明' } },
                        { languageCode: 'en', name: '待继续商品', customFields: { notes: 'Variant note' } },
                    ],
                },
            ],
        },
    };
    mocks.data.workspaceVariants = undefined;
    await rerender();
    expect(hasCreatedProductDraft('store-a', 'partial-created')).toBe(true);
    mocks.data.workspaceVariants = [
        {
            ...workspace,
            id: 'created-sku',
            sku,
            deliveryMode: 'manual_service',
            stockPolicy: 'limited',
            migrationRequired: false,
            availableQuantity: 0,
            purchaseCostMicrounits: null,
            fileVersion: null,
        },
    ];
    await rerender();
    expect(hasCreatedProductDraft('store-a', 'partial-created')).toBe(false);
    expect(editor).toMatchObject({
        productName: '待继续商品',
        slug: 'saved-slug',
        selectedCollectionIds: ['pending-category'],
        isDirty: true,
    });
    expect(editor.variants).toHaveLength(1);
    expect(editor.variants[0]).toMatchObject({
        id: 'created-sku',
        isNew: false,
        price: '25.00',
        costPrice: '9.00',
        currencyPrices: { CNY: '22.00' },
        digitalAvailableQuantity: 40,
        variantCustomFields: { notes: { zh_Hans: '规格说明', en: 'Variant note' } },
    });
    const retry = mocks.saveInput as Parameters<typeof useProductEditorSave>[0];
    expect(retry.productId).toBe('partial-created');
    expect(retry.baselineDraft?.variants[0]).toMatchObject({
        id: 'created-sku',
        isNew: false,
        costPrice: '',
        digitalAvailableQuantity: 0,
    });
    mocks.data.productData = structuredClone(mocks.data.productData);
    await rerender();
    expect(editor.variants[0]).toMatchObject({
        id: 'created-sku',
        costPrice: '9.00',
        digitalAvailableQuantity: 40,
    });
    expect(editor.selectedCollectionIds).toEqual(['pending-category']);
});

it('does not apply or consume a partial-create draft in another store scope', async () => {
    const submitted = structuredClone((mocks.saveInput as Parameters<typeof useProductEditorSave>[0]).draft);
    submitted.variants[0].costPrice = '19.00';
    retainCreatedProductDraft('store-a', 'scope-bound-created', submitted, []);
    mocks.productId = 'scope-bound-created';
    mocks.scope = 'store-b';
    mocks.data.productData = { product: { ...product, id: 'scope-bound-created' } };
    await rerender();
    expect(editor.variants[0].costPrice).toBe('5.00');
    expect(hasCreatedProductDraft('store-a', 'scope-bound-created')).toBe(true);
    mocks.scope = 'store-a';
    await rerender();
    expect(editor.variants[0].costPrice).toBe('19.00');
    expect(hasCreatedProductDraft('store-a', 'scope-bound-created')).toBe(false);
});

it('opens a fully successful create for continued setup with a clean real baseline', async () => {
    mocks.productId = 'new';
    mocks.data.productData = undefined;
    mocks.data.workspaceVariants = [];
    await rerender();
    await act(async () => {
        editor.setProductName('成功后继续配置');
        editor.setDescription('已成功提交');
        editor.handleVariantFieldChange(0, 'price', '25.00');
    });
    const sku = editor.variants[0].sku;
    mocks.productId = 'successful-continue';
    mocks.data.productData = {
        product: {
            ...product,
            id: 'successful-continue',
            slug: 'successful-continue',
            translations: [
                {
                    ...product.translations[0],
                    name: '成功后继续配置',
                    slug: 'successful-continue',
                    description: '已成功提交',
                },
            ],
            variants: [
                {
                    ...product.variants[0],
                    id: 'successful-sku',
                    sku,
                    price: 2500,
                    currencyCode: 'MYR',
                    prices: [{ currencyCode: 'MYR', price: 2500 }],
                    translations: [{ languageCode: 'zh_Hans', name: '成功后继续配置' }],
                },
            ],
        },
    };
    mocks.data.workspaceVariants = [
        {
            ...workspace,
            id: 'successful-sku',
            sku,
            deliveryMode: 'manual_service',
            stockPolicy: 'limited',
            migrationRequired: false,
            availableQuantity: 0,
            purchaseCostMicrounits: null,
            fileVersion: null,
        },
    ];
    await rerender();
    expect(hasCreatedProductDraft('store-a', 'successful-continue')).toBe(false);
    expect(editor.variants[0]).toMatchObject({ id: 'successful-sku', isNew: false, price: '25.00' });
    expect(editor.productName).toBe('成功后继续配置');
    expect(editor.isDirty).toBe(false);
});
