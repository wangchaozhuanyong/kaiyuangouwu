import { useLazyQuery, useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Edit3,
    Eye,
    FolderTree,
    Plus,
    RefreshCw,
    Sliders,
    Tag,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { DynamicCustomFieldsForm } from '../../custom-fields/DynamicCustomFieldsForm';
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
    CREATE_COLLECTION,
    CREATE_FACET,
    CREATE_FACET_VALUE,
    CREATE_OPTION_GROUP,
    CREATE_PRODUCT_OPTION,
    DELETE_COLLECTION,
    DELETE_FACET,
    DELETE_FACET_VALUE,
    DELETE_OPTION_GROUP,
    DELETE_PRODUCT_OPTION,
    GET_CATALOG_TAXONOMY,
    PREVIEW_COLLECTION_VARIANTS,
    UPDATE_COLLECTION,
    UPDATE_FACET,
    UPDATE_FACET_VALUE,
    UPDATE_OPTION_GROUP,
    UPDATE_PRODUCT_OPTION,
} from '../../graphql/catalog-admin.graphql';
import type {
    OperationArgDefinition,
    OperationDefinition,
    OperationValue,
} from '../../graphql/generic-promotions.graphql';
import { useUrlTab } from '../../hooks/use-url-tab';
import { toUserFacingError } from '../../utils/user-facing-error';

type ActiveTab = 'CATEGORIES' | 'OPTION_TEMPLATES' | 'FACETS';
const CATEGORY_TABS = { categories: 'CATEGORIES', options: 'OPTION_TEMPLATES', facets: 'FACETS' } as const;

interface TranslationItem {
    id: string;
    languageCode: string;
    name: string;
    slug?: string;
    description?: string;
    customFields?: Record<string, unknown> | null;
}

interface CollectionItem {
    id: string;
    name: string;
    slug: string;
    description: string;
    isPrivate: boolean;
    parentId?: string | null;
    position: number;
    productVariantCount: number;
    inheritFilters: boolean;
    filters: Array<{ code: string; args: Array<{ name: string; value: string }> }>;
    customFields?: Record<string, unknown> | null;
    translations: TranslationItem[];
}

interface ValueItem {
    id: string;
    name: string;
    code: string;
    translations: TranslationItem[];
}

interface OptionGroupItem {
    id: string;
    name: string;
    code: string;
    productCount: number;
    translations: TranslationItem[];
    options: ValueItem[];
}

interface FacetItem {
    id: string;
    name: string;
    code: string;
    isPrivate: boolean;
    translations: TranslationItem[];
    values: ValueItem[];
}

interface CatalogTaxonomyData {
    collections: { items: CollectionItem[]; totalItems: number };
    productOptionGroups: { items: OptionGroupItem[]; totalItems: number };
    facets: { items: FacetItem[]; totalItems: number };
    activeChannel: { id: string; defaultLanguageCode: string };
    collectionFilters: OperationDefinition[];
}

interface CollectionTreeNode extends CollectionItem {
    children: CollectionTreeNode[];
}

type EditableItem = CollectionItem | OptionGroupItem | FacetItem;
const EMPTY_COLLECTIONS: CollectionItem[] = [];
const EMPTY_OPTION_GROUPS: OptionGroupItem[] = [];
const EMPTY_FACETS: FacetItem[] = [];
const SOURCE_LANGUAGE_CODE = 'zh_Hans';

const getSourceTranslation = (item: { translations: TranslationItem[] }) =>
    item.translations.find(translation => translation.languageCode === SOURCE_LANGUAGE_CODE) ??
    item.translations[0];

const getSourceName = (item: { name: string; translations: TranslationItem[] }) =>
    getSourceTranslation(item)?.name || item.name;

const splitValues = (value: string) =>
    value
        .split(/[，,\n]/)
        .map(item => item.trim())
        .filter((item, index, all) => item.length > 0 && all.indexOf(item) === index);

const toCode = (value: string, prefix: string, index = 0) => {
    const normalized = value
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || `${prefix}-${Date.now().toString(36)}${index ? `-${index + 1}` : ''}`;
};

const deletionSucceeded = (response?: { result?: string; message?: string }) => {
    if (response?.result !== 'DELETED') {
        throw new Error(response?.message || '后端拒绝删除该数据');
    }
};

