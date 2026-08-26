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
    AssetPickerDialog,
    Badge,
    Button,
    ChannelCodeLabel,
    DashboardRouteDefinition,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    ImageSizeHint,
    Input,
    Label,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    ProductMultiSelectorDialog,
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
    ImagePlus,
    LayoutTemplate,
    Pencil,
    Plus,
    RefreshCw,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { applyCoreCategoryDefaults, dualCardTemplateId, dualCardTemplates } from './dual-card-templates';
import { swappedContentBlockIds } from './storefront-content-ordering';
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
    'COUPONS',
    'TRUST_BAR',
    'CORE_CATEGORIES',
    'FLASH_SALE',
    'BEST_SELLERS',
    'RECOMMENDATIONS',
    'STORY',
    'LEGAL',
    'SUPPORT',
    'CUSTOM',
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
    'COUPON',
];

type ContentImageGuidance = 'hero' | 'banner' | 'contentCard' | 'icon';

const CLOUD_BRIDGE_TARGET_URL = 'https://codexgemini.cc';
const CLOUD_BRIDGE_HERO_THEME = {
    overlayColor: '#FFF7F5',
    titleColor: '#451A1A',
    secondaryTextColor: '#6F3841',
    accentColor: '#D33C30',
    accentSecondaryColor: '#7C3AED',
    buttonTextColor: '#FFFFFF',
} as const;

const zhCopy = {
    title: '店铺装修',
    description: '管理当前店铺的首页内容、条款和客服信息。切换店铺后会自动读取对应销售渠道。',
    add: '新建区块',
    configureDualCards: '配置双卡片',
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
    editorDescription: '中文为原文，保存时自动生成英文；可在高级模式手动修改英文。内容只保存到当前 Channel。',
    basic: '区块设置',
    simpleMode: '常用设置',
    advancedMode: '高级自定义',
    simpleModeHint: '常用模式填写中文即可；高级模式可校对英文并保留全部通用能力。',
    internalName: '模块内部名称',
    internalNameHint: '仅供管理后台识别，例如：首页第二屏快捷入口；不会展示给顾客。',
    code: '区块编码',
    codeHint: '小写字母、数字和短横线，例如 home-hero。',
    type: '区块类型',
    position: '排序',
    status: '启用区块',
    statusHint: '关闭后 Shop API 不再返回此区块。',
    startsAt: '开始时间',
    endsAt: '结束时间',
    imageUrl: '导入外部图片',
    imageHint: '保存时会自动下载到本站素材库，并由客户端以 WebP 格式加载。',
    imageAsset: '模块图片',
    selectImage: '从素材库选择或上传',
    replaceImage: '更换图片',
    removeImage: '移除图片',
    noImage: '暂未选择图片',
    displaySettings: '显示设置',
    dualCardTemplate: '双卡片颜色模板',
    dualCardTemplateHint: '模板已包含背景、边框、强调色与纹理；切换模板不会改变文字和跳转目标。',
    dualCardDefault: '默认',
    displayCount: '显示商品数量',
    displayCountHint: '客户端首屏显示 1 到 50 个商品。',
    noticeInterval: '公告滚动间隔',
    noticeIntervalHint: '有多条公告时，每 3 到 30 秒切换一条。',
    selectProducts: '选择固定商品',
    selectPinnedProducts: '选择置顶商品',
    productsSelected: '个商品已选择',
    productSelectionHint: '可按名称搜索，也可先按商品分类筛选。',
    backgroundColor: '背景色',
    textColor: '文字色',
    heroTheme: '轮播文字与配色',
    heroThemeHint: '颜色只作用于网页文字、遮罩和按钮，不会写进轮播图片。',
    heroThemePreset: '应用云桥科技亮色',
    heroOverlayColor: '左侧遮罩色',
    heroTitleColor: '标题颜色',
    heroSecondaryTextColor: '说明文字颜色',
    heroAccentColor: '强调色',
    heroAccentSecondaryColor: '按钮渐变结束色',
    heroButtonTextColor: '按钮文字颜色',
    targetType: '跳转类型',
    targetValue: '跳转目标',
    targetHint: '根据类型填写商品 ID、集合 ID、优惠码、搜索词、页面路径或链接。',
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
    itemBadge: '顶部标签',
    itemLabel: '名称',
    itemDescription: '说明',
    itemCta: '按钮文字',
    removeItem: '移除条目',
    preview: '移动端预览',
    previewEmpty: '填写标题后预览会显示在这里',
    save: '保存区块',
    saving: '正在保存',
    created: '装修区块已创建',
    updated: '装修区块已更新',
    deleted: '装修区块已删除',
    reordered: '区块顺序已更新',
    validation: '请填写模块内部名称和中文标题；每个条目也需要中文名称',
    activeChannel: '当前店铺',
    carouselSettings: '首页轮播设置',
    carouselSettingsDescription:
        '配置当前店铺首页广告的自动切换速度。用户手动切换后，本次访问将停止自动轮播。',
    autoplayInterval: '自动切换间隔',
    autoplayIntervalHint: '填写 3 到 30 之间的整数，单位为秒；默认 5 秒。',
    autoplayIntervalInvalid: '自动切换间隔必须是 3 到 30 秒之间的整数',
    saveCarouselSettings: '保存轮播设置',
    carouselSettingsUpdated: '轮播设置已更新',
    carouselTitle: '首页轮播',
    carouselDescription: '单独管理当前店铺首页轮播的图片、文案、样式、跳转和播放速度。',
    carouselSlides: '轮播图片',
    carouselSlidesDescription: '按顺序管理轮播图 1、2、3……关闭后该图片将不在前台展示。',
    addCarouselSlide: '添加轮播图',
    carouselEmpty: '当前店铺还没有轮播图',
    carouselEmptyHint: '添加第一张图片后，首页才会显示轮播区域。',
    carouselSlide: '轮播图',
    createCarouselSlideTitle: '添加轮播图',
    updateCarouselSlideTitle: '编辑轮播图',
    carouselCreated: '轮播图已创建',
    carouselUpdated: '轮播图已更新',
    carouselDeleted: '轮播图已删除',
    carouselReordered: '轮播顺序已更新',
};

