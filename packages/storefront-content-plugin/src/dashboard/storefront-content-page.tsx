import { useLingui } from '@lingui/react';
import {
    Alert,
    AlertDescription,
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Badge,
    Button,
    DashboardRouteDefinition,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
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
    Separator,
    Skeleton,
    Switch,
    Textarea,
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
    Eye,
    EyeOff,
    Image as ImageIcon,
    LayoutTemplate,
    Pencil,
    Plus,
    RefreshCw,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
    ContentBlock,
    ContentBlockTranslation,
    ContentBlockType,
    ContentItem,
    ContentTargetType,
    StorefrontContentBlocksResult,
    createStorefrontContentBlockMutation,
    deleteStorefrontContentBlockMutation,
    reorderStorefrontContentBlocksMutation,
    storefrontContentBlocksQuery,
    updateStorefrontContentBlockMutation,
    updateStorefrontContentSettingsMutation,
} from './storefront-content.graphql';

const blockTypes: ContentBlockType[] = [
    'HERO',
    'NOTICE',
    'QUICK_LINKS',
    'CATEGORY_AD',
    'FEATURED_COLLECTION',
    'STORY',
    'LEGAL',
    'SUPPORT',
];
const targetTypes: ContentTargetType[] = [
    'NONE',
    'URL',
    'PRODUCT',
    'COLLECTION',
    'CATEGORY',
    'SEARCH',
    'PAGE',
    'SUPPORT',
];

const zhCopy = {
    title: '店铺装修',
    description: '管理当前店铺的首页内容、条款和客服信息。切换店铺后会自动读取对应 Channel。',
    add: '新建区块',
    empty: '当前店铺还没有装修内容',
    emptyHint: '新建第一个区块后，客户端会按启用状态和生效时间自动展示。',
    loadError: '装修内容加载失败',
    retry: '重试',
    enabled: '已上线',
    disabled: '已下线',
    scheduled: '定时',
    edit: '编辑区块',
    moveUp: '上移',
    moveDown: '下移',
    delete: '删除区块',
    deleteTitle: '删除这个装修区块？',
    deleteDescription: '区块及其所有条目和翻译将一并删除，客户端会立即停止展示。',
    cancel: '取消',
    createTitle: '新建装修区块',
    updateTitle: '编辑装修区块',
    editorDescription: '内容始终保存到当前 Channel，不会影响其他店铺。',
    basic: '区块设置',
    code: '区块编码',
    codeHint: '小写字母、数字和短横线，例如 home-hero。',
    type: '区块类型',
    position: '排序',
    status: '启用区块',
    statusHint: '关闭后 Shop API 不再返回此区块。',
    startsAt: '开始时间',
    endsAt: '结束时间',
    imageUrl: '图片地址',
    imageHint: '支持站内 /assets 路径或 HTTP(S) 地址。',
    backgroundColor: '背景色',
    textColor: '文字色',
    targetType: '跳转类型',
    targetValue: '跳转目标',
    targetHint: '根据类型填写商品 ID、集合 ID、搜索词、页面路径或链接。',
    translations: '多语言内容',
    chinese: '中文',
    english: 'English',
    blockTitle: '标题',
    subtitle: '副标题',
    body: '正文',
    cta: '按钮文字',
    items: '区块条目',
    addItem: '添加条目',
    item: '条目',
    itemLabel: '名称',
    itemDescription: '说明',
    removeItem: '移除条目',
    preview: '移动端预览',
    previewEmpty: '填写标题后预览会显示在这里',
    save: '保存区块',
    saving: '正在保存',
    created: '装修区块已创建',
    updated: '装修区块已更新',
    deleted: '装修区块已删除',
    reordered: '区块顺序已更新',
    validation: '请填写区块编码以及中英文标题',
    activeChannel: '当前店铺',
    carouselSettings: '首页轮播设置',
    carouselSettingsDescription:
        '配置当前店铺首页广告的自动切换速度。用户手动切换后，本次访问将停止自动轮播。',
    autoplayInterval: '自动切换间隔',
    autoplayIntervalHint: '填写 3 到 30 之间的整数，单位为秒；默认 5 秒。',
    autoplayIntervalInvalid: '自动切换间隔必须是 3 到 30 秒之间的整数',
    saveCarouselSettings: '保存轮播设置',
    carouselSettingsUpdated: '轮播设置已更新',
};

