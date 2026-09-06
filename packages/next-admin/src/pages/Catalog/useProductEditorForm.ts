import { useMutation } from '@apollo/client/react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { sensitiveActionContext } from '../../apollo';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import type { CustomFieldValueMap } from '../../custom-fields/custom-field-types';
import { addCustomFieldsToDocument } from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import { DELETE_PRODUCT_VARIANT, GET_PRODUCT_DETAIL } from '../../graphql/catalog.graphql';
import {
    type DigitalDeliveryMode,
    type FulfillmentType,
    type RefundPolicy,
} from '../../graphql/commerce.graphql';
import { usePageSize } from '../../hooks/use-page-size';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
import { useUrlTab } from '../../hooks/use-url-tab';
import { stockPolicyForDeliveryMode } from '../../utils/commerce-mode';
import { toUserFacingError } from '../../utils/user-facing-error';
import { productEditorDraft } from './product-editor-draft';
import type { ProductEditorFormErrors } from './product-editor-types';
import {
    PRODUCT_EDITOR_TABS,
    PRODUCT_MANAGED_CUSTOM_FIELDS,
    serializeProductEditor,
    type AssetItem,
    type OptionGroupItem,
    type ProductEditorTab,
    type ProductVariantState,
} from './product-editor-types';
import { useProductEditorData } from './useProductEditorData';
import type { ProductEditorSaveDraft } from './useProductEditorSave';
import { useProductEditorSave } from './useProductEditorSave';

