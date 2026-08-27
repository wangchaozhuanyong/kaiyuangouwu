import {
    Alert,
    AlertDescription,
    AssetPickerDialog,
    Badge,
    Button,
    ChannelCodeLabel,
    DashboardRouteDefinition,
    ImageSizeHint,
    Input,
    Label,
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
    ArrowUp,
    GripVertical,
    Image as ImageIcon,
    ImagePlus,
    Plus,
    RefreshCw,
    Save,
    Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
    ContentBlock,
    ContentItem,
    StorefrontContentBlocksResult,
    createStorefrontContentBlockMutation,
    storefrontContentBlocksQuery,
    updateStorefrontContentBlockMutation,
    versionedContentBlockUpdate,
} from './storefront-content.graphql';
import {
    MAX_NAVIGATION_ITEMS,
    createEmptyNavigationItem,
    createNavigationDraft,
    moveNavigationItem,
    navigationBlockInput,
    navigationDraftIsValid,
    navigationTargetOptions,
} from './storefront-navigation-config';

export const storefrontNavigationRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketing',
        id: 'storefront-navigation',
        url: '/storefront-navigation',
        title: '客户端导航',
        requiresPermission: ['ReadStorefrontContent'],
    },
    path: '/storefront-navigation',
    loader: () => ({ breadcrumb: () => '客户端导航' }),
    component: () => <StorefrontNavigationPage />,
};