const enCopy: typeof zhCopy = {
    title: 'Storefront content',
    description:
        'Manage homepage content, legal text and support details for the active store. Switching stores loads its Channel content.',
    add: 'New block',
    empty: 'This store has no content blocks',
    emptyHint: 'Create the first block. The storefront respects its status and schedule automatically.',
    loadError: 'Could not load storefront content',
    retry: 'Retry',
    enabled: 'Published',
    disabled: 'Offline',
    scheduled: 'Scheduled',
    edit: 'Edit block',
    moveUp: 'Move up',
    moveDown: 'Move down',
    delete: 'Delete block',
    deleteTitle: 'Delete this content block?',
    deleteDescription:
        'The block, its items and translations will be removed. The storefront will stop showing it immediately.',
    cancel: 'Cancel',
    createTitle: 'New content block',
    updateTitle: 'Edit content block',
    editorDescription: 'Content is saved only to the active Channel and never affects another store.',
    basic: 'Block settings',
    code: 'Block code',
    codeHint: 'Lowercase letters, numbers and hyphens, for example home-hero.',
    type: 'Block type',
    position: 'Position',
    status: 'Enable block',
    statusHint: 'When disabled, the Shop API no longer returns this block.',
    startsAt: 'Starts at',
    endsAt: 'Ends at',
    imageUrl: 'Image URL',
    imageHint: 'Use an internal /assets path or an HTTP(S) URL.',
    backgroundColor: 'Background',
    textColor: 'Text color',
    targetType: 'Target type',
    targetValue: 'Target value',
    targetHint: 'Enter a product ID, collection ID, search term, page path or URL for the selected type.',
    translations: 'Localized content',
    chinese: '中文',
    english: 'English',
    blockTitle: 'Title',
    subtitle: 'Subtitle',
    body: 'Body',
    cta: 'Button label',
    items: 'Block items',
    addItem: 'Add item',
    item: 'Item',
    itemLabel: 'Label',
    itemDescription: 'Description',
    removeItem: 'Remove item',
    preview: 'Mobile preview',
    previewEmpty: 'Enter a title to see the preview',
    save: 'Save block',
    saving: 'Saving',
    created: 'Content block created',
    updated: 'Content block updated',
    deleted: 'Content block deleted',
    reordered: 'Block order updated',
    validation: 'Enter a block code and both Chinese and English titles',
    activeChannel: 'Active store',
    carouselSettings: 'Homepage carousel settings',
    carouselSettingsDescription:
        'Set the automatic rotation speed for this store. Autoplay stops for the visit after a customer changes slides manually.',
    autoplayInterval: 'Autoplay interval',
    autoplayIntervalHint: 'Enter a whole number from 3 to 30 seconds. The default is 5 seconds.',
    autoplayIntervalInvalid: 'The autoplay interval must be a whole number from 3 to 30 seconds',
    saveCarouselSettings: 'Save carousel settings',
    carouselSettingsUpdated: 'Carousel settings updated',
};

const blockTypeLabels: Record<ContentBlockType, { zh: string; en: string }> = {
    HERO: { zh: '首页主视觉', en: 'Hero' },
    NOTICE: { zh: '公告', en: 'Notice' },
    QUICK_LINKS: { zh: '快捷入口', en: 'Quick links' },
    CATEGORY_AD: { zh: '分类广告', en: 'Category ad' },
    FEATURED_COLLECTION: { zh: '推荐集合', en: 'Featured collection' },
    STORY: { zh: '内容故事', en: 'Story' },
    LEGAL: { zh: '条款内容', en: 'Legal' },
    SUPPORT: { zh: '客服配置', en: 'Support' },
};

const targetTypeLabels: Record<ContentTargetType, { zh: string; en: string }> = {
    NONE: { zh: '无跳转', en: 'No target' },
    URL: { zh: '链接', en: 'URL' },
    PRODUCT: { zh: '商品', en: 'Product' },
    COLLECTION: { zh: '集合', en: 'Collection' },
    CATEGORY: { zh: '分类', en: 'Category' },
    SEARCH: { zh: '搜索', en: 'Search' },
    PAGE: { zh: '客户端页面', en: 'Storefront page' },
    SUPPORT: { zh: '联系客服', en: 'Support action' },
};

export const storefrontContentRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketing',
        id: 'storefront-content',
        url: '/storefront-content',
        title: '店铺装修',
        requiresPermission: ['ReadStorefrontContent'],
    },
    path: '/storefront-content',
    loader: () => ({ breadcrumb: () => '店铺装修' }),
    component: () => <StorefrontContentPage />,
};

