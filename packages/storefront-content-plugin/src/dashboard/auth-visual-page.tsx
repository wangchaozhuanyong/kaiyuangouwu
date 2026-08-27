import { useLingui } from '@lingui/react';
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
    Skeleton,
    Switch,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import {
    Image as ImageIcon,
    ImagePlus,
    Monitor,
    RefreshCw,
    RotateCcw,
    Save,
    Smartphone,
    Sparkles,
} from 'lucide-react';
import { CSSProperties, useEffect, useState } from 'react';

import {
    AuthVisualBlockType,
    AuthVisualLanguageCode,
    authVisualAccentColor,
    authVisualInput,
    authVisualTranslation,
    createAuthVisualDraft,
    isAuthVisualValid,
} from './auth-visual-config';
import {
    ContentBlock,
    StorefrontContentBlocksResult,
    createStorefrontContentBlockMutation,
    storefrontContentBlocksQuery,
    updateStorefrontContentBlockMutation,
} from './storefront-content.graphql';

const copy = {
    zh: {
        nav: '登录注册页视觉',
        title: '登录注册页视觉',
        description: '分别管理登录页和注册页的图片与中文广告词；保存时自动生成英文并立即生效。',
        activeChannel: '当前店铺',
        refresh: '刷新',
        login: '登录页主视觉',
        register: '注册页主视觉',
        loginDescription: '适合老用户回访，突出 AI 工具聚合与效率提升。',
        registerDescription: '适合新用户转化，突出个人 AI 工作流与平台价值。',
        enabled: '启用后台配置',
        enabledHint: '关闭后前台使用系统默认图片和文案。',
        image: '广告图片',
        selectImage: '从素材库选择或上传',
        replaceImage: '更换图片',
        removeImage: '改用系统默认图',
        defaultImage: '当前使用系统默认图',
        color: '文字与遮罩颜色',
        textColor: '主文字',
        overlayColor: '遮罩底色',
        accentColor: '标签强调色',
        content: '广告文案',
        chinese: '中文',
        english: 'English',
        englishHint: '可直接编辑；留空时保存会根据中文自动生成。',
        commonMode: '常用模式',
        englishReview: '英文校对',
        translationHelp: '通常只需填写中文；仅在需要人工修改英文译文时展开校对。',
        eyebrow: '顶部短句',
        headline: '广告主标题',
        subtitle: '说明文案',
        tags: '卖点标签',
        preview: '实时预览',
        desktopPreview: '桌面端',
        mobilePreview: '手机端',
        save: '保存并发布',
        saving: '正在保存',
        reset: '载入系统默认配置',
        saved: '页面视觉已保存并发布',
        validation: '请填写中文顶部短句、主标题、说明文案和三个卖点标签。',
        loadError: '无法加载登录注册页视觉配置。',
        liveHint: '文字作为网页内容叠加在图片上，不会写入图片，手机端会自动适配。',
    },
    en: {
        nav: 'Login & registration visuals',
        // i18n-audit-ignore -- paired with the zh_Hans Dashboard copy above
        title: 'Login & registration visuals',
        // i18n-audit-ignore -- paired with the zh_Hans Dashboard copy above
        description:
            'Manage imagery, localized campaign copy and benefit tags for sign-in and registration. Saving publishes to the active store immediately.',
        activeChannel: 'Active store',
        refresh: 'Refresh',
        login: 'Login page visual',
        register: 'Registration page visual',
        loginDescription: 'Designed for returning users, emphasizing curated AI tools and productivity.',
        registerDescription:
            'Designed for conversion, emphasizing a personal AI workflow and platform value.',
        enabled: 'Use managed content',
        enabledHint: 'When off, the storefront uses its built-in image and copy.',
        image: 'Campaign image',
        selectImage: 'Select or upload asset',
        replaceImage: 'Replace image',
        removeImage: 'Use built-in image',
        defaultImage: 'Using the built-in image',
        color: 'Copy and overlay colors',
        textColor: 'Primary text',
        overlayColor: 'Overlay base',
        accentColor: 'Tag accent',
        content: 'Campaign copy',
        chinese: '中文',
        english: 'English',
        englishHint: 'Edit directly, or leave it blank to generate English from Chinese when saving.',
        commonMode: 'Common mode',
        englishReview: 'Review English',
        translationHelp:
            'Usually you only need Chinese. Open English review only to override the translation.',
        eyebrow: 'Eyebrow',
        headline: 'Headline',
        subtitle: 'Supporting copy',
        tags: 'Benefit tags',
        preview: 'Live preview',
        desktopPreview: 'Desktop',
        mobilePreview: 'Mobile',
        save: 'Save and publish',
        saving: 'Saving',
        reset: 'Load built-in defaults',
        saved: 'Page visual saved and published',
        validation: 'Enter the Chinese eyebrow, headline, supporting copy and all three benefit tags.',
        loadError: 'Could not load login and registration visual settings.',
        liveHint:
            'Copy is layered over the image as HTML, not baked into it, and adapts automatically on mobile.',
    },
} as const;

