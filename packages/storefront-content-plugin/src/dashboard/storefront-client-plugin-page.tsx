import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    ChannelCodeLabel,
    DashboardRouteDefinition,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    Switch,
    UnsavedChangesConfirmation,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    Headphones,
    PackagePlus,
    Puzzle,
    RefreshCw,
    Save,
    TicketPercent,
    Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
    CLIENT_PLUGIN_BLOCK_CODE,
    ClientPluginCategoryRule,
    ClientPluginDefinition,
    ClientPluginPlacement,
    addClientPlugin,
    clientPluginBlockInput,
    clientPluginCatalog,
    clientPluginCategoryRule,
    clientPluginCode,
    clientPluginDraftIsValid,
    clientPluginPlacement,
    clientPluginPlacementOptions,
    createClientPluginDraft,
    moveClientPlugin,
    placeClientPlugin,
    removeClientPlugin,
    targetClientPluginCategories,
} from './storefront-client-plugin-config';
import {
    ContentBlock,
    StorefrontClientPluginCollection,
    StorefrontClientPluginCollectionsResult,
    StorefrontContentBlocksResult,
    createStorefrontContentBlockMutation,
    storefrontClientPluginCollectionsQuery,
    storefrontContentBlocksQuery,
    updateStorefrontContentBlockMutation,
    versionedContentBlockUpdate,
} from './storefront-content.graphql';

export const storefrontClientPluginRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketing',
        id: 'storefront-client-plugins',
        url: '/storefront-client-plugins',
        title: '客户端插件中心',
        requiresPermission: ['ReadStorefrontContent'],
    },
    path: '/storefront-client-plugins',
    loader: () => ({ breadcrumb: () => '客户端插件中心' }),
    component: () => <StorefrontClientPluginPage />,
};