const enCopy: typeof zhCopy = {
    title: 'Storefront content',
    description:
        'Manage homepage content, legal text and support details for the active store. Switching stores loads its Channel content.',
    add: 'New block',
    configureDualCards: 'Configure dual cards',
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
    editorDescription:
        'Chinese is the source. English is generated on save and can be edited in Advanced mode. Content stays in the active Channel.',
    basic: 'Block settings',
    simpleMode: 'Common settings',
    advancedMode: 'Advanced custom',
    simpleModeHint:
        'Common mode only requires Chinese. Advanced mode lets you review English and preserves every generic option.',
    internalName: 'Internal module name',
    internalNameHint: 'Visible only in the dashboard, for example Homepage second-row quick links.',
    code: 'Block code',
    codeHint: 'Lowercase letters, numbers and hyphens, for example home-hero.',
    type: 'Block type',
    position: 'Position',
    status: 'Enable block',
    statusHint: 'When disabled, the Shop API no longer returns this block.',
    startsAt: 'Starts at',
    endsAt: 'Ends at',
    imageUrl: 'Import external image',
    imageHint: 'Saved into this store’s asset library and delivered to customers as WebP.',
    imageAsset: 'Module image',
    selectImage: 'Select or upload asset',
    replaceImage: 'Replace image',
    removeImage: 'Remove image',
    noImage: 'No image selected',
    displaySettings: 'Display settings',
    dualCardTemplate: 'Dual-card color template',
    dualCardTemplateHint:
        'Templates include backgrounds, borders, accents and textures. Changing templates keeps your copy and targets.',
    dualCardDefault: 'Default',
    displayCount: 'Number of products',
    displayCountHint: 'Show 1 to 50 products in this storefront section.',
    noticeInterval: 'Notice rotation interval',
    noticeIntervalHint: 'Rotate multiple notices every 3 to 30 seconds.',
    selectProducts: 'Select fixed products',
    selectPinnedProducts: 'Select pinned products',
    productsSelected: 'products selected',
    productSelectionHint: 'Search by name or filter the catalog by category first.',
    backgroundColor: 'Background',
    textColor: 'Text color',
    heroTheme: 'Carousel copy and colors',
    heroThemeHint:
        'Colors affect HTML copy, the overlay and the button; they are never baked into the image.',
    heroThemePreset: 'Apply CloudBridge bright theme',
    heroOverlayColor: 'Left overlay color',
    heroTitleColor: 'Title color',
    heroSecondaryTextColor: 'Supporting text color',
    heroAccentColor: 'Accent color',
    heroAccentSecondaryColor: 'Button gradient end',
    heroButtonTextColor: 'Button text color',
    targetType: 'Target type',
    targetValue: 'Target value',
    targetHint: 'Enter a product ID, collection ID, coupon code, search term, page path or URL.',
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
    itemBadge: 'Top label',
    itemLabel: 'Label',
    itemDescription: 'Description',
    itemCta: 'Button label',
    removeItem: 'Remove item',
    preview: 'Mobile preview',
    previewEmpty: 'Enter a title to see the preview',
    save: 'Save block',
    saving: 'Saving',
    created: 'Content block created',
    updated: 'Content block updated',
    deleted: 'Content block deleted',
    reordered: 'Block order updated',
    validation: 'Enter an internal name, a Chinese title, and a Chinese label for every item',
    activeChannel: 'Active store',
    carouselSettings: 'Homepage carousel settings',
    carouselSettingsDescription:
        'Set the automatic rotation speed for this store. Autoplay stops for the visit after a customer changes slides manually.',
    autoplayInterval: 'Autoplay interval',
    autoplayIntervalHint: 'Enter a whole number from 3 to 30 seconds. The default is 5 seconds.',
    autoplayIntervalInvalid: 'The autoplay interval must be a whole number from 3 to 30 seconds',
    saveCarouselSettings: 'Save carousel settings',
    carouselSettingsUpdated: 'Carousel settings updated',
    carouselTitle: 'Homepage carousel',
    carouselDescription:
        'Manage carousel images, copy, styles, targets and autoplay speed for the active store.',
    carouselSlides: 'Carousel images',
    carouselSlidesDescription:
        'Manage carousel images 1, 2, 3 and onward in order. Disabled images are hidden from the storefront.',
    addCarouselSlide: 'Add carousel image',
    carouselEmpty: 'This store has no carousel images',
    carouselEmptyHint: 'Add the first image to show the carousel area on the homepage.',
    carouselSlide: 'Carousel image',
    createCarouselSlideTitle: 'Add carousel image',
    updateCarouselSlideTitle: 'Edit carousel image',
    carouselCreated: 'Carousel image created',
    carouselUpdated: 'Carousel image updated',
    carouselDeleted: 'Carousel image deleted',
    carouselReordered: 'Carousel order updated',
};

const blockTypeLabels: Record<ContentBlockType, { zh: string; en: string }> = {
    HERO: { zh: '首页主视觉', en: 'Hero' },
    NOTICE: { zh: '公告', en: 'Notice' },
    QUICK_LINKS: { zh: '快捷入口', en: 'Quick links' },
    CATEGORY_AD: { zh: '分类广告', en: 'Category ad' },
    FEATURED_COLLECTION: { zh: '推荐集合', en: 'Featured collection' },
    COUPONS: { zh: '优惠券专区', en: 'Coupons' },
    TRUST_BAR: { zh: '服务保障栏', en: 'Trust bar' },
    CORE_CATEGORIES: { zh: '核心品类双卡片', en: 'Core category cards' },
    FLASH_SALE: { zh: '限时秒杀', en: 'Flash sale' },
    BEST_SELLERS: { zh: '热门商品', en: 'Best sellers' },
    RECOMMENDATIONS: { zh: '猜你喜欢', en: 'Recommendations' },
    STORY: { zh: '内容故事', en: 'Story' },
    LEGAL: { zh: '条款内容', en: 'Legal' },
    SUPPORT: { zh: '客服配置', en: 'Support' },
    CUSTOM: { zh: '高级自定义模块', en: 'Custom block' },
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
    COUPON: { zh: '优惠码', en: 'Coupon code' },
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

export const storefrontCarouselRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketing',
        id: 'storefront-carousel',
        url: '/storefront-carousel',
        title: '首页轮播',
        requiresPermission: ['ReadStorefrontContent'],
    },
    path: '/storefront-carousel',
    loader: () => ({ breadcrumb: () => '首页轮播' }),
    component: () => <StorefrontCarouselPage />,
};

