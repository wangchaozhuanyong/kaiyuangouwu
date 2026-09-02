import { useMutation, useQuery } from '@apollo/client/react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { client, sensitiveActionContext } from '../../apollo';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import type { CustomFieldValueMap } from '../../custom-fields/custom-field-types';
import {
    addCustomFieldsToDocument,
    customFieldInputFromValues,
    customFieldValuesFromEntity,
    localizedCustomFieldInputFromValues,
    validateCustomFieldValues,
} from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import {
    ADD_OPTION_GROUP_TO_PRODUCT,
    ASSIGN_PRODUCTS_TO_CHANNEL,
    CREATE_PRODUCT,
    CREATE_PRODUCT_VARIANTS,
    DELETE_PRODUCT_VARIANT,
    GET_ACTIVE_CHANNEL,
    GET_ASSETS,
    GET_CATALOG_CHANNELS,
    GET_COLLECTION_ASSIGNMENT_DETAIL,
    GET_COLLECTIONS,
    GET_FACETS,
    GET_OPTION_GROUPS,
    GET_PRODUCT_DETAIL,
    GET_PRODUCTS,
    REMOVE_OPTION_GROUP_FROM_PRODUCT,
    REMOVE_PRODUCTS_FROM_CHANNEL,
    UPDATE_COLLECTION_ASSIGNMENT,
    UPDATE_PRODUCT,
    UPDATE_PRODUCT_VARIANTS,
} from '../../graphql/catalog.graphql';
import {
    STORE_COMMERCE_MODE_QUERY,
    type DigitalDeliveryMode,
    type FulfillmentType,
    type RefundPolicy,
    type StoreCommerceModeData,
} from '../../graphql/commerce.graphql';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
import { useUrlTab } from '../../hooks/use-url-tab';
import { fulfillmentTypeForMode, stockPolicyForDeliveryMode } from '../../utils/commerce-mode';
import {
    hasDirectProductAssignment,
    setDirectProductAssignment,
    type CollectionFilterValue,
} from '../../utils/product-collection-assignment';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    ASSET_PAGE_SIZE,
    createSlugFromName,
    LOOKUP_PAGE_SIZE,
    PRODUCT_EDITOR_TABS,
    PRODUCT_MANAGED_CUSTOM_FIELDS,
    serializeProductEditor,
    SOURCE_LANGUAGE_CODE,
    variantFulfillmentInput,
    type AssetItem,
    type CatalogChannel,
    type CollectionItem,
    type FacetItem,
    type OptionGroupItem,
    type ProductDetailRecord,
    type ProductEditorTab,
    type ProductVariantState,
} from './product-editor-types';

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
    const [knownAssets, setKnownAssets] = useState<Record<string, AssetItem>>({});

    // Facet 标签属性关联 (使用真实 FacetValue ID)
    const [selectedFacetValueIds, setSelectedFacetValueIds] = useState<string[]>([]);
    const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
    const [facetSearch, setFacetSearch] = useState('');
    const [facetPage, setFacetPage] = useState(0);
    const [collectionSearch, setCollectionSearch] = useState('');
    const [collectionPage, setCollectionPage] = useState(0);

    // 变体 SKU 矩阵 (严格无演示默认数据)
    const [variants, setVariants] = useState<ProductVariantState[]>([]);
    const [selectedOptionGroupIds, setSelectedOptionGroupIds] = useState<string[]>([]);
    const [optionGroupSearch, setOptionGroupSearch] = useState('');
    const [optionGroupPage, setOptionGroupPage] = useState(0);
    const [knownOptionGroups, setKnownOptionGroups] = useState<Record<string, OptionGroupItem>>({});

    // 表单校验错误信息
    const [formErrors, setFormErrors] = useState<{
        name?: string;
        description?: string;
        variants?: Record<number, { sku?: string; price?: string; stock?: string }>;
    }>({});

    const [notification, setNotification] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [saving, setSaving] = useState(false);
    const loadingAllCatalogChannelsRef = useRef(false);
    const deferredAssetSearch = useDeferredValue(assetSearch.trim());
    const deferredFacetSearch = useDeferredValue(facetSearch.trim());
    const deferredCollectionSearch = useDeferredValue(collectionSearch.trim());
    const deferredOptionGroupSearch = useDeferredValue(optionGroupSearch.trim());

    const {
        data: channelData,
        loading: channelLoading,
        error: channelError,
        refetch: refetchChannel,
    } = useQuery<{
        activeChannel: {
            id: string;
            code: string;
            defaultLanguageCode: string;
            currencyCode: string;
            defaultCurrencyCode: string;
        };
    }>(GET_ACTIVE_CHANNEL, { fetchPolicy: 'cache-first' });
    const activeCurrencyCode =
        channelData?.activeChannel.currencyCode ?? channelData?.activeChannel.defaultCurrencyCode ?? 'CNY';
    const commerceModeQuery = useQuery<StoreCommerceModeData>(STORE_COMMERCE_MODE_QUERY, {
        fetchPolicy: 'cache-first',
    });
    const commerceMode = commerceModeQuery.data?.myStoreCommerceMode.mode ?? 'HYBRID';
    const fixedFulfillmentType = fulfillmentTypeForMode(commerceMode);
    const effectiveFulfillmentType = fixedFulfillmentType ?? fulfillmentType;

    // 1. 查询已有商品详情 (若为编辑模式)
    const {
        data: productData,
        loading: productLoading,
        error: productError,
        refetch: refetchProduct,
    } = useQuery<{
        product: ProductDetailRecord | null;
    }>(productDetailDocument, {
        variables: { id: productId },
        skip: isCreateMode,
        fetchPolicy: 'network-only',
    });

    // 2. 查询系统中的所有 Facets
    const {
        data: facetsData,
        loading: facetsLoading,
        error: facetsError,
        refetch: refetchFacets,
    } = useQuery<{ facets: { items: FacetItem[]; totalItems: number } }>(GET_FACETS, {
        variables: {
            options: {
                skip: facetPage * LOOKUP_PAGE_SIZE,
                take: LOOKUP_PAGE_SIZE,
                sort: { name: 'ASC' },
                filter: deferredFacetSearch ? { name: { contains: deferredFacetSearch } } : {},
            },
        },
        fetchPolicy: 'cache-first',
    });

    // 3. 查询系统中的所有 Collections（包含规则，支持手动归类且不破坏自动规则）
    const {
        data: collectionsData,
        loading: collectionsLoading,
        error: collectionsError,
        refetch: refetchCollections,
    } = useQuery<{ collections: { items: CollectionItem[]; totalItems: number } }>(GET_COLLECTIONS, {
        variables: {
            options: {
                topLevelOnly: false,
                skip: collectionPage * LOOKUP_PAGE_SIZE,
                take: LOOKUP_PAGE_SIZE,
                sort: { name: 'ASC' },
                filter: deferredCollectionSearch ? { name: { contains: deferredCollectionSearch } } : {},
            },
        },
        fetchPolicy: 'cache-first',
    });

    const {
        data: catalogChannelsData,
        loading: catalogChannelsLoading,
        error: catalogChannelsError,
        fetchMore: fetchMoreCatalogChannels,
        refetch: refetchCatalogChannels,
    } = useQuery<{
        activeChannel: CatalogChannel;
        channels: { items: CatalogChannel[]; totalItems: number };
    }>(GET_CATALOG_CHANNELS, {
        variables: { options: { skip: 0, take: 100, sort: { code: 'ASC' } } },
        fetchPolicy: 'cache-and-network',
    });

    useEffect(() => {
        const channels = catalogChannelsData?.channels;
        if (
            !channels ||
            catalogChannelsLoading ||
            catalogChannelsError ||
            loadingAllCatalogChannelsRef.current
        )
            return;
        const loadedCount = channels.items.length;
        if (loadedCount >= channels.totalItems) return;
        loadingAllCatalogChannelsRef.current = true;
        void fetchMoreCatalogChannels({
            variables: { options: { skip: loadedCount, take: 100, sort: { code: 'ASC' } } },
            updateQuery: (previous, { fetchMoreResult }) => ({
                ...previous,
                channels: {
                    ...fetchMoreResult.channels,
                    items: [
                        ...new Map(
                            [...previous.channels.items, ...fetchMoreResult.channels.items].map(channel => [
                                channel.id,
                                channel,
                            ]),
                        ).values(),
                    ],
                },
            }),
        })
            .catch(fetchError => {
                setErrorMessage(toUserFacingError(fetchError, '销售渠道未能全部加载'));
            })
            .finally(() => {
                loadingAllCatalogChannelsRef.current = false;
            });
    }, [catalogChannelsData, catalogChannelsError, catalogChannelsLoading, fetchMoreCatalogChannels]);

    // 4. 查询真实素材库
    const {
        data: assetsData,
        loading: assetsLoading,
        error: assetsError,
        refetch: refetchAssets,
    } = useQuery<{ assets: { items: AssetItem[]; totalItems: number } }>(GET_ASSETS, {
        variables: {
            options: {
                skip: assetPage * ASSET_PAGE_SIZE,
                take: ASSET_PAGE_SIZE,
                sort: { updatedAt: 'DESC' },
                filter: {
                    type: { eq: 'IMAGE' },
                    ...(deferredAssetSearch ? { name: { contains: deferredAssetSearch } } : {}),
                },
            },
        },
        skip: !isAssetPickerOpen,
        fetchPolicy: 'cache-first',
    });

    const {
        data: optionGroupsData,
        error: optionGroupsError,
        refetch: refetchOptionGroups,
    } = useQuery<{
        productOptionGroups: { items: OptionGroupItem[]; totalItems: number };
    }>(GET_OPTION_GROUPS, {
        variables: {
            options: {
                skip: optionGroupPage * LOOKUP_PAGE_SIZE,
                take: LOOKUP_PAGE_SIZE,
                sort: { name: 'ASC' },
                filter: deferredOptionGroupSearch ? { name: { contains: deferredOptionGroupSearch } } : {},
            },
        },
        fetchPolicy: 'cache-first',
    });

    // 绑定从后端查询到的真实商品数据；查询结果到达后需要初始化可编辑表单。
    /* oxlint-disable react/set-state-in-effect */
    useEffect(() => {
        if (productData?.product) {
            const p = productData.product;
            const sourceTranslation =
                p.translations.find(translation => translation.languageCode === SOURCE_LANGUAGE_CODE) ||
                p.translations[0];
            setProductName(sourceTranslation?.name || p.name || '');
            setSlug(sourceTranslation?.slug || p.slug || '');
            setEnabled(p.enabled ?? true);
            setDescription(sourceTranslation?.description || p.description || '');
            setFulfillmentType(
                fixedFulfillmentType ??
                    (p.customFields?.fulfillmentType === 'physical' ? 'physical' : 'digital'),
            );
            setRefundPolicy(
                p.customFields?.refundPolicy === 'SEVEN_DAY_NO_REASON' ||
                    p.customFields?.refundPolicy === 'NON_REFUNDABLE'
                    ? p.customFields.refundPolicy
                    : 'MERCHANT_REVIEW',
            );
            setManualDeliverySlaMinutes(
                Math.min(525600, Math.max(5, p.customFields?.manualDeliverySlaMinutes ?? 1440)),
            );
            setDynamicCustomFieldValues(
                customFieldValuesFromEntity(productExtensionFields, p.customFields, p.translations),
            );

            if (p.featuredAsset) {
                setFeaturedAssetId(p.featuredAsset.id);
                setFeaturedAssetPreview(p.featuredAsset.preview);
            } else {
                setFeaturedAssetId(null);
                setFeaturedAssetPreview(null);
            }
            setSelectedAssetIds(p.assets.map(asset => asset.id));
            setKnownAssets(
                Object.fromEntries(
                    p.assets.map(asset => [asset.id, { ...asset, type: 'IMAGE' } satisfies AssetItem]),
                ),
            );
            setSelectedOptionGroupIds(p.optionGroups.map(group => group.id));

            setSelectedFacetValueIds(p.facetValues.map(facetValue => facetValue.id));
            setSelectedCollectionIds(
                p.collections
                    .filter(collection => hasDirectProductAssignment(collection.filters, p.id))
                    .map(collection => collection.id),
            );

            if (p.variants.length > 0) {
                setVariants(
                    p.variants.map(variant => {
                        const sourceVariantTranslation = variant.translations.find(
                            translation => translation.languageCode === SOURCE_LANGUAGE_CODE,
                        );
                        return {
                            id: variant.id,
                            sku: variant.sku || '',
                            name:
                                sourceVariantTranslation?.name ||
                                variant.name ||
                                sourceTranslation?.name ||
                                p.name ||
                                '',
                            price: (variant.price / 100).toFixed(2),
                            stockOnHand: variant.stockOnHand,
                            stockAllocated: variant.stockAllocated,
                            enabled: variant.enabled,
                            digitalDeliveryMode:
                                variant.customFields?.digitalDeliveryMode === 'auto_card' ||
                                variant.customFields?.digitalDeliveryMode === 'file_download'
                                    ? variant.customFields.digitalDeliveryMode
                                    : 'manual_service',
                            digitalStockPolicy:
                                variant.customFields?.digitalStockPolicy === 'pool_derived' ||
                                variant.customFields?.digitalStockPolicy === 'unlimited'
                                    ? variant.customFields.digitalStockPolicy
                                    : 'limited',
                            autoCardAvailableStock: variant.autoCardAvailableStock,
                            optionIds: variant.options.map(option => option.id),
                            isNew: false,
                        };
                    }),
                );
            } else {
                // 若后端商品尚未配置规格，显示空数组，不注入假数据
                setVariants([]);
            }
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

    const currentEditorSnapshot = useMemo(
        () =>
            serializeProductEditor({
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
            }),
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
        const sourceTranslation =
            product.translations.find(translation => translation.languageCode === SOURCE_LANGUAGE_CODE) ??
            product.translations[0];
        return serializeProductEditor({
            productName: sourceTranslation?.name || product.name || '',
            slug: sourceTranslation?.slug || product.slug || '',
            enabled: product.enabled,
            description: sourceTranslation?.description || product.description || '',
            fulfillmentType:
                fixedFulfillmentType ??
                (product.customFields?.fulfillmentType === 'physical' ? 'physical' : 'digital'),
            refundPolicy:
                product.customFields?.refundPolicy === 'SEVEN_DAY_NO_REASON' ||
                product.customFields?.refundPolicy === 'NON_REFUNDABLE'
                    ? product.customFields.refundPolicy
                    : 'MERCHANT_REVIEW',
            manualDeliverySlaMinutes: Math.min(
                525600,
                Math.max(5, product.customFields?.manualDeliverySlaMinutes ?? 1440),
            ),
            featuredAssetId: product.featuredAsset?.id ?? null,
            selectedAssetIds: product.assets.map(asset => asset.id),
            selectedFacetValueIds: product.facetValues.map(value => value.id),
            selectedCollectionIds: product.collections
                .filter(collection => hasDirectProductAssignment(collection.filters, product.id))
                .map(collection => collection.id),
            selectedChannelIds: product.channels.map(channel => channel.id),
            selectedOptionGroupIds: product.optionGroups.map(group => group.id),
            variants: product.variants.map(variant => ({
                id: variant.id,
                sku: variant.sku || '',
                name:
                    variant.translations.find(
                        translation => translation.languageCode === SOURCE_LANGUAGE_CODE,
                    )?.name ||
                    variant.name ||
                    sourceTranslation?.name ||
                    product.name ||
                    '',
                price: (variant.price / 100).toFixed(2),
                stockOnHand: variant.stockOnHand,
                stockAllocated: variant.stockAllocated,
                enabled: variant.enabled,
                digitalDeliveryMode:
                    variant.customFields?.digitalDeliveryMode === 'auto_card' ||
                    variant.customFields?.digitalDeliveryMode === 'file_download'
                        ? variant.customFields.digitalDeliveryMode
                        : 'manual_service',
                digitalStockPolicy:
                    variant.customFields?.digitalStockPolicy === 'pool_derived' ||
                    variant.customFields?.digitalStockPolicy === 'unlimited'
                        ? variant.customFields.digitalStockPolicy
                        : 'limited',
                autoCardAvailableStock: variant.autoCardAvailableStock,
                optionIds: variant.options.map(option => option.id),
                isNew: false,
            })),
            dynamicCustomFields: customFieldValuesFromEntity(
                productExtensionFields,
                product.customFields,
                product.translations,
            ),
        });
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
    const [createProductMutation] = useMutation<{ createProduct: { id: string } }>(CREATE_PRODUCT);
    const [updateProductMutation] = useMutation<{ updateProduct: { id: string } }>(UPDATE_PRODUCT);
    const [createVariantsMutation] = useMutation(CREATE_PRODUCT_VARIANTS);
    const [updateVariantsMutation] = useMutation(UPDATE_PRODUCT_VARIANTS);
    const [deleteVariantMutation] = useMutation<{
        deleteProductVariant: { result: string; message?: string | null };
    }>(DELETE_PRODUCT_VARIANT);
    const [addOptionGroupToProduct] = useMutation(ADD_OPTION_GROUP_TO_PRODUCT);
    const [removeOptionGroupFromProduct] = useMutation<{
        removeOptionGroupFromProduct: {
            __typename: 'Product' | 'ProductOptionInUseError';
            message?: string;
        };
    }>(REMOVE_OPTION_GROUP_FROM_PRODUCT);
    const [updateCollectionAssignment] = useMutation(UPDATE_COLLECTION_ASSIGNMENT);
    const [assignProductsToChannel] = useMutation(ASSIGN_PRODUCTS_TO_CHANNEL);
    const [removeProductsFromChannel] = useMutation(REMOVE_PRODUCTS_FROM_CHANNEL);

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
        showNotice(`已生成 ${generated.length} 个待填写 SKU 组合，请补充编码、售价和库存后保存`);
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

    const syncProductOptionGroups = async (targetProductId: string, originalGroupIds: string[]) => {
        const addedGroupIds = selectedOptionGroupIds.filter(id => !originalGroupIds.includes(id));
        const removedGroupIds = originalGroupIds.filter(id => !selectedOptionGroupIds.includes(id));
        for (const optionGroupId of addedGroupIds) {
            await addOptionGroupToProduct({ variables: { productId: targetProductId, optionGroupId } });
        }
        for (const optionGroupId of removedGroupIds) {
            const result = await removeOptionGroupFromProduct({
                variables: { productId: targetProductId, optionGroupId },
            });
            if (result.data?.removeOptionGroupFromProduct.__typename === 'ProductOptionInUseError') {
                throw new Error(
                    result.data.removeOptionGroupFromProduct.message || '规格模板仍被 SKU 使用，无法移除',
                );
            }
        }
    };

    const syncProductCollections = async (targetProductId: string) => {
        const originalIds = (productData?.product?.collections ?? [])
            .filter(collection => hasDirectProductAssignment(collection.filters, targetProductId))
            .map(collection => collection.id);
        const originalIdSet = new Set(originalIds);
        const selectedIdSet = new Set(selectedCollectionIds);
        const changes = [
            ...selectedCollectionIds
                .filter(collectionId => !originalIdSet.has(collectionId))
                .map(collectionId => ({ collectionId, assigned: true })),
            ...originalIds
                .filter(collectionId => !selectedIdSet.has(collectionId))
                .map(collectionId => ({ collectionId, assigned: false })),
        ];

        await Promise.all(
            changes.map(async change => {
                const detail = await client.query<{
                    collection: { id: string; filters: CollectionFilterValue[] } | null;
                }>({
                    query: GET_COLLECTION_ASSIGNMENT_DETAIL,
                    variables: { id: change.collectionId },
                    fetchPolicy: 'network-only',
                });
                const collection = detail.data?.collection;
                if (!collection) throw new Error('所选商品分类不存在或已被删除');
                await updateCollectionAssignment({
                    variables: {
                        input: {
                            id: change.collectionId,
                            filters: setDirectProductAssignment(
                                collection.filters,
                                targetProductId,
                                change.assigned,
                            ),
                        },
                    },
                });
            }),
        );

        if (changes.length > 0) await refetchCollections();
    };

    const syncProductChannels = async (targetProductId: string, originalChannelIds: string[]) => {
        const activeChannelId = catalogChannelsData?.activeChannel.id;
        const nextChannelIds =
            activeChannelId && !selectedChannelIds.includes(activeChannelId)
                ? [...selectedChannelIds, activeChannelId]
                : selectedChannelIds;
        const originalIdSet = new Set(originalChannelIds);
        const nextIdSet = new Set(nextChannelIds);
        const addedChannelIds = nextChannelIds.filter(channelId => !originalIdSet.has(channelId));
        const removedChannelIds = originalChannelIds.filter(
            channelId => channelId !== activeChannelId && !nextIdSet.has(channelId),
        );

        await Promise.all([
            ...addedChannelIds.map(channelId =>
                assignProductsToChannel({
                    variables: { input: { productIds: [targetProductId], channelId, priceFactor: 1 } },
                }),
            ),
            ...removedChannelIds.map(channelId =>
                removeProductsFromChannel({
                    variables: { input: { productIds: [targetProductId], channelId } },
                }),
            ),
        ]);
    };

    // 严格表单校验
    const validateForm = (): boolean => {
        const errors: typeof formErrors = {};
        if (!productName.trim()) {
            errors.name = '请输入商品名称';
        }
        if (!description.trim()) {
            errors.description = '请输入中文商品详情';
        }
        if (
            effectiveFulfillmentType === 'digital' &&
            (!Number.isInteger(manualDeliverySlaMinutes) ||
                manualDeliverySlaMinutes < 5 ||
                manualDeliverySlaMinutes > 525600)
        ) {
            setActiveTab('BASIC');
            showError('人工交付预计时长必须是 5 到 525600 分钟之间的整数');
            return false;
        }

        const variantErrors: Record<number, { sku?: string; price?: string; stock?: string }> = {};
        const skuCounts = variants.reduce<Record<string, number>>((counts, variant) => {
            const sku = variant.sku.trim().toLowerCase();
            if (sku) counts[sku] = (counts[sku] ?? 0) + 1;
            return counts;
        }, {});
        variants.forEach((v, index) => {
            const rowErr: { sku?: string; price?: string; stock?: string } = {};
            if (!v.sku.trim()) {
                rowErr.sku = 'SKU 编码为必填项';
            } else if (skuCounts[v.sku.trim().toLowerCase()] > 1) {
                rowErr.sku = '同一商品内的 SKU 编码不能重复';
            }
            if (v.price === '' || isNaN(parseFloat(v.price)) || parseFloat(v.price) < 0) {
                rowErr.price = '请输入有效的非负金额';
            }
            const requiresManualStock =
                effectiveFulfillmentType === 'physical' ||
                (v.digitalDeliveryMode !== 'auto_card' && v.digitalStockPolicy === 'limited');
            if (
                requiresManualStock &&
                v.stockOnHand !== '' &&
                (!Number.isInteger(Number(v.stockOnHand)) || Number(v.stockOnHand) < 0)
            ) {
                rowErr.stock = '库存必须为非负整数';
            }
            if (Object.keys(rowErr).length > 0) {
                variantErrors[index] = rowErr;
            }
        });

        if (Object.keys(variantErrors).length > 0) {
            errors.variants = variantErrors;
        }

        setFormErrors(errors);

        if (errors.name || errors.description) {
            setActiveTab('BASIC');
            showError('商品基础信息填写不完整，请修正标红字段');
            return false;
        }

        if (errors.variants) {
            setActiveTab('VARIANTS');
            showError('SKU 规格变体列表中存在未填写的编码或格式错误金额，请核对');
            return false;
        }

        return true;
    };

    // 真实提交保存 (严格两阶段处理与明确阶段归因)
    const handleSave = async () => {
        if (!validateForm()) return;

        const customFieldErrors = validateCustomFieldValues(productExtensionFields, dynamicCustomFieldValues);
        if (Object.keys(customFieldErrors).length > 0) {
            setActiveTab('BASIC');
            showError(Object.values(customFieldErrors)[0] ?? '商品扩展字段校验失败');
            return;
        }

        setSaving(true);
        setErrorMessage('');
        const completedStages: string[] = [];

        const generatedSlug = slug.trim() || createSlugFromName(productName);
        const localizedFieldsFor = (languageCode: string) => {
            const customFields = localizedCustomFieldInputFromValues(
                productExtensionFields,
                dynamicCustomFieldValues,
                languageCode,
            );
            return Object.keys(customFields).length > 0 ? { customFields } : {};
        };
        const updateTranslations = productData?.product
            ? [
                  ...productData.product.translations.map(translation => ({
                      id: translation.id,
                      languageCode: translation.languageCode,
                      name:
                          translation.languageCode === SOURCE_LANGUAGE_CODE
                              ? productName.trim()
                              : translation.name,
                      slug:
                          translation.languageCode === SOURCE_LANGUAGE_CODE
                              ? generatedSlug
                              : translation.slug,
                      description:
                          translation.languageCode === SOURCE_LANGUAGE_CODE
                              ? description.trim()
                              : translation.description,
                      ...localizedFieldsFor(translation.languageCode),
                  })),
                  ...(productData.product.translations.some(
                      translation => translation.languageCode === SOURCE_LANGUAGE_CODE,
                  )
                      ? []
                      : [
                            {
                                languageCode: SOURCE_LANGUAGE_CODE,
                                name: productName.trim(),
                                slug: generatedSlug,
                                description: description.trim(),
                                ...localizedFieldsFor(SOURCE_LANGUAGE_CODE),
                            },
                        ]),
              ]
            : [];

        try {
            if (isCreateMode) {
                // 阶段 1: 创建 SPU 商品实体
                let newProductId = '';
                try {
                    const createRes = await createProductMutation({
                        variables: {
                            input: {
                                enabled,
                                featuredAssetId: featuredAssetId || undefined,
                                assetIds: selectedAssetIds,
                                facetValueIds:
                                    selectedFacetValueIds.length > 0 ? selectedFacetValueIds : undefined,
                                customFields: {
                                    fulfillmentType: effectiveFulfillmentType,
                                    refundPolicy,
                                    manualDeliverySlaMinutes,
                                    ...customFieldInputFromValues(
                                        productExtensionFields,
                                        dynamicCustomFieldValues,
                                    ),
                                },
                                translations: [
                                    {
                                        languageCode: SOURCE_LANGUAGE_CODE,
                                        name: productName.trim(),
                                        slug: generatedSlug,
                                        description: description.trim(),
                                        ...localizedFieldsFor(SOURCE_LANGUAGE_CODE),
                                    },
                                ],
                            },
                        },
                        refetchQueries: [{ query: GET_PRODUCTS }],
                    });

                    newProductId = createRes?.data?.createProduct?.id || '';
                    if (!newProductId) throw new Error('后端未返回创建的商品 ID');
                } catch (err: unknown) {
                    throw new Error(`[阶段 1：商品创建失败] ${toUserFacingError(err, '请稍后重试')}`);
                }

                // 阶段 2: 将所选真实规格模板分配给新商品
                try {
                    await syncProductOptionGroups(newProductId, []);
                } catch (err: unknown) {
                    navigate(`/catalog/products/${newProductId}`, { replace: true });
                    showError(
                        `[阶段 2：商品已创建，但规格模板分配失败] ${toUserFacingError(err, '请稍后重试')}`,
                    );
                    setSaving(false);
                    return;
                }

                // 阶段 3: 创建 SKU 规格变体 (若有配置变体)
                if (variants.length > 0) {
                    try {
                        const variantsInput = variants.map(v => ({
                            productId: newProductId,
                            sku: v.sku.trim(),
                            enabled: v.enabled,
                            price: Math.round(parseFloat(v.price) * 100),
                            ...variantFulfillmentInput(v, effectiveFulfillmentType),
                            optionIds: v.optionIds,
                            translations: [
                                {
                                    languageCode: SOURCE_LANGUAGE_CODE,
                                    name: v.name.trim() || productName.trim(),
                                },
                            ],
                        }));

                        await createVariantsMutation({
                            variables: { input: variantsInput },
                        });
                    } catch (err: unknown) {
                        // SPU 已创建但规格失败，如实告知用户，不能冒充成功
                        navigate(`/catalog/products/${newProductId}`, { replace: true });
                        showError(
                            `[阶段 3：商品与规格模板已保存，但 SKU 变体创建失败] ${toUserFacingError(err, '请稍后重试')}`,
                        );
                        setSaving(false);
                        return;
                    }
                }

                // 阶段 4: 保存销售店铺范围与人工商品分类
                try {
                    const activeChannelId = catalogChannelsData?.activeChannel.id;
                    await syncProductChannels(newProductId, activeChannelId ? [activeChannelId] : []);
                    await syncProductCollections(newProductId);
                } catch (err: unknown) {
                    navigate(`/catalog/products/${newProductId}`, { replace: true });
                    showError(
                        `[阶段 4：商品与 SKU 已保存，但销售店铺或分类归属保存失败] ${toUserFacingError(err, '请稍后重试')}`,
                    );
                    setSaving(false);
                    return;
                }

                showNotice(`商品《${productName}》及 ${variants.length} 个规格变体已全部发布入库！`);
                navigate(`/catalog/products/${newProductId}`, { replace: true });
            } else {
                const existingVariants = variants.filter(v => v.id && !v.isNew);
                const newVariants = variants.filter(v => v.isNew);
                const changesVariantEnabledState = existingVariants.some(
                    variant =>
                        productData?.product?.variants.find(original => original.id === variant.id)
                            ?.enabled !== variant.enabled,
                );
                const changesProductEnabledState = productData?.product?.enabled !== enabled;
                let enabledMutationContext: ReturnType<typeof sensitiveActionContext> | undefined;
                if (changesProductEnabledState || changesVariantEnabledState) {
                    const confirmation = await requestConfirmation({
                        title: '确认修改商品上下架状态？',
                        description:
                            'SPU 或 SKU 上下架会立即影响买家是否可以购买。请输入当前管理员密码完成安全校验。',
                        confirmLabel: '验证并保存',
                        tone: 'warning',
                        requireCurrentPassword: true,
                    });
                    if (!confirmation) return;
                    enabledMutationContext = sensitiveActionContext(confirmation.currentPassword ?? '');
                }

                // 编辑模式: 更新 SPU 与 Facet
                try {
                    await updateProductMutation({
                        variables: {
                            input: {
                                id: productId,
                                ...(changesProductEnabledState ? { enabled } : {}),
                                featuredAssetId,
                                assetIds: selectedAssetIds,
                                facetValueIds: selectedFacetValueIds,
                                customFields: {
                                    fulfillmentType: effectiveFulfillmentType,
                                    refundPolicy,
                                    manualDeliverySlaMinutes,
                                    ...customFieldInputFromValues(
                                        productExtensionFields,
                                        dynamicCustomFieldValues,
                                    ),
                                },
                                translations: updateTranslations,
                            },
                        },
                        context: changesProductEnabledState ? enabledMutationContext : undefined,
                    });
                    completedStages.push('商品基础信息');
                } catch (err: unknown) {
                    throw new Error(`[商品属性更新失败] ${toUserFacingError(err, '请稍后重试')}`);
                }

                try {
                    const originalGroupIds = Array.isArray(productData?.product?.optionGroups)
                        ? productData.product.optionGroups.map(group => group.id)
                        : [];
                    await syncProductOptionGroups(productId, originalGroupIds);
                    completedStages.push('规格模板关联');
                } catch (err: unknown) {
                    throw new Error(`[规格模板关联更新失败] ${toUserFacingError(err, '请稍后重试')}`);
                }

                // 更新已有变体与创建新加变体
                if (existingVariants.length > 0) {
                    try {
                        await updateVariantsMutation({
                            variables: {
                                input: existingVariants.map(v => {
                                    const original = productData?.product?.variants.find(
                                        item => item.id === v.id,
                                    );
                                    return {
                                        id: v.id,
                                        sku: v.sku.trim(),
                                        ...(original?.enabled !== v.enabled ? { enabled: v.enabled } : {}),
                                        price: Math.round(parseFloat(v.price) * 100),
                                        ...variantFulfillmentInput(v, effectiveFulfillmentType),
                                        optionIds: v.optionIds,
                                        translations: [
                                            {
                                                languageCode: SOURCE_LANGUAGE_CODE,
                                                name: v.name.trim() || productName.trim(),
                                            },
                                        ],
                                    };
                                }),
                            },
                            context: changesVariantEnabledState ? enabledMutationContext : undefined,
                        });
                        completedStages.push('现有 SKU');
                    } catch (err: unknown) {
                        throw new Error(`[现有 SKU 变体更新失败] ${toUserFacingError(err, '请稍后重试')}`);
                    }
                }

                if (newVariants.length > 0) {
                    try {
                        await createVariantsMutation({
                            variables: {
                                input: newVariants.map(v => ({
                                    productId,
                                    sku: v.sku.trim(),
                                    enabled: v.enabled,
                                    price: Math.round(parseFloat(v.price) * 100),
                                    ...variantFulfillmentInput(v, effectiveFulfillmentType),
                                    optionIds: v.optionIds,
                                    translations: [
                                        {
                                            languageCode: SOURCE_LANGUAGE_CODE,
                                            name: v.name.trim() || productName.trim(),
                                        },
                                    ],
                                })),
                            },
                        });
                        completedStages.push('新增 SKU');
                    } catch (err: unknown) {
                        throw new Error(`[新 SKU 变体创建失败] ${toUserFacingError(err, '请稍后重试')}`);
                    }
                }

                try {
                    await syncProductChannels(
                        productId,
                        productData?.product?.channels.map(channel => channel.id) ?? [],
                    );
                    await syncProductCollections(productId);
                    completedStages.push('销售店铺与商品分类');
                } catch (err: unknown) {
                    throw new Error(`[销售店铺或商品分类更新失败] ${toUserFacingError(err, '请稍后重试')}`);
                }

                await refetchProduct();
                showNotice(`商品《${productName}》及规格变体已全部保存至数据库！`);
            }
        } catch (err: unknown) {
            if (!isCreateMode && completedStages.length > 0) {
                await refetchProduct().catch(() => undefined);
                showError(
                    `部分内容已保存（${completedStages.join('、')}），但后续步骤失败：${toUserFacingError(err, '请稍后重试')}。页面已按后端当前数据重新加载。`,
                );
            } else {
                showError(toUserFacingError(err, '商品保存失败，请稍后重试'));
            }
        } finally {
            setSaving(false);
        }
    };

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
        setFacetPage,
        collectionSearch,
        setCollectionSearch,
        collectionPage,
        setCollectionPage,
        toggleFacetValue,
        variants,
        setVariants,
        selectedOptionGroupIds,
        setSelectedOptionGroupIds,
        optionGroupSearch,
        setOptionGroupSearch,
        optionGroupPage,
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
