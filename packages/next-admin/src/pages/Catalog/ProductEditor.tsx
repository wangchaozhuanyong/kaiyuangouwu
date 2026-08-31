import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    ArrowLeft,
    Check,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    FolderTree,
    Image as ImageIcon,
    Layers,
    Plus,
    RefreshCw,
    Save,
    Search,
    Sliders,
    Tag,
    Trash2,
    X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { CustomFieldValueMap } from '../../custom-fields/custom-field-types';

import { client, sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import {
    addCustomFieldsToDocument,
    customFieldInputFromValues,
    customFieldValuesFromEntity,
    localizedCustomFieldInputFromValues,
    validateCustomFieldValues,
} from '../../custom-fields/custom-field-utils';
import { useCustomFieldDefinitions } from '../../custom-fields/custom-fields-context';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
import { NextAdminActions, NextAdminPageBlocks } from '../../extensions/extension-hosts';
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
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
import { useUrlTab } from '../../hooks/use-url-tab';
import { getChannelDisplayName } from '../../utils/channel-display';
import {
    hasDirectProductAssignment,
    setDirectProductAssignment,
    type CollectionFilterValue,
} from '../../utils/product-collection-assignment';
import { toUserFacingError } from '../../utils/user-facing-error';

type ProductEditorTab = 'BASIC' | 'VARIANTS' | 'FACETS_COLLECTIONS';
const PRODUCT_EDITOR_TABS = {
    basic: 'BASIC',
    variants: 'VARIANTS',
    attributes: 'FACETS_COLLECTIONS',
} as const;
const SOURCE_LANGUAGE_CODE = 'zh_Hans';
const LOOKUP_PAGE_SIZE = 30;
const ASSET_PAGE_SIZE = 40;

interface ProductVariantState {
    id?: string;
    sku: string;
    name: string;
    price: string;
    stockOnHand: number | '';
    stockAllocated: number;
    enabled: boolean;
    optionIds: string[];
    isNew?: boolean;
}

interface FacetValueItem {
    id: string;
    code: string;
    name: string;
}

interface FacetItem {
    id: string;
    code: string;
    name: string;
    values: FacetValueItem[];
}

interface AssetItem {
    id: string;
    name: string;
    preview: string;
    type: string;
    fileSize?: number;
}

interface OptionGroupItem {
    id: string;
    name: string;
    code: string;
    productCount: number;
    options: Array<{ id: string; name: string; code: string }>;
}

interface CollectionItem {
    id: string;
    name: string;
    slug: string;
    filters: CollectionFilterValue[];
}

interface CatalogChannel {
    id: string;
    code: string;
    token: string;
    defaultCurrencyCode: string;
}

interface ProductDetailRecord {
    id: string;
    enabled: boolean;
    name: string;
    slug: string;
    description: string;
    customFields?: Record<string, unknown> | null;
    featuredAsset?: { id: string; preview: string; name: string } | null;
    assets: Array<{ id: string; name: string; preview: string }>;
    translations: Array<{
        id: string;
        languageCode: string;
        name: string;
        slug: string;
        description: string;
        customFields?: Record<string, unknown> | null;
    }>;
    optionGroups: Array<{ id: string }>;
    facetValues: Array<{ id: string }>;
    collections: CollectionItem[];
    channels: Array<{ id: string; code: string }>;
    variants: Array<{
        id: string;
        enabled: boolean;
        name: string;
        sku: string;
        price: number;
        stockOnHand: number;
        stockAllocated: number;
        options: Array<{ id: string }>;
        translations: Array<{
            languageCode: string;
            name: string;
        }>;
    }>;
}

interface ProductEditorSnapshotInput {
    productName: string;
    slug: string;
    enabled: boolean;
    description: string;
    featuredAssetId: string | null;
    selectedAssetIds: string[];
    selectedFacetValueIds: string[];
    selectedCollectionIds: string[];
    selectedChannelIds: string[];
    selectedOptionGroupIds: string[];
    variants: ProductVariantState[];
    dynamicCustomFields: CustomFieldValueMap;
}

const serializeProductEditor = (input: ProductEditorSnapshotInput) =>
    JSON.stringify({
        ...input,
        selectedAssetIds: [...input.selectedAssetIds].sort(),
        selectedFacetValueIds: [...input.selectedFacetValueIds].sort(),
        selectedCollectionIds: [...input.selectedCollectionIds].sort(),
        selectedChannelIds: [...input.selectedChannelIds].sort(),
        selectedOptionGroupIds: [...input.selectedOptionGroupIds].sort(),
        variants: input.variants.map(variant => ({
            id: variant.id ?? null,
            sku: variant.sku,
            name: variant.name,
            price: variant.price,
            stockOnHand: variant.stockOnHand,
            stockAllocated: variant.stockAllocated,
            enabled: variant.enabled,
            optionIds: [...variant.optionIds].sort(),
            isNew: Boolean(variant.isNew),
        })),
    });

const createSlugFromName = (value: string) => {
    const normalized = value
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || `product-${Date.now().toString(36)}`;
};

export function ProductEditor() {
    const requestConfirmation = useConfirmDialog();
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const productId = params.id;
    const isCreateMode = !productId || productId === 'new';
    const productCustomFieldDefinitions = useCustomFieldDefinitions('Product');
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

    const { data: optionGroupsData, error: optionGroupsError } = useQuery<{
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
            setDynamicCustomFieldValues(
                customFieldValuesFromEntity(productCustomFieldDefinitions, p.customFields, p.translations),
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
    }, [productData, isCreateMode, productCustomFieldDefinitions]);

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
            featuredAssetId,
            productName,
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
                optionIds: variant.options.map(option => option.id),
                isNew: false,
            })),
            dynamicCustomFields: customFieldValuesFromEntity(
                productCustomFieldDefinitions,
                product.customFields,
                product.translations,
            ),
        });
    }, [catalogChannelsData?.activeChannel.id, isCreateMode, productCustomFieldDefinitions, productData]);
    const hasUnsavedChanges =
        !productLoading &&
        baselineEditorSnapshot !== null &&
        currentEditorSnapshot !== baselineEditorSnapshot;
    const confirmLeave = useUnsavedChangesWarning(
        hasUnsavedChanges && !saving,
        '当前商品还有未保存的修改，离开后这些内容将丢失。确定离开吗？',
    );
    const leaveToProductList = () => {
        if (confirmLeave()) void navigate('/catalog/list');
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
        updated[index] = { ...updated[index], [field]: value };
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
            if (
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
        const customFieldErrors = validateCustomFieldValues(
            productCustomFieldDefinitions,
            dynamicCustomFieldValues,
        );
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
                productCustomFieldDefinitions,
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
                                customFields: customFieldInputFromValues(
                                    productCustomFieldDefinitions,
                                    dynamicCustomFieldValues,
                                ),
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
                    void navigate(`/catalog/products/${newProductId}`, { replace: true });
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
                            stockOnHand: v.stockOnHand === '' ? 0 : Number(v.stockOnHand),
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
                        void navigate(`/catalog/products/${newProductId}`, { replace: true });
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
                    void navigate(`/catalog/products/${newProductId}`, { replace: true });
                    showError(
                        `[阶段 4：商品与 SKU 已保存，但销售店铺或分类归属保存失败] ${toUserFacingError(err, '请稍后重试')}`,
                    );
                    setSaving(false);
                    return;
                }

                showNotice(`商品《${productName}》及 ${variants.length} 个规格变体已全部发布入库！`);
                void navigate(`/catalog/products/${newProductId}`, { replace: true });
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
                                customFields: customFieldInputFromValues(
                                    productCustomFieldDefinitions,
                                    dynamicCustomFieldValues,
                                ),
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
                                        stockOnHand: v.stockOnHand === '' ? 0 : Number(v.stockOnHand),
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
                                    stockOnHand: v.stockOnHand === '' ? 0 : Number(v.stockOnHand),
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

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* Top Header */}
            <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 bg-white px-5 py-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div className="flex items-center gap-3">
                    <NextAdminActions
                        pageId="product-detail"
                        entity={(productData?.product as unknown as Record<string, unknown>) ?? null}
                    />
                    <button
                        type="button"
                        onClick={leaveToProductList}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition-colors cursor-pointer"
                        title="返回商品列表"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>

                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-lg font-bold text-slate-900">
                                {isCreateMode ? '发布新商品' : productName || '编辑商品详情'}
                            </h1>
                            {!isCreateMode && (
                                <span className="text-[11px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                                    ID: {productId}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                            {isCreateMode
                                ? '录入商品 SPU 图文参数、关联素材、配置 SKU 变体与属性分类'
                                : '维护 SPU 详情、图片素材、SKU 变体与属性标签'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={leaveToProductList}
                        className="px-4 py-2 border border-slate-300 hover:bg-slate-100 rounded-lg text-xs font-bold text-slate-700 transition-colors cursor-pointer"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={
                            saving ||
                            productLoading ||
                            channelLoading ||
                            catalogChannelsLoading ||
                            !channelData?.activeChannel ||
                            !catalogChannelsData?.activeChannel ||
                            (!isCreateMode && !productData?.product)
                        }
                        className={[
                            'flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-xs',
                            'font-bold text-white shadow-sm transition-colors hover:bg-blue-700',
                            'cursor-pointer disabled:opacity-50',
                        ].join(' ')}
                    >
                        {saving ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                            <Save className="w-4 h-4" />
                        )}
                        <span>{isCreateMode ? '立即发布商品' : '保存修改'}</span>
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="scrollbar-hidden flex shrink-0 gap-6 overflow-x-auto border-b border-slate-200 bg-white px-5 text-xs font-bold sm:px-8">
                <button
                    type="button"
                    onClick={() => setActiveTab('BASIC')}
                    className={[
                        'flex cursor-pointer items-center gap-1.5 border-b-2 py-3.5 transition-colors',
                        activeTab === 'BASIC'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-800',
                    ].join(' ')}
                >
                    <Sliders className="w-3.5 h-3.5" /> SPU 基础图文与主图
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('VARIANTS')}
                    className={[
                        'flex cursor-pointer items-center gap-1.5 border-b-2 py-3.5 transition-colors',
                        activeTab === 'VARIANTS'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-800',
                    ].join(' ')}
                >
                    <Layers className="w-3.5 h-3.5" /> SKU 变体与库存 ({variants.length})
                </button>
                <button
                    type="button"
                    onClick={() => setActiveTab('FACETS_COLLECTIONS')}
                    className={[
                        'flex cursor-pointer items-center gap-1.5 border-b-2 py-3.5 transition-colors',
                        activeTab === 'FACETS_COLLECTIONS'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-slate-500 hover:text-slate-800',
                    ].join(' ')}
                >
                    <Tag className="w-3.5 h-3.5" /> 标签属性与分类 (
                    {selectedFacetValueIds.length + selectedCollectionIds.length})
                </button>
            </div>

            {/* Main Form Body */}
            <div className="mx-auto w-full max-w-5xl flex-1 space-y-6 overflow-y-auto p-5 sm:p-8">
                {/* 成功通知 */}
                {notification && (
                    <div
                        role="status"
                        className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-emerald-800 text-xs font-medium animate-fadeIn"
                    >
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> {notification}
                    </div>
                )}

                {!isCreateMode && productData?.product && (
                    <NextAdminPageBlocks
                        pageId="product-detail"
                        entity={productData.product as unknown as Record<string, unknown>}
                    />
                )}

                {/* 错误提示 */}
                {errorMessage && (
                    <div
                        role="alert"
                        className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center gap-2 animate-fadeIn"
                    >
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        <span>{errorMessage}</span>
                    </div>
                )}

                {channelError && (
                    <div
                        role="alert"
                        className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 animate-fadeIn"
                    >
                        <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            <span>
                                {toUserFacingError(
                                    channelError,
                                    '无法读取当前销售渠道，商品语言与币种配置暂不可用',
                                )}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => void refetchChannel()}
                            className="shrink-0 rounded bg-rose-600 px-3 py-1 font-bold text-white hover:bg-rose-700"
                        >
                            重试
                        </button>
                    </div>
                )}

                {catalogChannelsError && (
                    <div
                        role="alert"
                        className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 animate-fadeIn"
                    >
                        <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                            <span>
                                {toUserFacingError(
                                    catalogChannelsError,
                                    '无法读取可用店铺，暂不能保存商品销售范围',
                                )}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={() => void refetchCatalogChannels()}
                            className="shrink-0 rounded bg-rose-600 px-3 py-1 font-bold text-white hover:bg-rose-700"
                        >
                            重试
                        </button>
                    </div>
                )}

                {/* 查询已有商品失败 */}
                {productError && (
                    <div
                        role="alert"
                        className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-center justify-between"
                    >
                        <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                            <span>{toUserFacingError(productError, '商品详情读取失败，请稍后重试')}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => void refetchProduct()}
                            className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold cursor-pointer"
                        >
                            重试查询
                        </button>
                    </div>
                )}

                {/* 骨架屏 */}
                {productLoading && !productData && (
                    <div className="space-y-4 p-8 bg-white rounded-xl border border-slate-200 animate-pulse">
                        <div className="h-6 bg-slate-200 rounded w-1/3"></div>
                        <div className="h-10 bg-slate-100 rounded"></div>
                        <div className="h-24 bg-slate-100 rounded"></div>
                    </div>
                )}

                {!isCreateMode && !productLoading && !productError && productData && !productData.product && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
                        <AlertCircle className="mx-auto h-8 w-8 text-amber-600" />
                        <h2 className="mt-3 text-sm font-bold text-amber-900">
                            商品不存在或当前账号无权查看
                        </h2>
                        <p className="mt-1 text-xs text-amber-700">
                            请返回商品列表重新选择，不会使用空白数据覆盖商品。
                        </p>
                        <button
                            type="button"
                            onClick={leaveToProductList}
                            className="mt-4 rounded-lg bg-amber-700 px-4 py-2 text-xs font-bold text-white"
                        >
                            返回商品列表
                        </button>
                    </div>
                )}

                {/* 1. SPU 基础信息与主图 */}
                {(isCreateMode || Boolean(productData?.product)) && activeTab === 'BASIC' && (
                    <div className="space-y-6">
                        {/* 核心属性 */}
                        <div className="bg-white rounded-xl shadow-2xs border border-slate-200 p-6 space-y-5">
                            <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                                <h3 className="text-sm font-bold text-slate-900">SPU 核心属性</h3>

                                <label className="flex items-center gap-2 cursor-pointer">
                                    <span className="text-xs font-bold text-slate-600">上架状态</span>
                                    <input
                                        type="checkbox"
                                        checked={enabled}
                                        onChange={e => setEnabled(e.target.checked)}
                                        className="w-4 h-4 text-blue-600 rounded"
                                    />
                                    <span
                                        className={[
                                            'rounded px-2 py-0.5 text-[11px] font-bold',
                                            enabled
                                                ? 'bg-emerald-100 text-emerald-800'
                                                : 'bg-slate-100 text-slate-600',
                                        ].join(' ')}
                                    >
                                        {enabled ? '已上架' : '放入仓库'}
                                    </span>
                                </label>
                            </div>

                            <div className="space-y-4 text-xs">
                                <div>
                                    <label
                                        htmlFor="product-name"
                                        className="block font-bold text-slate-700 mb-1"
                                    >
                                        中文商品标题 <span className="text-rose-500">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        id="product-name"
                                        value={productName}
                                        onChange={e => {
                                            setProductName(e.target.value);
                                            if (formErrors.name)
                                                setFormErrors(prev => ({ ...prev, name: undefined }));
                                        }}
                                        placeholder="输入商品名称，如：无线主动降噪头戴耳机 Pro Max"
                                        aria-invalid={Boolean(formErrors.name)}
                                        aria-describedby={formErrors.name ? 'product-name-error' : undefined}
                                        className={[
                                            'w-full rounded-lg border bg-white p-2.5 text-xs font-bold',
                                            'focus:outline-none focus:ring-1',
                                            formErrors.name
                                                ? 'border-rose-500 focus:ring-rose-500'
                                                : 'border-slate-300 focus:ring-blue-500',
                                        ].join(' ')}
                                    />
                                    {formErrors.name && (
                                        <p id="product-name-error" className="text-rose-500 text-[11px] mt-1">
                                            {formErrors.name}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label
                                        htmlFor="product-slug"
                                        className="block font-bold text-slate-700 mb-1"
                                    >
                                        URL 唯一别名 (Slug)
                                    </label>
                                    <input
                                        type="text"
                                        id="product-slug"
                                        value={slug}
                                        onChange={e => setSlug(e.target.value)}
                                        placeholder="例如：wireless-noise-cancelling-headphones (留空将根据商品标题自动生成)"
                                        className={[
                                            'w-full rounded-lg border border-slate-300 bg-white p-2.5',
                                            'font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-500',
                                        ].join(' ')}
                                    />
                                </div>

                                <div>
                                    <label
                                        htmlFor="product-description"
                                        className="block font-bold text-slate-700 mb-1"
                                    >
                                        中文商品详情 <span className="text-rose-500">*</span>
                                    </label>
                                    <textarea
                                        rows={6}
                                        id="product-description"
                                        value={description}
                                        onChange={e => {
                                            setDescription(e.target.value);
                                            if (formErrors.description)
                                                setFormErrors(previous => ({
                                                    ...previous,
                                                    description: undefined,
                                                }));
                                        }}
                                        placeholder="输入商品详情规格、包装清单及说明..."
                                        aria-invalid={Boolean(formErrors.description)}
                                        aria-describedby={
                                            formErrors.description ? 'product-description-error' : undefined
                                        }
                                        className={[
                                            'w-full rounded-xl border bg-white p-3 text-xs leading-relaxed',
                                            'focus:outline-none focus:ring-1',
                                            formErrors.description
                                                ? 'border-rose-500 focus:ring-rose-500'
                                                : 'border-slate-300 focus:ring-blue-500',
                                        ].join(' ')}
                                    />
                                    {formErrors.description && (
                                        <p
                                            id="product-description-error"
                                            className="mt-1 text-[11px] text-rose-500"
                                        >
                                            {formErrors.description}
                                        </p>
                                    )}
                                    <p className="mt-1 text-[10px] leading-4 text-slate-400">
                                        中文是商城内容源语言；英文由翻译引擎生成，并可在“多语言翻译”中复核。
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* 真实素材主图 */}
                        <div className="bg-white rounded-xl shadow-2xs border border-slate-200 p-6 space-y-4">
                            <div className="border-b border-slate-100 pb-3 flex justify-between items-center">
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900">
                                        商品主图 (Featured Asset)
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        从后端真实素材库选择一张图片作为前台商品主图
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAssetPickerMode('FEATURED');
                                        setIsAssetPickerOpen(true);
                                    }}
                                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                                >
                                    {featuredAssetId ? '更换主图' : '选择素材主图'}
                                </button>
                            </div>

                            {featuredAssetPreview ? (
                                <div className="flex items-center gap-4">
                                    <div className="w-24 h-24 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 relative group">
                                        <img
                                            src={featuredAssetPreview}
                                            alt="主图预览"
                                            className="w-full h-full object-cover"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setFeaturedAssetId(null);
                                                setFeaturedAssetPreview(null);
                                            }}
                                            className={[
                                                'absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white',
                                                'opacity-0 transition-colors hover:bg-rose-600 group-hover:opacity-100',
                                            ].join(' ')}
                                            title="移除主图"
                                            aria-label="移除商品主图"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        <div className="font-mono text-slate-800 font-bold">
                                            Asset ID: {featuredAssetId}
                                        </div>
                                        <div className="text-[11px] text-slate-400 mt-1">
                                            已绑定为商品主图，将在前台列表与详情首屏展示
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setAssetPickerMode('FEATURED');
                                        setIsAssetPickerOpen(true);
                                    }}
                                    className={[
                                        'flex w-full cursor-pointer flex-col items-center justify-center gap-2',
                                        'rounded-xl border-2 border-dashed border-slate-200 p-6 text-center',
                                        'transition-all hover:border-blue-400 hover:bg-blue-50/30',
                                    ].join(' ')}
                                >
                                    <ImageIcon className="w-8 h-8 text-slate-300" />
                                    <div className="text-xs font-bold text-slate-600">
                                        暂未设置主图，点击从素材库选择
                                    </div>
                                </button>
                            )}

                            <div className="border-t border-slate-100 pt-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-xs font-bold text-slate-800">商品详情图集</div>
                                        <div className="text-[11px] text-slate-400 mt-0.5">
                                            可多选素材，保存为 Vendure 商品 Asset 关联
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAssetPickerMode('GALLERY');
                                            setIsAssetPickerOpen(true);
                                        }}
                                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer"
                                    >
                                        管理图集 ({selectedAssetIds.length})
                                    </button>
                                </div>
                                {selectedAssetIds.length > 0 ? (
                                    <div className="flex flex-wrap gap-3">
                                        {selectedAssetIds.map(assetId => {
                                            const asset = knownAssets[assetId];
                                            return (
                                                <div
                                                    key={assetId}
                                                    className="relative w-16 h-16 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 group"
                                                >
                                                    {asset?.preview ? (
                                                        <img
                                                            src={asset.preview}
                                                            alt={asset.name}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <ImageIcon className="w-5 h-5 text-slate-300 absolute inset-0 m-auto" />
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setSelectedAssetIds(ids =>
                                                                ids.filter(id => id !== assetId),
                                                            )
                                                        }
                                                        aria-label={`移除素材 ${asset?.name ?? assetId}`}
                                                        className="absolute top-1 right-1 p-0.5 bg-black/60 text-white rounded opacity-0 group-hover:opacity-100"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-[11px] text-slate-400">暂未关联详情图。</div>
                                )}
                            </div>
                        </div>
                        <DynamicCustomFieldsForm
                            fields={productCustomFieldDefinitions}
                            values={dynamicCustomFieldValues}
                            onChange={setDynamicCustomFieldValues}
                            disabled={saving}
                            title="商品扩展属性"
                            languageCodes={[
                                ...new Set([
                                    SOURCE_LANGUAGE_CODE,
                                    ...(productData?.product?.translations.map(
                                        translation => translation.languageCode,
                                    ) ?? []),
                                ]),
                            ]}
                        />
                    </div>
                )}

                {/* 2. SKU 变体矩阵 */}
                {(isCreateMode || Boolean(productData?.product)) && activeTab === 'VARIANTS' && (
                    <div className="space-y-6">
                        <section className="rounded-xl border border-blue-200 bg-blue-50/60 p-5 shadow-2xs">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                        <FolderTree className="h-4 w-4 text-blue-600" />
                                        销售店铺与独立定价
                                    </h3>
                                    <p className="mt-1 text-xs leading-5 text-slate-500">
                                        当前正在编辑{' '}
                                        <strong className="text-blue-700">
                                            {catalogChannelsData
                                                ? getChannelDisplayName(
                                                      catalogChannelsData.activeChannel.code,
                                                  )
                                                : '当前店铺'}
                                        </strong>{' '}
                                        的 {activeCurrencyCode}{' '}
                                        售价。勾选其他店铺后，使用顶部“当前店铺”切换并分别维护售价。
                                    </p>
                                </div>
                                <span className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-blue-700 shadow-2xs">
                                    已发布 {selectedChannelIds.length} 个店铺
                                </span>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                                {catalogChannelsData?.channels.items.map(channel => {
                                    const isActiveChannel =
                                        channel.id === catalogChannelsData.activeChannel.id;
                                    const isSelected =
                                        selectedChannelIds.includes(channel.id) || isActiveChannel;
                                    return (
                                        <label
                                            key={channel.id}
                                            className={[
                                                'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                                                isSelected
                                                    ? 'border-blue-300 bg-white font-bold text-blue-800'
                                                    : 'border-slate-200 bg-white/70 text-slate-600',
                                            ].join(' ')}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                disabled={isActiveChannel}
                                                onChange={() =>
                                                    setSelectedChannelIds(ids =>
                                                        isSelected
                                                            ? ids.filter(id => id !== channel.id)
                                                            : [...ids, channel.id],
                                                    )
                                                }
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600"
                                            />
                                            <span>{getChannelDisplayName(channel.code)}</span>
                                            <span className="font-mono text-[10px] text-slate-400">
                                                {channel.defaultCurrencyCode}
                                            </span>
                                            {isActiveChannel && (
                                                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] text-blue-700">
                                                    当前
                                                </span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                            <p className="mt-3 text-[10px] leading-4 text-slate-400">
                                新增店铺初始价格按当前售价 1:1
                                复制；切换店铺后可修改为该店铺自己的价格。当前店铺不能在本页取消发布，避免编辑中的商品立即消失。
                            </p>
                        </section>

                        <div className="bg-white rounded-xl shadow-2xs border border-slate-200 overflow-hidden">
                            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                <div>
                                    <h3 className="text-sm font-bold text-slate-900">
                                        SKU 规格变体与在手库存
                                    </h3>
                                    <p className="text-xs text-slate-400 mt-0.5">
                                        为商品配置不同规格型号、条形码 SKU、售价与初始库存
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleAddVariant}
                                    className={[
                                        'flex cursor-pointer items-center gap-1.5 rounded-lg bg-blue-600',
                                        'px-3.5 py-1.5 text-xs font-bold text-white shadow-2xs',
                                        'transition-colors hover:bg-blue-700',
                                    ].join(' ')}
                                >
                                    <Plus className="w-3.5 h-3.5" /> 添加 SKU 变体
                                </button>
                            </div>

                            <div className="border-b border-slate-100 p-5 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-xs font-bold text-slate-800">套用规格模板</div>
                                        <div className="mt-0.5 text-[11px] text-slate-400">
                                            选择颜色、容量等模板后，一键生成真实 Option 组合 SKU
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleGenerateVariantMatrix}
                                        disabled={selectedOptionGroupIds.length === 0}
                                        className={[
                                            'rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700',
                                            'hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50',
                                        ].join(' ')}
                                    >
                                        生成 SKU 矩阵
                                    </button>
                                </div>
                                <div className="relative max-w-md">
                                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                                    <input
                                        aria-label="搜索规格模板"
                                        value={optionGroupSearch}
                                        onChange={event => {
                                            setOptionGroupSearch(event.target.value);
                                            setOptionGroupPage(0);
                                        }}
                                        placeholder="搜索规格模板名称"
                                        className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-blue-500"
                                    />
                                </div>
                                {optionGroupsError ? (
                                    <div className="rounded-lg bg-rose-50 p-3 text-[11px] text-rose-700">
                                        {toUserFacingError(optionGroupsError, '规格模板读取失败，请稍后重试')}
                                    </div>
                                ) : (optionGroupsData?.productOptionGroups.items.length ?? 0) === 0 ? (
                                    <div className="rounded-lg bg-slate-50 p-3 text-[11px] text-slate-500">
                                        尚未创建规格模板，请先到【商品管理 → 分类与属性】配置。
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {optionGroupsData?.productOptionGroups.items.map(group => {
                                            const isSelected = selectedOptionGroupIds.includes(group.id);
                                            return (
                                                <button
                                                    key={group.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setKnownOptionGroups(current => ({
                                                            ...current,
                                                            [group.id]: group,
                                                        }));
                                                        setSelectedOptionGroupIds(ids =>
                                                            isSelected
                                                                ? ids.filter(id => id !== group.id)
                                                                : [...ids, group.id],
                                                        );
                                                    }}
                                                    className={[
                                                        'rounded-lg border px-3 py-2 text-left transition-colors',
                                                        isSelected
                                                            ? 'border-blue-500 bg-blue-50 text-blue-800'
                                                            : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300',
                                                    ].join(' ')}
                                                >
                                                    <div className="flex items-center gap-1.5 text-xs font-bold">
                                                        {isSelected && <Check className="h-3 w-3" />}
                                                        {group.name}
                                                    </div>
                                                    <div className="mt-0.5 font-mono text-[10px] opacity-70">
                                                        {group.options.length} 个选项
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                <LookupPager
                                    page={optionGroupPage}
                                    pageSize={LOOKUP_PAGE_SIZE}
                                    totalItems={optionGroupsData?.productOptionGroups.totalItems ?? 0}
                                    onPageChange={setOptionGroupPage}
                                />
                                <p className="text-[10px] leading-4 text-slate-400">
                                    取消已被现有 SKU 使用的模板时，Vendure
                                    会拒绝移除并保留原关联，避免误删规格数据。
                                </p>
                            </div>

                            {variants.length === 0 ? (
                                <div className="p-12 text-center text-slate-400 space-y-3">
                                    <Layers className="w-8 h-8 mx-auto text-slate-300" />
                                    <div className="text-xs font-bold text-slate-600">
                                        当前商品未配置任何 SKU 规格变体
                                    </div>
                                    <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                                        若商品为单品或存在多规格选项，请点击上方 “添加 SKU 变体”
                                        按钮进行配置。
                                    </p>
                                </div>
                            ) : (
                                <div className="mobile-scrollbar-hidden overflow-x-auto">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold whitespace-nowrap">
                                                <th className="p-3.5">规格名称</th>
                                                <th className="p-3.5 min-w-[150px]">
                                                    SKU 编码 <span className="text-rose-500">*</span>
                                                </th>
                                                <th className="p-3.5">
                                                    售价 ({activeCurrencyCode}){' '}
                                                    <span className="text-rose-500">*</span>
                                                </th>
                                                <th className="p-3.5">在手库存 (OnHand)</th>
                                                <th className="p-3.5">锁定库存</th>
                                                <th className="p-3.5 text-center">启用状态</th>
                                                <th className="p-3.5 text-right w-16">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 text-slate-700">
                                            {variants.map((variant, index) => {
                                                const rowError = formErrors.variants?.[index];

                                                return (
                                                    <tr
                                                        key={variant.id || index}
                                                        className="hover:bg-slate-50/80"
                                                    >
                                                        {/* Variant Name */}
                                                        <td className="p-3.5">
                                                            <input
                                                                type="text"
                                                                aria-label={`第 ${index + 1} 行规格名称`}
                                                                value={variant.name}
                                                                onChange={e =>
                                                                    handleVariantFieldChange(
                                                                        index,
                                                                        'name',
                                                                        e.target.value,
                                                                    )
                                                                }
                                                                placeholder="规格名 (如: 红色 / XL)"
                                                                className="w-full border border-slate-300 rounded px-2 py-1 font-bold text-slate-900 bg-white"
                                                            />
                                                        </td>

                                                        {/* SKU */}
                                                        <td className="p-3.5">
                                                            <input
                                                                type="text"
                                                                aria-label={`第 ${index + 1} 行 SKU 编码`}
                                                                value={variant.sku}
                                                                onChange={e =>
                                                                    handleVariantFieldChange(
                                                                        index,
                                                                        'sku',
                                                                        e.target.value,
                                                                    )
                                                                }
                                                                placeholder="必须唯一编码"
                                                                className={[
                                                                    'w-full rounded border bg-white px-2 py-1 font-mono',
                                                                    rowError?.sku
                                                                        ? 'border-rose-500 text-rose-600'
                                                                        : 'border-slate-300 text-slate-700',
                                                                ].join(' ')}
                                                            />
                                                            {rowError?.sku && (
                                                                <div className="text-[10px] text-rose-500 mt-0.5">
                                                                    {rowError.sku}
                                                                </div>
                                                            )}
                                                        </td>

                                                        {/* Price */}
                                                        <td className="p-3.5">
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-slate-400 font-mono">
                                                                    {activeCurrencyCode}
                                                                </span>
                                                                <input
                                                                    type="number"
                                                                    aria-label={`第 ${index + 1} 行售价`}
                                                                    step="0.01"
                                                                    min="0"
                                                                    value={variant.price}
                                                                    onChange={e =>
                                                                        handleVariantFieldChange(
                                                                            index,
                                                                            'price',
                                                                            e.target.value,
                                                                        )
                                                                    }
                                                                    placeholder="0.00"
                                                                    className={[
                                                                        'w-24 rounded border bg-white px-2 py-1 font-mono font-bold',
                                                                        rowError?.price
                                                                            ? 'border-rose-500 text-rose-600'
                                                                            : 'border-slate-300 text-slate-900',
                                                                    ].join(' ')}
                                                                />
                                                            </div>
                                                            {rowError?.price && (
                                                                <div className="text-[10px] text-rose-500 mt-0.5">
                                                                    {rowError.price}
                                                                </div>
                                                            )}
                                                        </td>

                                                        {/* Stock on Hand */}
                                                        <td className="p-3.5">
                                                            <input
                                                                type="number"
                                                                aria-label={`第 ${index + 1} 行在手库存`}
                                                                min="0"
                                                                value={variant.stockOnHand}
                                                                onChange={e =>
                                                                    handleVariantFieldChange(
                                                                        index,
                                                                        'stockOnHand',
                                                                        e.target.value === ''
                                                                            ? ''
                                                                            : parseInt(e.target.value, 10) ||
                                                                                  0,
                                                                    )
                                                                }
                                                                placeholder="0"
                                                                className="w-20 font-mono font-bold text-slate-800 border border-slate-300 rounded px-2 py-1 bg-white"
                                                            />
                                                        </td>

                                                        {/* Allocated Stock */}
                                                        <td className="p-3.5 font-mono text-slate-400">
                                                            {variant.stockAllocated || 0}
                                                        </td>

                                                        {/* Enabled */}
                                                        <td className="p-3.5 text-center">
                                                            <input
                                                                type="checkbox"
                                                                aria-label={`第 ${index + 1} 行 SKU 启用状态`}
                                                                checked={variant.enabled}
                                                                onChange={e =>
                                                                    handleVariantFieldChange(
                                                                        index,
                                                                        'enabled',
                                                                        e.target.checked,
                                                                    )
                                                                }
                                                                className="w-4 h-4 text-blue-600 rounded cursor-pointer"
                                                            />
                                                        </td>

                                                        {/* Actions */}
                                                        <td className="p-3.5 text-right">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    void handleDeleteVariant(index)
                                                                }
                                                                className={[
                                                                    'cursor-pointer rounded p-1 text-slate-400 transition-colors',
                                                                    'hover:bg-rose-50 hover:text-rose-600',
                                                                ].join(' ')}
                                                                title="删除该规格"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 3. 标签属性与分类 */}
                {(isCreateMode || Boolean(productData?.product)) && activeTab === 'FACETS_COLLECTIONS' && (
                    <div className="space-y-6">
                        {/* Facet 筛选标签属性 */}
                        <div className="bg-white rounded-xl shadow-2xs border border-slate-200 p-6 space-y-4">
                            <div className="border-b border-slate-100 pb-3">
                                <h3 className="text-sm font-bold text-slate-900">Facet 属性标签关联</h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    勾选商品所属的 Facet 标签，将直接保存至后端并用于前台筛选检索
                                </p>
                            </div>
                            <div className="relative max-w-md">
                                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                                <input
                                    aria-label="搜索商品属性"
                                    value={facetSearch}
                                    onChange={event => {
                                        setFacetSearch(event.target.value);
                                        setFacetPage(0);
                                    }}
                                    placeholder="搜索属性名称"
                                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-blue-500"
                                />
                            </div>

                            {facetsLoading && !facetsData ? (
                                <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">
                                    正在读取属性标签…
                                </div>
                            ) : facetsError ? (
                                <div
                                    role="alert"
                                    className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700"
                                >
                                    <span>
                                        {toUserFacingError(facetsError, '属性标签读取失败，请稍后重试')}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => void refetchFacets()}
                                        className="shrink-0 rounded bg-rose-600 px-3 py-1 font-bold text-white"
                                    >
                                        重试
                                    </button>
                                </div>
                            ) : facetsData?.facets?.items && facetsData.facets.items.length > 0 ? (
                                <div className="space-y-4">
                                    {facetsData.facets.items.map(facet => (
                                        <div key={facet.id} className="space-y-2">
                                            <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                                <Tag className="w-3.5 h-3.5 text-blue-500" />
                                                <span>{facet.name}</span>
                                                <span className="text-[10px] text-slate-400 font-mono">
                                                    ({facet.code})
                                                </span>
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                {facet.values.map(fv => {
                                                    const isSelected = selectedFacetValueIds.includes(fv.id);
                                                    return (
                                                        <button
                                                            key={fv.id}
                                                            type="button"
                                                            onClick={() => toggleFacetValue(fv.id)}
                                                            className={[
                                                                'flex cursor-pointer items-center gap-1 rounded-lg border',
                                                                'px-3 py-1 text-xs font-medium transition-all',
                                                                isSelected
                                                                    ? 'border-blue-600 bg-blue-600 text-white shadow-2xs'
                                                                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
                                                            ].join(' ')}
                                                        >
                                                            {isSelected && <Check className="w-3 h-3" />}
                                                            <span>{fv.name}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-4 bg-slate-50 rounded-lg text-xs text-slate-500">
                                    系统中尚未配置任何 Facet 属性标签，可在【商品 ➡️
                                    分类与属性】中先创建属性。
                                </div>
                            )}
                            <LookupPager
                                page={facetPage}
                                pageSize={LOOKUP_PAGE_SIZE}
                                totalItems={facetsData?.facets.totalItems ?? 0}
                                onPageChange={setFacetPage}
                            />
                        </div>

                        {/* 所属商品分类 */}
                        <div className="bg-white rounded-xl shadow-2xs border border-slate-200 p-6 space-y-3">
                            <div className="border-b border-slate-100 pb-3">
                                <h3 className="text-sm font-bold text-slate-900">
                                    所属商品分类 (Collections)
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    勾选后直接加入分类；已有 Facet 自动分类规则会完整保留，不会被人工归类覆盖
                                </p>
                            </div>
                            <div className="relative max-w-md">
                                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                                <input
                                    aria-label="搜索商品分类或专辑"
                                    value={collectionSearch}
                                    onChange={event => {
                                        setCollectionSearch(event.target.value);
                                        setCollectionPage(0);
                                    }}
                                    placeholder="搜索分类或专辑名称"
                                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-blue-500"
                                />
                            </div>

                            {collectionsLoading && !collectionsData ? (
                                <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">
                                    正在读取商品分类…
                                </div>
                            ) : collectionsError ? (
                                <div
                                    role="alert"
                                    className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700"
                                >
                                    <span>
                                        {toUserFacingError(collectionsError, '商品分类读取失败，请稍后重试')}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => void refetchCollections()}
                                        className="shrink-0 rounded bg-rose-600 px-3 py-1 font-bold text-white"
                                    >
                                        重试
                                    </button>
                                </div>
                            ) : collectionsData?.collections?.items &&
                              collectionsData.collections.items.length > 0 ? (
                                <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2 lg:grid-cols-3">
                                    {collectionsData.collections.items.map(col => {
                                        const isSelected = selectedCollectionIds.includes(col.id);
                                        const isAutomaticallyMatched =
                                            !isCreateMode &&
                                            productData?.product?.collections.some(
                                                collection => collection.id === col.id,
                                            ) &&
                                            !hasDirectProductAssignment(col.filters, productId ?? '');
                                        return (
                                            <label
                                                key={col.id}
                                                className={[
                                                    'flex cursor-pointer items-center gap-3 rounded-lg border p-3',
                                                    'text-xs transition-colors',
                                                    isSelected
                                                        ? 'border-blue-400 bg-blue-50'
                                                        : 'border-slate-200 bg-slate-50 hover:border-blue-300',
                                                ].join(' ')}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() =>
                                                        setSelectedCollectionIds(ids =>
                                                            isSelected
                                                                ? ids.filter(id => id !== col.id)
                                                                : [...ids, col.id],
                                                        )
                                                    }
                                                    className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600"
                                                />
                                                <FolderTree
                                                    className="h-4 w-4 shrink-0 text-blue-500"
                                                    aria-hidden="true"
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-bold text-slate-800">
                                                        {col.name}
                                                    </span>
                                                    <span className="block truncate font-mono text-[10px] text-slate-400">
                                                        {col.slug}
                                                    </span>
                                                </span>
                                                {isAutomaticallyMatched && (
                                                    <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                                                        自动匹配
                                                    </span>
                                                )}
                                            </label>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="p-4 bg-slate-50 rounded-lg text-xs text-slate-500">
                                    当前店铺暂无分类专辑。
                                </div>
                            )}
                            <LookupPager
                                page={collectionPage}
                                pageSize={LOOKUP_PAGE_SIZE}
                                totalItems={collectionsData?.collections.totalItems ?? 0}
                                onPageChange={setCollectionPage}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* 素材库弹窗选择器 (真实 Asset ID) */}
            {isAssetPickerOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs animate-fadeIn"
                    onClick={() => setIsAssetPickerOpen(false)}
                >
                    <AccessibleDialogSurface
                        accessibleName={
                            assetPickerMode === 'FEATURED' ? '选择商品主图素材' : '管理商品详情图集'
                        }
                        onRequestClose={() => setIsAssetPickerOpen(false)}
                        className="bg-white rounded-2xl max-w-3xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scaleIn max-h-[80vh] flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                            <div>
                                <h3 className="text-base font-bold text-slate-900">
                                    {assetPickerMode === 'FEATURED' ? '选择商品主图素材' : '管理商品详情图集'}
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    {assetPickerMode === 'FEATURED'
                                        ? '选中后立即作为商品主图'
                                        : '可连续选择或取消多个后端素材'}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsAssetPickerOpen(false)}
                                className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"
                                aria-label="关闭"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <input
                                aria-label="搜索图片素材"
                                value={assetSearch}
                                onChange={event => {
                                    setAssetSearch(event.target.value);
                                    setAssetPage(0);
                                }}
                                placeholder="搜索图片素材名称"
                                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-500"
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-[300px]">
                            {assetsLoading && (
                                <div className="p-12 text-center text-slate-400 text-xs">
                                    正在加载素材库...
                                </div>
                            )}

                            {!assetsLoading && assetsError && (
                                <div
                                    role="alert"
                                    className="flex min-h-52 flex-col items-center justify-center gap-3 p-8 text-center text-xs text-rose-700"
                                >
                                    <AlertCircle className="h-8 w-8 text-rose-500" />
                                    <span>
                                        {toUserFacingError(assetsError, '素材库读取失败，请稍后重试')}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => void refetchAssets()}
                                        className="rounded-lg bg-rose-600 px-4 py-2 font-bold text-white"
                                    >
                                        重试
                                    </button>
                                </div>
                            )}

                            {!assetsLoading &&
                                !assetsError &&
                                (!assetsData?.assets?.items || assetsData.assets.items.length === 0) && (
                                    <div className="p-12 text-center text-slate-400 text-xs space-y-2">
                                        <ImageIcon className="w-8 h-8 mx-auto text-slate-300" />
                                        <div>
                                            素材库中暂无图片，请在【店铺 ➡️ 素材中心】中先上传素材文件。
                                        </div>
                                    </div>
                                )}

                            {!assetsError &&
                                assetsData?.assets?.items &&
                                assetsData.assets.items.length > 0 && (
                                    <div className="grid grid-cols-2 gap-3 p-1 sm:grid-cols-4 md:grid-cols-5">
                                        {assetsData.assets.items.map(asset => {
                                            const isSelected =
                                                assetPickerMode === 'FEATURED'
                                                    ? featuredAssetId === asset.id
                                                    : selectedAssetIds.includes(asset.id);
                                            return (
                                                <button
                                                    type="button"
                                                    key={asset.id}
                                                    aria-pressed={isSelected}
                                                    onClick={() => {
                                                        setKnownAssets(current => ({
                                                            ...current,
                                                            [asset.id]: asset,
                                                        }));
                                                        if (assetPickerMode === 'FEATURED') {
                                                            setFeaturedAssetId(asset.id);
                                                            setFeaturedAssetPreview(asset.preview);
                                                            setIsAssetPickerOpen(false);
                                                        } else {
                                                            setSelectedAssetIds(ids =>
                                                                ids.includes(asset.id)
                                                                    ? ids.filter(id => id !== asset.id)
                                                                    : [...ids, asset.id],
                                                            );
                                                        }
                                                    }}
                                                    className={[
                                                        'group relative aspect-square cursor-pointer overflow-hidden',
                                                        'rounded-xl border-2 transition-all',
                                                        isSelected
                                                            ? 'border-blue-600 shadow-md ring-2 ring-blue-400'
                                                            : 'border-slate-200 hover:border-blue-300',
                                                    ].join(' ')}
                                                >
                                                    <img
                                                        src={asset.preview}
                                                        alt={asset.name}
                                                        className="w-full h-full object-cover"
                                                    />
                                                    <div className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[10px] p-1 truncate font-mono">
                                                        {asset.name}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                        </div>

                        <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                            <LookupPager
                                page={assetPage}
                                pageSize={ASSET_PAGE_SIZE}
                                totalItems={assetsData?.assets.totalItems ?? 0}
                                onPageChange={setAssetPage}
                            />
                            <button
                                type="button"
                                onClick={() => setIsAssetPickerOpen(false)}
                                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold cursor-pointer"
                            >
                                关闭
                            </button>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}

function LookupPager({
    page,
    pageSize,
    totalItems,
    onPageChange,
}: {
    page: number;
    pageSize: number;
    totalItems: number;
    onPageChange: (page: number) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    return (
        <div className="flex items-center justify-between gap-3 text-[10px] text-slate-400">
            <span>
                共 {totalItems} 条 · {Math.min(page + 1, totalPages)} / {totalPages} 页
            </span>
            <div className="flex gap-1.5">
                <button
                    type="button"
                    onClick={() => onPageChange(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 disabled:opacity-30"
                    aria-label="上一页"
                >
                    <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                    type="button"
                    onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 disabled:opacity-30"
                    aria-label="下一页"
                >
                    <ChevronRight className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}