function StorefrontCarouselPage() {
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
    const allBlocks = contentQuery.data?.storefrontContentBlocks ?? [];
    const slides = allBlocks.filter(block => block.type === 'HERO');
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
            const input = blockInput({ ...block, type: 'HERO' });
            return block.id
                ? api.mutate(updateStorefrontContentBlockMutation, { input: { id: block.id, ...input } })
                : api.mutate(createStorefrontContentBlockMutation, { input });
        },
        onSuccess: async (_, block) => {
            toast.success(block.id ? text.carouselUpdated : text.carouselCreated);
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
            toast.success(text.carouselReordered);
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => api.mutate(deleteStorefrontContentBlockMutation, { id }),
        onSuccess: async () => {
            toast.success(text.carouselDeleted);
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
        if (targetIndex < 0 || targetIndex >= slides.length) return;
        reorderMutation.mutate(swappedContentBlockIds(allBlocks, slides[index].id, slides[targetIndex].id));
    };

    const createSlide = () => setDraft(newHeroBlock(allBlocks.length, slides.length + 1));

    return (
        <Page pageId="storefront-carousel">
            <PageTitle>{text.carouselTitle}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button disabled={contentQuery.isPending || contentQuery.isError} onClick={createSlide}>
                        <Plus className="size-4" aria-hidden="true" />
                        {text.addCarouselSlide}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="storefront-carousel-settings"
                    title={text.carouselSettings}
                    description={text.carouselSettingsDescription}
                >
                    <Field
                        label={text.autoplayInterval}
                        hint={text.autoplayIntervalHint}
                        className="max-w-xl"
                    >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                            <div className="relative flex-1">
                                <Input
                                    type="number"
                                    min={3}
                                    max={30}
                                    step={1}
                                    inputMode="numeric"
                                    value={heroAutoplayIntervalInput}
                                    aria-invalid={!heroAutoplayIntervalValid}
                                    aria-describedby={
                                        heroAutoplayIntervalValid
                                            ? undefined
                                            : 'carousel-autoplay-interval-error'
                                    }
                                    disabled={contentQuery.isPending || contentQuery.isError}
                                    onChange={event => setHeroAutoplayIntervalInput(event.target.value)}
                                />
                                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                                    {isZh ? '秒' : 'sec'}
                                </span>
                            </div>
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
                        {!heroAutoplayIntervalValid && (
                            <p
                                id="carousel-autoplay-interval-error"
                                className="text-xs text-destructive"
                                role="alert"
                            >
                                {text.autoplayIntervalInvalid}
                            </p>
                        )}
                    </Field>
                </PageBlock>
                <PageBlock
                    column="full"
                    blockId="storefront-carousel-slides"
                    title={text.carouselSlides}
                    description={text.carouselSlidesDescription}
                >
                    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>{text.activeChannel}</span>
                        <Badge variant="outline">
                            {activeChannel ? <ChannelCodeLabel code={activeChannel.code} /> : '-'}
                        </Badge>
                    </div>
                    {contentQuery.isPending ? (
                        <div className="space-y-3" aria-busy="true">
                            <Skeleton className="h-24 w-full" />
                            <Skeleton className="h-24 w-full" />
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
                    ) : slides.length === 0 ? (
                        <div className="py-12 text-center">
                            <ImageIcon
                                className="mx-auto mb-3 size-8 text-muted-foreground"
                                aria-hidden="true"
                            />
                            <p className="text-sm font-medium">{text.carouselEmpty}</p>
                            <p className="mt-1 text-sm text-muted-foreground">{text.carouselEmptyHint}</p>
                            <Button className="mt-5" variant="outline" onClick={createSlide}>
                                <Plus className="size-4" aria-hidden="true" />
                                {text.addCarouselSlide}
                            </Button>
                        </div>
                    ) : (
                        <div className="divide-y border-y">
                            {slides.map((slide, index) => (
                                <CarouselSlideRow
                                    key={slide.id}
                                    slide={slide}
                                    index={index}
                                    count={slides.length}
                                    isZh={isZh}
                                    text={text}
                                    pending={
                                        reorderMutation.isPending ||
                                        quickUpdateMutation.isPending ||
                                        deleteMutation.isPending
                                    }
                                    onMove={direction => move(index, direction)}
                                    onEdit={() => setDraft(cloneBlock(slide))}
                                    onToggle={() =>
                                        slide.id &&
                                        quickUpdateMutation.mutate({ id: slide.id, enabled: !slide.enabled })
                                    }
                                    onDelete={() => setDeleteTarget(slide)}
                                />
                            ))}
                        </div>
                    )}
                </PageBlock>
            </PageLayout>

            <BlockEditor
                draft={draft}
                lockedType="HERO"
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

function StorefrontContentPage() {
    const { i18n } = useLingui();
    const isZh = i18n.locale.toLowerCase().startsWith('zh');
    const text = isZh ? zhCopy : enCopy;
    const { activeChannel } = useChannel();
    const queryClient = useQueryClient();
    const queryKey = ['storefront-content-blocks', activeChannel?.id];
    const [draft, setDraft] = useState<ContentBlock | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<ContentBlock | null>(null);

    const contentQuery = useQuery({
        queryKey,
        queryFn: () => api.query<StorefrontContentBlocksResult>(storefrontContentBlocksQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const allBlocks = contentQuery.data?.storefrontContentBlocks ?? [];
    const blocks = allBlocks.filter(block => block.type !== 'HERO');
    const coreCategoriesBlock = blocks.find(block => block.type === 'CORE_CATEGORIES');
    const refresh = () => queryClient.invalidateQueries({ queryKey });

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
    const move = (index: number, direction: -1 | 1) => {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= blocks.length) return;
        reorderMutation.mutate(swappedContentBlockIds(allBlocks, blocks[index].id, blocks[targetIndex].id));
    };

    return (
        <Page pageId="storefront-content">
            <PageTitle>{text.title}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button
                        variant="outline"
                        onClick={() =>
                            setDraft(
                                coreCategoriesBlock
                                    ? applyCoreCategoryDefaults(cloneBlock(coreCategoriesBlock))
                                    : newCoreCategoriesBlock(allBlocks.length),
                            )
                        }
                    >
                        <LayoutTemplate className="size-4" aria-hidden="true" />
                        {text.configureDualCards}
                    </Button>
                    <Button onClick={() => setDraft(newBlock(allBlocks.length, 'NOTICE'))}>
                        <Plus className="size-4" aria-hidden="true" />
                        {text.add}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="storefront-content-list"
                    title={text.title}
                    description={text.description}
                >
                    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>{text.activeChannel}</span>
                        <Badge variant="outline">
                            {activeChannel ? <ChannelCodeLabel code={activeChannel.code} /> : '-'}
                        </Badge>
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
                            <Button
                                className="mt-5"
                                variant="outline"
                                onClick={() => setDraft(newBlock(allBlocks.length, 'NOTICE'))}
                            >
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
                            {block.internalName || translation.title || block.code}
                        </span>
                        <Badge variant={block.enabled ? 'default' : 'secondary'}>
                            {block.enabled ? text.enabled : text.disabled}
                        </Badge>
                        {(block.startsAt || block.endsAt) && (
                            <Badge variant="outline">{text.scheduled}</Badge>
                        )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {translation.title && translation.title !== block.internalName ? (
                            <span>{translation.title}</span>
                        ) : null}
                        <span>{isZh ? blockTypeLabels[block.type].zh : blockTypeLabels[block.type].en}</span>
                        <span>{isZh ? `${block.items.length} 个条目` : `${block.items.length} items`}</span>
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

function CarouselSlideRow({
    slide,
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
    slide: ContentBlock;
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
    const translation = preferredBlockTranslation(slide, isZh);
    return (
        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {slide.imageUrl ? (
                        <img className="size-full object-cover" src={slide.imageUrl} alt="" />
                    ) : (
                        <ImageIcon className="size-5" aria-hidden="true" />
                    )}
                </div>
                <div className="min-w-0 py-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                            {text.carouselSlide} {index + 1}
                        </span>
                        <Badge variant={slide.enabled ? 'default' : 'secondary'}>
                            {slide.enabled ? text.enabled : text.disabled}
                        </Badge>
                        {(slide.startsAt || slide.endsAt) && (
                            <Badge variant="outline">{text.scheduled}</Badge>
                        )}
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                        {translation.title || slide.internalName || slide.code}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                        {translation.subtitle || (isZh ? '暂无副标题' : 'No subtitle')}
                    </p>
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
                    label={slide.enabled ? text.disabled : text.enabled}
                    disabled={pending}
                    onClick={onToggle}
                >
                    {slide.enabled ? <EyeOff /> : <Eye />}
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

function ModuleSpecificSettings({
    draft,
    isZh,
    text,
    onChange,
}: Readonly<{
    draft: ContentBlock;
    isZh: boolean;
    text: typeof zhCopy;
    onChange: (draft: ContentBlock) => void;
}>) {
    const [productPickerOpen, setProductPickerOpen] = useState(false);
    const settings = draft.settings ?? {};
    const productSettingKey =
        draft.type === 'FEATURED_COLLECTION' || draft.type === 'CUSTOM'
            ? 'selectedProductIds'
            : draft.type === 'BEST_SELLERS'
              ? 'pinnedProductIds'
              : null;
    const selectedProductIds = productSettingKey ? stringArraySetting(settings[productSettingKey]) : [];
    const displayCount = numberSetting(settings.displayCount, 8);
    const noticeIntervalSeconds = numberSetting(settings.scrollIntervalSeconds, 5);
    const updateSettings = (patch: Record<string, unknown>) =>
        onChange({ ...draft, settings: { ...settings, ...patch } });

    if (draft.type === 'CORE_CATEGORIES') {
        return (
            <DualCardTemplatePicker
                value={dualCardTemplateId(draft.settings)}
                isZh={isZh}
                text={text}
                onChange={value => updateSettings({ dualCardTemplate: value })}
            />
        );
    }

    return (
        <section className="space-y-4">
            <h3 className="text-sm font-medium">{text.displaySettings}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
                {draft.type === 'NOTICE' ? (
                    <Field label={text.noticeInterval} hint={text.noticeIntervalHint}>
                        <Input
                            type="number"
                            min={3}
                            max={30}
                            value={noticeIntervalSeconds}
                            onChange={event =>
                                updateSettings({
                                    scrollIntervalSeconds: Math.min(
                                        30,
                                        Math.max(3, Number(event.target.value) || 3),
                                    ),
                                })
                            }
                        />
                    </Field>
                ) : (
                    <Field label={text.displayCount} hint={text.displayCountHint}>
                        <Input
                            type="number"
                            min={1}
                            max={50}
                            value={displayCount}
                            onChange={event =>
                                updateSettings({
                                    displayCount: Math.min(50, Math.max(1, Number(event.target.value) || 1)),
                                })
                            }
                        />
                    </Field>
                )}
                {productSettingKey ? (
                    <Field
                        label={
                            draft.type === 'BEST_SELLERS' ? text.selectPinnedProducts : text.selectProducts
                        }
                        hint={text.productSelectionHint}
                    >
                        <Button
                            type="button"
                            variant="outline"
                            className="w-full justify-start"
                            onClick={() => setProductPickerOpen(true)}
                        >
                            <Plus className="size-4" aria-hidden="true" />
                            {selectedProductIds.length} {text.productsSelected}
                        </Button>
                        <ProductMultiSelectorDialog
                            mode="product"
                            initialSelectionIds={selectedProductIds}
                            onSelectionChange={ids => updateSettings({ [productSettingKey]: ids })}
                            open={productPickerOpen}
                            onOpenChange={setProductPickerOpen}
                        />
                    </Field>
                ) : null}
            </div>
        </section>
    );
}

function DualCardTemplatePicker({
    value,
    isZh,
    text,
    onChange,
}: Readonly<{
    value: string;
    isZh: boolean;
    text: typeof zhCopy;
    onChange: (value: string) => void;
}>) {
    return (
        <section className="space-y-3">
            <div>
                <h3 className="text-sm font-medium">{text.dualCardTemplate}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{text.dualCardTemplateHint}</p>
            </div>
            <div
                className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
                role="radiogroup"
                aria-label={text.dualCardTemplate}
            >
                {dualCardTemplates.map(template => {
                    const selected = template.id === value;
                    return (
                        <button
                            key={template.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            className={`min-w-0 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none
                                focus-visible:ring-2 focus-visible:ring-ring ${
                                    selected
                                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                        : 'hover:border-foreground/25 hover:bg-muted/40'
                                }`}
                            onClick={() => onChange(template.id)}
                        >
                            <span className="grid grid-cols-2 gap-1.5" aria-hidden="true">
                                {template.cards.map((card, index) => (
                                    <span
                                        key={index}
                                        className="flex h-16 flex-col justify-between rounded-md border p-2 shadow-sm"
                                        style={{
                                            background: card.background,
                                            borderColor: card.border,
                                            color: card.accent,
                                        }}
                                    >
                                        <span
                                            className="h-2 w-8 rounded-sm border"
                                            style={{ borderColor: card.accent }}
                                        />
                                        <span className="space-y-1">
                                            <span className="block h-1.5 w-3/4 rounded-sm bg-white/85" />
                                            <span
                                                className="block h-1 w-1/2 rounded-sm"
                                                style={{ backgroundColor: card.accent }}
                                            />
                                        </span>
                                    </span>
                                ))}
                            </span>
                            <span className="mt-3 flex items-center justify-between gap-2">
                                <span className="truncate text-sm font-medium">
                                    {isZh ? template.labelZh : template.labelEn}
                                </span>
                                {template.id === 'tech-duo' ? (
                                    <Badge variant="secondary" className="shrink-0">
                                        {text.dualCardDefault}
                                    </Badge>
                                ) : null}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                                {isZh ? template.descriptionZh : template.descriptionEn}
                            </span>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

function HeroThemeSettings({
    draft,
    text,
    onChange,
}: Readonly<{
    draft: ContentBlock;
    text: typeof zhCopy;
    onChange: (draft: ContentBlock) => void;
}>) {
    const settings = draft.settings ?? {};
    const secondaryTextColor = heroSettingColor(
        settings.secondaryTextColor,
        CLOUD_BRIDGE_HERO_THEME.secondaryTextColor,
    );
    const accentColor = heroSettingColor(settings.accentColor, CLOUD_BRIDGE_HERO_THEME.accentColor);
    const accentSecondaryColor = heroSettingColor(
        settings.accentSecondaryColor,
        CLOUD_BRIDGE_HERO_THEME.accentSecondaryColor,
    );
    const buttonTextColor = heroSettingColor(
        settings.buttonTextColor,
        CLOUD_BRIDGE_HERO_THEME.buttonTextColor,
    );
    const updateSetting = (key: string, value: string | null) =>
        onChange({ ...draft, settings: { ...settings, [key]: value } });
    const applyCloudBridgeTheme = () =>
        onChange({
            ...draft,
            backgroundColor: CLOUD_BRIDGE_HERO_THEME.overlayColor,
            textColor: CLOUD_BRIDGE_HERO_THEME.titleColor,
            settings: {
                ...settings,
                themePreset: 'cloudbridge-bright',
                fallbackImage: 'cloudbridge-ai-hub',
                secondaryTextColor: CLOUD_BRIDGE_HERO_THEME.secondaryTextColor,
                accentColor: CLOUD_BRIDGE_HERO_THEME.accentColor,
                accentSecondaryColor: CLOUD_BRIDGE_HERO_THEME.accentSecondaryColor,
                buttonTextColor: CLOUD_BRIDGE_HERO_THEME.buttonTextColor,
            },
        });

    return (
        <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h3 className="text-sm font-medium">{text.heroTheme}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{text.heroThemeHint}</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={applyCloudBridgeTheme}>
                    <Sparkles className="size-4" aria-hidden="true" />
                    {text.heroThemePreset}
                </Button>
            </div>
            <div
                className="h-3 w-full rounded-full border"
                style={{
                    background: `linear-gradient(90deg, ${accentColor}, ${accentSecondaryColor})`,
                }}
                aria-hidden="true"
            />
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label={text.heroOverlayColor}>
                    <ColorInput
                        value={draft.backgroundColor}
                        ariaLabel={text.heroOverlayColor}
                        onChange={value => onChange({ ...draft, backgroundColor: value })}
                    />
                </Field>
                <Field label={text.heroTitleColor}>
                    <ColorInput
                        value={draft.textColor}
                        ariaLabel={text.heroTitleColor}
                        onChange={value => onChange({ ...draft, textColor: value })}
                    />
                </Field>
                <Field label={text.heroSecondaryTextColor}>
                    <ColorInput
                        value={secondaryTextColor}
                        ariaLabel={text.heroSecondaryTextColor}
                        onChange={value => updateSetting('secondaryTextColor', value)}
                    />
                </Field>
                <Field label={text.heroAccentColor}>
                    <ColorInput
                        value={accentColor}
                        ariaLabel={text.heroAccentColor}
                        onChange={value => updateSetting('accentColor', value)}
                    />
                </Field>
                <Field label={text.heroAccentSecondaryColor}>
                    <ColorInput
                        value={accentSecondaryColor}
                        ariaLabel={text.heroAccentSecondaryColor}
                        onChange={value => updateSetting('accentSecondaryColor', value)}
                    />
                </Field>
                <Field label={text.heroButtonTextColor}>
                    <ColorInput
                        value={buttonTextColor}
                        ariaLabel={text.heroButtonTextColor}
                        onChange={value => updateSetting('buttonTextColor', value)}
                    />
                </Field>
            </div>
        </section>
    );
}

function BlockEditor({
    draft,
    lockedType,
    isZh,
    text,
    saving,
    onChange,
    onClose,
    onSave,
}: Readonly<{
    draft: ContentBlock | null;
    lockedType?: ContentBlockType;
    isZh: boolean;
    text: typeof zhCopy;
    saving: boolean;
    onChange: (draft: ContentBlock | null) => void;
    onClose: () => void;
    onSave: (draft: ContentBlock) => void;
}>) {
    const [advancedMode, setAdvancedMode] = useState(false);
    const previewTranslation = useMemo(
        () => (draft ? preferredBlockTranslation(draft, isZh) : null),
        [draft, isZh],
    );
    useEffect(() => {
        setAdvancedMode(draft?.type === 'CUSTOM');
    }, [draft?.id, draft?.type, draft == null]);
    if (!draft) return null;

    const translationLanguages: Array<'zh_Hans' | 'en'> = advancedMode ? ['zh_Hans', 'en'] : ['zh_Hans'];
    const visibleTextFields = simpleTextFieldsForType(draft.type);

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
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <DialogTitle>
                                {lockedType === 'HERO'
                                    ? draft.id
                                        ? text.updateCarouselSlideTitle
                                        : text.createCarouselSlideTitle
                                    : draft.id
                                      ? text.updateTitle
                                      : text.createTitle}
                            </DialogTitle>
                            <DialogDescription className="mt-1">{text.editorDescription}</DialogDescription>
                        </div>
                        <div
                            className="flex shrink-0 rounded-md border bg-muted/30 p-1"
                            aria-label={text.simpleModeHint}
                        >
                            <Button
                                type="button"
                                size="sm"
                                variant={advancedMode ? 'ghost' : 'secondary'}
                                onClick={() => setAdvancedMode(false)}
                            >
                                {text.simpleMode}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={advancedMode ? 'secondary' : 'ghost'}
                                onClick={() => setAdvancedMode(true)}
                            >
                                {text.advancedMode}
                            </Button>
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{text.simpleModeHint}</p>
                </DialogHeader>
                <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden">
                    <div className="min-w-0 space-y-7 px-6 py-5 lg:overflow-y-auto">
                        <section className="space-y-4">
                            <h3 className="text-sm font-medium">{text.basic}</h3>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Field label={text.internalName} hint={text.internalNameHint}>
                                    <Input
                                        value={draft.internalName}
                                        onChange={event => update('internalName', event.target.value)}
                                    />
                                </Field>
                                {!lockedType ? (
                                    <Field label={text.type}>
                                        <Select
                                            value={draft.type}
                                            onValueChange={value => {
                                                if (!value) return;
                                                const type = value;
                                                const nextDraft = {
                                                    ...draft,
                                                    type,
                                                    layoutVariant: defaultLayoutForType(type),
                                                };
                                                onChange(
                                                    type === 'CORE_CATEGORIES'
                                                        ? applyCoreCategoryDefaults(nextDraft)
                                                        : nextDraft,
                                                );
                                                if (type === 'CUSTOM') setAdvancedMode(true);
                                            }}
                                        >
                                            <SelectTrigger className="w-full min-w-0">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {blockTypes
                                                    .filter(type => type !== 'HERO')
                                                    .map(type => (
                                                        <SelectItem key={type} value={type}>
                                                            {isZh
                                                                ? blockTypeLabels[type].zh
                                                                : blockTypeLabels[type].en}
                                                        </SelectItem>
                                                    ))}
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                ) : null}
                                {advancedMode ? (
                                    <Field label={text.code} hint={text.codeHint}>
                                        <Input
                                            value={draft.code}
                                            autoCapitalize="none"
                                            spellCheck={false}
                                            onChange={event => update('code', event.target.value)}
                                        />
                                    </Field>
                                ) : null}
                                {advancedMode ? (
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
                                ) : null}
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
                                {advancedMode ? (
                                    <>
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
                                    </>
                                ) : null}
                                {advancedMode || previewUsesBlockImage(draft.type) ? (
                                    <AssetSelectionField
                                        className="sm:col-span-2"
                                        label={text.imageAsset}
                                        asset={draft.imageAsset}
                                        fallbackUrl={draft.imageUrl}
                                        imageGuidance={blockImageGuidance(draft.type)}
                                        text={text}
                                        onChange={asset =>
                                            onChange({
                                                ...draft,
                                                imageAsset: asset,
                                                imageAssetId: asset?.id ?? null,
                                                imageUrl: asset?.preview ?? null,
                                            })
                                        }
                                    />
                                ) : null}
                                {advancedMode ? (
                                    <>
                                        <Field
                                            label={text.imageUrl}
                                            hint={text.imageHint}
                                            className="sm:col-span-2"
                                        >
                                            <Input
                                                inputMode="url"
                                                value={draft.imageUrl ?? ''}
                                                onChange={event =>
                                                    onChange({
                                                        ...draft,
                                                        imageAsset: null,
                                                        imageAssetId: null,
                                                        imageUrl: event.target.value || null,
                                                    })
                                                }
                                            />
                                            <ImageSizeHint guidance={blockImageGuidance(draft.type)} />
                                        </Field>
                                        {draft.type !== 'CORE_CATEGORIES' && draft.type !== 'HERO' ? (
                                            <>
                                                <Field label={text.backgroundColor}>
                                                    <ColorInput
                                                        value={draft.backgroundColor}
                                                        ariaLabel={text.backgroundColor}
                                                        onChange={value => update('backgroundColor', value)}
                                                    />
                                                </Field>
                                                <Field label={text.textColor}>
                                                    <ColorInput
                                                        value={draft.textColor}
                                                        ariaLabel={text.textColor}
                                                        onChange={value => update('textColor', value)}
                                                    />
                                                </Field>
                                            </>
                                        ) : null}
                                    </>
                                ) : null}
                                {advancedMode || lockedType === 'HERO' ? (
                                    <>
                                        <Field label={text.targetType}>
                                            <TargetSelect
                                                value={draft.targetType}
                                                isZh={isZh}
                                                onChange={value =>
                                                    onChange({
                                                        ...draft,
                                                        targetType: value,
                                                        targetValue:
                                                            value === 'NONE' ? null : draft.targetValue,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Field label={text.targetValue} hint={text.targetHint}>
                                            <Input
                                                disabled={draft.targetType === 'NONE'}
                                                value={draft.targetValue ?? ''}
                                                onChange={event =>
                                                    update('targetValue', event.target.value || null)
                                                }
                                            />
                                        </Field>
                                    </>
                                ) : null}
                            </div>
                        </section>

                        {draft.type === 'HERO' ? (
                            <>
                                <Separator />
                                <HeroThemeSettings draft={draft} text={text} onChange={onChange} />
                            </>
                        ) : null}

                        {(!advancedMode || draft.type === 'CORE_CATEGORIES') &&
                        simpleModuleHasSettings(draft.type) ? (
                            <>
                                <Separator />
                                <ModuleSpecificSettings
                                    draft={draft}
                                    isZh={isZh}
                                    text={text}
                                    onChange={onChange}
                                />
                            </>
                        ) : null}

                        <Separator />
                        <section className="space-y-4">
                            <h3 className="text-sm font-medium">{text.translations}</h3>
                            <div className="grid gap-5 xl:grid-cols-2">
                                {translationLanguages.map(languageCode => {
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
                                            {advancedMode || visibleTextFields.subtitle ? (
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
                                            ) : null}
                                            {advancedMode || visibleTextFields.body ? (
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
                                            ) : null}
                                            {advancedMode || visibleTextFields.cta ? (
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
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>

                        {advancedMode || simpleModuleUsesItems(draft.type) ? (
                            <>
                                <Separator />
                                <section className="space-y-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <h3 className="text-sm font-medium">{text.items}</h3>
                                        {draft.type !== 'CORE_CATEGORIES' || draft.items.length < 2 ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    update('items', [
                                                        ...draft.items,
                                                        newItem(draft.items.length, draft.type),
                                                    ])
                                                }
                                            >
                                                <Plus className="size-4" aria-hidden="true" />
                                                {text.addItem}
                                            </Button>
                                        ) : null}
                                    </div>
                                    {draft.items.map((item, index) => (
                                        <ItemEditor
                                            key={item.id ?? `new-${index}`}
                                            item={item}
                                            index={index}
                                            blockType={draft.type}
                                            advancedMode={advancedMode}
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
                                                    draft.items.filter(
                                                        (_, currentIndex) => currentIndex !== index,
                                                    ),
                                                )
                                            }
                                        />
                                    ))}
                                </section>
                            </>
                        ) : null}
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
                                    backgroundColor:
                                        draft.type === 'HERO'
                                            ? '#f8fafc'
                                            : draft.backgroundColor || '#ffffff',
                                    color: draft.type === 'HERO' ? '#111827' : draft.textColor || '#111827',
                                }}
                            >
                                {draft.type === 'HERO' ? (
                                    <HeroEditorPreview
                                        draft={draft}
                                        translation={previewTranslation}
                                        isZh={isZh}
                                    />
                                ) : (
                                    <>
                                        {previewUsesBlockImage(draft.type) ? (
                                            draft.imageUrl ? (
                                                <img
                                                    className="mb-4 aspect-[16/9] w-full rounded-md object-cover"
                                                    src={draft.imageUrl}
                                                    alt=""
                                                />
                                            ) : (
                                                <div className="mb-4 flex aspect-[16/9] items-center justify-center rounded-md border border-dashed bg-background/50">
                                                    <ImageIcon
                                                        className="size-5 opacity-50"
                                                        aria-hidden="true"
                                                    />
                                                </div>
                                            )
                                        ) : null}
                                        {previewTranslation?.title ? (
                                            <>
                                                <h4 className="text-lg font-semibold">
                                                    {previewTranslation.title}
                                                </h4>
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
                                                                    {item.imageUrl ? (
                                                                        <img
                                                                            className="mb-2 aspect-square w-full rounded object-cover"
                                                                            src={item.imageUrl}
                                                                            alt=""
                                                                        />
                                                                    ) : null}
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
                                    </>
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

function HeroEditorPreview({
    draft,
    translation,
    isZh,
}: Readonly<{
    draft: ContentBlock;
    translation: ContentBlockTranslation | null;
    isZh: boolean;
}>) {
    const settings = draft.settings ?? {};
    const overlayColor = heroSettingColor(draft.backgroundColor, CLOUD_BRIDGE_HERO_THEME.overlayColor);
    const titleColor = heroSettingColor(draft.textColor, CLOUD_BRIDGE_HERO_THEME.titleColor);
    const bodyColor = heroSettingColor(
        settings.secondaryTextColor,
        CLOUD_BRIDGE_HERO_THEME.secondaryTextColor,
    );
    const accentColor = heroSettingColor(settings.accentColor, CLOUD_BRIDGE_HERO_THEME.accentColor);
    const accentSecondaryColor = heroSettingColor(
        settings.accentSecondaryColor,
        CLOUD_BRIDGE_HERO_THEME.accentSecondaryColor,
    );
    const buttonTextColor = heroSettingColor(
        settings.buttonTextColor,
        CLOUD_BRIDGE_HERO_THEME.buttonTextColor,
    );
    const imageBackground = draft.imageUrl
        ? `url("${draft.imageUrl.replace(/"/g, '%22')}") center / cover no-repeat`
        : 'linear-gradient(135deg, #f4fbff 0%, #67e8f9 43%, #818cf8 72%, #c084fc 100%)';
    const overlayStrong = heroColorWithAlpha(overlayColor, 0.92);
    const overlayMedium = heroColorWithAlpha(overlayColor, 0.76);

    return (
        <div className="overflow-hidden rounded-lg border bg-white shadow-sm">
            <div className="relative aspect-[16/9] overflow-hidden" style={{ background: imageBackground }}>
                {!draft.imageUrl ? (
                    <div
                        className="absolute right-4 top-1/2 size-20 -translate-y-1/2 rounded-full border-[10px] shadow-[0_0_28px_rgba(255,255,255,0.9)]"
                        style={{
                            borderColor: heroColorWithAlpha(accentColor, 0.7),
                            backgroundColor: heroColorWithAlpha('#ffffff', 0.45),
                        }}
                        aria-hidden="true"
                    />
                ) : null}
                <div
                    className="absolute inset-0"
                    style={{
                        background: `linear-gradient(90deg, ${overlayStrong} 0%, ${overlayMedium} 48%, transparent 100%)`,
                    }}
                />
                <div className="absolute inset-0 flex w-[68%] flex-col justify-between p-3">
                    <span
                        className="self-start rounded-full border px-2 py-0.5 text-[7px] font-semibold"
                        style={{
                            borderColor: heroColorWithAlpha(accentColor, 0.55),
                            backgroundColor: heroColorWithAlpha(accentColor, 0.18),
                            color: accentColor,
                        }}
                    >
                        {translation?.subtitle || (isZh ? '轮播副标题' : 'Carousel subtitle')}
                    </span>
                    <div>
                        <h4 className="text-[14px] font-black leading-tight" style={{ color: titleColor }}>
                            {translation?.title || (isZh ? '轮播标题' : 'Carousel title')}
                        </h4>
                        {translation?.body ? (
                            <p
                                className="mt-1 line-clamp-2 text-[8px] leading-3"
                                style={{ color: bodyColor }}
                            >
                                {translation.body}
                            </p>
                        ) : null}
                    </div>
                    {draft.items.length ? (
                        <div className="flex gap-1">
                            {draft.items.slice(0, 3).map((item, index) => {
                                const itemTranslation = preferredItemTranslation(item, isZh);
                                return (
                                    <span
                                        key={item.id ?? index}
                                        className="rounded border px-1.5 py-0.5 text-[6px]"
                                        style={{
                                            borderColor: heroColorWithAlpha(accentColor, 0.35),
                                            backgroundColor: heroColorWithAlpha(overlayColor, 0.58),
                                            color: bodyColor,
                                        }}
                                    >
                                        {itemTranslation.label}
                                    </span>
                                );
                            })}
                        </div>
                    ) : null}
                    {translation?.ctaLabel ? (
                        <span
                            className="self-start rounded-md px-2 py-1 text-[7px] font-bold"
                            style={{
                                background: `linear-gradient(135deg, ${accentColor}, ${accentSecondaryColor})`,
                                color: buttonTextColor,
                            }}
                        >
                            {translation.ctaLabel}
                        </span>
                    ) : null}
                </div>
            </div>
            <p className="px-3 py-2 text-[10px] leading-4 text-muted-foreground">
                {isZh
                    ? '预览展示网页文字与配色；轮播图片本身不包含文字。'
                    : 'Preview of HTML copy and colors; the image itself remains text-free.'}
            </p>
        </div>
    );
}

function ItemEditor({
    item,
    index,
    blockType,
    advancedMode,
    isZh,
    text,
    onChange,
    onRemove,
}: Readonly<{
    item: ContentItem;
    index: number;
    blockType: ContentBlockType;
    advancedMode: boolean;
    isZh: boolean;
    text: typeof zhCopy;
    onChange: (item: ContentItem) => void;
    onRemove: () => void;
}>) {
    const translationLanguages: Array<'zh_Hans' | 'en'> = advancedMode ? ['zh_Hans', 'en'] : ['zh_Hans'];
    const showTarget = advancedMode || simpleItemNeedsTarget(blockType);
    const update = <K extends keyof ContentItem>(key: K, value: ContentItem[K]) =>
        onChange({ ...item, [key]: value });
    const updateLocalizedSetting = (
        field: 'badgeLabel' | 'ctaLabel',
        languageCode: 'zh_Hans' | 'en',
        value: string,
    ) => {
        const settings = {
            ...(item.settings ?? {}),
            [localizedItemSettingKey(field, languageCode)]: value,
        };
        if (!advancedMode && languageCode === 'zh_Hans') {
            delete settings[localizedItemSettingKey(field, 'en')];
        }
        update('settings', settings);
    };
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
                {advancedMode || simpleItemUsesImage(blockType) ? (
                    <AssetSelectionField
                        className="sm:col-span-2"
                        label={text.imageAsset}
                        asset={item.imageAsset}
                        fallbackUrl={item.imageUrl}
                        imageGuidance={itemImageGuidance(blockType)}
                        text={text}
                        onChange={asset =>
                            onChange({
                                ...item,
                                imageAsset: asset,
                                imageAssetId: asset?.id ?? null,
                                imageUrl: asset?.preview ?? null,
                            })
                        }
                    />
                ) : null}
                {advancedMode ? (
                    <Field label={text.position}>
                        <Input
                            type="number"
                            min={0}
                            value={item.position}
                            onChange={event => update('position', Number(event.target.value) || 0)}
                        />
                    </Field>
                ) : null}
                {showTarget ? (
                    <>
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
                        <Field label={text.targetValue} hint={text.targetHint}>
                            <Input
                                disabled={item.targetType === 'NONE'}
                                value={item.targetValue ?? ''}
                                onChange={event => update('targetValue', event.target.value || null)}
                            />
                        </Field>
                    </>
                ) : null}
                {translationLanguages.map(languageCode => {
                    const translation = getItemTranslation(item, languageCode);
                    return (
                        <div key={languageCode} className="space-y-3 border-l-2 pl-4">
                            <h4 className="text-xs font-medium text-muted-foreground">
                                {languageCode === 'zh_Hans' ? text.chinese : text.english}
                            </h4>
                            {blockType === 'CORE_CATEGORIES' ? (
                                <Field label={text.itemBadge}>
                                    <Input
                                        value={stringSetting(
                                            item.settings?.[
                                                localizedItemSettingKey('badgeLabel', languageCode)
                                            ],
                                        )}
                                        onChange={event =>
                                            updateLocalizedSetting(
                                                'badgeLabel',
                                                languageCode,
                                                event.target.value,
                                            )
                                        }
                                    />
                                </Field>
                            ) : null}
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
                            {blockType === 'CORE_CATEGORIES' ? (
                                <Field label={text.itemCta}>
                                    <Input
                                        value={stringSetting(
                                            item.settings?.[
                                                localizedItemSettingKey('ctaLabel', languageCode)
                                            ],
                                        )}
                                        onChange={event =>
                                            updateLocalizedSetting(
                                                'ctaLabel',
                                                languageCode,
                                                event.target.value,
                                            )
                                        }
                                    />
                                </Field>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function AssetSelectionField({
    label,
    className,
    asset,
    fallbackUrl,
    imageGuidance,
    text,
    onChange,
}: Readonly<{
    label: string;
    className?: string;
    asset: ContentBlock['imageAsset'];
    fallbackUrl: string | null;
    imageGuidance: ContentImageGuidance;
    text: typeof zhCopy;
    onChange: (asset: NonNullable<ContentBlock['imageAsset']> | null) => void;
}>) {
    const [open, setOpen] = useState(false);
    const preview = asset?.preview ?? fallbackUrl;

    return (
        <Field label={label} className={className}>
            <div className="flex min-w-0 items-center gap-3 rounded-md border p-3">
                {preview ? (
                    <img className="size-16 shrink-0 rounded-md border object-cover" src={preview} alt="" />
                ) : (
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-md border border-dashed bg-muted/40">
                        <ImageIcon className="size-5 text-muted-foreground" aria-hidden="true" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{asset?.name ?? text.noImage}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
                            <ImagePlus className="size-4" aria-hidden="true" />
                            {preview ? text.replaceImage : text.selectImage}
                        </Button>
                        {preview ? (
                            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
                                {text.removeImage}
                            </Button>
                        ) : null}
                    </div>
                </div>
            </div>
            <ImageSizeHint guidance={imageGuidance} />
            <AssetPickerDialog
                open={open}
                onClose={() => setOpen(false)}
                onSelect={assets => onChange(assets[0] ?? null)}
                initialSelectedAssets={asset ? [asset] : []}
                title={text.selectImage}
                imageGuidance={imageGuidance}
            />
        </Field>
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
    ariaLabel,
    onChange,
}: Readonly<{ value: string | null; ariaLabel: string; onChange: (value: string | null) => void }>) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            <input
                className="size-9 shrink-0 cursor-pointer rounded border bg-transparent p-1"
                type="color"
                value={value || '#ffffff'}
                aria-label={ariaLabel}
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

function heroSettingColor(value: unknown, fallback: string): string {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : fallback;
}

function heroColorWithAlpha(color: string, alpha: number): string {
    const normalized = heroSettingColor(color, '#000000').slice(1);
    const red = Number.parseInt(normalized.slice(0, 2), 16);
    const green = Number.parseInt(normalized.slice(2, 4), 16);
    const blue = Number.parseInt(normalized.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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

function defaultLayoutForType(type: ContentBlockType): ContentBlock['layoutVariant'] {
    if (type === 'HERO') return 'HERO_OVERLAY';
    if (type === 'NOTICE') return 'TICKER';
    if (type === 'QUICK_LINKS' || type === 'TRUST_BAR') return 'ICON_GRID';
    if (type === 'CORE_CATEGORIES' || type === 'CATEGORY_AD') return 'CARD_GRID';
    if (type === 'FLASH_SALE' || type === 'BEST_SELLERS' || type === 'RECOMMENDATIONS') {
        return 'PRODUCT_GRID';
    }
    if (type === 'STORY' || type === 'LEGAL' || type === 'SUPPORT') return 'RICH_TEXT';
    if (type === 'CUSTOM') return 'CUSTOM';
    return 'AUTO';
}

function simpleTextFieldsForType(type: ContentBlockType): {
    subtitle: boolean;
    body: boolean;
    cta: boolean;
} {
    return {
        subtitle: ['HERO', 'CATEGORY_AD', 'STORY'].includes(type),
        body: ['HERO', 'NOTICE', 'STORY', 'LEGAL', 'SUPPORT'].includes(type),
        cta: ['HERO', 'CATEGORY_AD', 'FEATURED_COLLECTION', 'STORY'].includes(type),
    };
}

function simpleItemNeedsTarget(type: ContentBlockType): boolean {
    return ['HERO', 'QUICK_LINKS', 'CATEGORY_AD', 'CORE_CATEGORIES', 'COUPONS', 'CUSTOM'].includes(type);
}

function simpleItemUsesImage(type: ContentBlockType): boolean {
    return [
        'HERO',
        'QUICK_LINKS',
        'CATEGORY_AD',
        'COUPONS',
        'TRUST_BAR',
        'CORE_CATEGORIES',
        'CUSTOM',
    ].includes(type);
}

function simpleModuleHasSettings(type: ContentBlockType): boolean {
    return [
        'NOTICE',
        'CORE_CATEGORIES',
        'FEATURED_COLLECTION',
        'FLASH_SALE',
        'BEST_SELLERS',
        'RECOMMENDATIONS',
    ].includes(type);
}

function simpleModuleUsesItems(type: ContentBlockType): boolean {
    return [
        'HERO',
        'NOTICE',
        'QUICK_LINKS',
        'CATEGORY_AD',
        'COUPONS',
        'TRUST_BAR',
        'CORE_CATEGORIES',
        'SUPPORT',
        'CUSTOM',
    ].includes(type);
}

function previewUsesBlockImage(type: ContentBlockType): boolean {
    return ['HERO', 'CATEGORY_AD', 'STORY', 'CUSTOM'].includes(type);
}

function blockImageGuidance(type: ContentBlockType): ContentImageGuidance {
    return type === 'HERO' ? 'hero' : 'banner';
}

function itemImageGuidance(type: ContentBlockType): ContentImageGuidance {
    return ['QUICK_LINKS', 'TRUST_BAR'].includes(type) ? 'icon' : 'contentCard';
}

function stringArraySetting(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringSetting(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function localizedItemSettingKey(field: 'badgeLabel' | 'ctaLabel', languageCode: 'zh_Hans' | 'en'): string {
    return `${field}${languageCode === 'zh_Hans' ? 'Zh' : 'En'}`;
}

function numberSetting(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function newBlock(position: number, type: ContentBlockType = 'HERO'): ContentBlock {
    return {
        code: `home-block-${Date.now().toString(36)}-${position}`,
        internalName: `首页模块 ${position + 1}`,
        type,
        layoutVariant: defaultLayoutForType(type),
        enabled: true,
        position,
        startsAt: null,
        endsAt: null,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        translations: [emptyBlockTranslation('zh_Hans'), emptyBlockTranslation('en')],
        items: [],
    };
}

function newHeroBlock(position: number, slideNumber: number): ContentBlock {
    const heroStat = (
        statPosition: number,
        labelZh: string,
        descriptionZh: string,
        labelEn: string,
        descriptionEn: string,
    ): ContentItem => ({
        ...newItem(statPosition, 'HERO'),
        translations: [
            { languageCode: 'zh_Hans', label: labelZh, description: descriptionZh },
            { languageCode: 'en', label: labelEn, description: descriptionEn },
        ],
    });

    return {
        ...newBlock(position, 'HERO'),
        internalName: `首页轮播图 ${slideNumber}`,
        backgroundColor: CLOUD_BRIDGE_HERO_THEME.overlayColor,
        textColor: CLOUD_BRIDGE_HERO_THEME.titleColor,
        targetType: 'URL',
        targetValue: CLOUD_BRIDGE_TARGET_URL,
        settings: {
            themePreset: 'cloudbridge-bright',
            fallbackImage: 'cloudbridge-ai-hub',
            secondaryTextColor: CLOUD_BRIDGE_HERO_THEME.secondaryTextColor,
            accentColor: CLOUD_BRIDGE_HERO_THEME.accentColor,
            accentSecondaryColor: CLOUD_BRIDGE_HERO_THEME.accentSecondaryColor,
            buttonTextColor: CLOUD_BRIDGE_HERO_THEME.buttonTextColor,
        },
        translations: [
            {
                languageCode: 'zh_Hans',
                title: '模型很多，入口只要一个',
                subtitle: 'AI API 智能中转',
                body: '统一接入多种 AI 能力，灵活路由、按需切换，让每一次调用更简单。',
                ctaLabel: '开启云桥通道',
            },
            {
                languageCode: 'en',
                title: 'Many models. One gateway.',
                subtitle: 'Intelligent AI API Relay',
                body: 'Connect diverse AI capabilities through one flexible gateway and route every request with ease.',
                ctaLabel: 'Open the gateway',
            },
        ],
        items: [
            heroStat(0, '统一', '多模型接入', 'Unified', 'Multi-model access'),
            heroStat(1, '灵活', '按需切换', 'Flexible', 'Route on demand'),
            heroStat(2, '快速', '开发调用', 'Ready', 'Developer friendly'),
        ],
    };
}

function newCoreCategoriesBlock(position: number): ContentBlock {
    return applyCoreCategoryDefaults({
        ...newBlock(position),
        type: 'CORE_CATEGORIES',
        layoutVariant: 'CARD_GRID',
        internalName: '首页核心品类双卡片',
    });
}

function newItem(position: number, blockType?: ContentBlockType): ContentItem {
    return {
        enabled: true,
        position,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        targetType: blockType === 'COUPONS' ? 'COUPON' : 'NONE',
        targetValue: null,
        settings: null,
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
        internalName: block.internalName.trim(),
        type: block.type,
        layoutVariant: block.layoutVariant,
        enabled: block.enabled,
        position: block.position,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        imageAssetId: block.imageAsset?.id ?? block.imageAssetId ?? null,
        imageUrl: block.imageUrl?.trim() || null,
        backgroundColor: block.backgroundColor?.trim() || null,
        textColor: block.textColor?.trim() || null,
        targetType: block.targetType,
        targetValue: block.targetType === 'NONE' ? null : block.targetValue?.trim() || null,
        settings: block.settings,
        translations: block.translations
            .map(({ languageCode, title, subtitle, body, ctaLabel }) => ({
                languageCode,
                title: title.trim(),
                subtitle: subtitle.trim(),
                body: body.trim(),
                ctaLabel: ctaLabel.trim(),
            }))
            .filter(translation => Boolean(translation.title)),
        items: block.items.map((item, index) => ({
            ...(item.id ? { id: item.id } : {}),
            enabled: item.enabled,
            position: index,
            imageAssetId: item.imageAsset?.id ?? item.imageAssetId ?? null,
            imageUrl: item.imageUrl?.trim() || null,
            targetType: item.targetType,
            targetValue: item.targetType === 'NONE' ? null : item.targetValue?.trim() || null,
            settings: item.settings,
            translations: item.translations
                .map(({ languageCode, label, description }) => ({
                    languageCode,
                    label: label.trim(),
                    description: description.trim(),
                }))
                .filter(translation => Boolean(translation.label)),
        })),
    };
}

function isValid(block: ContentBlock): boolean {
    return (
        Boolean(block.code.trim()) &&
        Boolean(block.internalName.trim()) &&
        blockHasChineseSource(block.translations) &&
        block.items.every(item => itemHasChineseSource(item.translations))
    );
}

function blockHasChineseSource(translations: ContentBlockTranslation[]): boolean {
    return Boolean(translations.find(translation => translation.languageCode === 'zh_Hans')?.title.trim());
}

function itemHasChineseSource(translations: ContentItem['translations']): boolean {
    return Boolean(translations.find(translation => translation.languageCode === 'zh_Hans')?.label.trim());
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
