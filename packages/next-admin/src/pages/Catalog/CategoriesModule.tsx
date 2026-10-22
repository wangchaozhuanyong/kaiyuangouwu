import { useMutation } from '@apollo/client/react';
import {
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Edit3,
    Eye,
    FolderTree,
    GripVertical,
    Plus,
    RefreshCw,
    Search,
    Sliders,
    Tag,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { sensitiveActionContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import {
    ConfigurableOperationField,
    ConfigurableOperationTechnicalDetails,
} from '../../components/ConfigurableOperationFields';
import { FeatureHelpButton } from '../../components/FeatureHelp';
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
    DELETE_COLLECTIONS,
    DELETE_FACET,
    DELETE_FACET_VALUE,
    DELETE_OPTION_GROUP,
    DELETE_PRODUCT_OPTION,
    GET_CATALOG_TAXONOMY,
    MOVE_COLLECTION,
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
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminLazyQuery as useLazyQuery, useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { useStandaloneAdminPage } from '../../hooks/use-standalone-admin-page';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
import { useUrlTab } from '../../hooks/use-url-tab';
import {
    configurableArgumentLabel,
    configurableOperationLabel,
    serializeConfigurableListValue,
} from '../../utils/configurable-operation-localization';
import { getLocalizedEntityTranslation } from '../../utils/localized-entity-display';
import { mergeQueryLists } from '../../utils/merge-query-lists';
import { selectQueryFields } from '../../utils/select-query-fields';
import { toUserFacingError } from '../../utils/user-facing-error';
import { SeoEditorLink } from '../Storefront/SeoEditorLink';
import { CatalogTemplateLibraryPanel } from './CatalogTemplateLibraryPanel';
import { CategoryImageField, type CategoryImageAsset } from './CategoryImageField';
import { OptionGroupProductsDialog } from './OptionGroupProductsDialog';
import { SYSTEM_IMPORT_OPTION_GROUP_CODE_PREFIX } from './catalog-option-groups';

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
    featuredAsset: CategoryImageAsset | null;
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
const OPTION_GROUP_PAGE_SIZE = 20;

const getSourceTranslation = (item: { translations: TranslationItem[] }) =>
    getLocalizedEntityTranslation(item.translations, SOURCE_LANGUAGE_CODE);

const getSourceName = (item: { name: string; translations: TranslationItem[] }) =>
    getSourceTranslation(item)?.name ?? '';

const collectionEditorSourceSignature = (item: CollectionItem) =>
    JSON.stringify({
        id: item.id,
        translations: item.translations,
        featuredAsset: item.featuredAsset,
        isPrivate: item.isPrivate,
        parentId: item.parentId,
        inheritFilters: item.inheritFilters,
        filters: item.filters,
        customFields: item.customFields,
    });

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
    const standalonePage = useStandaloneAdminPage();
    const requestConfirmation = useConfirmDialog();
    const collectionCustomFields = useCustomFieldDefinitions('Collection');
    const taxonomyDocument = useMemo(
        () => addCustomFieldsToDocument(GET_CATALOG_TAXONOMY, 'Collection', collectionCustomFields),
        [collectionCustomFields],
    );
    const [activeTab, setActiveTab] = useUrlTab<ActiveTab>(CATEGORY_TABS, 'categories');
    const { hasAnyPermission } = useAdminPermissions();
    const permissionResource =
        activeTab === 'CATEGORIES' ? 'Collection' : activeTab === 'OPTION_TEMPLATES' ? 'Product' : 'Facet';
    const canCreate = hasAnyPermission(['CreateCatalog', `Create${permissionResource}`]);
    const canUpdate = hasAnyPermission(['UpdateCatalog', `Update${permissionResource}`]);
    const canDelete = hasAnyPermission(['DeleteCatalog', `Delete${permissionResource}`]);
    const [notification, setNotification] = useState('');
    const noticeTimeout = useRef<number | undefined>(undefined);
    useEffect(() => () => window.clearTimeout(noticeTimeout.current), []);
    const [actionError, setActionError] = useState('');
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<EditableItem | null>(null);
    const [formName, setFormName] = useState('');
    const [formSourceDescription, setFormSourceDescription] = useState('');
    const [formEnglishName, setFormEnglishName] = useState('');
    const [formEnglishDescription, setFormEnglishDescription] = useState('');
    const [formCode, setFormCode] = useState('');
    const [formValues, setFormValues] = useState('');
    const [formParentId, setFormParentId] = useState('');
    const [formFeaturedAsset, setFormFeaturedAsset] = useState<CategoryImageAsset | null>(null);
    const [formIsPrivate, setFormIsPrivate] = useState(false);
    const [formInheritFilters, setFormInheritFilters] = useState(true);
    const [formFilters, setFormFilters] = useState<OperationValue[]>([]);
    const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueMap>({});
    const [saving, setSaving] = useState(false);
    const [initialEditorDraft, setInitialEditorDraft] = useState('');
    const [editorScope, setEditorScope] = useState<string | undefined>(undefined);
    const [expandedCollectionIds, setExpandedCollectionIds] = useState<Set<string>>(() => new Set());
    const [selectedCollectionIds, setSelectedCollectionIds] = useState<Set<string>>(() => new Set());
    const [bulkDeletingCollections, setBulkDeletingCollections] = useState(false);
    const [optionGroupSearch, setOptionGroupSearch] = useState('');
    const [optionGroupPage, setOptionGroupPage] = useState(0);
    const [usageGroup, setUsageGroup] = useState<OptionGroupItem | null>(null);

    const { data, loading, error, refetch, fetchMore } = useQuery<CatalogTaxonomyData>(
        standalonePage
            ? selectQueryFields(taxonomyDocument, [
                  'activeChannel',
                  ...(activeTab === 'CATEGORIES'
                      ? ['collections', 'collectionFilters']
                      : activeTab === 'OPTION_TEMPLATES'
                        ? ['productOptionGroups']
                        : ['facets']),
              ])
            : taxonomyDocument,
        {
            variables: {
                collectionOptions: {
                    topLevelOnly: false,
                    skip: 0,
                    take: 100,
                    sort: { position: 'ASC', id: 'ASC' },
                },
                optionGroupOptions: {
                    skip: 0,
                    take: 100,
                    sort: { updatedAt: 'DESC', id: 'DESC' },
                    filter: { code: { notContains: SYSTEM_IMPORT_OPTION_GROUP_CODE_PREFIX } },
                },
                facetOptions: { skip: 0, take: 100, sort: { updatedAt: 'DESC', id: 'DESC' } },
            },

            notifyOnNetworkStatusChange: true,
        },
    );

    useEffect(() => {
        if (!data || loading || error) return;
        const collectionCount = data.collections?.items.length ?? 0;
        const optionGroupCount = data.productOptionGroups?.items.length ?? 0;
        const facetCount = data.facets?.items.length ?? 0;
        if (
            collectionCount >= (data.collections?.totalItems ?? 0) &&
            optionGroupCount >= (data.productOptionGroups?.totalItems ?? 0) &&
            facetCount >= (data.facets?.totalItems ?? 0)
        )
            return;
        void fetchMore({
            variables: {
                collectionOptions: {
                    topLevelOnly: false,
                    skip: collectionCount,
                    take: 100,
                    sort: { position: 'ASC', id: 'ASC' },
                },
                optionGroupOptions: {
                    skip: optionGroupCount,
                    take: 100,
                    sort: { updatedAt: 'DESC', id: 'DESC' },
                    filter: { code: { notContains: SYSTEM_IMPORT_OPTION_GROUP_CODE_PREFIX } },
                },
                facetOptions: { skip: facetCount, take: 100, sort: { updatedAt: 'DESC', id: 'DESC' } },
            },
            updateQuery: (previous, { fetchMoreResult }) =>
                mergeQueryLists(previous, fetchMoreResult, ['collections', 'productOptionGroups', 'facets']),
        }).catch(fetchError => {
            setActionError(toUserFacingError(fetchError, '分类与属性数据未能全部加载，请点击刷新重试'));
        });
    }, [data, error, fetchMore, loading]);

    const [createCollection] = useMutation(CREATE_COLLECTION);
    const [updateCollection] = useMutation(UPDATE_COLLECTION);
    const [deleteCollection] = useMutation<{ deleteCollection: { result: string; message?: string } }>(
        DELETE_COLLECTION,
    );
    const [deleteCollections] = useMutation<{
        deleteCollections: Array<{ result: string; message?: string }>;
    }>(DELETE_COLLECTIONS);
    const [moveCollection] = useMutation(MOVE_COLLECTION);
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

    type Placement = 'before' | 'after';
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{ id: string; placement: Placement } | null>(null);
    const [isReordering, setIsReordering] = useState(false);
    const [optimisticCollections, setOptimisticCollections] = useState<CollectionItem[] | null>(null);
    const dragSourceRef = useRef<{ id: string; parentId: string | null } | null>(null);
    const keyboardHandleRef = useRef<HTMLButtonElement | null>(null);

    const serverCollections = data?.collections?.items ?? EMPTY_COLLECTIONS;
    const collections = optimisticCollections ?? serverCollections;
    const optionGroups = data?.productOptionGroups?.items ?? EMPTY_OPTION_GROUPS;
    const facets = data?.facets?.items ?? EMPTY_FACETS;

    useEffect(() => {
        if (isReordering || !keyboardHandleRef.current) return;
        const handle = keyboardHandleRef.current;
        keyboardHandleRef.current = null;
        if (handle.isConnected && document.activeElement === document.body) handle.focus();
    }, [isReordering, collections]);
    useEffect(() => {
        // oxlint-disable-next-line react/set-state-in-effect
        setExpandedCollectionIds(new Set());
        // oxlint-disable-next-line react/set-state-in-effect
        setSelectedCollectionIds(new Set());
    }, [data?.activeChannel.id]);
    // 中文来源固定为简体中文；已有英文修订单独沿用原生人工翻译保护。
    const languageCode = SOURCE_LANGUAGE_CODE;

    const serializedEditorDraft = JSON.stringify({
        name: formName,
        sourceDescription: formSourceDescription,
        englishName: formEnglishName,
        englishDescription: formEnglishDescription,
        code: formCode,
        values: formValues,
        parentId: formParentId,
        featuredAssetId: formFeaturedAsset?.id ?? null,
        isPrivate: formIsPrivate,
        inheritFilters: formInheritFilters,
        filters: formFilters,
        customFields: customFieldValues,
    });
    const categoryEditorDirty =
        isEditorOpen && activeTab === 'CATEGORIES' && serializedEditorDraft !== initialEditorDraft;
    useUnsavedChangesWarning(
        categoryEditorDirty || (isEditorOpen && activeTab === 'CATEGORIES' && saving),
        '分类还有未保存的修改，确定放弃吗？',
    );
    const currentEditingCollection =
        editingItem && 'slug' in editingItem
            ? collections.find(item => item.id === editingItem.id)
            : undefined;
    const categorySourceChanged = Boolean(
        isEditorOpen &&
        activeTab === 'CATEGORIES' &&
        (editorScope !== data?.activeChannel.id ||
            (editingItem &&
                'slug' in editingItem &&
                (!currentEditingCollection ||
                    collectionEditorSourceSignature(currentEditingCollection) !==
                        collectionEditorSourceSignature(editingItem)))),
    );

    const matchingOptionGroups = useMemo(() => {
        const search = optionGroupSearch.trim().toLocaleLowerCase();
        if (!search) return optionGroups;
        return optionGroups.filter(group =>
            [group.name, group.code, ...group.options.map(option => option.name)].some(value =>
                value.toLocaleLowerCase().includes(search),
            ),
        );
    }, [optionGroupSearch, optionGroups]);
    const optionGroupPageCount = Math.max(1, Math.ceil(matchingOptionGroups.length / OPTION_GROUP_PAGE_SIZE));
    const visibleOptionGroupPage = Math.min(optionGroupPage, optionGroupPageCount - 1);
    const visibleOptionGroups = matchingOptionGroups.slice(
        visibleOptionGroupPage * OPTION_GROUP_PAGE_SIZE,
        (visibleOptionGroupPage + 1) * OPTION_GROUP_PAGE_SIZE,
    );

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

    const visibleExpandedCollectionIds = expandedCollectionIds;
    const allTopLevelCollectionsExpanded =
        collectionTree.length > 0 &&
        collectionTree.every(collection => visibleExpandedCollectionIds.has(collection.id));
    const allTopLevelCollectionsCollapsed = collectionTree.every(
        collection => !visibleExpandedCollectionIds.has(collection.id),
    );

    const toggleCollection = (collectionId: string) => {
        setExpandedCollectionIds(current => {
            const next = new Set(current);
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
        window.clearTimeout(noticeTimeout.current);
        noticeTimeout.current = window.setTimeout(() => setNotification(''), 3500);
    };

    const showError = (message: string) => {
        setActionError(message);
        setNotification('');
    };

    const clearDrag = () => {
        dragSourceRef.current = null;
        setDraggingId(null);
        setDropTarget(null);
    };

    const placementAt = (event: DragEvent<HTMLDivElement>): Placement => {
        const rect = event.currentTarget.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    };

    const handleReorder = async (
        sourceId: string,
        targetId: string,
        placement: Placement,
        siblings: CollectionTreeNode[],
    ) => {
        if (!canUpdate || sourceId === targetId || isReordering) return;
        const sourceNode = siblings.find(item => item.id === sourceId);
        if (!sourceNode) return;

        const remaining = siblings.filter(item => item.id !== sourceId);
        const targetIdx = remaining.findIndex(item => item.id === targetId);
        if (targetIdx === -1) return;

        const finalIndex = placement === 'before' ? targetIdx : targetIdx + 1;
        const currentIdx = siblings.findIndex(item => item.id === sourceId);
        if (finalIndex === currentIdx) return;

        const newSiblings = [...remaining];
        newSiblings.splice(finalIndex, 0, sourceNode);
        const updatedMap = new Map(newSiblings.map((item, idx) => [item.id, idx]));

        setOptimisticCollections(prev => {
            const base = prev ?? serverCollections;
            return base.map(item => {
                const newPos = updatedMap.get(item.id);
                return newPos !== undefined ? { ...item, position: newPos } : item;
            });
        });

        const rootParentId = collections.find(c => c.parentId)?.parentId || '1';
        const targetParentId = sourceNode.parentId || rootParentId;

        try {
            setIsReordering(true);
            await moveCollection({
                variables: {
                    input: {
                        collectionId: sourceId,
                        parentId: targetParentId,
                        index: finalIndex,
                    },
                },
            });
            await refetch();
            setOptimisticCollections(null);
            showNotice(`已调整分类《${sourceNode.name}》排序`);
        } catch (moveError) {
            setOptimisticCollections(null);
            await refetch();
            showError(toUserFacingError(moveError, '分类排序调整失败，请稍后重试'));
        } finally {
            setIsReordering(false);
        }
    };

    const openEditor = (item: EditableItem | null = null) => {
        if (item ? !canUpdate : !canCreate) return;
        setEditingItem(item);
        const sourceTranslation = item ? getSourceTranslation(item) : undefined;
        const englishTranslation =
            item && 'slug' in item ? getLocalizedEntityTranslation(item.translations, 'en') : undefined;
        const name = item ? getSourceName(item) : '';
        const code = item ? ('slug' in item ? sourceTranslation?.slug || item.slug : item.code) : '';
        const values =
            item && 'options' in item
                ? item.options.map(getSourceName).join('，')
                : item && 'values' in item
                  ? item.values.map(getSourceName).join('，')
                  : '';
        const parentId = item && 'parentId' in item ? (item.parentId ?? '') : '';
        const featuredAsset = item && 'slug' in item ? (item.featuredAsset ?? null) : null;
        const isPrivate = item && 'isPrivate' in item ? item.isPrivate : false;
        const inheritFilters = item && 'filters' in item ? item.inheritFilters : true;
        const filters =
            item && 'filters' in item
                ? item.filters.map(filter => ({ code: filter.code, arguments: filter.args }))
                : [];
        const customFields =
            item && 'filters' in item
                ? customFieldValuesFromEntity(collectionCustomFields, item.customFields, item.translations)
                : customFieldValuesFromEntity(collectionCustomFields, null);
        setFormName(name);
        setFormSourceDescription(sourceTranslation?.description ?? '');
        setFormEnglishName(englishTranslation?.name ?? '');
        setFormEnglishDescription(englishTranslation?.description ?? '');
        setFormCode(code);
        setFormValues(values);
        setFormParentId(parentId);
        setFormFeaturedAsset(featuredAsset);
        setFormIsPrivate(isPrivate);
        setFormInheritFilters(inheritFilters);
        setFormFilters(filters);
        setCustomFieldValues(customFields);
        setInitialEditorDraft(
            JSON.stringify({
                name,
                sourceDescription: sourceTranslation?.description ?? '',
                englishName: englishTranslation?.name ?? '',
                englishDescription: englishTranslation?.description ?? '',
                code,
                values,
                parentId,
                featuredAssetId: featuredAsset?.id ?? null,
                isPrivate,
                inheritFilters,
                filters,
                customFields,
            }),
        );
        setEditorScope(data?.activeChannel.id);
        setActionError('');
        setIsEditorOpen(true);
    };

    const closeEditor = async () => {
        if (saving) return;
        if (
            categoryEditorDirty &&
            !(await requestConfirmation({
                title: '放弃分类修改？',
                description: '尚未保存的中文、英文及分类设置将被放弃。',
                confirmLabel: '放弃修改',
            }))
        )
            return;
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
        if (editingItem ? !canUpdate : !canCreate) return;
        if (categorySourceChanged) {
            showError('分类内容已更新或当前店铺已切换，请关闭编辑并重新打开后保存。');
            return;
        }
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
        const previousValues =
            editingItem &&
            ('options' in editingItem
                ? editingItem.options
                : 'values' in editingItem
                  ? editingItem.values
                  : null);
        if (
            previousValues &&
            ((values.length > previousValues.length && !canCreate) ||
                (values.length < previousValues.length && !canDelete))
        ) {
            showError('当前岗位不能新增或删除规格、属性值，请保留原有数量或联系管理员。');
            return;
        }
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
                    const englishTranslation = getLocalizedEntityTranslation(editingItem.translations, 'en');
                    // Blank fields retain existing English. Submit changed English only so an ordinary
                    // Chinese save does not convert automatic translations into manual edits.
                    const englishName =
                        formEnglishName === englishTranslation?.name
                            ? englishTranslation.name
                            : formEnglishName.trim() || englishTranslation?.name || '';
                    const englishDescription =
                        formEnglishDescription === englishTranslation?.description
                            ? englishTranslation.description
                            : formEnglishDescription.trim() || englishTranslation?.description || '';
                    const englishChanges = {
                        ...(englishTranslation && englishName !== englishTranslation.name
                            ? { name: englishName }
                            : {}),
                        ...(englishTranslation &&
                        englishDescription !== (englishTranslation.description ?? '')
                            ? { description: englishDescription }
                            : {}),
                    };
                    const englishChanged = Object.keys(englishChanges).length > 0;
                    if (englishChanged && /\p{Script=Han}/u.test(Object.values(englishChanges).join(''))) {
                        showError('请填写不含中文的英文名称与描述；留空会保留原文。');
                        return;
                    }
                    const sourceTranslation = getSourceTranslation(editingItem);
                    const sourceDescription =
                        formSourceDescription === (sourceTranslation?.description ?? '')
                            ? (sourceTranslation?.description ?? '')
                            : formSourceDescription.trim() || sourceTranslation?.description || '';
                    const chineseChanged =
                        formName !== getSourceName(editingItem) ||
                        formCode !== (sourceTranslation?.slug || editingItem.slug) ||
                        sourceDescription !== (sourceTranslation?.description ?? '') ||
                        JSON.stringify(customFieldValues) !==
                            JSON.stringify(
                                customFieldValuesFromEntity(
                                    collectionCustomFields,
                                    editingItem.customFields,
                                    editingItem.translations,
                                ),
                            );
                    const otherFormChanged =
                        chineseChanged ||
                        (formFeaturedAsset?.id ?? null) !== (editingItem.featuredAsset?.id ?? null) ||
                        formIsPrivate !== editingItem.isPrivate ||
                        formParentId !== (editingItem.parentId ?? '') ||
                        formInheritFilters !== editingItem.inheritFilters ||
                        JSON.stringify(formFilters) !==
                            JSON.stringify(
                                editingItem.filters.map(filter => ({
                                    code: filter.code,
                                    arguments: filter.args,
                                })),
                            );
                    if (!englishChanged && !otherFormChanged) {
                        setIsEditorOpen(false);
                        setEditingItem(null);
                        showNotice('没有需要保存的修改');
                        return;
                    }
                    await updateCollection({
                        variables: {
                            input: {
                                id: editingItem.id,
                                ...(otherFormChanged
                                    ? {
                                          featuredAssetId: formFeaturedAsset?.id ?? null,
                                          isPrivate: formIsPrivate,
                                          parentId: formParentId || null,
                                          inheritFilters: formInheritFilters,
                                          filters: collectionFilterInput(
                                              formFilters,
                                              data?.collectionFilters ?? [],
                                          ),
                                          customFields: customFieldInputFromValues(
                                              collectionCustomFields,
                                              customFieldValues,
                                          ),
                                      }
                                    : {}),
                                translations: [
                                    ...(!englishChanged || chineseChanged
                                        ? [
                                              {
                                                  languageCode,
                                                  name,
                                                  slug: code,
                                                  description: sourceDescription,
                                                  customFields: localizedCustomFieldInputFromValues(
                                                      collectionCustomFields,
                                                      customFieldValues,
                                                      languageCode,
                                                  ),
                                              },
                                          ]
                                        : []),
                                    ...(englishChanged
                                        ? [
                                              {
                                                  languageCode: 'en',
                                                  ...englishChanges,
                                              },
                                          ]
                                        : []),
                                ],
                            },
                        },
                    });
                } else {
                    await createCollection({
                        variables: {
                            input: {
                                featuredAssetId: formFeaturedAsset?.id ?? null,
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
                                        description: formSourceDescription.trim(),
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

            if (activeTab === 'CATEGORIES') {
                setIsEditorOpen(false);
                setEditingItem(null);
                try {
                    await refetch();
                    showNotice(`${editingItem ? '已保存' : '已创建'}《${name}》`);
                } catch (readError) {
                    showError(
                        `已保存《${name}》，但列表更新失败。${toUserFacingError(readError, '请刷新本页重试读取')}`,
                    );
                }
                return;
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
        if (!canDelete) return;
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

    const toggleCollectionSelection = (collectionId: string) => {
        if (!canDelete) return;
        setSelectedCollectionIds(current => {
            const next = new Set(current);
            if (next.has(collectionId)) next.delete(collectionId);
            else next.add(collectionId);
            return next;
        });
    };

    const handleBulkDeleteCollections = async () => {
        if (!canDelete || selectedCollectionIds.size === 0 || bulkDeletingCollections) return;
        const selected = collections.filter(collection => selectedCollectionIds.has(collection.id));
        const unsafe = selected.find(collection => {
            const hasChildren = collections.some(candidate => candidate.parentId === collection.id);
            return hasChildren || collection.productVariantCount > 0;
        });
        if (selected.length !== selectedCollectionIds.size || unsafe) {
            showError('所选分类已发生变化，请刷新后重新选择空分类');
            return;
        }
        const preview = selected
            .slice(0, 5)
            .map(collection => `《${collection.name}》`)
            .join('、');
        const suffix = selected.length > 5 ? `等 ${selected.length} 个分类` : '';
        const confirmation = await requestConfirmation({
            title: `批量删除 ${selected.length} 个空分类？`,
            description: `将删除 ${preview}${suffix}。仅无子分类、无 SKU 的分类可被批量选择。`,
            confirmLabel: '确认批量删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;

        setActionError('');
        setBulkDeletingCollections(true);
        try {
            const ids = selected.map(collection => collection.id);
            const result = await deleteCollections({
                variables: { ids },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            const responses = result.data?.deleteCollections ?? [];
            const failedIds = ids.filter((_, index) => responses[index]?.result !== 'DELETED');
            await refetch();
            if (failedIds.length > 0 || responses.length !== ids.length) {
                setSelectedCollectionIds(new Set(failedIds));
                const firstFailure = responses.find(response => response.result !== 'DELETED');
                throw new Error(
                    firstFailure?.message ||
                        `已删除 ${ids.length - failedIds.length} 个，${failedIds.length} 个删除失败`,
                );
            }
            setSelectedCollectionIds(new Set());
            showNotice(`已批量删除 ${ids.length} 个空分类`);
        } catch (deleteError) {
            showError(toUserFacingError(deleteError, '批量删除失败，请刷新后重试'));
        } finally {
            setBulkDeletingCollections(false);
        }
    };

    const renderCollection = (
        node: CollectionTreeNode,
        depth = 0,
        siblings: CollectionTreeNode[] = collectionTree,
        index = 0,
    ) => {
        const isTopLevel = depth === 0;
        const hasChildren = node.children.length > 0;
        const isExpanded = !isTopLevel || visibleExpandedCollectionIds.has(node.id);
        const locked = !canUpdate || isReordering || siblings.length < 2;
        const canBulkDelete = !hasChildren && node.productVariantCount === 0;

        return (
            <div
                key={node.id}
                data-collection-id={node.id}
                className={`relative space-y-1 ${draggingId === node.id && !locked ? 'opacity-40' : ''}`}
                onDragOver={event => {
                    if (locked || !dragSourceRef.current) return;
                    const source = dragSourceRef.current;
                    if ((source.parentId ?? '') !== (node.parentId ?? '')) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    if (source.id === node.id) {
                        setDropTarget(null);
                        return;
                    }
                    const placement = placementAt(event);
                    setDropTarget(current =>
                        current?.id === node.id && current.placement === placement
                            ? current
                            : { id: node.id, placement },
                    );
                }}
                onDragLeave={event => {
                    if (
                        event.relatedTarget instanceof Node &&
                        event.currentTarget.contains(event.relatedTarget)
                    ) {
                        return;
                    }
                    setDropTarget(current => (current?.id === node.id ? null : current));
                }}
                onDrop={event => {
                    if (locked || !dragSourceRef.current) return;
                    const source = dragSourceRef.current;
                    if ((source.parentId ?? '') !== (node.parentId ?? '')) return;
                    event.preventDefault();
                    const placement = placementAt(event);
                    clearDrag();
                    void handleReorder(source.id, node.id, placement, siblings);
                }}
            >
                {dropTarget?.id === node.id && !locked && (
                    <div
                        aria-hidden="true"
                        data-drop-position={dropTarget.placement}
                        className={`pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded bg-blue-500 ${dropTarget.placement === 'before' ? 'top-0' : 'bottom-0'}`}
                    />
                )}
                <div
                    className={`flex min-h-12 flex-col items-stretch justify-between sm:flex-row sm:items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 ${isTopLevel ? 'shadow-2xs' : ''}`}
                    style={{ marginLeft: `calc(${Math.min(depth, 3)} * min(3vw, 20px))` }}
                >
                    <div className="flex min-w-0 items-center gap-2">
                        {canDelete && (
                            <AdminInput
                                type="checkbox"
                                checked={selectedCollectionIds.has(node.id)}
                                disabled={!canBulkDelete || bulkDeletingCollections}
                                onChange={() => toggleCollectionSelection(node.id)}
                                aria-label={`选择分类 ${node.name}`}
                                title={
                                    canBulkDelete ? '选择这个空分类' : '仅无子分类、无 SKU 的分类可批量选择'
                                }
                                className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                            />
                        )}
                        {canUpdate && (
                            <AdminButton
                                type="button"
                                draggable={!locked}
                                disabled={locked}
                                aria-label={`拖动分类 ${node.name} 排序`}
                                aria-keyshortcuts="ArrowUp ArrowDown"
                                title={
                                    locked ? '同级至少需要2个分类才可排序' : '拖拽排序，也可使用上下方向键'
                                }
                                className="hidden md:flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-500 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                                onDragStart={event => {
                                    if (locked) {
                                        event.preventDefault();
                                        return;
                                    }
                                    dragSourceRef.current = { id: node.id, parentId: node.parentId ?? null };
                                    setDraggingId(node.id);
                                    event.dataTransfer.effectAllowed = 'move';
                                    event.dataTransfer.setData('text/plain', node.id);
                                    const element =
                                        event.currentTarget.closest<HTMLElement>('[data-collection-id]');
                                    if (element) {
                                        event.dataTransfer.setDragImage(
                                            element,
                                            24,
                                            element.clientHeight / 2,
                                        );
                                    }
                                }}
                                onDragEnd={clearDrag}
                                onKeyDown={event => {
                                    if (locked || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                                    event.preventDefault();
                                    const direction = event.key === 'ArrowUp' ? -1 : 1;
                                    const adjacent = siblings[index + direction];
                                    if (adjacent) {
                                        keyboardHandleRef.current = event.currentTarget;
                                        void handleReorder(
                                            node.id,
                                            adjacent.id,
                                            direction === -1 ? 'before' : 'after',
                                            siblings,
                                        );
                                    }
                                }}
                            >
                                <GripVertical className="h-4 w-4" />
                            </AdminButton>
                        )}
                        {isTopLevel && hasChildren ? (
                            <AdminButton
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
                            </AdminButton>
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
                                <span
                                    className="break-words text-sm font-bold text-slate-900 sm:truncate"
                                    title={`/${node.slug}`}
                                >
                                    {node.name}
                                </span>
                                {node.isPrivate && (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                                        内部分类
                                    </span>
                                )}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                                {isTopLevel && hasChildren && <span>{node.children.length} 个子分类</span>}
                            </div>
                        </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
                        {canUpdate && (
                            <AdminButton
                                type="button"
                                className="md:hidden"
                                disabled={locked || index === 0}
                                aria-label={`上移分类 ${node.name}`}
                                onClick={() => {
                                    const adjacent = siblings[index - 1];
                                    if (adjacent)
                                        void handleReorder(node.id, adjacent.id, 'before', siblings);
                                }}
                            >
                                上移
                            </AdminButton>
                        )}
                        {canUpdate && (
                            <AdminButton
                                type="button"
                                className="md:hidden"
                                disabled={locked || index === siblings.length - 1}
                                aria-label={`下移分类 ${node.name}`}
                                onClick={() => {
                                    const adjacent = siblings[index + 1];
                                    if (adjacent) void handleReorder(node.id, adjacent.id, 'after', siblings);
                                }}
                            >
                                下移
                            </AdminButton>
                        )}
                        <span className="text-xs text-slate-500">
                            <strong className="font-mono text-slate-800">{node.productVariantCount}</strong>{' '}
                            个 SKU
                        </span>
                        {canUpdate && (
                            <AdminButton
                                type="button"
                                onClick={() => openEditor(node)}
                                className="p-1.5 text-slate-400 hover:text-blue-600"
                                aria-label={`编辑分类 ${node.name}`}
                            >
                                <Edit3 className="h-3.5 w-3.5" />
                            </AdminButton>
                        )}
                        <SeoEditorLink targetType="COLLECTION" targetId={node.id} name={node.name} />
                        {canDelete && (
                            <AdminButton
                                type="button"
                                onClick={() => handleDelete(node)}
                                className="p-1.5 text-slate-400 hover:text-rose-600"
                                aria-label={`删除分类 ${node.name}`}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </AdminButton>
                        )}
                    </div>
                </div>
                {hasChildren && isExpanded && (
                    <div id={`collection-children-${node.id}`} className="space-y-1">
                        {node.children.map((child, childIndex) =>
                            renderCollection(child, depth + 1, node.children, childIndex),
                        )}
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
                    <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                        {standalonePage?.title ?? '分类与属性'}
                        <FeatureHelpButton
                            topic="catalog.categories"
                            title="分类与属性"
                            description={'集中管理 Vendure 商品分类、通用规格模板与前台筛选属性'}
                        />
                    </h1>
                </div>
                <div className="flex items-center gap-2">
                    <AdminButton
                        refreshPage
                        type="button"
                        onClick={() => refetch()}
                        disabled={loading}
                        className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading && !data ? 'animate-spin' : ''}`} /> 刷新
                    </AdminButton>
                    {canCreate && (
                        <AdminButton
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
                        </AdminButton>
                    )}
                </div>
            </div>

            <CatalogTemplateLibraryPanel key={data?.activeChannel.id} onClaimed={() => void refetch()} />

            {!standalonePage && (
                <div className="px-4 py-3 md:hidden">
                    <AdminField label="分类管理章节">
                        <AdminSelect
                            aria-label="分类管理章节"
                            value={activeTab}
                            onChange={event => setActiveTab(event.target.value as typeof activeTab)}
                        >
                            <option value="CATEGORIES">商品分类树</option>
                            <option value="OPTION_TEMPLATES">规格选项模板</option>
                            <option value="FACETS">筛选属性与标签</option>
                        </AdminSelect>
                    </AdminField>
                </div>
            )}
            {!standalonePage && (
                <div className="scrollbar-hidden hidden md:flex shrink-0 gap-6 overflow-x-auto border-b border-slate-200 bg-white px-5 text-xs font-bold sm:px-8">
                    {(
                        [
                            [
                                'CATEGORIES',
                                FolderTree,
                                `商品分类树 (${data?.collections?.totalItems ?? collections.length})`,
                            ],
                            [
                                'OPTION_TEMPLATES',
                                Sliders,
                                `规格选项模板 (${data?.productOptionGroups?.totalItems ?? optionGroups.length})`,
                            ],
                            ['FACETS', Tag, `筛选属性与标签 (${data?.facets?.totalItems ?? facets.length})`],
                        ] as const
                    ).map(([key, Icon, label]) => (
                        <AdminButton
                            type="button"
                            key={key}
                            onClick={() => setActiveTab(key)}
                            className={`flex items-center gap-1.5 border-b-2 py-3.5 transition-colors ${activeTab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                        >
                            <Icon className="h-3.5 w-3.5" /> {label}
                        </AdminButton>
                    ))}
                </div>
            )}

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
                            <AdminButton
                                type="button"
                                onClick={() => refetch()}
                                className="rounded bg-rose-600 px-3 py-1 font-bold text-white"
                            >
                                重试
                            </AdminButton>
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
                        {canCreate
                            ? '当前渠道尚未配置此类数据，点击右上角开始创建。'
                            : '当前渠道尚未配置此类数据。'}
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
                                {canDelete && selectedCollectionIds.size > 0 && (
                                    <>
                                        <span className="text-[11px] font-bold text-slate-600">
                                            已选 {selectedCollectionIds.size} 个空分类
                                        </span>
                                        <AdminButton
                                            type="button"
                                            onClick={() => setSelectedCollectionIds(new Set())}
                                            disabled={bulkDeletingCollections}
                                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                                        >
                                            取消选择
                                        </AdminButton>
                                        <AdminButton
                                            type="button"
                                            onClick={handleBulkDeleteCollections}
                                            disabled={bulkDeletingCollections}
                                            className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
                                        >
                                            {bulkDeletingCollections
                                                ? '正在删除…'
                                                : `批量删除 (${selectedCollectionIds.size})`}
                                        </AdminButton>
                                    </>
                                )}
                                <AdminButton
                                    type="button"
                                    onClick={expandAllCollections}
                                    disabled={allTopLevelCollectionsExpanded}
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-default disabled:opacity-40"
                                >
                                    全部展开
                                </AdminButton>
                                <AdminButton
                                    type="button"
                                    onClick={collapseAllCollections}
                                    disabled={allTopLevelCollectionsCollapsed}
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:cursor-default disabled:opacity-40"
                                >
                                    全部收起
                                </AdminButton>
                            </div>
                        </div>
                        <div className="space-y-3 bg-slate-50/50 p-3 sm:p-5" aria-busy={isReordering}>
                            {collectionTree.map((node, index) =>
                                renderCollection(node, 0, collectionTree, index),
                            )}
                        </div>
                    </div>
                ) : activeTab === 'OPTION_TEMPLATES' ? (
                    <div className="space-y-4">
                        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="text-xs font-bold text-slate-800">
                                    规格模板共 {data?.productOptionGroups?.totalItems ?? optionGroups.length}{' '}
                                    个
                                </div>
                                <div className="mt-0.5 text-[11px] text-slate-400">
                                    这里只显示人工创建、可重复使用的模板；导入商品的系统规格由系统维护。
                                </div>
                            </div>
                            <div className="relative w-full sm:max-w-xs">
                                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <AdminInput
                                    type="search"
                                    name="option-group-search"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    aria-label="搜索规格模板"
                                    value={optionGroupSearch}
                                    onChange={event => {
                                        setOptionGroupSearch(event.target.value);
                                        setOptionGroupPage(0);
                                    }}
                                    placeholder="搜索模板名、编码或选项值"
                                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                                />
                            </div>
                        </div>

                        {visibleOptionGroups.length === 0 ? (
                            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
                                <p className="text-sm font-bold text-slate-700">没有找到匹配的规格模板</p>
                                <p className="mt-1 text-xs text-slate-400">请尝试其他名称、编码或选项值</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                {visibleOptionGroups.map(group => (
                                    <div
                                        key={group.id}
                                        className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
                                    >
                                        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                                            <div className="min-w-0">
                                                <div className="break-words text-sm font-bold text-slate-900 sm:truncate">
                                                    {group.name}
                                                </div>
                                                <AdminButton
                                                    type="button"
                                                    onClick={() => setUsageGroup(group)}
                                                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                                                    aria-label={`查看使用规格模板《${group.name}》的 ${group.productCount} 个商品`}
                                                >
                                                    查看 {group.productCount} 个关联商品
                                                    <ChevronRight className="h-3 w-3" />
                                                </AdminButton>
                                            </div>
                                            <div className="flex shrink-0 gap-1">
                                                {canUpdate && (
                                                    <AdminButton
                                                        type="button"
                                                        onClick={() => openEditor(group)}
                                                        aria-label={`编辑规格模板：${group.name}`}
                                                        className="p-1.5 text-slate-400 hover:text-blue-600"
                                                    >
                                                        <Edit3 className="h-3.5 w-3.5" />
                                                    </AdminButton>
                                                )}
                                                {canDelete && (
                                                    <AdminButton
                                                        type="button"
                                                        onClick={() => handleDelete(group)}
                                                        disabled={group.productCount > 0}
                                                        aria-label={`删除规格模板：${group.name}`}
                                                        title={
                                                            group.productCount > 0
                                                                ? `正在被 ${group.productCount} 个商品使用，请先移除关联`
                                                                : '删除规格模板'
                                                        }
                                                        className="p-1.5 text-slate-400 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-slate-400"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </AdminButton>
                                                )}
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
                        )}

                        {matchingOptionGroups.length > OPTION_GROUP_PAGE_SIZE && (
                            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] text-slate-500">
                                <span>
                                    共 {matchingOptionGroups.length} 个模板 · 第 {visibleOptionGroupPage + 1}{' '}
                                    / {optionGroupPageCount} 页
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <AdminButton
                                        type="button"
                                        onClick={() =>
                                            setOptionGroupPage(Math.max(0, visibleOptionGroupPage - 1))
                                        }
                                        disabled={visibleOptionGroupPage === 0}
                                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                                        aria-label="上一页规格模板"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </AdminButton>
                                    <AdminButton
                                        type="button"
                                        onClick={() =>
                                            setOptionGroupPage(
                                                Math.min(
                                                    optionGroupPageCount - 1,
                                                    visibleOptionGroupPage + 1,
                                                ),
                                            )
                                        }
                                        disabled={visibleOptionGroupPage >= optionGroupPageCount - 1}
                                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
                                        aria-label="下一页规格模板"
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </AdminButton>
                                </div>
                            </div>
                        )}
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
                                    </div>
                                    <div className="flex gap-1">
                                        {canUpdate && (
                                            <AdminButton
                                                type="button"
                                                onClick={() => openEditor(facet)}
                                                aria-label={`编辑筛选属性：${facet.name}`}
                                                className="p-1.5 text-slate-400 hover:text-blue-600"
                                            >
                                                <Edit3 className="h-3.5 w-3.5" />
                                            </AdminButton>
                                        )}
                                        {canDelete && (
                                            <AdminButton
                                                type="button"
                                                onClick={() => handleDelete(facet)}
                                                aria-label={`删除筛选属性：${facet.name}`}
                                                className="p-1.5 text-slate-400 hover:text-rose-600"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </AdminButton>
                                        )}
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

            {usageGroup && (
                <OptionGroupProductsDialog group={usageGroup} onClose={() => setUsageGroup(null)} />
            )}

            {isEditorOpen && (editingItem ? canUpdate : canCreate) && (
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
                            <AdminButton
                                type="button"
                                onClick={closeEditor}
                                disabled={saving}
                                className="p-1 text-slate-400"
                                aria-label="关闭"
                            >
                                <X className="h-5 w-5" />
                            </AdminButton>
                        </div>
                        {activeTab === 'OPTION_TEMPLATES' &&
                            editingItem &&
                            'productCount' in editingItem &&
                            editingItem.productCount > 0 && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                                    <div className="font-bold">
                                        此模板正在被 {editingItem.productCount} 个商品使用
                                    </div>
                                    <p className="mt-1 leading-5">
                                        修改名称或选项值会影响这些商品，删除前必须先移除所有关联。
                                    </p>
                                    <AdminButton
                                        type="button"
                                        onClick={() => {
                                            setIsEditorOpen(false);
                                            setEditingItem(null);
                                            setUsageGroup(editingItem);
                                        }}
                                        className="mt-2 font-bold text-amber-900 underline underline-offset-2"
                                    >
                                        先查看关联商品
                                    </AdminButton>
                                </div>
                            )}
                        <AdminField
                            label={
                                <span className="mb-1 block text-xs font-bold text-slate-700">
                                    中文名称 *
                                </span>
                            }
                            description={
                                <>
                                    <p className="mt-1 text-[10px] leading-4 text-slate-400">
                                        英文由翻译引擎生成；已有英文可在下方修订，并在“多语言翻译”中复核。
                                    </p>
                                </>
                            }
                        >
                            <AdminInput
                                value={formName}
                                onChange={event => setFormName(event.target.value)}
                                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                                autoFocus
                            />
                        </AdminField>
                        <AdminField
                            label={
                                <span className="mb-1 block text-xs font-bold text-slate-700">
                                    {activeTab === 'CATEGORIES' ? 'Slug' : '编码 Code'}
                                </span>
                            }
                        >
                            <AdminInput
                                value={formCode}
                                onChange={event => setFormCode(event.target.value)}
                                placeholder="留空自动生成"
                                className="w-full rounded-lg border border-slate-300 p-2.5 font-mono text-xs outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </AdminField>
                        {activeTab === 'CATEGORIES' ? (
                            <>
                                <AdminField
                                    label="中文描述"
                                    layout="stacked"
                                    description="留空保留原文；填写后会更新分类的中文源描述。"
                                >
                                    <AdminTextArea
                                        aria-label="中文描述"
                                        value={formSourceDescription}
                                        onChange={event => setFormSourceDescription(event.target.value)}
                                        disabled={saving}
                                        rows={3}
                                        className="w-full rounded-lg border border-slate-300 p-2.5 text-xs"
                                    />
                                </AdminField>
                                {editingItem &&
                                    'slug' in editingItem &&
                                    getLocalizedEntityTranslation(editingItem.translations, 'en') && (
                                        <>
                                            <AdminField
                                                label="英文名称"
                                                description="留空保留原文；保存修订后的英文会沿用人工翻译保护。"
                                            >
                                                <AdminInput
                                                    aria-label="英文名称"
                                                    value={formEnglishName}
                                                    onChange={event => setFormEnglishName(event.target.value)}
                                                    disabled={saving}
                                                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs"
                                                />
                                            </AdminField>
                                            <AdminField
                                                label="英文描述"
                                                layout="stacked"
                                                description="留空保留原文，不改动英文网址。"
                                            >
                                                <AdminTextArea
                                                    aria-label="英文描述"
                                                    value={formEnglishDescription}
                                                    onChange={event =>
                                                        setFormEnglishDescription(event.target.value)
                                                    }
                                                    disabled={saving}
                                                    rows={3}
                                                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs"
                                                />
                                            </AdminField>
                                        </>
                                    )}
                                <CategoryImageField
                                    value={formFeaturedAsset}
                                    onChange={setFormFeaturedAsset}
                                    disabled={saving}
                                />
                                <AdminField
                                    label={
                                        <span className="mb-1 block text-xs font-bold text-slate-700">
                                            上级分类
                                        </span>
                                    }
                                >
                                    <AdminSelect
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
                                    </AdminSelect>
                                </AdminField>
                                <CollectionFiltersEditor
                                    values={formFilters}
                                    definitions={data?.collectionFilters ?? []}
                                    inheritFilters={formInheritFilters}
                                    parentId={formParentId}
                                    onInheritFiltersChange={setFormInheritFilters}
                                    onChange={setFormFilters}
                                />
                                <DynamicCustomFieldsForm
                                    helpTopic="catalog.categories"
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
                                <AdminTextArea
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
                                <AdminInput
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
                        {categorySourceChanged && (
                            <div role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                                分类内容已更新或当前店铺已切换。当前输入已保留，请关闭编辑并重新打开后保存。
                            </div>
                        )}
                        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                            <AdminButton
                                type="button"
                                onClick={closeEditor}
                                disabled={saving}
                                className="rounded-lg bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700"
                            >
                                取消
                            </AdminButton>
                            <AdminButton
                                type="button"
                                onClick={handleSave}
                                disabled={saving || categorySourceChanged}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                            >
                                {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}保存
                            </AdminButton>
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
                    options: { take: 20, sort: { name: 'ASC', id: 'ASC' } },
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
                    <h4 className="flex items-center gap-2 text-xs font-bold text-slate-800">
                        集合筛选规则
                        <FeatureHelpButton
                            topic="catalog.collection-rules"
                            title="集合筛选规则"
                            description={'使用当前店铺支持的商品筛选规则，可在保存前预览命中的 SKU。'}
                        />
                    </h4>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs font-bold text-slate-700">
                    <AdminInput
                        type="checkbox"
                        checked={inheritFilters}
                        onChange={event => onInheritFiltersChange(event.target.checked)}
                    />
                    继承上级筛选
                </label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
                <AdminSelect
                    value={selectedCode}
                    onChange={event => setSelectedCode(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                >
                    <option value="">请选择筛选器</option>
                    {definitions.map(definition => (
                        <option key={definition.code} value={definition.code}>
                            {configurableOperationLabel(definition, '商品筛选规则')}
                        </option>
                    ))}
                </AdminSelect>
                <AdminButton
                    type="button"
                    onClick={add}
                    disabled={!selectedCode}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold disabled:opacity-40"
                >
                    <Plus className="mr-1 inline h-3.5 w-3.5" />
                    添加规则
                </AdminButton>
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
                                        {definition
                                            ? configurableOperationLabel(definition, '商品筛选规则')
                                            : '商品筛选规则'}
                                    </strong>
                                    {definition && (
                                        <ConfigurableOperationTechnicalDetails definition={definition} />
                                    )}
                                </div>
                                <AdminButton
                                    type="button"
                                    onClick={() =>
                                        onChange(values.filter((_, index) => index !== operationIndex))
                                    }
                                    className="text-rose-600"
                                    aria-label={`删除筛选规则 ${configurableOperationLabel(definitions.find(item => item.code === operation.code) ?? { code: operation.code, description: '', args: [] })}`}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </AdminButton>
                            </div>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                {(definition?.args ?? []).map(arg => (
                                    <ConfigurableOperationField
                                        key={arg.name}
                                        definition={arg}
                                        operationCode={operation.code}
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
            <AdminButton
                type="button"
                onClick={() => void runPreview()}
                disabled={previewState.loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
            >
                <Eye className="h-3.5 w-3.5" />
                {previewState.loading ? '预览中…' : '预览集合内容'}
            </AdminButton>
        </section>
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
                const label = configurableArgumentLabel(arg, definition.code);
                if (arg.required && !value)
                    throw new Error(
                        `${configurableOperationLabel(definition, '商品筛选规则')}的“${label}”不能为空`,
                    );
                let serializedValue = value;
                if (arg.list) {
                    try {
                        serializedValue = serializeConfigurableListValue(value, arg.type);
                    } catch (cause) {
                        throw new Error(
                            `${label}：${cause instanceof Error ? cause.message : '列表内容无效'}`,
                        );
                    }
                }
                if (
                    !arg.list &&
                    ['int', 'float', 'money'].includes(arg.type.toLowerCase()) &&
                    value &&
                    !Number.isFinite(Number(value))
                )
                    throw new Error(`${label}必须是数字`);
                return { name: arg.name, value: serializedValue };
            }),
        };
    });
}

function collectionDefaultArgValue(arg: OperationArgDefinition) {
    if (arg.defaultValue == null)
        return arg.type.toLowerCase() === 'boolean' ? 'false' : arg.list ? '[]' : '';
    return typeof arg.defaultValue === 'string' ? arg.defaultValue : JSON.stringify(arg.defaultValue);
}