function StorefrontContentPage() {
    const { i18n } = useLingui();
    const isZh = i18n.locale.toLowerCase().startsWith('zh');
    const text = isZh ? zhCopy : enCopy;
    const { activeChannel } = useChannel();
    const queryClient = useQueryClient();
    const queryKey = ['storefront-content-blocks', activeChannel?.id];
    const [draft, setDraft] = useState<ContentBlock | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<ContentBlock | null>(null);
    const [heroAutoplayIntervalInput, setHeroAutoplayIntervalInput] = useState('5');

    const contentQuery = useQuery({
        queryKey,
        queryFn: () => api.query<StorefrontContentBlocksResult>(storefrontContentBlocksQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const blocks = contentQuery.data?.storefrontContentBlocks ?? [];
    const refresh = () => queryClient.invalidateQueries({ queryKey });
    const heroAutoplayIntervalSeconds = Number(heroAutoplayIntervalInput);
    const heroAutoplayIntervalValid =
        Number.isInteger(heroAutoplayIntervalSeconds) &&
        heroAutoplayIntervalSeconds >= 3 &&
        heroAutoplayIntervalSeconds <= 30;

    useEffect(() => {
        setHeroAutoplayIntervalInput(
            String(contentQuery.data?.storefrontContentSettings?.heroAutoplayIntervalSeconds ?? 5),
        );
    }, [activeChannel?.id, contentQuery.data?.storefrontContentSettings?.heroAutoplayIntervalSeconds]);

    const saveMutation = useMutation({
        mutationFn: (block: ContentBlock) => {
            const input = blockInput(block);
            return block.id
                ? api.mutate(updateStorefrontContentBlockMutation, { input: { id: block.id, ...input } })
                : api.mutate(createStorefrontContentBlockMutation, { input });
        },
        onSuccess: async (_, block) => {
            toast.success(block.id ? text.updated : text.created);
            setDraft(null);
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const quickUpdateMutation = useMutation({
        mutationFn: (input: { id: string; enabled: boolean }) =>
            api.mutate(updateStorefrontContentBlockMutation, { input }),
        onSuccess: refresh,
        onError: error => toast.error(errorMessage(error)),
    });
    const reorderMutation = useMutation({
        mutationFn: (ids: string[]) => api.mutate(reorderStorefrontContentBlocksMutation, { ids }),
        onSuccess: async () => {
            toast.success(text.reordered);
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => api.mutate(deleteStorefrontContentBlockMutation, { id }),
        onSuccess: async () => {
            toast.success(text.deleted);
            setDeleteTarget(null);
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const settingsMutation = useMutation({
        mutationFn: (value: number) =>
            api.mutate(updateStorefrontContentSettingsMutation, {
                input: { heroAutoplayIntervalSeconds: value },
            }),
        onSuccess: async () => {
            toast.success(text.carouselSettingsUpdated);
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const move = (index: number, direction: -1 | 1) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= blocks.length) return;
        const reordered = [...blocks];
        [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
        reorderMutation.mutate(reordered.flatMap(block => (block.id ? [block.id] : [])));
    };

    return (
        <Page pageId="storefront-content">
            <PageTitle>{text.title}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button onClick={() => setDraft(newBlock(blocks.length))}>
                        <Plus className="size-4" aria-hidden="true" />
                        {text.add}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="storefront-content-carousel-settings"
                    title={text.carouselSettings}
                    description={text.carouselSettingsDescription}
                >
                    <div className="flex max-w-xl flex-col gap-4 sm:flex-row sm:items-end">
                        <Field
                            label={text.autoplayInterval}
                            hint={text.autoplayIntervalHint}
                            className="flex-1"
                        >
                            <div className="relative">
                                <Input
                                    type="number"
                                    min={3}
                                    max={30}
                                    step={1}
                                    inputMode="numeric"
                                    value={heroAutoplayIntervalInput}
                                    aria-invalid={!heroAutoplayIntervalValid}
                                    aria-describedby={
                                        heroAutoplayIntervalValid ? undefined : 'autoplay-interval-error'
                                    }
                                    disabled={contentQuery.isPending || contentQuery.isError}
                                    onChange={event => setHeroAutoplayIntervalInput(event.target.value)}
                                />
                                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                                    {isZh ? '秒' : 'sec'}
                                </span>
                            </div>
                            {!heroAutoplayIntervalValid && (
                                <p
                                    id="autoplay-interval-error"
                                    className="text-xs text-destructive"
                                    role="alert"
                                >
                                    {text.autoplayIntervalInvalid}
                                </p>
                            )}
                        </Field>
                        <Button
                            type="button"
                            disabled={
                                !heroAutoplayIntervalValid ||
                                contentQuery.isPending ||
                                contentQuery.isError ||
                                settingsMutation.isPending
                            }
                            onClick={() => settingsMutation.mutate(heroAutoplayIntervalSeconds)}
                        >
                            {settingsMutation.isPending ? text.saving : text.saveCarouselSettings}
                        </Button>
                    </div>
                </PageBlock>
                <PageBlock
                    column="full"
                    blockId="storefront-content-list"
                    title={text.title}
                    description={text.description}
                >
                    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>{text.activeChannel}</span>
                        <Badge variant="outline">{activeChannel?.code ?? '-'}</Badge>
                    </div>
                    {contentQuery.isPending ? (
                        <div className="space-y-3" aria-busy="true">
                            <Skeleton className="h-20 w-full" />
                            <Skeleton className="h-20 w-full" />
                        </div>
                    ) : contentQuery.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription className="flex items-center justify-between gap-3">
                                <span>{text.loadError}</span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void contentQuery.refetch()}
                                >
                                    <RefreshCw className="size-4" aria-hidden="true" />
                                    {text.retry}
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : blocks.length === 0 ? (
                        <div className="py-12 text-center">
                            <LayoutTemplate
                                className="mx-auto mb-3 size-8 text-muted-foreground"
                                aria-hidden="true"
                            />
                            <p className="text-sm font-medium">{text.empty}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{text.emptyHint}</p>
                            <Button className="mt-5" variant="outline" onClick={() => setDraft(newBlock(0))}>
                                <Plus className="size-4" aria-hidden="true" />
                                {text.add}
                            </Button>
                        </div>
                    ) : (
                        <div className="divide-y border-y">
                            {blocks.map((block, index) => (
                                <BlockRow
                                    key={block.id}
                                    block={block}
                                    index={index}
                                    count={blocks.length}
                                    isZh={isZh}
                                    text={text}
                                    pending={
                                        reorderMutation.isPending ||
                                        quickUpdateMutation.isPending ||
                                        deleteMutation.isPending
                                    }
                                    onMove={direction => move(index, direction)}
                                    onEdit={() => setDraft(cloneBlock(block))}
                                    onToggle={() =>
                                        block.id &&
                                        quickUpdateMutation.mutate({ id: block.id, enabled: !block.enabled })
                                    }
                                    onDelete={() => setDeleteTarget(block)}
                                />
                            ))}
                        </div>
                    )}
                </PageBlock>
            </PageLayout>

            <BlockEditor
                draft={draft}
                isZh={isZh}
                text={text}
                saving={saveMutation.isPending}
                onChange={setDraft}
                onClose={() => !saveMutation.isPending && setDraft(null)}
                onSave={block => {
                    if (!isValid(block)) {
                        toast.error(text.validation);
                        return;
                    }
                    saveMutation.mutate(block);
                }}
            />

            <AlertDialog open={Boolean(deleteTarget)} onOpenChange={open => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{text.deleteTitle}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget?.code ? `${deleteTarget.code}：` : ''}
                            {text.deleteDescription}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteMutation.isPending}>
                            {text.cancel}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={deleteMutation.isPending}
                            onClick={event => {
                                event.preventDefault();
                                if (deleteTarget?.id) deleteMutation.mutate(deleteTarget.id);
                            }}
                        >
                            {text.delete}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Page>
    );
}

function BlockRow({
    block,
    index,
    count,
    isZh,
    text,
    pending,
    onMove,
    onEdit,
    onToggle,
    onDelete,
}: Readonly<{
    block: ContentBlock;
    index: number;
    count: number;
    isZh: boolean;
    text: typeof zhCopy;
    pending: boolean;
    onMove: (direction: -1 | 1) => void;
    onEdit: () => void;
    onToggle: () => void;
    onDelete: () => void;
}>) {
    const translation = preferredBlockTranslation(block, isZh);
    return (
        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    {block.imageUrl ? (
                        <img className="size-10 rounded-md object-cover" src={block.imageUrl} alt="" />
                    ) : (
                        <LayoutTemplate className="size-4" aria-hidden="true" />
                    )}
                </div>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">
                            {translation.title || block.code}
                        </span>
                        <Badge variant={block.enabled ? 'default' : 'secondary'}>
                            {block.enabled ? text.enabled : text.disabled}
                        </Badge>
                        {(block.startsAt || block.endsAt) && (
                            <Badge variant="outline">{text.scheduled}</Badge>
                        )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{block.code}</span>
                        <span>{isZh ? blockTypeLabels[block.type].zh : blockTypeLabels[block.type].en}</span>
                        <span>{block.items.length} items</span>
                    </div>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
                <IconButton label={text.moveUp} disabled={pending || index === 0} onClick={() => onMove(-1)}>
                    <ArrowUp />
                </IconButton>
                <IconButton
                    label={text.moveDown}
                    disabled={pending || index === count - 1}
                    onClick={() => onMove(1)}
                >
                    <ArrowDown />
                </IconButton>
                <IconButton
                    label={block.enabled ? text.disabled : text.enabled}
                    disabled={pending}
                    onClick={onToggle}
                >
                    {block.enabled ? <EyeOff /> : <Eye />}
                </IconButton>
                <IconButton label={text.edit} disabled={pending} onClick={onEdit}>
                    <Pencil />
                </IconButton>
                <IconButton label={text.delete} disabled={pending} onClick={onDelete}>
                    <Trash2 />
                </IconButton>
            </div>
        </div>
    );
}

function IconButton({
    label,
    disabled,
    onClick,
    children,
}: Readonly<{
    label: string;
    disabled: boolean;
    onClick: () => void;
    children: React.ReactNode;
}>) {
    return (
        <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            aria-label={label}
            title={label}
            onClick={onClick}
        >
            <span className="[&>svg]:size-4" aria-hidden="true">
                {children}
            </span>
        </Button>
    );
}

function BlockEditor({
    draft,
    isZh,
    text,
    saving,
    onChange,
    onClose,
    onSave,
}: Readonly<{
    draft: ContentBlock | null;
    isZh: boolean;
    text: typeof zhCopy;
    saving: boolean;
    onChange: (draft: ContentBlock | null) => void;
    onClose: () => void;
    onSave: (draft: ContentBlock) => void;
}>) {
    const previewTranslation = useMemo(
        () => (draft ? preferredBlockTranslation(draft, isZh) : null),
        [draft, isZh],
    );
    if (!draft) return null;

    const update = <K extends keyof ContentBlock>(key: K, value: ContentBlock[K]) =>
        onChange({ ...draft, [key]: value });
    const updateTranslation = (languageCode: 'zh_Hans' | 'en', patch: Partial<ContentBlockTranslation>) =>
        update(
            'translations',
            draft.translations.map(translation =>
                translation.languageCode === languageCode ? { ...translation, ...patch } : translation,
            ),
        );

    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1180px,96vw)]">
                <DialogHeader className="shrink-0 border-b px-6 py-4">
                    <DialogTitle>{draft.id ? text.updateTitle : text.createTitle}</DialogTitle>
                    <DialogDescription>{text.editorDescription}</DialogDescription>
                </DialogHeader>
                <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
                    <div className="min-w-0 space-y-7 px-6 py-5 lg:overflow-y-auto">
                        <section className="space-y-4">
                            <h3 className="text-sm font-medium">{text.basic}</h3>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label={text.code} hint={text.codeHint}>
                                    <Input
                                        value={draft.code}
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        onChange={event => update('code', event.target.value)}
                                    />
                                </Field>
                                <Field label={text.type}>
                                    <Select
                                        value={draft.type}
                                        onValueChange={value =>
                                            value && update('type', value)
                                        }
                                    >
                                        <SelectTrigger className="w-full min-w-0">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {blockTypes.map(type => (
                                                <SelectItem key={type} value={type}>
                                                    {isZh
                                                        ? blockTypeLabels[type].zh
                                                        : blockTypeLabels[type].en}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </Field>
                                <Field label={text.position}>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={draft.position}
                                        onChange={event =>
                                            update('position', Number(event.target.value) || 0)
                                        }
                                    />
                                </Field>
                                <div className="flex min-w-0 items-center justify-between gap-4 rounded-md border px-3 py-2.5">
                                    <div className="min-w-0">
                                        <Label>{text.status}</Label>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {text.statusHint}
                                        </p>
                                    </div>
                                    <Switch
                                        className="shrink-0"
                                        checked={draft.enabled}
                                        onCheckedChange={value => update('enabled', value)}
                                    />
                                </div>
                                <Field label={text.startsAt}>
                                    <Input
                                        type="datetime-local"
                                        value={toLocalDateTime(draft.startsAt)}
                                        onChange={event =>
                                            update('startsAt', fromLocalDateTime(event.target.value))
                                        }
                                    />
                                </Field>
                                <Field label={text.endsAt}>
                                    <Input
                                        type="datetime-local"
                                        value={toLocalDateTime(draft.endsAt)}
                                        onChange={event =>
                                            update('endsAt', fromLocalDateTime(event.target.value))
                                        }
                                    />
                                </Field>
                                <Field label={text.imageUrl} hint={text.imageHint} className="sm:col-span-2">
                                    <Input
                                        inputMode="url"
                                        value={draft.imageUrl ?? ''}
                                        onChange={event => update('imageUrl', event.target.value || null)}
                                    />
                                </Field>
                                <Field label={text.backgroundColor}>
                                    <ColorInput
                                        value={draft.backgroundColor}
                                        onChange={value => update('backgroundColor', value)}
                                    />
                                </Field>
                                <Field label={text.textColor}>
                                    <ColorInput
                                        value={draft.textColor}
                                        onChange={value => update('textColor', value)}
                                    />
                                </Field>
                                <Field label={text.targetType}>
                                    <TargetSelect
                                        value={draft.targetType}
                                        isZh={isZh}
                                        onChange={value => {
                                            update('targetType', value);
                                            if (value === 'NONE') update('targetValue', null);
                                        }}
                                    />
                                </Field>
                                <Field label={text.targetValue} hint={text.targetHint}>
                                    <Input
                                        disabled={draft.targetType === 'NONE'}
                                        value={draft.targetValue ?? ''}
                                        onChange={event => update('targetValue', event.target.value || null)}
                                    />
                                </Field>
                            </div>
                        </section>

                        <Separator />
                        <section className="space-y-4">
                            <h3 className="text-sm font-medium">{text.translations}</h3>
                            <div className="grid gap-5 xl:grid-cols-2">
                                {(['zh_Hans', 'en'] as const).map(languageCode => {
                                    const translation = getBlockTranslation(draft, languageCode);
                                    return (
                                        <div key={languageCode} className="space-y-3 border-l-2 pl-4">
                                            <h4 className="text-sm font-medium">
                                                {languageCode === 'zh_Hans' ? text.chinese : text.english}
                                            </h4>
                                            <Field label={text.blockTitle}>
                                                <Input
                                                    value={translation.title}
                                                    onChange={event =>
                                                        updateTranslation(languageCode, {
                                                            title: event.target.value,
                                                        })
                                                    }
                                                />
                                            </Field>
                                            <Field label={text.subtitle}>
                                                <Input
                                                    value={translation.subtitle}
                                                    onChange={event =>
                                                        updateTranslation(languageCode, {
                                                            subtitle: event.target.value,
                                                        })
                                                    }
                                                />
                                            </Field>
                                            <Field label={text.body}>
                                                <Textarea
                                                    rows={4}
                                                    value={translation.body}
                                                    onChange={event =>
                                                        updateTranslation(languageCode, {
                                                            body: event.target.value,
                                                        })
                                                    }
                                                />
                                            </Field>
                                            <Field label={text.cta}>
                                                <Input
                                                    value={translation.ctaLabel}
                                                    onChange={event =>
                                                        updateTranslation(languageCode, {
                                                            ctaLabel: event.target.value,
                                                        })
                                                    }
                                                />
                                            </Field>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        <Separator />
                        <section className="space-y-4">
                            <div className="flex items-center justify-between gap-3">
                                <h3 className="text-sm font-medium">{text.items}</h3>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                        update('items', [...draft.items, newItem(draft.items.length)])
                                    }
                                >
                                    <Plus className="size-4" aria-hidden="true" />
                                    {text.addItem}
                                </Button>
                            </div>
                            {draft.items.map((item, index) => (
                                <ItemEditor
                                    key={item.id ?? `new-${index}`}
                                    item={item}
                                    index={index}
                                    isZh={isZh}
                                    text={text}
                                    onChange={next =>
                                        update(
                                            'items',
                                            draft.items.map((current, currentIndex) =>
                                                currentIndex === index ? next : current,
                                            ),
                                        )
                                    }
                                    onRemove={() =>
                                        update(
                                            'items',
                                            draft.items.filter((_, currentIndex) => currentIndex !== index),
                                        )
                                    }
                                />
                            ))}
                        </section>
                    </div>

                    <aside className="min-w-0 border-t bg-muted/30 px-5 py-5 lg:overflow-y-auto lg:border-l lg:border-t-0">
                        <h3 className="mb-4 text-sm font-medium">{text.preview}</h3>
                        <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[8px] border bg-background shadow-sm">
                            <div className="flex h-7 items-center justify-center border-b bg-muted text-[10px] text-muted-foreground">
                                390 x 844
                            </div>
                            <div
                                className="relative min-h-[420px] overflow-hidden p-4"
                                style={{
                                    backgroundColor: draft.backgroundColor || '#ffffff',
                                    color: draft.textColor || '#111827',
                                }}
                            >
                                {draft.imageUrl ? (
                                    <img
                                        className="mb-4 aspect-[16/9] w-full rounded-md object-cover"
                                        src={draft.imageUrl}
                                        alt=""
                                    />
                                ) : (
                                    <div className="mb-4 flex aspect-[16/9] items-center justify-center rounded-md border border-dashed bg-background/50">
                                        <ImageIcon className="size-5 opacity-50" aria-hidden="true" />
                                    </div>
                                )}
                                {previewTranslation?.title ? (
                                    <>
                                        <h4 className="text-lg font-semibold">{previewTranslation.title}</h4>
                                        {previewTranslation.subtitle && (
                                            <p className="mt-1 text-sm opacity-75">
                                                {previewTranslation.subtitle}
                                            </p>
                                        )}
                                        {previewTranslation.body && (
                                            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                                                {previewTranslation.body}
                                            </p>
                                        )}
                                        {previewTranslation.ctaLabel && (
                                            <div className="mt-4 inline-flex min-h-9 items-center border border-current px-3 text-sm font-medium">
                                                {previewTranslation.ctaLabel}
                                            </div>
                                        )}
                                        {draft.items.length > 0 && (
                                            <div className="mt-5 grid grid-cols-2 gap-2">
                                                {draft.items.slice(0, 4).map((item, index) => {
                                                    const itemTranslation = preferredItemTranslation(
                                                        item,
                                                        isZh,
                                                    );
                                                    return (
                                                        <div
                                                            key={item.id ?? index}
                                                            className="border border-current/15 p-2"
                                                        >
                                                            <div className="text-xs font-medium">
                                                                {itemTranslation.label ||
                                                                    `${text.item} ${index + 1}`}
                                                            </div>
                                                            <div className="mt-1 line-clamp-2 text-[11px] opacity-65">
                                                                {itemTranslation.description}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex min-h-44 items-center justify-center text-center text-sm opacity-60">
                                        {text.previewEmpty}
                                    </div>
                                )}
                            </div>
                        </div>
                    </aside>
                </div>
                <DialogFooter className="shrink-0 border-t px-6 py-4">
                    <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
                        {text.cancel}
                    </Button>
                    <Button type="button" disabled={saving} onClick={() => onSave(draft)}>
                        {saving ? text.saving : text.save}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ItemEditor({
    item,
    index,
    isZh,
    text,
    onChange,
    onRemove,
}: Readonly<{
    item: ContentItem;
    index: number;
    isZh: boolean;
    text: typeof zhCopy;
    onChange: (item: ContentItem) => void;
    onRemove: () => void;
}>) {
    const update = <K extends keyof ContentItem>(key: K, value: ContentItem[K]) =>
        onChange({ ...item, [key]: value });
    const updateTranslation = (
        languageCode: 'zh_Hans' | 'en',
        patch: Partial<ContentItem['translations'][number]>,
    ) =>
        update(
            'translations',
            item.translations.map(translation =>
                translation.languageCode === languageCode ? { ...translation, ...patch } : translation,
            ),
        );
    return (
        <div className="space-y-4 border-t pt-4 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">
                        {text.item} {index + 1}
                    </span>
                    <Switch checked={item.enabled} onCheckedChange={value => update('enabled', value)} />
                </div>
                <IconButton label={text.removeItem} disabled={false} onClick={onRemove}>
                    <X />
                </IconButton>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label={text.imageUrl}>
                    <div className="flex items-center gap-2">
                        {item.imageUrl ? (
                            <img
                                className="size-9 shrink-0 rounded-md object-cover border border-border"
                                src={item.imageUrl}
                                alt=""
                                onError={e => {
                                    (e.currentTarget as HTMLElement).style.display = 'none';
                                }}
                            />
                        ) : null}
                        <Input
                            value={item.imageUrl ?? ''}
                            onChange={event => update('imageUrl', event.target.value || null)}
                        />
                    </div>
                </Field>
                <Field label={text.position}>
                    <Input
                        type="number"
                        min={0}
                        value={item.position}
                        onChange={event => update('position', Number(event.target.value) || 0)}
                    />
                </Field>
                <Field label={text.targetType}>
                    <TargetSelect
                        value={item.targetType}
                        isZh={isZh}
                        onChange={value =>
                            onChange({
                                ...item,
                                targetType: value,
                                targetValue: value === 'NONE' ? null : item.targetValue,
                            })
                        }
                    />
                </Field>
                <Field label={text.targetValue}>
                    <Input
                        disabled={item.targetType === 'NONE'}
                        value={item.targetValue ?? ''}
                        onChange={event => update('targetValue', event.target.value || null)}
                    />
                </Field>
                {(['zh_Hans', 'en'] as const).map(languageCode => {
                    const translation = getItemTranslation(item, languageCode);
                    return (
                        <div key={languageCode} className="space-y-3 border-l-2 pl-4">
                            <h4 className="text-xs font-medium text-muted-foreground">
                                {languageCode === 'zh_Hans' ? text.chinese : text.english}
                            </h4>
                            <Field label={text.itemLabel}>
                                <Input
                                    value={translation.label}
                                    onChange={event =>
                                        updateTranslation(languageCode, { label: event.target.value })
                                    }
                                />
                            </Field>
                            <Field label={text.itemDescription}>
                                <Textarea
                                    rows={2}
                                    value={translation.description}
                                    onChange={event =>
                                        updateTranslation(languageCode, { description: event.target.value })
                                    }
                                />
                            </Field>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function Field({
    label,
    hint,
    className,
    children,
}: Readonly<{ label: string; hint?: string; className?: string; children: React.ReactNode }>) {
    return (
        <div className={`min-w-0 space-y-2 ${className ?? ''}`}>
            <Label>{label}</Label>
            {children}
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
    );
}

function ColorInput({
    value,
    onChange,
}: Readonly<{ value: string | null; onChange: (value: string | null) => void }>) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            <input
                className="size-9 shrink-0 cursor-pointer rounded border bg-transparent p-1"
                type="color"
                value={value || '#ffffff'}
                aria-label="Color"
                onChange={event => onChange(event.target.value)}
            />
            <Input
                className="min-w-0"
                value={value ?? ''}
                placeholder="#ffffff"
                onChange={event => onChange(event.target.value || null)}
            />
        </div>
    );
}

function TargetSelect({
    value,
    isZh,
    onChange,
}: Readonly<{ value: ContentTargetType; isZh: boolean; onChange: (value: ContentTargetType) => void }>) {
    return (
        <Select value={value} onValueChange={next => next && onChange(next)}>
            <SelectTrigger className="w-full min-w-0">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {targetTypes.map(type => (
                    <SelectItem key={type} value={type}>
                        {isZh ? targetTypeLabels[type].zh : targetTypeLabels[type].en}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function newBlock(position: number): ContentBlock {
    return {
        code: '',
        type: 'HERO',
        enabled: true,
        position,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        translations: [emptyBlockTranslation('zh_Hans'), emptyBlockTranslation('en')],
        items: [],
    };
}

function newItem(position: number): ContentItem {
    return {
        enabled: true,
        position,
        imageUrl: null,
        targetType: 'NONE',
        targetValue: null,
        translations: [
            { languageCode: 'zh_Hans', label: '', description: '' },
            { languageCode: 'en', label: '', description: '' },
        ],
    };
}

function emptyBlockTranslation(languageCode: 'zh_Hans' | 'en'): ContentBlockTranslation {
    return { languageCode, title: '', subtitle: '', body: '', ctaLabel: '' };
}

function cloneBlock(block: ContentBlock): ContentBlock {
    return {
        ...block,
        translations: (['zh_Hans', 'en'] as const).map(languageCode => ({
            ...emptyBlockTranslation(languageCode),
            ...block.translations.find(translation => translation.languageCode === languageCode),
            languageCode,
        })),
        items: block.items.map(item => ({
            ...item,
            translations: (['zh_Hans', 'en'] as const).map(languageCode => ({
                languageCode,
                label: '',
                description: '',
                ...item.translations.find(translation => translation.languageCode === languageCode),
            })),
        })),
    };
}

function getBlockTranslation(block: ContentBlock, languageCode: 'zh_Hans' | 'en') {
    return (
        block.translations.find(translation => translation.languageCode === languageCode) ??
        emptyBlockTranslation(languageCode)
    );
}

function getItemTranslation(item: ContentItem, languageCode: 'zh_Hans' | 'en') {
    return (
        item.translations.find(translation => translation.languageCode === languageCode) ?? {
            languageCode,
            label: '',
            description: '',
        }
    );
}

function preferredBlockTranslation(block: ContentBlock, isZh: boolean) {
    return getBlockTranslation(block, isZh ? 'zh_Hans' : 'en');
}

function preferredItemTranslation(item: ContentItem, isZh: boolean) {
    return getItemTranslation(item, isZh ? 'zh_Hans' : 'en');
}

function blockInput(block: ContentBlock) {
    return {
        code: block.code.trim(),
        type: block.type,
        enabled: block.enabled,
        position: block.position,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        imageUrl: block.imageUrl?.trim() || null,
        backgroundColor: block.backgroundColor?.trim() || null,
        textColor: block.textColor?.trim() || null,
        targetType: block.targetType,
        targetValue: block.targetType === 'NONE' ? null : block.targetValue?.trim() || null,
        translations: block.translations.map(({ languageCode, title, subtitle, body, ctaLabel }) => ({
            languageCode,
            title: title.trim(),
            subtitle: subtitle.trim(),
            body: body.trim(),
            ctaLabel: ctaLabel.trim(),
        })),
        items: block.items.map((item, index) => ({
            ...(item.id ? { id: item.id } : {}),
            enabled: item.enabled,
            position: index,
            imageUrl: item.imageUrl?.trim() || null,
            targetType: item.targetType,
            targetValue: item.targetType === 'NONE' ? null : item.targetValue?.trim() || null,
            translations: item.translations.map(({ languageCode, label, description }) => ({
                languageCode,
                label: label.trim(),
                description: description.trim(),
            })),
        })),
    };
}

function isValid(block: ContentBlock): boolean {
    return (
        Boolean(block.code.trim()) &&
        (['zh_Hans', 'en'] as const).every(languageCode =>
            Boolean(getBlockTranslation(block, languageCode).title.trim()),
        ) &&
        block.items.every(item =>
            (['zh_Hans', 'en'] as const).every(languageCode =>
                Boolean(getItemTranslation(item, languageCode).label.trim()),
            ),
        )
    );
}

function toLocalDateTime(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}

function fromLocalDateTime(value: string): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