export function CategoriesModule() {
    const requestConfirmation = useConfirmDialog();
    const collectionCustomFields = useCustomFieldDefinitions('Collection');
    const taxonomyDocument = useMemo(
        () => addCustomFieldsToDocument(GET_CATALOG_TAXONOMY, 'Collection', collectionCustomFields),
        [collectionCustomFields],
    );
    const [activeTab, setActiveTab] = useUrlTab<ActiveTab>(CATEGORY_TABS, 'categories');
    const [notification, setNotification] = useState('');
    const [actionError, setActionError] = useState('');
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<EditableItem | null>(null);
    const [formName, setFormName] = useState('');
    const [formCode, setFormCode] = useState('');
    const [formValues, setFormValues] = useState('');
    const [formParentId, setFormParentId] = useState('');
    const [formIsPrivate, setFormIsPrivate] = useState(false);
    const [formInheritFilters, setFormInheritFilters] = useState(true);
    const [formFilters, setFormFilters] = useState<OperationValue[]>([]);
    const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueMap>({});
    const [saving, setSaving] = useState(false);
    const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string> | null>(null);

    const { data, loading, error, refetch, fetchMore } = useQuery<CatalogTaxonomyData>(taxonomyDocument, {
        variables: {
            collectionOptions: { topLevelOnly: false, skip: 0, take: 100, sort: { position: 'ASC' } },
            optionGroupOptions: { skip: 0, take: 100, sort: { updatedAt: 'DESC' } },
            facetOptions: { skip: 0, take: 100, sort: { updatedAt: 'DESC' } },
        },
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });

    useEffect(() => {
        if (!data || loading || error) return;
        const collectionCount = data.collections.items.length;
        const optionGroupCount = data.productOptionGroups.items.length;
        const facetCount = data.facets.items.length;
        if (
            collectionCount >= data.collections.totalItems &&
            optionGroupCount >= data.productOptionGroups.totalItems &&
            facetCount >= data.facets.totalItems
        )
            return;
        const mergeById = <T extends { id: string }>(current: T[], next: T[]) => [
            ...new Map([...current, ...next].map(item => [item.id, item])).values(),
        ];
        void fetchMore({
            variables: {
                collectionOptions: {
                    topLevelOnly: false,
                    skip: collectionCount,
                    take: 100,
                    sort: { position: 'ASC' },
                },
                optionGroupOptions: { skip: optionGroupCount, take: 100, sort: { updatedAt: 'DESC' } },
                facetOptions: { skip: facetCount, take: 100, sort: { updatedAt: 'DESC' } },
            },
            updateQuery: (previous, { fetchMoreResult }) => ({
                ...previous,
                collections: {
                    ...fetchMoreResult.collections,
                    items: mergeById(previous.collections.items, fetchMoreResult.collections.items),
                },
                productOptionGroups: {
                    ...fetchMoreResult.productOptionGroups,
                    items: mergeById(
                        previous.productOptionGroups.items,
                        fetchMoreResult.productOptionGroups.items,
                    ),
                },
                facets: {
                    ...fetchMoreResult.facets,
                    items: mergeById(previous.facets.items, fetchMoreResult.facets.items),
                },
            }),
        }).catch(fetchError => {
            setActionError(toUserFacingError(fetchError, '分类与属性数据未能全部加载，请点击刷新重试'));
        });
    }, [data, error, fetchMore, loading]);

    const [createCollection] = useMutation(CREATE_COLLECTION);
    const [updateCollection] = useMutation(UPDATE_COLLECTION);
    const [deleteCollection] = useMutation<{ deleteCollection: { result: string; message?: string } }>(
        DELETE_COLLECTION,
    );
    const [createOptionGroup] = useMutation(CREATE_OPTION_GROUP);
    const [updateOptionGroup] = useMutation(UPDATE_OPTION_GROUP);
    const [deleteOptionGroup] = useMutation<{
        deleteProductOptionGroup: { result: string; message?: string };
    }>(DELETE_OPTION_GROUP);
    const [createProductOption] = useMutation(CREATE_PRODUCT_OPTION);
    const [updateProductOption] = useMutation(UPDATE_PRODUCT_OPTION);
    const [deleteProductOption] = useMutation<{ deleteProductOption: { result: string; message?: string } }>(
        DELETE_PRODUCT_OPTION,
    );
    const [createFacet] = useMutation(CREATE_FACET);
    const [updateFacet] = useMutation(UPDATE_FACET);
    const [deleteFacet] = useMutation<{ deleteFacet: { result: string; message?: string } }>(DELETE_FACET);
    const [createFacetValue] = useMutation(CREATE_FACET_VALUE);
    const [updateFacetValue] = useMutation(UPDATE_FACET_VALUE);
    const [deleteFacetValue] = useMutation<{
        deleteFacetValues: Array<{ result: string; message?: string }>;
    }>(DELETE_FACET_VALUE);

    const collections = data?.collections.items ?? EMPTY_COLLECTIONS;
    const optionGroups = data?.productOptionGroups.items ?? EMPTY_OPTION_GROUPS;
    const facets = data?.facets.items ?? EMPTY_FACETS;
    // 内容翻译插件要求所有原生目录内容都从简体中文源语言写入。
    const languageCode = SOURCE_LANGUAGE_CODE;

    const collectionTree = useMemo(() => {
        const nodes = new Map<string, CollectionTreeNode>();
        collections.forEach(item => nodes.set(item.id, { ...item, children: [] }));
        const roots: CollectionTreeNode[] = [];
        nodes.forEach(node => {
            const parent = node.parentId ? nodes.get(node.parentId) : undefined;
            if (parent) parent.children.push(node);
            else roots.push(node);
        });
        const sortNodes = (items: CollectionTreeNode[]) => {
            items.sort((left, right) => left.position - right.position);
            items.forEach(item => sortNodes(item.children));
        };
        sortNodes(roots);
        return roots;
    }, [collections]);

    const visibleExpandedCollectionIds =
        expandedCollectionIds ?? new Set(collectionTree.map(collection => collection.id));
    const allTopLevelCollectionsExpanded =
        collectionTree.length > 0 &&
        collectionTree.every(collection => visibleExpandedCollectionIds.has(collection.id));
    const allTopLevelCollectionsCollapsed = collectionTree.every(
        collection => !visibleExpandedCollectionIds.has(collection.id),
    );

    const toggleCollection = (collectionId: string) => {
        setExpandedCollectionIds(current => {
            const next = new Set(current ?? collectionTree.map(collection => collection.id));
            if (next.has(collectionId)) next.delete(collectionId);
            else next.add(collectionId);
            return next;
        });
    };

    const expandAllCollections = () => {
        setExpandedCollectionIds(new Set(collectionTree.map(collection => collection.id)));
    };

    const collapseAllCollections = () => {
        setExpandedCollectionIds(new Set());
    };

    const showNotice = (message: string) => {
        setNotification(message);
        setActionError('');
        window.setTimeout(() => setNotification(''), 3500);
    };

    const showError = (message: string) => {
        setActionError(message);
        setNotification('');
    };

    const openEditor = (item: EditableItem | null = null) => {
        setEditingItem(item);
        const sourceTranslation = item ? getSourceTranslation(item) : undefined;
        setFormName(item ? getSourceName(item) : '');
        setFormCode(item ? ('slug' in item ? sourceTranslation?.slug || item.slug : item.code) : '');
        setFormValues(
            item && 'options' in item
                ? item.options.map(getSourceName).join('，')
                : item && 'values' in item
                  ? item.values.map(getSourceName).join('，')
                  : '',
        );
        setFormParentId(item && 'parentId' in item ? (item.parentId ?? '') : '');
        setFormIsPrivate(item && 'isPrivate' in item ? item.isPrivate : false);
        setFormInheritFilters(item && 'filters' in item ? item.inheritFilters : true);
        setFormFilters(
            item && 'filters' in item
                ? item.filters.map(filter => ({ code: filter.code, arguments: filter.args }))
                : [],
        );
        setCustomFieldValues(
            item && 'filters' in item
                ? customFieldValuesFromEntity(collectionCustomFields, item.customFields, item.translations)
                : customFieldValuesFromEntity(collectionCustomFields, null),
        );
        setActionError('');
        setIsEditorOpen(true);
    };

    const closeEditor = () => {
        if (saving) return;
        setIsEditorOpen(false);
        setEditingItem(null);
    };

    const syncOptionValues = async (
        group: OptionGroupItem,
        names: string[],
        context?: ReturnType<typeof sensitiveActionContext>,
    ) => {
        const commonCount = Math.min(group.options.length, names.length);
        for (let index = 0; index < commonCount; index += 1) {
            const option = group.options[index];
            const name = names[index];
            await updateProductOption({
                variables: {
                    input: {
                        id: option.id,
                        code: option.code,
                        translations: [{ languageCode, name }],
                    },
                },
            });
        }
        for (let index = commonCount; index < names.length; index += 1) {
            const name = names[index];
            await createProductOption({
                variables: {
                    input: {
                        productOptionGroupId: group.id,
                        code: toCode(name, 'option', index),
                        translations: [{ languageCode, name }],
                    },
                },
            });
        }
        for (const option of group.options.slice(names.length)) {
            const result = await deleteProductOption({ variables: { id: option.id }, context });
            deletionSucceeded(result.data?.deleteProductOption);
        }
    };

    const syncFacetValues = async (
        facet: FacetItem,
        names: string[],
        context?: ReturnType<typeof sensitiveActionContext>,
    ) => {
        const commonCount = Math.min(facet.values.length, names.length);
        for (let index = 0; index < commonCount; index += 1) {
            const value = facet.values[index];
            const name = names[index];
            await updateFacetValue({
                variables: {
                    input: {
                        id: value.id,
                        code: value.code,
                        translations: [{ languageCode, name }],
                    },
                },
            });
        }
        for (let index = commonCount; index < names.length; index += 1) {
            const name = names[index];
            await createFacetValue({
                variables: {
                    input: {
                        facetId: facet.id,
                        code: toCode(name, 'value', index),
                        translations: [{ languageCode, name }],
                    },
                },
            });
        }
        const removedIds = facet.values.slice(names.length).map(value => value.id);
        if (removedIds.length > 0) {
            const result = await deleteFacetValue({ variables: { ids: removedIds, force: false }, context });
            result.data?.deleteFacetValues.forEach(deletionSucceeded);
        }
    };

    const handleSave = async () => {
        const name = formName.trim();
        if (!name) {
            showError('名称不能为空');
            return;
        }
        const code =
            formCode.trim() ||
            toCode(
                name,
                activeTab === 'CATEGORIES'
                    ? 'category'
                    : activeTab === 'OPTION_TEMPLATES'
                      ? 'option-group'
                      : 'facet',
            );
        const values = splitValues(formValues);
        if (activeTab === 'CATEGORIES') {
            const customFieldErrors = validateCustomFieldValues(
                collectionCustomFields,
                customFieldValues,
                languageCode,
            );
            if (Object.keys(customFieldErrors).length > 0) {
                showError(Object.values(customFieldErrors)[0] ?? '分类扩展字段校验失败');
                return;
            }
        }
        const removesExistingValues =
            editingItem &&
            (('options' in editingItem && values.length < editingItem.options.length) ||
                ('values' in editingItem && values.length < editingItem.values.length));
        let sensitiveContext: ReturnType<typeof sensitiveActionContext> | undefined;
        if (removesExistingValues) {
            const confirmation = await requestConfirmation({
                title: '确认删除已存在的规格或属性值？',
                description: '本次保存会永久删除从列表中移除的值。若已有商品使用，后端会拒绝删除。',
                confirmLabel: '验证并保存',
                tone: 'warning',
                requireCurrentPassword: true,
            });
            if (!confirmation) return;
            sensitiveContext = sensitiveActionContext(confirmation.currentPassword ?? '');
        }
        setSaving(true);
        setActionError('');

        try {
            if (activeTab === 'CATEGORIES') {
                if (editingItem && 'slug' in editingItem) {
                    await updateCollection({
                        variables: {
                            input: {
                                id: editingItem.id,
                                isPrivate: formIsPrivate,
                                parentId: formParentId || null,
                                inheritFilters: formInheritFilters,
                                filters: collectionFilterInput(formFilters, data?.collectionFilters ?? []),
                                customFields: customFieldInputFromValues(
                                    collectionCustomFields,
                                    customFieldValues,
                                ),
                                translations: [
                                    {
                                        languageCode,
                                        name,
                                        slug: code,
                                        description:
                                            getSourceTranslation(editingItem)?.description ||
                                            editingItem.description ||
                                            '',
                                        customFields: localizedCustomFieldInputFromValues(
                                            collectionCustomFields,
                                            customFieldValues,
                                            languageCode,
                                        ),
                                    },
                                ],
                            },
                        },
                    });
                } else {
                    await createCollection({
                        variables: {
                            input: {
                                isPrivate: formIsPrivate,
                                parentId: formParentId || undefined,
                                inheritFilters: formInheritFilters,
                                filters: collectionFilterInput(formFilters, data?.collectionFilters ?? []),
                                customFields: customFieldInputFromValues(
                                    collectionCustomFields,
                                    customFieldValues,
                                ),
                                translations: [
                                    {
                                        languageCode,
                                        name,
                                        slug: code,
                                        description: '',
                                        customFields: localizedCustomFieldInputFromValues(
                                            collectionCustomFields,
                                            customFieldValues,
                                            languageCode,
                                        ),
                                    },
                                ],
                            },
                        },
                    });
                }
            } else if (activeTab === 'OPTION_TEMPLATES') {
                if (editingItem && 'options' in editingItem) {
                    await updateOptionGroup({
                        variables: {
                            input: {
                                id: editingItem.id,
                                code,
                                translations: [{ languageCode, name }],
                            },
                        },
                    });
                    await syncOptionValues(editingItem, values, sensitiveContext);
                } else {
                    await createOptionGroup({
                        variables: {
                            input: {
                                code,
                                translations: [{ languageCode, name }],
                                options: values.map((value, index) => ({
                                    code: toCode(value, 'option', index),
                                    translations: [{ languageCode, name: value }],
                                })),
                            },
                        },
                    });
                }
            } else if (editingItem && 'values' in editingItem) {
                await updateFacet({
                    variables: {
                        input: {
                            id: editingItem.id,
                            code,
                            isPrivate: formIsPrivate,
                            translations: [{ languageCode, name }],
                        },
                    },
                });
                await syncFacetValues(editingItem, values, sensitiveContext);
            } else {
                await createFacet({
                    variables: {
                        input: {
                            code,
                            isPrivate: formIsPrivate,
                            translations: [{ languageCode, name }],
                            values: values.map((value, index) => ({
                                code: toCode(value, 'value', index),
                                translations: [{ languageCode, name: value }],
                            })),
                        },
                    },
                });
            }

            await refetch();
            setIsEditorOpen(false);
            setEditingItem(null);
            showNotice(`${editingItem ? '已保存' : '已创建'}《${name}》`);
        } catch (saveError) {
            showError(toUserFacingError(saveError, '保存失败，请稍后重试'));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (item: EditableItem) => {
        const detail =
            activeTab === 'CATEGORIES'
                ? '删除分类会同时删除其所有子分类，请确认该分类不再使用。'
                : '若数据已被商品使用，Vendure 会拒绝删除，不会强制破坏关联。';
        const confirmation = await requestConfirmation({
            title: `删除《${item.name}》？`,
            description: detail,
            confirmLabel: '确认删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        const context = sensitiveActionContext(confirmation.currentPassword ?? '');
        setActionError('');
        try {
            if (activeTab === 'CATEGORIES' && 'slug' in item) {
                const result = await deleteCollection({ variables: { id: item.id }, context });
                deletionSucceeded(result.data?.deleteCollection);
            } else if (activeTab === 'OPTION_TEMPLATES' && 'options' in item) {
                const result = await deleteOptionGroup({ variables: { id: item.id, force: false }, context });
                deletionSucceeded(result.data?.deleteProductOptionGroup);
            } else if ('values' in item) {
                const result = await deleteFacet({ variables: { id: item.id, force: false }, context });
                deletionSucceeded(result.data?.deleteFacet);
            }
            await refetch();
            showNotice(`已删除《${item.name}》`);
        } catch (deleteError) {
            showError(toUserFacingError(deleteError, '删除失败，请稍后重试'));
        }
    };

    const renderCollection = (node: CollectionTreeNode, depth = 0) => {
        const isTopLevel = depth === 0;
        const hasChildren = node.children.length > 0;
        const isExpanded = !isTopLevel || visibleExpandedCollectionIds.has(node.id);

        return (
            <div key={node.id} className="space-y-2">
                <div
                    className={`flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white ${isTopLevel ? 'p-4 shadow-2xs' : 'p-3.5'}`}
                    style={{ marginLeft: Math.min(depth, 3) * 20 }}
                >
                    <div className="flex min-w-0 items-center gap-3">
                        {isTopLevel && hasChildren ? (
                            <button
                                type="button"
                                onClick={() => toggleCollection(node.id)}
                                aria-expanded={isExpanded}
                                aria-controls={`collection-children-${node.id}`}
                                aria-label={`${isExpanded ? '收起' : '展开'}一级分类 ${node.name}`}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                            >
                                {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                ) : (
                                    <ChevronRight className="h-4 w-4" />
                                )}
                            </button>
                        ) : isTopLevel ? (
                            <span className="h-8 w-8 shrink-0" aria-hidden="true" />
                        ) : null}
                        <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isTopLevel ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}
                        >
                            <FolderTree className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-bold text-slate-900">{node.name}</span>
                                {node.isPrivate && (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                                        内部分类
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                                <span className="truncate font-mono">/{node.slug}</span>
                                {isTopLevel && hasChildren && <span>{node.children.length} 个子分类</span>}
                            </div>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 sm:gap-3">
                        <span className="hidden text-xs text-slate-500 sm:inline">
                            <strong className="font-mono text-slate-800">{node.productVariantCount}</strong>{' '}
                            个 SKU
                        </span>
                        <button
                            type="button"
                            onClick={() => openEditor(node)}
                            className="p-1.5 text-slate-400 hover:text-blue-600"
                            aria-label={`编辑分类 ${node.name}`}
                        >
                            <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDelete(node)}
                            className="p-1.5 text-slate-400 hover:text-rose-600"
                            aria-label={`删除分类 ${node.name}`}
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
                {hasChildren && isExpanded && (
                    <div id={`collection-children-${node.id}`} className="space-y-2">
                        {node.children.map(child => renderCollection(child, depth + 1))}
                    </div>
                )}
            </div>
        );
    };

    const tabCount =
        activeTab === 'CATEGORIES'
            ? collections.length
            : activeTab === 'OPTION_TEMPLATES'
              ? optionGroups.length
              : facets.length;

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 bg-white px-5 py-5 shadow-2xs sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div>
                    <h1 className="text-xl font-bold text-slate-900">分类与属性</h1>
                    <p className="mt-1 text-xs text-slate-500">
                        集中管理 Vendure 商品分类、通用规格模板与前台筛选属性
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => refetch()}
                        disabled={loading}
                        className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
                    </button>
                    <button
                        type="button"
                        onClick={() => openEditor()}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
                    >
                        <Plus className="h-4 w-4" />
                        {activeTab === 'CATEGORIES'
                            ? '新增分类'
                            : activeTab === 'OPTION_TEMPLATES'
                              ? '新增规格模板'
                              : '新增筛选属性'}
                    </button>
                </div>
            </div>

            <div className="scrollbar-hidden flex shrink-0 gap-6 overflow-x-auto border-b border-slate-200 bg-white px-5 text-xs font-bold sm:px-8">
                {(
                    [
                        [
                            'CATEGORIES',
                            FolderTree,
                            `商品分类树 (${data?.collections.totalItems ?? collections.length})`,
                        ],
                        [
                            'OPTION_TEMPLATES',
                            Sliders,
                            `规格选项模板 (${data?.productOptionGroups.totalItems ?? optionGroups.length})`,
                        ],
                        ['FACETS', Tag, `筛选属性与标签 (${data?.facets.totalItems ?? facets.length})`],
                    ] as const
                ).map(([key, Icon, label]) => (
                    <button
                        type="button"
                        key={key}
                        onClick={() => setActiveTab(key)}
                        className={`flex items-center gap-1.5 border-b-2 py-3.5 transition-colors ${activeTab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                    >
                        <Icon className="h-3.5 w-3.5" /> {label}
                    </button>
                ))}
            </div>

            <div className="mx-auto w-full max-w-none flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
                {notification && (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-medium text-emerald-800">
                        <CheckCircle2 className="h-4 w-4" />
                        {notification}
                    </div>
                )}
                {(error || actionError) && (
                    <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <span>
                                {actionError || toUserFacingError(error, '分类数据读取失败，请稍后重试')}
                            </span>
                        </div>
                        {error && (
                            <button
                                type="button"
                                onClick={() => refetch()}
                                className="rounded bg-rose-600 px-3 py-1 font-bold text-white"
                            >
                                重试
                            </button>
                        )}
                    </div>
                )}
                {loading && !data ? (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
                        {[1, 2, 3, 4].map(item => (
                            <div key={item} className="h-16 animate-pulse rounded-xl bg-slate-100" />
                        ))}
                    </div>
                ) : tabCount === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-16 text-center text-xs text-slate-400">
                        当前渠道尚未配置此类数据，点击右上角开始创建。
                    </div>
                ) : activeTab === 'CATEGORIES' ? (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                            <div>
                                <div className="text-xs font-bold text-slate-800">一级分类</div>
                                <div className="mt-0.5 text-[11px] text-slate-400">
                                    共 {collectionTree.length} 个，展开后查看下级分类
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={expandAllCollections}
                                    disabled={allTopLevelCollectionsExpanded}
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-default disabled:opacity-40"
                                >
                                    全部展开
                                </button>
                                <button
                                    type="button"
                                    onClick={collapseAllCollections}
                                    disabled={allTopLevelCollectionsCollapsed}
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-default disabled:opacity-40"
                                >
                                    全部收起
                                </button>
                            </div>
                        </div>
                        <div className="space-y-3 bg-slate-50/50 p-3 sm:p-5">
                            {collectionTree.map(node => renderCollection(node))}
                        </div>
                    </div>
                ) : activeTab === 'OPTION_TEMPLATES' ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {optionGroups.map(group => (
                            <div
                                key={group.id}
                                className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
                            >
                                <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                                    <div>
                                        <div className="text-sm font-bold text-slate-900">{group.name}</div>
                                        <div className="font-mono text-[11px] text-slate-400">
                                            {group.code} · {group.productCount} 个商品使用
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            type="button"
                                            onClick={() => openEditor(group)}
                                            aria-label={`编辑规格模板：${group.name}`}
                                            className="p-1.5 text-slate-400 hover:text-blue-600"
                                        >
                                            <Edit3 className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(group)}
                                            aria-label={`删除规格模板：${group.name}`}
                                            className="p-1.5 text-slate-400 hover:text-rose-600"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {group.options.map(option => (
                                        <span
                                            key={option.id}
                                            className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
                                        >
                                            {option.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {facets.map(facet => (
                            <div
                                key={facet.id}
                                className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
                            >
                                <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                                    <div>
                                        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                            {facet.name}
                                            {facet.isPrivate && (
                                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                                    内部属性
                                                </span>
                                            )}
                                        </div>
                                        <div className="font-mono text-[11px] text-slate-400">
                                            {facet.code}
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            type="button"
                                            onClick={() => openEditor(facet)}
                                            aria-label={`编辑筛选属性：${facet.name}`}
                                            className="p-1.5 text-slate-400 hover:text-blue-600"
                                        >
                                            <Edit3 className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(facet)}
                                            aria-label={`删除筛选属性：${facet.name}`}
                                            className="p-1.5 text-slate-400 hover:text-rose-600"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {facet.values.map(value => (
                                        <span
                                            key={value.id}
                                            className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-1 text-xs text-blue-700"
                                        >
                                            {value.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {isEditorOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs"
                    onClick={closeEditor}
                >
                    <AccessibleDialogSurface
                        accessibleName={editingItem ? '编辑目录数据' : '新增目录数据'}
                        onRequestClose={closeEditor}
                        className={`max-h-[92vh] w-full ${activeTab === 'CATEGORIES' ? 'max-w-4xl' : 'max-w-md'} space-y-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl`}
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-bold text-slate-900">
                                {editingItem ? '编辑' : '新增'}
                                {activeTab === 'CATEGORIES'
                                    ? '商品分类'
                                    : activeTab === 'OPTION_TEMPLATES'
                                      ? '规格模板'
                                      : '筛选属性'}
                            </h3>
                            <button
                                type="button"
                                onClick={closeEditor}
                                disabled={saving}
                                className="p-1 text-slate-400"
                                aria-label="关闭"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-bold text-slate-700">中文名称 *</label>
                            <input
                                value={formName}
                                onChange={event => setFormName(event.target.value)}
                                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                                autoFocus
                            />
                            <p className="mt-1 text-[10px] leading-4 text-slate-400">
                                英文由翻译引擎生成，并可在“多语言翻译”中复核。
                            </p>
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-bold text-slate-700">
                                {activeTab === 'CATEGORIES' ? 'Slug' : '编码 Code'}
                            </label>
                            <input
                                value={formCode}
                                onChange={event => setFormCode(event.target.value)}
                                placeholder="留空自动生成"
                                className="w-full rounded-lg border border-slate-300 p-2.5 font-mono text-xs outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        {activeTab === 'CATEGORIES' ? (
                            <>
                                <div>
                                    <label className="mb-1 block text-xs font-bold text-slate-700">
                                        上级分类
                                    </label>
                                    <select
                                        value={formParentId}
                                        onChange={event => setFormParentId(event.target.value)}
                                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs"
                                    >
                                        <option value="">设为顶级分类</option>
                                        {collections
                                            .filter(item => item.id !== editingItem?.id)
                                            .map(item => (
                                                <option key={item.id} value={item.id}>
                                                    {item.name}
                                                </option>
                                            ))}
                                    </select>
                                </div>
                                <CollectionFiltersEditor
                                    values={formFilters}
                                    definitions={data?.collectionFilters ?? []}
                                    inheritFilters={formInheritFilters}
                                    parentId={formParentId}
                                    onInheritFiltersChange={setFormInheritFilters}
                                    onChange={setFormFilters}
                                />
                                <DynamicCustomFieldsForm
                                    title="分类扩展字段"
                                    fields={collectionCustomFields}
                                    values={customFieldValues}
                                    onChange={setCustomFieldValues}
                                    disabled={saving}
                                />
                            </>
                        ) : (
                            <div>
                                <label className="mb-1 block text-xs font-bold text-slate-700">
                                    选项值（逗号或换行分隔）
                                </label>
                                <textarea
                                    value={formValues}
                                    onChange={event => setFormValues(event.target.value)}
                                    rows={4}
                                    placeholder="例如：红色，蓝色，黑色"
                                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <p className="mt-1 text-[10px] leading-4 text-slate-400">
                                    编辑时按当前顺序更新；已被商品使用的选项不会被强制删除。
                                </p>
                            </div>
                        )}
                        {activeTab !== 'OPTION_TEMPLATES' && (
                            <label className="flex items-center gap-2 text-xs text-slate-700">
                                <input
                                    type="checkbox"
                                    checked={formIsPrivate}
                                    onChange={event => setFormIsPrivate(event.target.checked)}
                                />
                                仅后台可见（不用于前台导航/筛选）
                            </label>
                        )}
                        {actionError && (
                            <div className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                                {actionError}
                            </div>
                        )}
                        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                            <button
                                type="button"
                                onClick={closeEditor}
                                disabled={saving}
                                className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                            >
                                {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}保存
                            </button>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}

function CollectionFiltersEditor({
    values,
    definitions,
    inheritFilters,
    parentId,
    onChange,
    onInheritFiltersChange,
}: {
    values: OperationValue[];
    definitions: OperationDefinition[];
    inheritFilters: boolean;
    parentId: string;
    onChange: (values: OperationValue[]) => void;
    onInheritFiltersChange: (value: boolean) => void;
}) {
    const [selectedCode, setSelectedCode] = useState(definitions[0]?.code ?? '');
    const [previewError, setPreviewError] = useState('');
    const [preview, previewState] = useLazyQuery<{
        previewCollectionVariants: {
            totalItems: number;
            items: Array<{
                id: string;
                sku: string;
                name: string;
                price: number;
                priceWithTax: number;
                product: { id: string; name: string };
            }>;
        };
    }>(PREVIEW_COLLECTION_VARIANTS, { fetchPolicy: 'no-cache' });

    const add = () => {
        const definition = definitions.find(item => item.code === selectedCode);
        if (!definition) return;
        onChange([
            ...values,
            {
                code: definition.code,
                arguments: definition.args.map(arg => ({
                    name: arg.name,
                    value: collectionDefaultArgValue(arg),
                })),
            },
        ]);
    };
    const runPreview = async () => {
        setPreviewError('');
        try {
            await preview({
                variables: {
                    input: {
                        parentId: parentId || undefined,
                        inheritFilters,
                        filters: collectionFilterInput(values, definitions),
                    },
                    options: { take: 20, sort: { name: 'ASC' } },
                },
            });
        } catch (cause) {
            setPreviewError(toUserFacingError(cause, '分类内容预览失败'));
        }
    };

    return (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h4 className="text-xs font-bold text-slate-800">集合筛选规则</h4>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        规则来自当前 Vendure 服务端注册的 CollectionFilter，可在保存前预览命中的 SKU。
                    </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                        type="checkbox"
                        checked={inheritFilters}
                        onChange={event => onInheritFiltersChange(event.target.checked)}
                    />
                    继承上级筛选
                </label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
                <select
                    value={selectedCode}
                    onChange={event => setSelectedCode(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                >
                    <option value="">请选择筛选器</option>
                    {definitions.map(definition => (
                        <option key={definition.code} value={definition.code}>
                            {definition.description || definition.code}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    onClick={add}
                    disabled={!selectedCode}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold disabled:opacity-40"
                >
                    <Plus className="mr-1 inline h-3.5 w-3.5" />
                    添加规则
                </button>
            </div>
            <div className="space-y-3">
                {values.map((operation, operationIndex) => {
                    const definition = definitions.find(item => item.code === operation.code);
                    return (
                        <article
                            key={`${operation.code}-${operationIndex}`}
                            className="rounded-lg border border-slate-200 bg-white p-4"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <strong className="text-xs text-slate-800">
                                        {definition?.description || operation.code}
                                    </strong>
                                    <code className="ml-2 text-[10px] text-slate-400">{operation.code}</code>
                                </div>
                                <button
                                    type="button"
                                    onClick={() =>
                                        onChange(values.filter((_, index) => index !== operationIndex))
                                    }
                                    className="text-rose-600"
                                    aria-label={`删除筛选规则 ${operation.code}`}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                {(definition?.args ?? []).map(arg => (
                                    <CollectionFilterArgument
                                        key={arg.name}
                                        definition={arg}
                                        value={
                                            operation.arguments.find(item => item.name === arg.name)?.value ??
                                            ''
                                        }
                                        onChange={value =>
                                            onChange(
                                                values.map((item, index) =>
                                                    index === operationIndex
                                                        ? {
                                                              ...item,
                                                              arguments: item.arguments.map(argument =>
                                                                  argument.name === arg.name
                                                                      ? { ...argument, value }
                                                                      : argument,
                                                              ),
                                                          }
                                                        : item,
                                                ),
                                            )
                                        }
                                    />
                                ))}
                            </div>
                        </article>
                    );
                })}
                {!values.length && (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-xs text-slate-500">
                        未配置筛选规则；集合本身不会自动命中商品。
                    </p>
                )}
            </div>
            {previewError && (
                <p className="text-xs text-rose-700" role="alert">
                    {previewError}
                </p>
            )}
            {previewState.data && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <strong className="text-xs text-blue-900">
                        命中 {previewState.data.previewCollectionVariants.totalItems} 个 SKU
                    </strong>
                    <ul className="mt-2 grid gap-1 text-[10px] text-blue-800 sm:grid-cols-2">
                        {previewState.data.previewCollectionVariants.items.map(item => (
                            <li key={item.id} className="truncate">
                                {item.product.name} · {item.name} · {item.sku}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <button
                type="button"
                onClick={() => void runPreview()}
                disabled={previewState.loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
                <Eye className="h-3.5 w-3.5" />
                {previewState.loading ? '预览中…' : '预览集合内容'}
            </button>
        </section>
    );
}

function CollectionFilterArgument({
    definition,
    value,
    onChange,
}: {
    definition: OperationArgDefinition;
    value: string;
    onChange: (value: string) => void;
}) {
    const label = definition.label || definition.name;
    return (
        <label className="text-xs font-bold text-slate-600">
            {label}
            {definition.required ? ' *' : ''}
            {definition.type.toLowerCase() === 'boolean' && !definition.list ? (
                <select
                    value={value}
                    onChange={event => onChange(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal"
                >
                    <option value="true">true</option>
                    <option value="false">false</option>
                </select>
            ) : (
                <input
                    value={value}
                    onChange={event => onChange(event.target.value)}
                    placeholder={definition.list ? '["value-1"]' : definition.type}
                    className={`mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal ${definition.list ? 'font-mono' : ''}`}
                />
            )}
            {definition.description && (
                <small className="mt-1 block font-normal leading-4 text-slate-400">
                    {definition.description}
                    {definition.list ? ' · JSON 数组' : ''}
                </small>
            )}
        </label>
    );
}

function collectionFilterInput(values: OperationValue[], definitions: OperationDefinition[]) {
    return values.map(operation => {
        const definition = definitions.find(item => item.code === operation.code);
        if (!definition) throw new Error(`服务端未注册集合筛选器 ${operation.code}`);
        return {
            code: operation.code,
            arguments: definition.args.map(arg => {
                const value = operation.arguments.find(item => item.name === arg.name)?.value.trim() ?? '';
                if (arg.required && !value)
                    throw new Error(
                        `${definition.description || operation.code} 的 ${arg.label || arg.name} 不能为空`,
                    );
                if (arg.list && value) {
                    const parsed = JSON.parse(value) as unknown;
                    if (!Array.isArray(parsed)) throw new Error(`${arg.label || arg.name} 必须是 JSON 数组`);
                }
                if (
                    ['int', 'float', 'money'].includes(arg.type.toLowerCase()) &&
                    value &&
                    !Number.isFinite(Number(value))
                )
                    throw new Error(`${arg.label || arg.name} 必须是数字`);
                return { name: arg.name, value };
            }),
        };
    });
}

function collectionDefaultArgValue(arg: OperationArgDefinition) {
    if (arg.defaultValue == null)
        return arg.type.toLowerCase() === 'boolean' ? 'false' : arg.list ? '[]' : '';
    return typeof arg.defaultValue === 'string' ? arg.defaultValue : JSON.stringify(arg.defaultValue);
}