export function useProductEditorForm() {
    const requestConfirmation = useConfirmDialog();
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const productId = params.id;
    const isCreateMode = !productId || productId === 'new';
    const productCustomFieldDefinitions = useCustomFieldDefinitions('Product');
    const productExtensionFields = useMemo(
        () =>
            productCustomFieldDefinitions.filter(
                field =>
                    !PRODUCT_MANAGED_CUSTOM_FIELDS.includes(
                        field.name as (typeof PRODUCT_MANAGED_CUSTOM_FIELDS)[number],
                    ),
            ),
        [productCustomFieldDefinitions],
    );
    const productDetailDocument = useMemo(
        () =>
            addCustomFieldsToDocument(GET_PRODUCT_DETAIL, 'Product', productCustomFieldDefinitions, [
                'product',
            ]),
        [productCustomFieldDefinitions],
    );

    const [activeTab, setActiveTab] = useUrlTab<ProductEditorTab>(PRODUCT_EDITOR_TABS, 'basic');

    // SPU 基础字段 (严格无演示默认数据)
    const [productName, setProductName] = useState('');
    const [slug, setSlug] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [description, setDescription] = useState('');
    const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('digital');
    const [refundPolicy, setRefundPolicy] = useState<RefundPolicy>('MERCHANT_REVIEW');
    const [manualDeliverySlaMinutes, setManualDeliverySlaMinutes] = useState(1440);
    const [dynamicCustomFieldValues, setDynamicCustomFieldValues] = useState<CustomFieldValueMap>({});

    // 素材与图片关联 (使用真实 Asset ID)
    const [featuredAssetId, setFeaturedAssetId] = useState<string | null>(null);
    const [featuredAssetPreview, setFeaturedAssetPreview] = useState<string | null>(null);
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
    const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
    const [assetPickerMode, setAssetPickerMode] = useState<'FEATURED' | 'GALLERY'>('FEATURED');
    const [assetSearch, setAssetSearch] = useState('');
    const [assetPage, setAssetPage] = useState(0);
    const [assetPageSize, setAssetPageSize] = usePageSize(setAssetPage);
    const [knownAssets, setKnownAssets] = useState<Record<string, AssetItem>>({});

    // Facet 标签属性关联 (使用真实 FacetValue ID)
    const [selectedFacetValueIds, setSelectedFacetValueIds] = useState<string[]>([]);
    const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
    const [facetSearch, setFacetSearch] = useState('');
    const [facetPage, setFacetPage] = useState(0);
    const [facetPageSize, setFacetPageSize] = usePageSize(setFacetPage);
    const [collectionSearch, setCollectionSearch] = useState('');

    // 变体 SKU 矩阵 (严格无演示默认数据)
    const [variants, setVariants] = useState<ProductVariantState[]>([]);
    const [selectedOptionGroupIds, setSelectedOptionGroupIds] = useState<string[]>([]);
    const [optionGroupSearch, setOptionGroupSearch] = useState('');
    const [optionGroupPage, setOptionGroupPage] = useState(0);
    const [optionGroupPageSize, setOptionGroupPageSize] = usePageSize(setOptionGroupPage);
    const [knownOptionGroups, setKnownOptionGroups] = useState<Record<string, OptionGroupItem>>({});

    // 表单校验错误信息
    const [formErrors, setFormErrors] = useState<ProductEditorFormErrors>({});

    const [notification, setNotification] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [saving, setSaving] = useState(false);

    const deferredAssetSearch = useDeferredValue(assetSearch.trim());
    const deferredFacetSearch = useDeferredValue(facetSearch.trim());
    const deferredOptionGroupSearch = useDeferredValue(optionGroupSearch.trim());

    const {
        channelData,
        channelLoading,
        channelError,
        refetchChannel,
        activeCurrencyCode,
        commerceMode,
        fixedFulfillmentType,
        productData,
        productLoading,
        productError,
        refetchProduct,
        facetsData,
        facetsLoading,
        facetsError,
        refetchFacets,
        collectionsData,
        collectionsLoading,
        collectionsError,
        refetchCollections,
        catalogChannelsData,
        catalogChannelsLoading,
        catalogChannelsError,
        refetchCatalogChannels,
        assetsData,
        assetsLoading,
        assetsError,
        refetchAssets,
        optionGroupsData,
        optionGroupsLoading,
        optionGroupsError,
        refetchOptionGroups,
    } = useProductEditorData({
        productId,
        isCreateMode,
        productDetailDocument,
        facetPage,
        facetPageSize,
        deferredFacetSearch,
        assetPage,
        assetPageSize,
        deferredAssetSearch,
        optionGroupPage,
        optionGroupPageSize,
        deferredOptionGroupSearch,
        isAssetPickerOpen,
        setErrorMessage,
    });

    const effectiveFulfillmentType = fixedFulfillmentType ?? fulfillmentType;

    // 绑定从后端查询到的真实商品数据；查询结果到达后需要初始化可编辑表单。
    /* oxlint-disable react/set-state-in-effect */
    useEffect(() => {
        if (productData?.product) {
            const p = productData.product;
            const draft = productEditorDraft(p, fixedFulfillmentType, productExtensionFields);
            setProductName(draft.productName);
            setSlug(draft.slug);
            setEnabled(draft.enabled ?? true);
            setDescription(draft.description);
            setFulfillmentType(draft.fulfillmentType);
            setRefundPolicy(draft.refundPolicy);
            setManualDeliverySlaMinutes(draft.manualDeliverySlaMinutes);
            setFeaturedAssetId(draft.featuredAssetId);
            setSelectedAssetIds(draft.selectedAssetIds);
            setSelectedFacetValueIds(draft.selectedFacetValueIds);
            setSelectedCollectionIds(draft.selectedCollectionIds);
            setSelectedOptionGroupIds(draft.selectedOptionGroupIds);
            setVariants(draft.variants);
            setDynamicCustomFieldValues(draft.dynamicCustomFields ?? {});
            setFeaturedAssetPreview(p.featuredAsset?.preview ?? null);
            setKnownAssets(
                Object.fromEntries(
                    p.assets.map(asset => [asset.id, { ...asset, type: 'IMAGE' } satisfies AssetItem]),
                ),
            );
        } else if (isCreateMode) {
            setProductName('');
            setSlug('');
            setEnabled(true);
            setDescription('');
            setFulfillmentType(fixedFulfillmentType ?? 'digital');
            setRefundPolicy('MERCHANT_REVIEW');
            setManualDeliverySlaMinutes(1440);
            setDynamicCustomFieldValues({});
            setFeaturedAssetId(null);
            setFeaturedAssetPreview(null);
            setSelectedAssetIds([]);
            setKnownAssets({});
            setSelectedFacetValueIds([]);
            setSelectedCollectionIds([]);
            setSelectedOptionGroupIds([]);
            setKnownOptionGroups({});
            setVariants([]);
        }
    }, [fixedFulfillmentType, productData, isCreateMode, productExtensionFields]);

    useEffect(() => {
        if (fixedFulfillmentType) setFulfillmentType(fixedFulfillmentType);
    }, [fixedFulfillmentType]);

    useEffect(() => {
        if (productData?.product) {
            setSelectedChannelIds(productData.product.channels.map(channel => channel.id));
        } else if (isCreateMode && catalogChannelsData?.activeChannel.id) {
            setSelectedChannelIds([catalogChannelsData.activeChannel.id]);
        }
    }, [catalogChannelsData?.activeChannel.id, isCreateMode, productData]);
    /* oxlint-enable react/set-state-in-effect */

    const currentEditorDraft = useMemo(
        () =>
            ({
                productName,
                slug,
                enabled,
                description,
                fulfillmentType: effectiveFulfillmentType,
                refundPolicy,
                manualDeliverySlaMinutes,
                featuredAssetId,
                selectedAssetIds,
                selectedFacetValueIds,
                selectedCollectionIds,
                selectedChannelIds,
                selectedOptionGroupIds,
                variants,
                dynamicCustomFields: dynamicCustomFieldValues,
            }) satisfies ProductEditorSaveDraft,
        [
            description,
            dynamicCustomFieldValues,
            enabled,
            effectiveFulfillmentType,
            featuredAssetId,
            manualDeliverySlaMinutes,
            productName,
            refundPolicy,
            selectedAssetIds,
            selectedChannelIds,
            selectedCollectionIds,
            selectedFacetValueIds,
            selectedOptionGroupIds,
            slug,
            variants,
        ],
    );
    const currentEditorSnapshot = useMemo(
        () => serializeProductEditor(currentEditorDraft),
        [currentEditorDraft],
    );
    const baselineEditorSnapshot = useMemo(() => {
        const activeChannelId = catalogChannelsData?.activeChannel.id;
        if (isCreateMode) {
            return serializeProductEditor({
                productName: '',
                slug: '',
                enabled: true,
                description: '',
                fulfillmentType: fixedFulfillmentType ?? 'digital',
                refundPolicy: 'MERCHANT_REVIEW',
                manualDeliverySlaMinutes: 1440,
                featuredAssetId: null,
                selectedAssetIds: [],
                selectedFacetValueIds: [],
                selectedCollectionIds: [],
                selectedChannelIds: activeChannelId ? [activeChannelId] : [],
                selectedOptionGroupIds: [],
                variants: [],
                dynamicCustomFields: {},
            });
        }
        const product = productData?.product;
        if (!product) return null;
        return serializeProductEditor(
            productEditorDraft(product, fixedFulfillmentType, productExtensionFields),
        );
    }, [
        catalogChannelsData?.activeChannel.id,
        fixedFulfillmentType,
        isCreateMode,
        productData,
        productExtensionFields,
    ]);
    const hasUnsavedChanges =
        !productLoading &&
        baselineEditorSnapshot !== null &&
        currentEditorSnapshot !== baselineEditorSnapshot;
    const confirmLeave = useUnsavedChangesWarning(
        hasUnsavedChanges && !saving,
        '当前商品还有未保存的修改，离开后这些内容将丢失。确定离开吗？',
    );
    const leaveToProductList = () => {
        if (confirmLeave()) navigate('/catalog/list');
    };

    // Mutations

    const [deleteVariantMutation] = useMutation<{
        deleteProductVariant: { result: string; message?: string | null };
    }>(DELETE_PRODUCT_VARIANT);

    const showNotice = (msg: string) => {
        setNotification(msg);
        setErrorMessage('');
        setTimeout(() => setNotification(''), 4000);
    };

    const showError = (msg: string) => {
        setErrorMessage(msg);
        setNotification('');
    };

    const handleVariantFieldChange = <K extends keyof ProductVariantState>(
        index: number,
        field: K,
        value: ProductVariantState[K],
    ) => {
        const updated = [...variants];
        const current = updated[index];
        updated[index] = {
            ...current,
            [field]: value,
            ...(field === 'digitalDeliveryMode'
                ? {
                      digitalStockPolicy: stockPolicyForDeliveryMode(
                          value as DigitalDeliveryMode,
                          current.digitalStockPolicy,
                      ),
                  }
                : {}),
        };
        setVariants(updated);

        // 清除对应字段的表单错误
        if (formErrors.variants?.[index]) {
            const vErrors = { ...formErrors.variants };
            delete vErrors[index];
            setFormErrors(prev => ({ ...prev, variants: Object.keys(vErrors).length ? vErrors : undefined }));
        }
    };

    const handleAddVariant = () => {
        setVariants(prev => [
            ...prev,
            {
                sku: '',
                name: '',
                price: '',
                stockOnHand: '',
                stockAllocated: 0,
                enabled: true,
                digitalDeliveryMode: 'manual_service',
                digitalStockPolicy: 'limited',
                optionIds: [],
                isNew: true,
            },
        ]);
    };

    const handleGenerateVariantMatrix = () => {
        const availableGroups = new Map(
            [...Object.values(knownOptionGroups), ...(optionGroupsData?.productOptionGroups.items ?? [])].map(
                group => [group.id, group],
            ),
        );
        const selectedGroups = selectedOptionGroupIds
            .map(id => availableGroups.get(id))
            .filter((group): group is OptionGroupItem => Boolean(group));
        if (selectedGroups.length === 0) {
            showError('请先选择至少一个规格模板');
            return;
        }
        if (selectedGroups.some(group => group.options.length === 0)) {
            showError('所选规格模板中存在空选项，请先到【分类与属性】补充选项值');
            return;
        }

        const combinations = selectedGroups.reduce<Array<Array<{ id: string; name: string }>>>(
            (current, group) =>
                current.flatMap(combination =>
                    group.options.map(option => [...combination, { id: option.id, name: option.name }]),
                ),
            [[]],
        );
        if (combinations.length > 100) {
            showError(
                `当前规格组合将生成 ${combinations.length} 个 SKU，超过单次 100 个的安全限制，请减少规格选项`,
            );
            return;
        }

        const existingKeys = new Set(variants.map(variant => [...variant.optionIds].sort().join(':')));
        const generated = combinations
            .filter(
                combination =>
                    !existingKeys.has(
                        combination
                            .map(option => option.id)
                            .sort()
                            .join(':'),
                    ),
            )
            .map((combination): ProductVariantState => ({
                sku: '',
                name: combination.map(option => option.name).join(' / '),
                price: '',
                stockOnHand: '',
                stockAllocated: 0,
                enabled: true,
                digitalDeliveryMode: 'manual_service',
                digitalStockPolicy: 'limited',
                optionIds: combination.map(option => option.id),
                isNew: true,
            }));
        if (generated.length === 0) {
            showNotice('当前规格组合均已存在，无需重复生成');
            return;
        }
        setVariants(current => [...current, ...generated]);
        showNotice(`已生成 ${generated.length} 个待填写 SKU 组合，请补充编码、销售价和库存后保存`);
    };

    const handleDeleteVariant = async (index: number) => {
        const target = variants[index];
        if (target.id && !target.isNew) {
            const confirmation = await requestConfirmation({
                title: `删除 SKU ${target.sku || '未命名规格'}？`,
                description: '该规格会被永久删除且无法恢复。若已有订单引用，系统可能阻止删除。',
                confirmLabel: '确认删除',
                tone: 'danger',
                requireCurrentPassword: true,
            });
            if (!confirmation) return;
            try {
                const response = await deleteVariantMutation({
                    variables: { id: target.id },
                    context: sensitiveActionContext(confirmation.currentPassword ?? ''),
                });
                const deletion = response.data?.deleteProductVariant;
                if (!deletion || deletion.result !== 'DELETED') {
                    throw new Error(deletion?.message || '后端拒绝删除该规格变体');
                }
                showNotice(`规格变体 ${target.sku} 已成功从后端数据库删除！`);
            } catch (err: unknown) {
                showError(`删除规格失败：${toUserFacingError(err, '请稍后重试')}`);
                return;
            }
        }
        setVariants(variants.filter((_, i) => i !== index));
    };

    const toggleFacetValue = (id: string) => {
        setSelectedFacetValueIds(prev =>
            prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id],
        );
    };

    const { handleSave } = useProductEditorSave({
        draft: currentEditorDraft,
        data: { productData, catalogChannelsData, refetchCollections, refetchProduct },
        productId,
        productExtensionFields,
        controls: {
            requestConfirmation,
            navigate,
            setActiveTab,
            setErrorMessage,
            setFormErrors,
            setSaving,
            showError,
            showNotice,
        },
    });

    return {
        isCreateMode,
        productId,
        activeTab,
        setActiveTab,
        leaveToProductList,
        effectiveFulfillmentType,
        commerceMode,
        activeCurrencyCode,
        productName,
        setProductName,
        slug,
        setSlug,
        enabled,
        setEnabled,
        description,
        setDescription,
        fulfillmentType,
        setFulfillmentType,
        refundPolicy,
        setRefundPolicy,
        manualDeliverySlaMinutes,
        setManualDeliverySlaMinutes,
        dynamicCustomFieldValues,
        setDynamicCustomFieldValues,
        productExtensionFields,
        featuredAssetId,
        setFeaturedAssetId,
        featuredAssetPreview,
        setFeaturedAssetPreview,
        selectedAssetIds,
        setSelectedAssetIds,
        isAssetPickerOpen,
        setIsAssetPickerOpen,
        assetPickerMode,
        setAssetPickerMode,
        assetSearch,
        setAssetSearch,
        assetPage,
        assetPageSize,
        setAssetPageSize,
        setAssetPage,
        knownAssets,
        setKnownAssets,
        selectedFacetValueIds,
        setSelectedFacetValueIds,
        selectedCollectionIds,
        setSelectedCollectionIds,
        selectedChannelIds,
        setSelectedChannelIds,
        facetSearch,
        setFacetSearch,
        facetPage,
        facetPageSize,
        setFacetPageSize,
        setFacetPage,
        collectionSearch,
        setCollectionSearch,
        toggleFacetValue,
        variants,
        setVariants,
        selectedOptionGroupIds,
        setSelectedOptionGroupIds,
        optionGroupSearch,
        setOptionGroupSearch,
        optionGroupPage,
        optionGroupPageSize,
        setOptionGroupPageSize,
        setOptionGroupPage,
        knownOptionGroups,
        setKnownOptionGroups,
        formErrors,
        setFormErrors,
        notification,
        setNotification,
        errorMessage,
        setErrorMessage,
        saving,
        isDirty: hasUnsavedChanges,
        channelData,
        channelLoading,
        channelError,
        refetchChannel,
        catalogChannelsData,
        catalogChannelsLoading,
        catalogChannelsError,
        refetchCatalogChannels,
        productData,
        productLoading,
        productError,
        refetchProduct,
        facetsData,
        facetsLoading,
        facetsError,
        refetchFacets,
        collectionsData,
        collectionsLoading,
        collectionsError,
        refetchCollections,
        assetsData,
        assetsLoading,
        assetsError,
        refetchAssets,
        optionGroupsData,
        optionGroupsLoading,
        optionGroupsError,
        refetchOptionGroups,
        handleVariantFieldChange,
        handleAddVariant,
        handleGenerateVariantMatrix,
        handleDeleteVariant,
        handleSave,
        navigate,
        fixedFulfillmentType,
    };
}

export type ProductEditorFormState = ReturnType<typeof useProductEditorForm>;
