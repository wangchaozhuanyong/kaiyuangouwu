import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    ArrowDown,
    ArrowUp,
    CheckCircle2,
    Headphones,
    LoaderCircle,
    Plus,
    Puzzle,
    RefreshCw,
    Save,
    Search,
    Sparkles,
    TicketPercent,
    Trash2,
    X,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
    CREATE_STOREFRONT_BLOCK_MUTATION,
    STOREFRONT_CONTENT_QUERY,
    STOREFRONT_PLUGIN_COLLECTIONS_QUERY,
    UPDATE_STOREFRONT_BLOCK_MUTATION,
    type StorefrontContentBlock,
    type StorefrontContentItem,
    type StorefrontContentResult,
} from '../../graphql/storefront.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { resolveVersionedDraft } from '../../utils/versioned-draft';
import {
    emptyBlockTranslation,
    emptyItemTranslation,
    errorText,
    storefrontBlockInput,
} from '../Storefront/storefront-content-utils';

type Placement =
    | 'AFTER_HEADER'
    | 'AFTER_CATEGORY_NAVIGATION'
    | 'BEFORE_PRODUCT_LIST'
    | 'AFTER_PRODUCT_LIST'
    | 'BUSINESS_SERVICES_MAIN';
type CategoryScope = 'ALL' | 'SELECTED';

interface PluginDefinition {
    code: string;
    name: string;
    englishName: string;
    description: string;
    englishDescription: string;
    version: string;
    defaultPlacement: Placement;
}

interface CollectionResult {
    collections: {
        items: Array<{ id: string; name: string; parentId: string | null }>;
        totalItems: number;
    };
    selectedCollections: {
        items: Array<{ id: string; name: string; parentId: string | null }>;
        totalItems: number;
    };
}

const catalog: PluginDefinition[] = [
    {
        code: 'category-coupon-entry',
        name: '优惠券快捷入口',
        englishName: 'Coupon shortcut',
        description: '在商品分类页或商业服务页展示优惠券快捷入口。',
        englishDescription: 'Shows a coupon shortcut on category or business-services pages.',
        version: '1.0.0',
        defaultPlacement: 'BEFORE_PRODUCT_LIST',
    },
    {
        code: 'category-support-entry',
        name: '客服快捷入口',
        englishName: 'Support shortcut',
        description: '在商品分类页或商业服务页展示客服快捷入口。',
        englishDescription: 'Shows a support shortcut on category or business-services pages.',
        version: '1.0.0',
        defaultPlacement: 'AFTER_PRODUCT_LIST',
    },
    {
        code: 'ai-image-studio-entry',
        name: 'AI 图片工坊',
        englishName: 'AI Image Studio',
        description: '在商业服务页提供提示词优化、文生图和单参考图生图入口。',
        englishDescription: 'Adds prompt optimization, text-to-image, and reference-image generation.',
        version: '1.0.0',
        defaultPlacement: 'BUSINESS_SERVICES_MAIN',
    },
];

const placementOptions: Array<[Placement, string, string]> = [
    ['AFTER_HEADER', '分类页标题下方', '显示在页面标题和搜索框下方'],
    ['AFTER_CATEGORY_NAVIGATION', '分类导航下方', '显示在一级分类切换区之后'],
    ['BEFORE_PRODUCT_LIST', '商品列表上方', '显示在排序筛选栏之后'],
    ['AFTER_PRODUCT_LIST', '商品列表下方', '显示在商品列表和加载更多之后'],
    ['BUSINESS_SERVICES_MAIN', '商业服务页主区域', '显示在客户端“商业服务”页主区域'],
];