function StorefrontClientPluginPage() {
    const { activeChannel } = useChannel();
    const queryClient = useQueryClient();
    const queryKey = ['storefront-content-blocks', activeChannel?.id];
    const [draft, setDraft] = useState<ContentBlock | null>(null);
    const contentQuery = useQuery({
        queryKey,
        queryFn: () => api.query<StorefrontContentBlocksResult>(storefrontContentBlocksQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const collectionsQuery = useQuery({
        queryKey: ['storefront-client-plugin-collections', activeChannel?.id],
        queryFn: () =>
            api.query<StorefrontClientPluginCollectionsResult>(storefrontClientPluginCollectionsQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const collections = collectionsQuery.data?.collections.items ?? [];
    const pluginBlock = useMemo(
        () =>
            contentQuery.data?.storefrontContentBlocks.find(
                block => block.type === 'CLIENT_PLUGINS' && block.code === CLIENT_PLUGIN_BLOCK_CODE,
            ),
        [contentQuery.data?.storefrontContentBlocks],
    );

    useEffect(() => {
        if (!activeChannel?.id || contentQuery.isError) {
            setDraft(null);
            return;
        }
        if (contentQuery.isPending) return;
        setDraft(createClientPluginDraft(pluginBlock));
    }, [activeChannel?.id, contentQuery.isError, contentQuery.isPending, pluginBlock]);

    const saveMutation = useMutation({
        mutationFn: async (block: ContentBlock) => {
            const input = clientPluginBlockInput(block);
            return block.id
                ? api.mutate(updateStorefrontContentBlockMutation, {
                      input: versionedContentBlockUpdate(block, input),
                  })
                : api.mutate(createStorefrontContentBlockMutation, { input });
        },
        onSuccess: async () => {
            toast.success('客户端插件配置已保存');
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : String(error)),
    });

    const installedCodes = new Set(draft?.items.map(clientPluginCode).filter(Boolean) ?? []);
    const valid = Boolean(draft && clientPluginDraftIsValid(draft));
    const configReady = Boolean(draft && !contentQuery.isPending && !contentQuery.isError);
    const isDirty = Boolean(
        configReady && JSON.stringify(draft) !== JSON.stringify(createClientPluginDraft(pluginBlock)),
    );
    const contentErrorMessage = contentQuery.isError
        ? contentQuery.error instanceof Error
            ? contentQuery.error.message
            : String(contentQuery.error)
        : null;

    return (
        <Page pageId="storefront-client-plugins">
            <UnsavedChangesConfirmation when={isDirty} />
            <PageTitle>客户端插件中心</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button
                        disabled={!configReady || !valid || saveMutation.isPending}
                        onClick={() => draft && saveMutation.mutate(draft)}
                    >
                        <Save className="size-4" aria-hidden="true" />
                        {saveMutation.isPending ? '正在保存' : '保存插件配置'}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="storefront-client-plugin-catalog"
                    title="平台插件"
                    description="这里只展示平台自行开发并发布的插件。商家不能上传或执行第三方代码。"
                >
                    <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>当前店铺</span>
                        <Badge variant="outline">
                            {activeChannel ? <ChannelCodeLabel code={activeChannel.code} /> : '-'}
                        </Badge>
                        <Badge variant="secondary">商品分类页 / 商业服务页</Badge>
                        <Badge variant="outline">{clientPluginCatalog.length} 个可用插件</Badge>
                    </div>

                    {contentQuery.isError ? (
                        <Alert variant="destructive" className="mb-4">
                            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                                <span className="min-w-0">
                                    <strong className="block">插件配置加载失败</strong>
                                    <span className="mt-1 block break-words text-xs">
                                        {contentErrorMessage || '请确认管理接口可用后重试。'}
                                    </span>
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={contentQuery.isFetching}
                                    onClick={() => void contentQuery.refetch()}
                                >
                                    <RefreshCw
                                        className={`size-4 ${contentQuery.isFetching ? 'animate-spin' : ''}`}
                                        aria-hidden="true"
                                    />
                                    {contentQuery.isFetching ? '重试中' : '重试'}
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : null}

                    {contentQuery.isPending || (!draft && !contentQuery.isError) ? (
                        <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
                            <Skeleton className="h-44 w-full" />
                            <Skeleton className="h-44 w-full" />
                        </div>
                    ) : (
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {clientPluginCatalog.map(definition => (
                                <PluginCatalogCard
                                    key={definition.code}
                                    definition={definition}
                                    installed={installedCodes.has(definition.code)}
                                    disabled={!configReady}
                                    onAdd={() =>
                                        setDraft(current => current && addClientPlugin(current, definition))
                                    }
                                    onRemove={() =>
                                        setDraft(current =>
                                            current ? removeClientPlugin(current, definition.code) : current,
                                        )
                                    }
                                />
                            ))}
                        </div>
                    )}
                </PageBlock>

                <PageBlock
                    column="full"
                    blockId="storefront-client-plugin-layout"
                    title="已添加到客户端"
                    description="选择插件显示在商品分类页或商业服务页；同一位置的插件按照这里的顺序显示。"
                >
                    {contentQuery.isError ? (
                        <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
                            <RefreshCw className="size-8 text-muted-foreground" aria-hidden="true" />
                            <strong className="text-sm">暂时无法读取已添加的插件</strong>
                            <span className="text-sm text-muted-foreground">
                                恢复插件配置连接后，此处会显示当前店铺的插件。
                            </span>
                        </div>
                    ) : !draft || contentQuery.isPending ? (
                        <Skeleton className="h-36 w-full" aria-busy="true" />
                    ) : !draft.items.length ? (
                        <div className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
                            <Puzzle className="size-8 text-muted-foreground" aria-hidden="true" />
                            <strong className="text-sm">还没有添加客户端插件</strong>
                            <span className="text-sm text-muted-foreground">
                                从上方平台插件中选择“添加到客户端”。
                            </span>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {!valid ? (
                                <Alert variant="destructive">
                                    <AlertDescription>
                                        插件配置不完整，请选择有效位置；使用“指定分类”时至少选择一个分类。
                                    </AlertDescription>
                                </Alert>
                            ) : null}
                            {draft.items.map((item, index) => {
                                const code = clientPluginCode(item) ?? '';
                                const definition = clientPluginCatalog.find(entry => entry.code === code);
                                const placement = clientPluginPlacement(item) ?? 'BEFORE_PRODUCT_LIST';
                                const categoryRule = clientPluginCategoryRule(item) ?? {
                                    scope: 'ALL' as const,
                                    categoryIds: [],
                                    includeChildren: true,
                                };
                                return (
                                    <InstalledPluginEditor
                                        key={item.id ?? code ?? `client-plugin-${index}`}
                                        code={code}
                                        name={definition?.name ?? item.label ?? code}
                                        description={
                                            definition?.description ??
                                            item.description ??
                                            '当前版本未登记的插件'
                                        }
                                        version={definition?.version}
                                        placement={placement}
                                        categoryRule={categoryRule}
                                        collections={collections}
                                        collectionsLoading={collectionsQuery.isPending}
                                        collectionsError={collectionsQuery.isError}
                                        index={index}
                                        count={draft.items.length}
                                        onPlacementChange={nextPlacement =>
                                            setDraft(current =>
                                                current
                                                    ? placeClientPlugin(current, code, nextPlacement)
                                                    : current,
                                            )
                                        }
                                        onCategoryRuleChange={nextRule =>
                                            setDraft(current =>
                                                current
                                                    ? targetClientPluginCategories(current, code, nextRule)
                                                    : current,
                                            )
                                        }
                                        onMove={direction =>
                                            setDraft(current =>
                                                current
                                                    ? moveClientPlugin(current, index, index + direction)
                                                    : current,
                                            )
                                        }
                                        onRemove={() =>
                                            setDraft(current =>
                                                current ? removeClientPlugin(current, code) : current,
                                            )
                                        }
                                    />
                                );
                            })}
                        </div>
                    )}
                </PageBlock>
            </PageLayout>
        </Page>
    );
}

function PluginCatalogCard({
    definition,
    installed,
    disabled,
    onAdd,
    onRemove,
}: Readonly<{
    definition: ClientPluginDefinition;
    installed: boolean;
    disabled: boolean;
    onAdd: () => void;
    onRemove: () => void;
}>) {
    const Icon = definition.code === 'category-coupon-entry' ? TicketPercent : Headphones;
    return (
        <article className="flex min-h-44 flex-col rounded-lg border bg-background p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
                <span className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="flex items-center gap-2">
                    <Badge variant="outline">v{definition.version}</Badge>
                    <Badge variant={disabled ? 'outline' : installed ? 'default' : 'secondary'}>
                        {disabled ? '状态未知' : installed ? '已添加' : '可添加'}
                    </Badge>
                </div>
            </div>
            <strong>{definition.name}</strong>
            <span className="mt-1 text-xs text-muted-foreground">{definition.code}</span>
            <p className="mt-3 flex-1 text-sm text-muted-foreground">{definition.description}</p>
            <Button
                type="button"
                className="mt-4 w-full"
                variant={installed ? 'outline' : 'default'}
                disabled={disabled}
                onClick={installed ? onRemove : onAdd}
            >
                {installed ? <Trash2 className="size-4" /> : <PackagePlus className="size-4" />}
                {disabled ? '配置恢复后可操作' : installed ? '从客户端移除' : '添加到客户端'}
            </Button>
        </article>
    );
}

function InstalledPluginEditor({
    code,
    name,
    description,
    version,
    placement,
    categoryRule,
    collections,
    collectionsLoading,
    collectionsError,
    index,
    count,
    onPlacementChange,
    onCategoryRuleChange,
    onMove,
    onRemove,
}: Readonly<{
    code: string;
    name: string;
    description: string;
    version?: string;
    placement: ClientPluginPlacement;
    categoryRule: ClientPluginCategoryRule;
    collections: StorefrontClientPluginCollection[];
    collectionsLoading: boolean;
    collectionsError: boolean;
    index: number;
    count: number;
    onPlacementChange: (placement: ClientPluginPlacement) => void;
    onCategoryRuleChange: (rule: ClientPluginCategoryRule) => void;
    onMove: (direction: -1 | 1) => void;
    onRemove: () => void;
}>) {
    const selectedPlacement = clientPluginPlacementOptions.find(option => option.value === placement);
    const collectionNames = new Map(collections.map(collection => [collection.id, collection.name]));
    const toggleCategory = (categoryId: string) =>
        onCategoryRuleChange({
            ...categoryRule,
            categoryIds: categoryRule.categoryIds.includes(categoryId)
                ? categoryRule.categoryIds.filter(id => id !== categoryId)
                : [...categoryRule.categoryIds, categoryId],
        });
    return (
        <article className="rounded-lg border bg-background p-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)_auto] lg:items-center">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <Puzzle className="size-4 text-primary" aria-hidden="true" />
                        <strong className="text-sm">{name}</strong>
                        {version ? <Badge variant="outline">v{version}</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                    <span className="mt-1 block text-xs text-muted-foreground">{code}</span>
                </div>
                <div>
                    <span className="mb-1.5 block text-sm font-medium">客户端显示位置</span>
                    <Select value={placement} onValueChange={value => value && onPlacementChange(value)}>
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {clientPluginPlacementOptions.map(option => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <span className="mt-1 block text-xs text-muted-foreground">
                        {selectedPlacement?.description}
                    </span>
                </div>
                <div className="flex items-center justify-end gap-1">
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={index === 0}
                        aria-label="上移插件"
                        onClick={() => onMove(-1)}
                    >
                        <ArrowUp className="size-4" />
                    </Button>
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={index === count - 1}
                        aria-label="下移插件"
                        onClick={() => onMove(1)}
                    >
                        <ArrowDown className="size-4" />
                    </Button>
                    <ArrowRight className="mx-1 size-4 text-muted-foreground" aria-hidden="true" />
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="移除插件"
                        onClick={onRemove}
                    >
                        <Trash2 className="size-4" />
                    </Button>
                </div>
            </div>
            <div className="mt-4 border-t pt-4">
                {placement === 'BUSINESS_SERVICES_MAIN' ? (
                    <div className="rounded-md border border-dashed p-4">
                        <strong className="block text-sm">商业服务页展示</strong>
                        <span className="mt-1 block text-xs text-muted-foreground">
                            此位置不受商品分类限制，会直接显示在“商业服务”页面。
                        </span>
                    </div>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.35fr)_minmax(0,1fr)]">
                        <div>
                            <span className="mb-1.5 block text-sm font-medium">显示分类范围</span>
                            <Select
                                value={categoryRule.scope}
                                onValueChange={scope =>
                                    scope && onCategoryRuleChange({ ...categoryRule, scope })
                                }
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">全部分类</SelectItem>
                                    <SelectItem value="SELECTED">指定分类</SelectItem>
                                </SelectContent>
                            </Select>
                            <span className="mt-1 block text-xs text-muted-foreground">
                                {categoryRule.scope === 'ALL'
                                    ? '现在和以后新增的所有分类都会显示。'
                                    : '只在右侧选择的分类中显示。'}
                            </span>
                        </div>

                        {categoryRule.scope === 'SELECTED' ? (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                                    <div>
                                        <strong className="block text-sm">包含子分类</strong>
                                        <span className="text-xs text-muted-foreground">
                                            选择一级分类后，也在它下面的二级分类显示。
                                        </span>
                                    </div>
                                    <Switch
                                        checked={categoryRule.includeChildren}
                                        onCheckedChange={includeChildren =>
                                            onCategoryRuleChange({ ...categoryRule, includeChildren })
                                        }
                                    />
                                </div>
                                {collectionsLoading ? (
                                    <Skeleton className="h-24 w-full" aria-busy="true" />
                                ) : collectionsError ? (
                                    <Alert variant="destructive">
                                        <AlertDescription>商品分类加载失败，请刷新后重试。</AlertDescription>
                                    </Alert>
                                ) : collections.length ? (
                                    <div className="max-h-44 overflow-y-auto rounded-md border p-3">
                                        <div className="flex flex-wrap gap-2">
                                            {collections.map(collection => {
                                                const selected = categoryRule.categoryIds.includes(
                                                    collection.id,
                                                );
                                                const parentName = collectionNames.get(collection.parentId);
                                                return (
                                                    <Button
                                                        key={collection.id}
                                                        type="button"
                                                        size="sm"
                                                        variant={selected ? 'default' : 'outline'}
                                                        aria-pressed={selected}
                                                        onClick={() => toggleCategory(collection.id)}
                                                    >
                                                        {parentName ? `${parentName} / ` : ''}
                                                        {collection.name}
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                                        当前店铺还没有可选择的商品分类。
                                    </div>
                                )}
                                <span className="block text-xs text-muted-foreground">
                                    已选择 {categoryRule.categoryIds.length} 个分类
                                </span>
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </article>
    );
}