const PREVIEW_OVERLAY_BACKGROUND = [
    'linear-gradient(90deg, color-mix(in srgb, var(--preview-overlay) 88%, transparent), color-mix(in srgb, var(--preview-overlay) 28%, transparent))',
    'linear-gradient(0deg, color-mix(in srgb, var(--preview-overlay) 46%, transparent), transparent 62%)',
].join(', ');

type AuthVisualCopy = { [Key in keyof (typeof copy)['zh']]: string };

export const authVisualRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketing',
        id: 'auth-visuals',
        url: '/auth-visuals',
        title: copy.zh.nav,
        requiresPermission: ['ReadStorefrontContent'],
    },
    path: '/auth-visuals',
    loader: () => ({ breadcrumb: () => copy.zh.nav }),
    component: () => <AuthVisualPage />,
};

function AuthVisualPage() {
    const { i18n } = useLingui();
    const text = i18n.locale.toLowerCase().startsWith('zh') ? copy.zh : copy.en;
    const { activeChannel } = useChannel();
    const queryClient = useQueryClient();
    const queryKey = ['storefront-content-blocks', activeChannel?.id];
    const [drafts, setDrafts] = useState<Record<AuthVisualBlockType, ContentBlock>>({
        AUTH_LOGIN: createAuthVisualDraft('AUTH_LOGIN'),
        AUTH_REGISTER: createAuthVisualDraft('AUTH_REGISTER'),
    });
    const [activeType, setActiveType] = useState<AuthVisualBlockType>('AUTH_LOGIN');

    const contentQuery = useQuery({
        queryKey,
        queryFn: () => api.query<StorefrontContentBlocksResult>(storefrontContentBlocksQuery),
        enabled: Boolean(activeChannel?.id),
    });

    useEffect(() => {
        if (!contentQuery.data) return;
        const blocks = contentQuery.data.storefrontContentBlocks;
        setDrafts({
            AUTH_LOGIN: createAuthVisualDraft(
                'AUTH_LOGIN',
                blocks.find(block => block.type === 'AUTH_LOGIN'),
            ),
            AUTH_REGISTER: createAuthVisualDraft(
                'AUTH_REGISTER',
                blocks.find(block => block.type === 'AUTH_REGISTER'),
            ),
        });
    }, [activeChannel?.id, contentQuery.data]);

    const saveMutation = useMutation({
        mutationFn: (block: ContentBlock) => {
            const input = authVisualInput(block);
            return block.id
                ? api.mutate(updateStorefrontContentBlockMutation, { input: { id: block.id, ...input } })
                : api.mutate(createStorefrontContentBlockMutation, { input });
        },
        onSuccess: async () => {
            toast.success(text.saved);
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const updateDraft = (type: AuthVisualBlockType, draft: ContentBlock) =>
        setDrafts(current => ({ ...current, [type]: draft }));

    const resetDraft = (type: AuthVisualBlockType) => {
        const current = drafts[type];
        const restored = createAuthVisualDraft(type);
        updateDraft(type, {
            ...restored,
            id: current.id,
            position: current.position,
        });
    };

    return (
        <Page pageId="auth-visuals">
            <PageTitle>{text.title}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={contentQuery.isFetching}
                        onClick={() => void contentQuery.refetch()}
                    >
                        <RefreshCw className={`size-4 ${contentQuery.isFetching ? 'animate-spin' : ''}`} />
                        {text.refresh}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="auth-visuals-introduction"
                    title={text.title}
                    description={text.description}
                >
                    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                        <span>{text.activeChannel}</span>
                        <Badge variant="outline">
                            {activeChannel ? <ChannelCodeLabel code={activeChannel.code} /> : '-'}
                        </Badge>
                        <span>{text.liveHint}</span>
                    </div>
                </PageBlock>

                {contentQuery.isPending ? (
                    <PageBlock column="full" blockId="auth-visuals-loading">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Skeleton className="h-[520px]" />
                            <Skeleton className="h-[520px]" />
                        </div>
                    </PageBlock>
                ) : contentQuery.isError ? (
                    <PageBlock column="full" blockId="auth-visuals-error">
                        <Alert variant="destructive">
                            <AlertDescription>{text.loadError}</AlertDescription>
                        </Alert>
                    </PageBlock>
                ) : (
                    <PageBlock
                        column="full"
                        blockId={`auth-visual-${activeType.toLowerCase()}`}
                        title={activeType === 'AUTH_LOGIN' ? text.login : text.register}
                        description={
                            activeType === 'AUTH_LOGIN' ? text.loginDescription : text.registerDescription
                        }
                    >
                        <div className="mb-6 grid gap-2 rounded-xl bg-muted/35 p-1.5 sm:grid-cols-2">
                            {(['AUTH_LOGIN', 'AUTH_REGISTER'] as const).map(type => (
                                <Button
                                    key={type}
                                    type="button"
                                    variant={activeType === type ? 'secondary' : 'ghost'}
                                    className="h-auto justify-start px-4 py-3 text-left"
                                    aria-pressed={activeType === type}
                                    onClick={() => setActiveType(type)}
                                >
                                    <span>
                                        <span className="block font-semibold">
                                            {type === 'AUTH_LOGIN' ? text.login : text.register}
                                        </span>
                                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                                            {type === 'AUTH_LOGIN'
                                                ? text.loginDescription
                                                : text.registerDescription}
                                        </span>
                                    </span>
                                </Button>
                            ))}
                        </div>
                        <AuthVisualEditor
                            draft={drafts[activeType]}
                            text={text}
                            saving={saveMutation.isPending && saveMutation.variables?.type === activeType}
                            onChange={draft => updateDraft(activeType, draft)}
                            onReset={() => resetDraft(activeType)}
                            onSave={() => saveMutation.mutate(drafts[activeType])}
                        />
                    </PageBlock>
                )}
            </PageLayout>
        </Page>
    );
}

function AuthVisualEditor({
    draft,
    text,
    saving,
    onChange,
    onReset,
    onSave,
}: Readonly<{
    draft: ContentBlock;
    text: AuthVisualCopy;
    saving: boolean;
    onChange: (draft: ContentBlock) => void;
    onReset: () => void;
    onSave: () => void;
}>) {
    const [previewLanguage, setPreviewLanguage] = useState<AuthVisualLanguageCode>('zh_Hans');
    const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop');
    const [editEnglish, setEditEnglish] = useState(false);
    const previewTranslation = authVisualTranslation(draft, previewLanguage);
    const previewImage = draft.imageAsset?.preview ?? draft.imageUrl;
    const accentColor = authVisualAccentColor(draft);
    const valid = isAuthVisualValid(draft);
    const editLanguages: AuthVisualLanguageCode[] = editEnglish ? ['zh_Hans', 'en'] : ['zh_Hans'];
    const previewStyle = {
        '--preview-text': draft.textColor ?? '#ffffff',
        '--preview-overlay': draft.backgroundColor ?? '#020718',
        '--preview-accent': accentColor,
        ...(previewImage ? { backgroundImage: `url("${previewImage.replace(/"/g, '%22')}")` } : {}),
    } as CSSProperties;
    const previewViewportClassName = [
        'relative overflow-hidden rounded-2xl border bg-slate-950 bg-cover bg-center shadow-xl',
        'transition-[max-width,aspect-ratio] duration-300',
        previewViewport === 'mobile'
            ? 'mx-auto aspect-[390/230] min-h-[230px] max-w-[390px]'
            : 'aspect-[16/9] min-h-[280px] max-w-full',
    ].join(' ');

    const updateTranslation = (
        languageCode: AuthVisualLanguageCode,
        key: 'ctaLabel' | 'title' | 'subtitle',
        value: string,
    ) =>
        onChange({
            ...draft,
            translations: draft.translations.map(translation =>
                translation.languageCode === languageCode ? { ...translation, [key]: value } : translation,
            ),
        });

    const updateTag = (languageCode: AuthVisualLanguageCode, position: number, value: string) =>
        onChange({
            ...draft,
            items: draft.items.map((item, itemPosition) =>
                itemPosition === position
                    ? {
                          ...item,
                          translations: item.translations.map(translation =>
                              translation.languageCode === languageCode
                                  ? { ...translation, label: value }
                                  : translation,
                          ),
                      }
                    : item,
            ),
        });

    return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
            <div className="space-y-6">
                <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 p-4">
                    <div>
                        <Label>{text.enabled}</Label>
                        <p className="mt-1 text-xs text-muted-foreground">{text.enabledHint}</p>
                    </div>
                    <Switch
                        checked={draft.enabled}
                        onCheckedChange={enabled => onChange({ ...draft, enabled })}
                    />
                </div>

                <AuthVisualImageField
                    draft={draft}
                    text={text}
                    onChange={(asset, remove) =>
                        onChange({
                            ...draft,
                            imageAsset: asset,
                            imageAssetId: asset?.id ?? (remove ? null : draft.imageAssetId),
                            imageUrl: remove || asset ? null : draft.imageUrl,
                        })
                    }
                />

                <div className="space-y-3">
                    <div>
                        <Label>{text.color}</Label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <ColorField
                            label={text.textColor}
                            value={draft.textColor ?? '#ffffff'}
                            onChange={value => onChange({ ...draft, textColor: value })}
                        />
                        <ColorField
                            label={text.overlayColor}
                            value={draft.backgroundColor ?? '#020718'}
                            onChange={value => onChange({ ...draft, backgroundColor: value })}
                        />
                        <ColorField
                            label={text.accentColor}
                            value={accentColor}
                            onChange={value =>
                                onChange({
                                    ...draft,
                                    settings: { ...draft.settings, accentColor: value },
                                })
                            }
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <Label>{text.content}</Label>
                            <p className="mt-1 text-xs text-muted-foreground">{text.translationHelp}</p>
                        </div>
                        <div className="flex shrink-0 rounded-md border bg-background p-1">
                            <Button
                                type="button"
                                size="sm"
                                variant={editEnglish ? 'ghost' : 'secondary'}
                                onClick={() => setEditEnglish(false)}
                            >
                                {text.commonMode}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={editEnglish ? 'secondary' : 'ghost'}
                                onClick={() => setEditEnglish(true)}
                            >
                                {text.englishReview}
                            </Button>
                        </div>
                    </div>
                    <div className={`grid gap-4 ${editEnglish ? '2xl:grid-cols-2' : ''}`}>
                        {editLanguages.map(languageCode => {
                            const translation = authVisualTranslation(draft, languageCode);
                            return (
                                <div key={languageCode} className="space-y-4 rounded-lg border p-4">
                                    <div>
                                        <h3 className="font-medium">
                                            {languageCode === 'zh_Hans' ? text.chinese : text.english}
                                        </h3>
                                        {languageCode === 'en' ? (
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {text.englishHint}
                                            </p>
                                        ) : null}
                                    </div>
                                    <TextField
                                        label={text.eyebrow}
                                        value={translation.ctaLabel}
                                        maxLength={languageCode === 'zh_Hans' ? 28 : 40}
                                        onChange={value => updateTranslation(languageCode, 'ctaLabel', value)}
                                    />
                                    <TextField
                                        label={text.headline}
                                        value={translation.title}
                                        maxLength={languageCode === 'zh_Hans' ? 24 : 48}
                                        onChange={value => updateTranslation(languageCode, 'title', value)}
                                    />
                                    <TextField
                                        label={text.subtitle}
                                        value={translation.subtitle}
                                        maxLength={languageCode === 'zh_Hans' ? 42 : 80}
                                        onChange={value => updateTranslation(languageCode, 'subtitle', value)}
                                    />
                                    <div className="space-y-2">
                                        <Label>{text.tags}</Label>
                                        <div className="grid gap-2 sm:grid-cols-3 2xl:grid-cols-1">
                                            {draft.items.map((item, position) => (
                                                <Input
                                                    key={item.id ?? position}
                                                    value={
                                                        item.translations.find(
                                                            itemTranslation =>
                                                                itemTranslation.languageCode === languageCode,
                                                        )?.label ?? ''
                                                    }
                                                    maxLength={languageCode === 'zh_Hans' ? 8 : 18}
                                                    onChange={event =>
                                                        updateTag(languageCode, position, event.target.value)
                                                    }
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {!valid ? (
                    <Alert variant="destructive">
                        <AlertDescription>{text.validation}</AlertDescription>
                    </Alert>
                ) : null}

                <div className="flex flex-wrap justify-end gap-3">
                    <Button type="button" variant="outline" disabled={saving} onClick={onReset}>
                        <RotateCcw className="size-4" />
                        {text.reset}
                    </Button>
                    <Button type="button" disabled={!valid || saving} onClick={onSave}>
                        <Save className="size-4" />
                        {saving ? text.saving : text.save}
                    </Button>
                </div>
            </div>

            <div className="xl:sticky xl:top-6 xl:self-start">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <Label>{text.preview}</Label>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <div className="flex rounded-md border bg-background p-1">
                            {(['desktop', 'mobile'] as const).map(viewport => (
                                <Button
                                    key={viewport}
                                    type="button"
                                    size="sm"
                                    variant={previewViewport === viewport ? 'secondary' : 'ghost'}
                                    aria-pressed={previewViewport === viewport}
                                    onClick={() => setPreviewViewport(viewport)}
                                >
                                    {viewport === 'desktop' ? (
                                        <Monitor className="size-4" aria-hidden="true" />
                                    ) : (
                                        <Smartphone className="size-4" aria-hidden="true" />
                                    )}
                                    {viewport === 'desktop' ? text.desktopPreview : text.mobilePreview}
                                </Button>
                            ))}
                        </div>
                        <div className="flex rounded-md border bg-background p-1">
                            {(['zh_Hans', 'en'] as const).map(languageCode => (
                                <Button
                                    key={languageCode}
                                    type="button"
                                    size="sm"
                                    variant={previewLanguage === languageCode ? 'secondary' : 'ghost'}
                                    aria-pressed={previewLanguage === languageCode}
                                    onClick={() => setPreviewLanguage(languageCode)}
                                >
                                    {languageCode === 'zh_Hans' ? text.chinese : text.english}
                                </Button>
                            ))}
                        </div>
                    </div>
                </div>
                <div className={previewViewport === 'mobile' ? 'rounded-2xl bg-muted/30 p-3' : ''}>
                    <div className={previewViewportClassName} style={previewStyle}>
                        <div
                            className="absolute inset-0"
                            style={{
                                background: PREVIEW_OVERLAY_BACKGROUND,
                            }}
                        />
                        {!previewImage ? (
                            <div className="absolute inset-0 grid place-items-center opacity-30">
                                <Sparkles className="size-28 text-cyan-300" />
                            </div>
                        ) : null}
                        <div
                            className={`absolute z-10 text-[var(--preview-text)] ${
                                previewViewport === 'mobile'
                                    ? 'inset-x-5 bottom-5 text-center'
                                    : 'inset-x-7 bottom-7'
                            }`}
                        >
                            <span
                                className="inline-flex rounded-full border px-3 py-1 text-[10px] font-bold tracking-[0.14em] backdrop-blur"
                                style={{
                                    borderColor: `color-mix(in srgb, var(--preview-accent) 70%, transparent)`,
                                    color: 'var(--preview-accent)',
                                    background: 'color-mix(in srgb, var(--preview-overlay) 58%, transparent)',
                                }}
                            >
                                {previewTranslation.ctaLabel}
                            </span>
                            <h3
                                className={`mt-3 font-extrabold tracking-tight ${
                                    previewViewport === 'mobile' ? 'text-xl' : 'text-2xl'
                                }`}
                            >
                                {previewTranslation.title}
                            </h3>
                            <p className="mt-2 max-w-lg text-sm opacity-85">{previewTranslation.subtitle}</p>
                            <div
                                className={`mt-4 flex flex-wrap gap-2 ${
                                    previewViewport === 'mobile' ? 'justify-center' : ''
                                }`}
                            >
                                {draft.items.map((item, position) => (
                                    <span
                                        key={item.id ?? position}
                                        className="rounded-full border border-white/20 bg-black/25 px-3 py-1 text-[11px] backdrop-blur"
                                    >
                                        {item.translations.find(
                                            translation => translation.languageCode === previewLanguage,
                                        )?.label ?? ''}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function AuthVisualImageField({
    draft,
    text,
    onChange,
}: Readonly<{
    draft: ContentBlock;
    text: AuthVisualCopy;
    onChange: (asset: NonNullable<ContentBlock['imageAsset']> | null, remove: boolean) => void;
}>) {
    const [open, setOpen] = useState(false);
    const preview = draft.imageAsset?.preview ?? draft.imageUrl;
    return (
        <div className="space-y-2">
            <Label>{text.image}</Label>
            <div className="flex min-w-0 items-center gap-4 rounded-lg border p-4">
                {preview ? (
                    <img
                        className="h-20 w-36 shrink-0 rounded-lg border object-cover"
                        src={preview}
                        alt={draft.imageAsset?.name ?? text.image}
                    />
                ) : (
                    <div className="flex h-20 w-36 shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/40">
                        <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                        {draft.imageAsset?.name ?? text.defaultImage}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
                            <ImagePlus className="size-4" />
                            {preview ? text.replaceImage : text.selectImage}
                        </Button>
                        {preview ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => onChange(null, true)}
                            >
                                {text.removeImage}
                            </Button>
                        ) : null}
                    </div>
                </div>
            </div>
            <ImageSizeHint guidance="hero" />
            <AssetPickerDialog
                open={open}
                onClose={() => setOpen(false)}
                onSelect={assets => onChange(assets[0] ?? null, false)}
                initialSelectedAssets={draft.imageAsset ? [draft.imageAsset] : []}
                title={text.selectImage}
                imageGuidance="hero"
            />
        </div>
    );
}

function TextField({
    label,
    value,
    maxLength,
    onChange,
}: Readonly<{ label: string; value: string; maxLength: number; onChange: (value: string) => void }>) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <Label>{label}</Label>
                <span className="text-xs text-muted-foreground">
                    {value.length}/{maxLength}
                </span>
            </div>
            <Input value={value} maxLength={maxLength} onChange={event => onChange(event.target.value)} />
        </div>
    );
}

function ColorField({
    label,
    value,
    onChange,
}: Readonly<{ label: string; value: string; onChange: (value: string) => void }>) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            <div className="flex items-center gap-2 rounded-md border p-2">
                <Input
                    className="h-8 w-10 cursor-pointer border-0 p-0"
                    type="color"
                    value={value}
                    aria-label={label}
                    onChange={event => onChange(event.target.value)}
                />
                <code className="text-xs uppercase text-muted-foreground">{value}</code>
            </div>
        </div>
    );
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return typeof error === 'string' ? error : '保存失败，请稍后重试';
}