function StorefrontNavigationPage() {
    const { activeChannel } = useChannel();
    const queryClient = useQueryClient();
    const queryKey = ['storefront-content-blocks', activeChannel?.id];
    const [draft, setDraft] = useState<ContentBlock | null>(null);
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const contentQuery = useQuery({
        queryKey,
        queryFn: () => api.query<StorefrontContentBlocksResult>(storefrontContentBlocksQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const navigationBlock = useMemo(
        () =>
            contentQuery.data?.storefrontContentBlocks.find(
                block => block.type === 'NAVIGATION' && block.code === 'storefront-navigation',
            ),
        [contentQuery.data?.storefrontContentBlocks],
    );

    useEffect(() => {
        if (!activeChannel?.id || contentQuery.isPending) return;
        setDraft(createNavigationDraft(navigationBlock));
    }, [activeChannel?.id, contentQuery.isPending, navigationBlock]);

    const saveMutation = useMutation({
        mutationFn: async (block: ContentBlock) => {
            const input = navigationBlockInput(block);
            return block.id
                ? api.mutate(updateStorefrontContentBlockMutation, {
                      input: versionedContentBlockUpdate(block, input),
                  })
                : api.mutate(createStorefrontContentBlockMutation, { input });
        },
        onSuccess: async () => {
            toast.success('客户端导航已保存');
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : String(error)),
    });

    const updateItem = (index: number, next: ContentItem) => {
        if (!draft) return;
        setDraft({
            ...draft,
            items: draft.items.map((item, currentIndex) => (currentIndex === index ? next : item)),
        });
    };
    const reorder = (fromIndex: number, toIndex: number) => {
        if (!draft) return;
        setDraft({ ...draft, items: moveNavigationItem(draft.items, fromIndex, toIndex) });
    };
    const valid = Boolean(draft && navigationDraftIsValid(draft));
    const isDirty = Boolean(
        draft && JSON.stringify(draft) !== JSON.stringify(createNavigationDraft(navigationBlock)),
    );

    return (
        <Page pageId="storefront-navigation">
            <UnsavedChangesConfirmation when={isDirty} />
            <PageTitle>客户端导航</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button
                        disabled={!draft || !valid || saveMutation.isPending}
                        onClick={() => draft && saveMutation.mutate(draft)}
                    >
                        <Save className="size-4" aria-hidden="true" />
                        {saveMutation.isPending ? '正在保存' : '保存导航'}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="storefront-navigation-editor"
                    title="底部主导航"
                    description="为当前店铺设置 1 到 5 个导航项目；可以修改名称、页面、顺序和图标。未保存配置时客户端继续使用系统默认导航。"
                >
                    <div className="mb-5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>当前店铺</span>
                        <Badge variant="outline">
                            {activeChannel ? <ChannelCodeLabel code={activeChannel.code} /> : '-'}
                        </Badge>
                        <Badge variant="secondary">最多 {MAX_NAVIGATION_ITEMS} 项</Badge>
                    </div>

                    {contentQuery.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription className="flex items-center justify-between gap-3">
                                <span>客户端导航加载失败</span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void contentQuery.refetch()}
                                >
                                    <RefreshCw className="size-4" aria-hidden="true" />
                                    重试
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : contentQuery.isPending || !draft ? (
                        <div className="space-y-3" aria-busy="true">
                            <Skeleton className="h-40 w-full" />
                            <Skeleton className="h-40 w-full" />
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {!valid ? (
                                <Alert variant="destructive">
                                    <AlertDescription>
                                        每个导航项目都需要填写中文名称并选择跳转页面，导航总数不能超过 5 项。
                                    </AlertDescription>
                                </Alert>
                            ) : null}

                            <NavigationPreview items={draft.items} />

                            <div className="space-y-3">
                                {draft.items.map((item, index) => (
                                    <NavigationItemEditor
                                        key={item.id ?? `navigation-item-${index}`}
                                        item={item}
                                        index={index}
                                        count={draft.items.length}
                                        dragging={draggedIndex === index}
                                        onChange={next => updateItem(index, next)}
                                        onMove={direction => reorder(index, index + direction)}
                                        onRemove={() =>
                                            setDraft({
                                                ...draft,
                                                items: draft.items
                                                    .filter((_, currentIndex) => currentIndex !== index)
                                                    .map((current, currentIndex) => ({
                                                        ...current,
                                                        position: currentIndex,
                                                    })),
                                            })
                                        }
                                        onDragStart={() => setDraggedIndex(index)}
                                        onDragEnd={() => setDraggedIndex(null)}
                                        onDrop={() => {
                                            if (draggedIndex != null) reorder(draggedIndex, index);
                                            setDraggedIndex(null);
                                        }}
                                    />
                                ))}
                            </div>

                            <Button
                                type="button"
                                variant="outline"
                                disabled={draft.items.length >= MAX_NAVIGATION_ITEMS}
                                onClick={() =>
                                    setDraft({
                                        ...draft,
                                        items: [
                                            ...draft.items,
                                            createEmptyNavigationItem(draft.items.length),
                                        ],
                                    })
                                }
                            >
                                <Plus className="size-4" aria-hidden="true" />
                                添加导航项目
                            </Button>
                        </div>
                    )}
                </PageBlock>
            </PageLayout>
        </Page>
    );
}

function NavigationItemEditor({
    item,
    index,
    count,
    dragging,
    onChange,
    onMove,
    onRemove,
    onDragStart,
    onDragEnd,
    onDrop,
}: Readonly<{
    item: ContentItem;
    index: number;
    count: number;
    dragging: boolean;
    onChange: (item: ContentItem) => void;
    onMove: (direction: -1 | 1) => void;
    onRemove: () => void;
    onDragStart: () => void;
    onDragEnd: () => void;
    onDrop: () => void;
}>) {
    const updateTranslation = (languageCode: 'zh_Hans' | 'en', label: string) =>
        onChange({
            ...item,
            translations: item.translations.map(translation =>
                translation.languageCode === languageCode ? { ...translation, label } : translation,
            ),
        });
    const zhLabel = item.translations.find(value => value.languageCode === 'zh_Hans')?.label ?? '';
    const enLabel = item.translations.find(value => value.languageCode === 'en')?.label ?? '';

    return (
        <div
            className={`rounded-lg border bg-background p-4 transition-opacity ${dragging ? 'opacity-50' : ''}`}
            draggable
            onDragStart={event => {
                event.dataTransfer.effectAllowed = 'move';
                onDragStart();
            }}
            onDragEnd={onDragEnd}
            onDragOver={event => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={event => {
                event.preventDefault();
                onDrop();
            }}
        >
            <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span
                        className="flex size-8 cursor-grab items-center justify-center rounded text-muted-foreground active:cursor-grabbing"
                        title="拖动排序"
                    >
                        <GripVertical className="size-4" aria-hidden="true" />
                    </span>
                    <strong className="text-sm">导航 {index + 1}</strong>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={index === 0}
                        aria-label="上移"
                        onClick={() => onMove(-1)}
                    >
                        <ArrowUp className="size-4" />
                    </Button>
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={index === count - 1}
                        aria-label="下移"
                        onClick={() => onMove(1)}
                    >
                        <ArrowDown className="size-4" />
                    </Button>
                    <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        disabled={count === 1}
                        aria-label="删除导航项目"
                        onClick={onRemove}
                    >
                        <Trash2 className="size-4" />
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]">
                <NavigationIconPicker
                    item={item}
                    onChange={asset =>
                        onChange({
                            ...item,
                            imageAsset: asset,
                            imageAssetId: asset?.id ?? null,
                            imageUrl: asset?.preview ?? null,
                        })
                    }
                />
                <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
                    <Field label="中文名称">
                        <Input
                            value={zhLabel}
                            maxLength={20}
                            placeholder="例如：首页"
                            onChange={event => updateTranslation('zh_Hans', event.target.value)}
                        />
                    </Field>
                    <Field label="英文名称（可选）">
                        <Input
                            value={enLabel}
                            maxLength={20}
                            placeholder="未填写时自动翻译"
                            onChange={event => updateTranslation('en', event.target.value)}
                        />
                    </Field>
                </div>
                <Field label="跳转页面">
                    <Select
                        value={item.targetValue ?? '/'}
                        onValueChange={value =>
                            value && onChange({ ...item, targetType: 'PAGE', targetValue: value })
                        }
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {navigationTargetOptions.map(option => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.zh}
                                    <span className="ml-2 text-muted-foreground">{option.value}</span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
            </div>
        </div>
    );
}

function NavigationIconPicker({
    item,
    onChange,
}: Readonly<{
    item: ContentItem;
    onChange: (asset: NonNullable<ContentItem['imageAsset']> | null) => void;
}>) {
    const [open, setOpen] = useState(false);
    const preview = item.imageAsset?.preview ?? item.imageUrl;
    return (
        <Field label="导航图标">
            <div className="flex items-center gap-3 rounded-md border p-3">
                {preview ? (
                    <img className="size-14 rounded-md border object-contain p-1" src={preview} alt="" />
                ) : (
                    <div className="flex size-14 items-center justify-center rounded-md border border-dashed bg-muted/40">
                        <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                    </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
                        <ImagePlus className="size-4" aria-hidden="true" />
                        {preview ? '替换图标' : '选择图标'}
                    </Button>
                    {preview ? (
                        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
                            使用系统图标
                        </Button>
                    ) : null}
                </div>
            </div>
            <ImageSizeHint guidance="icon" />
            <AssetPickerDialog
                open={open}
                onClose={() => setOpen(false)}
                onSelect={assets => onChange(assets[0] ?? null)}
                initialSelectedAssets={item.imageAsset ? [item.imageAsset] : []}
                title="选择导航图标"
                imageGuidance="icon"
            />
        </Field>
    );
}

function NavigationPreview({ items }: Readonly<{ items: ContentItem[] }>) {
    return (
        <div className="rounded-lg border bg-muted/20 p-4">
            <p className="mb-3 text-xs font-medium text-muted-foreground">客户端预览</p>
            <div
                className="mx-auto grid max-w-[430px] rounded-xl border bg-background px-2 py-2 shadow-sm"
                style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
            >
                {items.map((item, index) => {
                    const label =
                        item.translations.find(value => value.languageCode === 'zh_Hans')?.label ||
                        `导航 ${index + 1}`;
                    const preview = item.imageAsset?.preview ?? item.imageUrl;
                    return (
                        <div
                            key={item.id ?? index}
                            className="flex min-w-0 flex-col items-center gap-1 px-1 py-1"
                        >
                            {preview ? (
                                <img className="size-6 object-contain" src={preview} alt="" />
                            ) : (
                                <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
                            )}
                            <span className="max-w-full truncate text-[11px]">{label}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
    return (
        <div className="min-w-0 space-y-2">
            <Label>{label}</Label>
            {children}
        </div>
    );
}