export function ClientPluginsModule() {
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [collectionSearch, setCollectionSearch] = useState('');
    const content = useQuery<StorefrontContentResult>(STOREFRONT_CONTENT_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    const sourceBlock = content.data?.storefrontContentBlocks.find(
        block => block.type === 'CLIENT_PLUGINS' && block.code === 'storefront-client-plugins',
    );
    const sourceSignature = sourceBlock
        ? `${sourceBlock.id}:${sourceBlock.updatedAt}`
        : content.data
          ? 'empty'
          : '';
    const [storedDraft, setDraft] = useState<StorefrontContentBlock | null>(() =>
        sourceSignature ? createDraft(sourceBlock) : null,
    );
    const [loadedSignature, setLoadedSignature] = useState(sourceSignature);
    const draft = resolveVersionedDraft(
        sourceSignature,
        loadedSignature,
        createDraft(sourceBlock),
        storedDraft,
    );
    const selectedCollectionIds = useMemo(
        () => [...new Set((draft?.items ?? []).flatMap(item => pluginCategoryIds(item)))].sort(),
        [draft],
    );
    const deferredCollectionSearch = useDeferredValue(collectionSearch.trim());
    const collections = useQuery<CollectionResult>(STOREFRONT_PLUGIN_COLLECTIONS_QUERY, {
        variables: {
            options: {
                take: 50,
                sort: { name: 'ASC' },
                filter: deferredCollectionSearch
                    ? { name: { contains: deferredCollectionSearch } }
                    : undefined,
            },
            selectedOptions: {
                take: Math.max(1, selectedCollectionIds.length),
                sort: { name: 'ASC' },
                filter: {
                    id: selectedCollectionIds.length
                        ? { in: selectedCollectionIds }
                        : { eq: '__no_selected_collection__' },
                },
            },
        },
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [create, createState] = useMutation(CREATE_STOREFRONT_BLOCK_MUTATION);
    const [update, updateState] = useMutation(UPDATE_STOREFRONT_BLOCK_MUTATION);
    /* oxlint-disable react/set-state-in-effect -- GraphQL 结果是编辑草稿的外部版本源 */
    useEffect(() => {
        if (!sourceSignature || sourceSignature === loadedSignature) return;
        setDraft(createDraft(sourceBlock));
        setLoadedSignature(sourceSignature);
    }, [loadedSignature, sourceBlock, sourceSignature]);
    /* oxlint-enable react/set-state-in-effect */
    const installedCodes = new Set(
        (draft?.items ?? []).map(pluginCode).filter((value): value is string => Boolean(value)),
    );
    const collectionOptions = [
        ...new Map(
            [
                ...(collections.data?.selectedCollections.items ?? []),
                ...(collections.data?.collections.items ?? []),
            ].map(collection => [collection.id, collection]),
        ).values(),
    ];
    const dirty = Boolean(draft && JSON.stringify(draft) !== JSON.stringify(createDraft(sourceBlock)));
    const validation = draft ? validateDraft(draft) : '配置尚未加载';
    const pending = createState.loading || updateState.loading;

    const save = async () => {
        if (!draft || validation) return;
        try {
            if (draft.id) {
                if (!draft.updatedAt) throw new Error('缺少配置版本，请刷新后重试');
                await update({
                    variables: {
                        input: {
                            id: draft.id,
                            expectedUpdatedAt: draft.updatedAt,
                            ...storefrontBlockInput(draft),
                        },
                    },
                });
            } else {
                await create({ variables: { input: storefrontBlockInput(draft) } });
            }
            setNotice('客户端插件配置已保存');
            setActionError('');
            await content.refetch();
        } catch (error) {
            setActionError(errorText(error));
            setNotice('');
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">客户端插件中心</h1>
                        <p className="mt-1 text-xs text-slate-500">
                            只能装配平台代码中已发布的官方插件，商家不能上传第三方代码
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => void Promise.all([content.refetch(), collections.refetch()])}
                            disabled={content.loading || collections.loading}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                        >
                            <RefreshCw
                                className={`h-3.5 w-3.5 ${content.loading || collections.loading ? 'animate-spin' : ''}`}
                            />
                            刷新
                        </button>
                        <button
                            type="button"
                            onClick={() => void save()}
                            disabled={pending || !dirty || Boolean(validation) || Boolean(collections.error)}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                            <Save className="h-3.5 w-3.5" />
                            {pending ? '正在保存…' : '保存插件配置'}
                        </button>
                    </div>
                </div>
            </header>
            <main className="mx-auto w-full max-w-none flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
                {notice && (
                    <Message kind="success" onClose={() => setNotice('')}>
                        {notice}
                    </Message>
                )}
                {actionError && (
                    <Message kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </Message>
                )}
                {collections.error && (
                    <Message kind="error" onClose={() => void collections.refetch()}>
                        {toUserFacingError(
                            collections.error,
                            '商品分类读取失败，暂不能保存指定分类的插件配置；点击此提示重试',
                        )}
                    </Message>
                )}
                <section className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-xs">
                    <span className="text-slate-500">当前店铺</span>
                    <strong className="rounded bg-slate-100 px-2 py-1 text-slate-800">
                        {content.data ? getChannelDisplayName(content.data.activeChannel.code) : '—'}
                    </strong>
                    <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">
                        {catalog.length} 个已发布官方插件
                    </span>
                    <span className="rounded bg-blue-50 px-2 py-1 font-bold text-blue-700">
                        {installedCodes.size} 个已装配
                    </span>
                </section>
                {content.loading && !content.data ? (
                    <LoadingState />
                ) : content.error ? (
                    <ErrorState message={content.error.message} onRetry={() => void content.refetch()} />
                ) : (
                    draft && (
                        <>
                            <section>
                                <div className="mb-3">
                                    <h2 className="text-sm font-bold text-slate-900">平台插件</h2>
                                    <p className="mt-1 text-[11px] text-slate-400">
                                        清单直接来自当前后端发布的插件 manifest
                                    </p>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                    {catalog.map(definition => (
                                        <PluginCard
                                            key={definition.code}
                                            definition={definition}
                                            installed={installedCodes.has(definition.code)}
                                            onToggle={() =>
                                                setDraft(current =>
                                                    current
                                                        ? installedCodes.has(definition.code)
                                                            ? removePlugin(current, definition.code)
                                                            : addPlugin(current, definition)
                                                        : current,
                                                )
                                            }
                                        />
                                    ))}
                                </div>
                            </section>
                            <section className="rounded-xl border border-slate-200 bg-white">
                                <div className="border-b border-slate-100 p-4">
                                    <h2 className="text-sm font-bold text-slate-900">已添加到客户端</h2>
                                    <p className="mt-1 text-[11px] text-slate-400">
                                        同一位置的插件依照下方顺序展示；选择“指定分类”时必须勾选至少一项
                                    </p>
                                </div>
                                {draft.items.length ? (
                                    <div className="space-y-3 p-4">
                                        {draft.items.map((item, index) => {
                                            const code = pluginCode(item) ?? '';
                                            const definition = catalog.find(value => value.code === code);
                                            return (
                                                <InstalledEditor
                                                    key={item.id ?? code}
                                                    item={item}
                                                    definition={definition}
                                                    index={index}
                                                    count={draft.items.length}
                                                    collections={collectionOptions}
                                                    collectionTotal={
                                                        collections.data?.collections.totalItems ?? 0
                                                    }
                                                    collectionsLoading={collections.loading}
                                                    collectionSearch={collectionSearch}
                                                    setCollectionSearch={setCollectionSearch}
                                                    onChange={next =>
                                                        setDraft({
                                                            ...draft,
                                                            items: draft.items.map((current, currentIndex) =>
                                                                currentIndex === index ? next : current,
                                                            ),
                                                        })
                                                    }
                                                    onMove={direction =>
                                                        setDraft({
                                                            ...draft,
                                                            items: movePlugin(
                                                                draft.items,
                                                                index,
                                                                index + direction,
                                                            ),
                                                        })
                                                    }
                                                    onRemove={() => setDraft(removePlugin(draft, code))}
                                                />
                                            );
                                        })}
                                        {validation && (
                                            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                                                <strong>配置未完成：</strong>
                                                {validation}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="flex min-h-52 flex-col items-center justify-center p-8 text-center">
                                        <Puzzle className="h-9 w-9 text-slate-300" />
                                        <h3 className="mt-3 text-sm font-bold text-slate-800">
                                            还没有装配客户端插件
                                        </h3>
                                        <p className="mt-1 text-xs text-slate-400">
                                            从上方平台插件中选择需要的入口。
                                        </p>
                                    </div>
                                )}
                            </section>
                        </>
                    )
                )}
            </main>
        </div>
    );
}

function PluginCard({
    definition,
    installed,
    onToggle,
}: {
    definition: PluginDefinition;
    installed: boolean;
    onToggle: () => void;
}) {
    const Icon =
        definition.code === 'category-coupon-entry'
            ? TicketPercent
            : definition.code === 'category-support-entry'
              ? Headphones
              : Sparkles;
    return (
        <article className="flex min-h-56 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="flex items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                    <Icon className="h-5 w-5" />
                </div>
                <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-slate-400">v{definition.version}</span>
                    <span
                        className={`rounded px-2 py-1 text-[10px] font-bold ${installed ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}
                    >
                        {installed ? '已添加' : '可添加'}
                    </span>
                </div>
            </div>
            <h3 className="mt-4 text-sm font-bold text-slate-900">{definition.name}</h3>
            <div className="mt-1 font-mono text-[10px] text-slate-400">{definition.code}</div>
            <p className="mt-3 flex-1 text-xs leading-5 text-slate-500">{definition.description}</p>
            <button
                type="button"
                onClick={onToggle}
                className={`mt-5 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold ${installed ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
            >
                {installed ? (
                    <>
                        <Trash2 className="h-3.5 w-3.5" />
                        从客户端移除
                    </>
                ) : (
                    <>
                        <Plus className="h-3.5 w-3.5" />
                        添加到客户端
                    </>
                )}
            </button>
        </article>
    );
}

function InstalledEditor({
    item,
    definition,
    index,
    count,
    collections,
    collectionTotal,
    collectionsLoading,
    collectionSearch,
    setCollectionSearch,
    onChange,
    onMove,
    onRemove,
}: {
    item: StorefrontContentItem;
    definition?: PluginDefinition;
    index: number;
    count: number;
    collections: CollectionResult['collections']['items'];
    collectionTotal: number;
    collectionsLoading: boolean;
    collectionSearch: string;
    setCollectionSearch: (value: string) => void;
    onChange: (item: StorefrontContentItem) => void;
    onMove: (direction: -1 | 1) => void;
    onRemove: () => void;
}) {
    const placement = pluginPlacement(item);
    const scope = pluginScope(item);
    const categoryIds = pluginCategoryIds(item);
    const patchSettings = (patch: Record<string, unknown>) =>
        onChange({ ...item, settings: { ...(item.settings ?? {}), ...patch } });
    return (
        <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="text-xs font-bold text-slate-900">
                            {definition?.name ?? pluginCode(item) ?? '未知插件'}
                        </h3>
                        <span className="font-mono text-[9px] text-slate-400">顺序 {index + 1}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">
                        {definition?.description ?? '当前版本未登记的插件配置'}
                    </p>
                </div>
                <div className="flex shrink-0 gap-1">
                    <IconButton
                        label="上移"
                        disabled={index === 0}
                        onClick={() => onMove(-1)}
                        icon={ArrowUp}
                    />
                    <IconButton
                        label="下移"
                        disabled={index === count - 1}
                        onClick={() => onMove(1)}
                        icon={ArrowDown}
                    />
                    <IconButton label="移除" disabled={false} onClick={onRemove} icon={Trash2} danger />
                </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
                <Field label="展示位置">
                    <select
                        value={placement ?? ''}
                        onChange={event => patchSettings({ placement: event.target.value })}
                        className={inputClass}
                    >
                        <option value="">请选择</option>
                        {placementOptions.map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                    <p className="mt-1 text-[10px] text-slate-400">
                        {placementOptions.find(value => value[0] === placement)?.[2]}
                    </p>
                </Field>
                {placement !== 'BUSINESS_SERVICES_MAIN' && (
                    <Field label="适用商品分类">
                        <select
                            value={scope}
                            onChange={event =>
                                patchSettings({
                                    categoryScope: event.target.value,
                                    categoryIds: event.target.value === 'ALL' ? [] : categoryIds,
                                })
                            }
                            className={inputClass}
                        >
                            <option value="ALL">全部分类</option>
                            <option value="SELECTED">仅指定分类</option>
                        </select>
                        <label className="mt-2 flex items-center gap-2 text-[10px] font-normal text-slate-500">
                            <input
                                type="checkbox"
                                checked={pluginIncludeChildren(item)}
                                onChange={event => patchSettings({ includeChildren: event.target.checked })}
                            />
                            包含子分类
                        </label>
                    </Field>
                )}
            </div>
            {placement !== 'BUSINESS_SERVICES_MAIN' && scope === 'SELECTED' && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                        <input
                            value={collectionSearch}
                            onChange={event => setCollectionSearch(event.target.value)}
                            aria-label="搜索商品分类"
                            placeholder="搜索全部分类"
                            className={`${inputClass} pl-8`}
                        />
                    </div>
                    <p className="mt-1 text-[9px] text-slate-400">
                        {collectionsLoading
                            ? '正在查询分类…'
                            : `匹配 ${collectionTotal} 个分类，当前显示前 50 个；已选择项始终保留`}
                    </p>
                    <div className="mt-2 grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                        {collections.map(collection => (
                            <label
                                key={collection.id}
                                className="flex cursor-pointer items-center gap-2 rounded p-2 text-[10px] hover:bg-slate-50"
                            >
                                <input
                                    type="checkbox"
                                    checked={categoryIds.includes(collection.id)}
                                    onChange={event =>
                                        patchSettings({
                                            categoryIds: event.target.checked
                                                ? [...new Set([...categoryIds, collection.id])]
                                                : categoryIds.filter(id => id !== collection.id),
                                        })
                                    }
                                />
                                <span className="truncate">{collection.name}</span>
                            </label>
                        ))}
                    </div>
                    {!collectionsLoading && !collections.length && (
                        <p className="py-5 text-center text-[10px] text-slate-400">没有匹配的分类</p>
                    )}
                </div>
            )}
        </article>
    );
}

function createDraft(block?: StorefrontContentBlock): StorefrontContentBlock {
    if (block)
        return {
            ...block,
            settings: block.settings ? structuredClone(block.settings) : null,
            translations: block.translations.map(value => ({ ...value })),
            items: block.items.map((item, position) => ({
                ...item,
                position,
                settings: item.settings ? structuredClone(item.settings) : null,
                translations: item.translations.map(value => ({ ...value })),
            })),
        };
    return {
        code: 'storefront-client-plugins',
        internalName: '客户端插件配置',
        type: 'CLIENT_PLUGINS',
        layoutVariant: 'CUSTOM',
        enabled: true,
        position: 10001,
        startsAt: null,
        endsAt: null,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: { version: 1, page: 'category' },
        translations: [
            { ...emptyBlockTranslation('zh_Hans'), title: '客户端插件配置' },
            { ...emptyBlockTranslation('en'), title: 'Storefront client plugins' },
        ],
        items: [],
    };
}
function addPlugin(block: StorefrontContentBlock, definition: PluginDefinition) {
    if (block.items.some(item => pluginCode(item) === definition.code)) return block;
    const item: StorefrontContentItem = {
        enabled: true,
        position: block.items.length,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        targetType: 'NONE',
        targetValue: null,
        settings: {
            pluginCode: definition.code,
            placement: definition.defaultPlacement,
            categoryScope: 'ALL',
            categoryIds: [],
            includeChildren: true,
        },
        translations: [
            {
                ...emptyItemTranslation('zh_Hans'),
                label: definition.name,
                description: definition.description,
            },
            {
                ...emptyItemTranslation('en'),
                label: definition.englishName,
                description: definition.englishDescription,
            },
        ],
    };
    return { ...block, items: [...block.items, item] };
}
function removePlugin(block: StorefrontContentBlock, code: string) {
    return {
        ...block,
        items: block.items
            .filter(item => pluginCode(item) !== code)
            .map((item, position) => ({ ...item, position })),
    };
}
function movePlugin(items: StorefrontContentItem[], from: number, to: number) {
    if (to < 0 || to >= items.length) return items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next.map((item, position) => ({ ...item, position }));
}
function pluginCode(item: StorefrontContentItem) {
    return typeof item.settings?.pluginCode === 'string' ? item.settings.pluginCode : null;
}
function pluginPlacement(item: StorefrontContentItem): Placement | null {
    const value = item.settings?.placement;
    return placementOptions.some(option => option[0] === value) ? (value as Placement) : null;
}
function pluginScope(item: StorefrontContentItem): CategoryScope {
    return item.settings?.categoryScope === 'SELECTED' ? 'SELECTED' : 'ALL';
}
function pluginCategoryIds(item: StorefrontContentItem): string[] {
    const value = item.settings?.categoryIds;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}
function pluginIncludeChildren(item: StorefrontContentItem) {
    return typeof item.settings?.includeChildren === 'boolean' ? item.settings.includeChildren : true;
}
function validateDraft(block: StorefrontContentBlock): string | null {
    const codes = block.items.map(pluginCode);
    if (codes.some(code => !code || !catalog.some(item => item.code === code)))
        return '包含当前平台未发布的插件';
    if (new Set(codes).size !== codes.length) return '插件配置重复';
    for (const item of block.items) {
        const placement = pluginPlacement(item);
        if (!placement) return '请为每个插件选择展示位置';
        if (
            placement !== 'BUSINESS_SERVICES_MAIN' &&
            pluginScope(item) === 'SELECTED' &&
            !pluginCategoryIds(item).length
        )
            return '“仅指定分类”至少需要勾选一个分类';
    }
    return null;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            {children}
        </label>
    );
}
function IconButton({
    label,
    disabled,
    onClick,
    icon: Icon,
    danger = false,
}: {
    label: string;
    disabled: boolean;
    onClick: () => void;
    icon: typeof ArrowUp;
    danger?: boolean;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={`rounded-md p-1.5 disabled:opacity-30 ${danger ? 'text-rose-500 hover:bg-rose-50' : 'text-slate-500 hover:bg-white'}`}
        >
            <Icon className="h-3.5 w-3.5" />
        </button>
    );
}
function LoadingState() {
    return (
        <div className="flex min-h-80 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在读取真实插件配置…
        </div>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <h2 className="mt-3 text-sm font-bold text-slate-800">插件配置加载失败</h2>
            <p className="mt-1 max-w-lg text-xs text-rose-600">{toUserFacingError(message)}</p>
            <button
                type="button"
                onClick={onRetry}
                className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
            >
                重试
            </button>
        </div>
    );
}
function Message({
    kind,
    onClose,
    children,
}: {
    kind: 'success' | 'error';
    onClose: () => void;
    children: React.ReactNode;
}) {
    const success = kind === 'success';
    return (
        <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}
        >
            {success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <span className="flex-1">{children}</span>
            <button type="button" onClick={onClose} aria-label="关闭">
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
