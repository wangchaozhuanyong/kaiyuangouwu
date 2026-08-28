import { useLingui } from '@lingui/react';
import {
    ActionBarItem,
    Alert,
    AlertDescription,
    Asset,
    AssetPickerDialog,
    Badge,
    Button,
    DashboardRouteDefinition,
    ImageSizeHint,
    Input,
    Label,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Skeleton,
    Textarea,
    UnsavedChangesConfirmation,
    api,
    toast,
    useChannelDisplayName,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import {
    Check,
    CircleAlert,
    Globe2,
    ImagePlus,
    LoaderCircle,
    Pencil,
    RefreshCw,
    Store,
    X,
} from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';

import {
    StoreProfileRecord,
    StoreProfileStatus,
    StoreProfilesResult,
    UpdateStoreProfileResult,
    storeProfilesQuery,
    updateStoreProfileMutation,
} from './store-management.graphql';

interface ProfileDraft {
    id: string;
    expectedUpdatedAt: string;
    storefrontNameZh: string;
    storefrontNameEn: string;
    originalStorefrontNameZh: string;
    originalStorefrontNameEn: string;
    status: StoreProfileStatus;
    sortOrder: string;
    descriptionZh: string;
    descriptionEn: string;
    internalNote: string;
    logoAsset: Asset | null;
    activationReadiness: StoreProfileRecord['activationReadiness'];
}

const zhCopy = {
    title: '网店管理',
    description: '管理各独立域名网店的运营状态、顺序和基础资料。',
    refresh: '刷新网店列表',
    loadingError: '网店列表加载失败',
    retry: '重试',
    empty: '暂时没有网店 Profile',
    stores: '家网店',
    enabled: '可正常访问',
    draft: '草稿',
    active: '已上线',
    accessible: '可访问',
    suspended: '已停用',
    noDomain: '尚未验证主域名',
    order: '排序',
    edit: '编辑网店资料',
    editTitle: '编辑网店',
    editDescription: '填写中文资料即可自动生成英文；店铺通过各自绑定的域名独立访问。',
    status: '网店状态',
    sortOrder: '管理顺序',
    storefrontNameZh: '店铺名称',
    storefrontNameEn: '英文店铺名称（人工覆盖）',
    descriptionZh: '公开简介',
    descriptionEn: '公开英文简介（人工覆盖）',
    publicDescriptionHelp:
        '中文是源内容，保存时自动生成英文。公开简介会显示在对应语言的商城首页，并用于搜索与分享摘要。',
    commonMode: '常用模式',
    englishReview: '英文校对',
    translationHelp: '通常只需填写中文；仅在需要人工修改英文译文时切换到英文校对。',
    internalNote: '内部备注（仅平台管理员可见）',
    internalNoteHelp: '用于记录运营、联系或审核信息，不会发送给商家，也不会显示在商城。',
    logo: '网店 Logo',
    selectLogo: '选择 Logo',
    clearLogo: '移除 Logo',
    cancel: '取消',
    save: '保存',
    saving: '正在保存',
    saved: '网店资料已保存',
    invalidOrder: '排序必须是大于或等于 0 的整数',
    invalidName: '店铺名称必须是 1 至 16 个显示单位',
    readiness: '上线检查',
    ready: '已满足全部上线条件',
    notReady: '完成全部检查后才能设为正常运营',
};

const enCopy: typeof zhCopy = {
    title: 'Store management',
    description: 'Manage the operational status, ordering, and profile of each custom-domain store.',
    refresh: 'Refresh stores',
    loadingError: 'Could not load stores',
    retry: 'Retry',
    empty: 'No store profiles yet',
    stores: 'stores',
    enabled: 'Accessible stores',
    draft: 'Draft',
    active: 'Active',
    accessible: 'Accessible',
    suspended: 'Suspended',
    noDomain: 'No verified primary domain',
    order: 'Order',
    edit: 'Edit store profile',
    editTitle: 'Edit store',
    editDescription: 'Enter Chinese content to generate English; each store uses its own bound domain.',
    status: 'Store status',
    sortOrder: 'Management order',
    storefrontNameZh: 'Store name (Chinese source)',
    storefrontNameEn: 'English store name (manual override)',
    descriptionZh: 'Public description (Chinese source)',
    descriptionEn: 'Public English description (manual override)',
    publicDescriptionHelp:
        'English is generated from the Chinese source when you save. Public descriptions appear on the storefront and in search/share summaries.',
    commonMode: 'Common mode',
    englishReview: 'Review English',
    translationHelp: 'Usually you only need Chinese. Open English review only to override the translation.',
    internalNote: 'Internal note (platform administrators only)',
    internalNoteHelp: 'Operational notes are not exposed to merchants or storefront visitors.',
    logo: 'Store logo',
    selectLogo: 'Select logo',
    clearLogo: 'Remove logo',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving',
    saved: 'Store profile saved',
    invalidOrder: 'Order must be an integer greater than or equal to 0',
    invalidName: 'The store name must use 1 to 16 display units',
    readiness: 'Launch checks',
    ready: 'All launch requirements are complete',
    notReady: 'Complete every check before activating the store',
};

export const storeManagementRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'system',
        id: 'store-management',
        url: '/store-management',
        title: '网店管理',
        icon: Store,
        requiresPermission: ['SuperAdmin'],
    },
    path: '/store-management',
    loader: () => ({ breadcrumb: () => '网店管理' }),
    component: () => <StoreManagementPage />,
};

function StoreManagementPage() {
    const { i18n } = useLingui();
    const isZh = i18n.locale.toLowerCase().startsWith('zh');
    const text = isZh ? zhCopy : enCopy;
    const [draft, setDraft] = useState<ProfileDraft | null>(null);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const profilesQuery = useQuery({
        queryKey: ['store-management-profiles'],
        queryFn: () => api.query<StoreProfilesResult>(storeProfilesQuery),
    });
    const profiles = profilesQuery.data?.storeProfiles ?? [];
    const mutation = useMutation({
        mutationFn: (input: ProfileDraft) => {
            const updateInput: Record<string, unknown> = {
                id: input.id,
                expectedUpdatedAt: input.expectedUpdatedAt,
                status: input.status,
                sortOrder: Number(input.sortOrder),
                descriptionZh: input.descriptionZh,
                descriptionEn: input.descriptionEn,
                internalNote: input.internalNote,
                logoAssetId: input.logoAsset?.id ?? null,
            };
            if (input.storefrontNameZh !== input.originalStorefrontNameZh) {
                updateInput.storefrontNameZh = input.storefrontNameZh;
            }
            if (input.storefrontNameEn !== input.originalStorefrontNameEn) {
                updateInput.storefrontNameEn = input.storefrontNameEn;
            }
            return api.mutate(updateStoreProfileMutation, {
                input: updateInput,
            }) as Promise<UpdateStoreProfileResult>;
        },
        onSuccess: async () => {
            toast.success(text.saved);
            setDraft(null);
            await profilesQuery.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const openEditor = (profile: StoreProfileRecord) => {
        setDraft({
            id: profile.id,
            expectedUpdatedAt: profile.updatedAt,
            storefrontNameZh: profile.channel.customFields.storefrontNameZh ?? '',
            storefrontNameEn: profile.channel.customFields.storefrontNameEn ?? '',
            originalStorefrontNameZh: profile.channel.customFields.storefrontNameZh ?? '',
            originalStorefrontNameEn: profile.channel.customFields.storefrontNameEn ?? '',
            status: profile.status,
            sortOrder: String(profile.sortOrder),
            descriptionZh: profile.descriptionZh,
            descriptionEn: profile.descriptionEn,
            internalNote: profile.internalNote ?? '',
            logoAsset: profile.logoAsset,
            activationReadiness: profile.activationReadiness,
        });
    };
    const save = () => {
        if (!draft) return;
        const sortOrder = Number(draft.sortOrder);
        if (!Number.isInteger(sortOrder) || sortOrder < 0) {
            toast.error(text.invalidOrder);
            return;
        }
        if (
            (draft.storefrontNameZh !== draft.originalStorefrontNameZh &&
                !validStorefrontName(draft.storefrontNameZh)) ||
            (draft.storefrontNameEn !== draft.originalStorefrontNameEn &&
                !validStorefrontName(draft.storefrontNameEn))
        ) {
            toast.error(text.invalidName);
            return;
        }
        mutation.mutate(draft);
    };

    return (
        <Page pageId="store-management">
            <PageTitle>{text.title}</PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="refresh-stores">
                    <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        title={text.refresh}
                        aria-label={text.refresh}
                        onClick={() => void profilesQuery.refetch()}
                        disabled={profilesQuery.isFetching}
                    >
                        <RefreshCw
                            className={`size-4 ${profilesQuery.isFetching ? 'animate-spin' : ''}`}
                            aria-hidden="true"
                        />
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="store-management-list"
                    title={text.title}
                    description={text.description}
                >
                    {profilesQuery.isPending ? (
                        <div className="divide-y">
                            {[0, 1, 2].map(item => (
                                <div key={item} className="flex items-center gap-3 py-4">
                                    <Skeleton className="size-12 shrink-0" />
                                    <div className="flex-1 space-y-2">
                                        <Skeleton className="h-4 w-40" />
                                        <Skeleton className="h-3 w-64 max-w-full" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : profilesQuery.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription className="flex items-center justify-between gap-3">
                                <span>{text.loadingError}</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void profilesQuery.refetch()}
                                >
                                    <RefreshCw className="size-4" aria-hidden="true" />
                                    {text.retry}
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : profiles.length === 0 ? (
                        <div className="py-12 text-center text-sm text-muted-foreground">{text.empty}</div>
                    ) : (
                        <>
                            <div className="pb-3 text-sm text-muted-foreground">
                                {profiles.length} {text.stores} ·{' '}
                                {profiles.filter(profile => profile.isOperational).length} {text.enabled}
                            </div>
                            <div className="divide-y">
                                {profiles.map(profile => (
                                    <StoreProfileRow
                                        key={profile.id}
                                        profile={profile}
                                        isZh={isZh}
                                        text={text}
                                        onEdit={() => openEditor(profile)}
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </PageBlock>
            </PageLayout>
            <ProfileEditor
                draft={draft}
                text={text}
                isZh={isZh}
                pending={mutation.isPending}
                assetPickerOpen={assetPickerOpen}
                onAssetPickerOpen={setAssetPickerOpen}
                onChange={setDraft}
                onClose={() => setDraft(null)}
                onSave={save}
            />
        </Page>
    );
}

function StoreProfileRow({
    profile,
    isZh,
    text,
    onEdit,
}: Readonly<{
    profile: StoreProfileRecord;
    isZh: boolean;
    text: typeof zhCopy;
    onEdit: () => void;
}>) {
    const name = isZh
        ? profile.channel.customFields.storefrontNameZh
        : profile.channel.customFields.storefrontNameEn;
    const channelDisplayName = useChannelDisplayName(profile.channel.code);
    const description = isZh ? profile.descriptionZh : profile.descriptionEn;
    return (
        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {profile.logoAsset ? (
                        <img className="size-12 object-cover" src={profile.logoAsset.preview} alt="" />
                    ) : (
                        <Store className="size-5" aria-hidden="true" />
                    )}
                </div>
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">{name || channelDisplayName}</span>
                        <StatusBadge status={profile.status} text={text} />
                        {profile.isOperational && profile.status !== 'ACTIVE' && (
                            <Badge variant="secondary">{text.accessible}</Badge>
                        )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{profile.channel.seller?.name ?? channelDisplayName}</span>
                        <span>{profile.channel.code}</span>
                        <span>
                            {text.order}: {profile.sortOrder}
                        </span>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                        <Globe2 className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{profile.primaryDomain ?? text.noDomain}</span>
                    </div>
                    {description && (
                        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{description}</p>
                    )}
                </div>
            </div>
            <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="self-end sm:self-auto"
                title={text.edit}
                aria-label={text.edit}
                onClick={onEdit}
            >
                <Pencil className="size-4" aria-hidden="true" />
            </Button>
        </div>
    );
}

function StatusBadge({ status, text }: Readonly<{ status: StoreProfileStatus; text: typeof zhCopy }>) {
    if (status === 'ACTIVE') return <Badge variant="secondary">{text.active}</Badge>;
    if (status === 'SUSPENDED') return <Badge variant="destructive">{text.suspended}</Badge>;
    return <Badge variant="outline">{text.draft}</Badge>;
}

function ProfileEditor({
    draft,
    text,
    isZh,
    pending,
    assetPickerOpen,
    onAssetPickerOpen,
    onChange,
    onClose,
    onSave,
}: Readonly<{
    draft: ProfileDraft | null;
    text: typeof zhCopy;
    isZh: boolean;
    pending: boolean;
    assetPickerOpen: boolean;
    onAssetPickerOpen: (open: boolean) => void;
    onChange: (draft: ProfileDraft | null) => void;
    onClose: () => void;
    onSave: () => void;
}>) {
    const [editEnglish, setEditEnglish] = useState(false);
    const initialDraftRef = useRef('');
    const initialDraftIdRef = useRef<string | undefined>(undefined);
    if (draft && draft.id !== initialDraftIdRef.current) {
        initialDraftIdRef.current = draft.id;
        initialDraftRef.current = JSON.stringify(draft);
    }
    if (!draft) {
        initialDraftIdRef.current = undefined;
        initialDraftRef.current = '';
    }
    useEffect(() => setEditEnglish(false), [draft?.id]);
    if (!draft) return null;
    const update = <K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]) =>
        onChange({ ...draft, [field]: value });
    const isDirty = initialDraftRef.current !== JSON.stringify(draft);
    const requestClose = () => {
        if (isDirty && !window.confirm(isZh ? '有未保存的修改，确定放弃吗？' : 'Discard unsaved changes?')) {
            return;
        }
        onClose();
    };
    return (
        <>
            <UnsavedChangesConfirmation when={isDirty} />
            <Sheet open onOpenChange={open => !open && requestClose()}>
                <SheetContent className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[640px] sm:max-w-[640px]">
                    <SheetHeader className="shrink-0 border-b px-6 py-5 text-left">
                        <SheetTitle>{text.editTitle}</SheetTitle>
                        <SheetDescription>{text.editDescription}</SheetDescription>
                    </SheetHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                        <div className="grid gap-5 sm:grid-cols-2">
                            <Field label={text.status} htmlFor="profile-status">
                                <Select
                                    value={draft.status}
                                    onValueChange={value => update('status', value as StoreProfileStatus)}
                                >
                                    <SelectTrigger id="profile-status" className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="DRAFT">{text.draft}</SelectItem>
                                        <SelectItem value="ACTIVE">{text.active}</SelectItem>
                                        <SelectItem value="SUSPENDED">{text.suspended}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label={text.sortOrder} htmlFor="profile-sort-order">
                                <Input
                                    id="profile-sort-order"
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={draft.sortOrder}
                                    onChange={event => update('sortOrder', event.target.value)}
                                />
                            </Field>
                            <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-xs text-muted-foreground">{text.translationHelp}</p>
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
                            <Field
                                label={text.storefrontNameZh}
                                htmlFor="profile-name-zh"
                                className={editEnglish ? undefined : 'sm:col-span-2'}
                            >
                                <Input
                                    id="profile-name-zh"
                                    value={draft.storefrontNameZh}
                                    onChange={event => update('storefrontNameZh', event.target.value)}
                                />
                            </Field>
                            {editEnglish ? (
                                <Field label={text.storefrontNameEn} htmlFor="profile-name-en">
                                    <Input
                                        id="profile-name-en"
                                        value={draft.storefrontNameEn}
                                        onChange={event => update('storefrontNameEn', event.target.value)}
                                    />
                                </Field>
                            ) : null}
                            <Field
                                label={text.descriptionZh}
                                htmlFor="profile-description-zh"
                                className={editEnglish ? undefined : 'sm:col-span-2'}
                            >
                                <Textarea
                                    id="profile-description-zh"
                                    rows={4}
                                    maxLength={800}
                                    value={draft.descriptionZh}
                                    onChange={event => update('descriptionZh', event.target.value)}
                                />
                            </Field>
                            {editEnglish ? (
                                <Field label={text.descriptionEn} htmlFor="profile-description-en">
                                    <Textarea
                                        id="profile-description-en"
                                        rows={4}
                                        maxLength={800}
                                        value={draft.descriptionEn}
                                        onChange={event => update('descriptionEn', event.target.value)}
                                    />
                                </Field>
                            ) : null}
                            <p className="text-xs text-muted-foreground sm:col-span-2">
                                {text.publicDescriptionHelp}
                            </p>
                            <div className="space-y-2 sm:col-span-2">
                                <Label htmlFor="profile-internal-note">{text.internalNote}</Label>
                                <Textarea
                                    id="profile-internal-note"
                                    rows={4}
                                    maxLength={2000}
                                    value={draft.internalNote}
                                    onChange={event => update('internalNote', event.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">{text.internalNoteHelp}</p>
                            </div>
                            <div className="space-y-3 border-t pt-4 sm:col-span-2">
                                <div>
                                    <Label>{text.readiness}</Label>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {draft.activationReadiness.ready ? text.ready : text.notReady}
                                    </p>
                                </div>
                                <ul className="grid gap-2 sm:grid-cols-2">
                                    {draft.activationReadiness.checks.map(check => (
                                        <li key={check.code} className="flex items-start gap-2 text-sm">
                                            {check.ready ? (
                                                <Check
                                                    className="mt-0.5 size-4 shrink-0 text-success"
                                                    aria-hidden="true"
                                                />
                                            ) : (
                                                <CircleAlert
                                                    className="mt-0.5 size-4 shrink-0 text-destructive"
                                                    aria-hidden="true"
                                                />
                                            )}
                                            <span>{isZh ? check.message : check.messageEn}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                                <Label>{text.logo}</Label>
                                <ImageSizeHint guidance="logo" />
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                                        {draft.logoAsset ? (
                                            <img
                                                className="size-16 object-cover"
                                                src={draft.logoAsset.preview}
                                                alt=""
                                            />
                                        ) : (
                                            <Store className="size-6" aria-hidden="true" />
                                        )}
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => onAssetPickerOpen(true)}
                                    >
                                        <ImagePlus className="size-4" aria-hidden="true" />
                                        {text.selectLogo}
                                    </Button>
                                    {draft.logoAsset && (
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            title={text.clearLogo}
                                            aria-label={text.clearLogo}
                                            onClick={() => update('logoAsset', null)}
                                        >
                                            <X className="size-4" aria-hidden="true" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    <SheetFooter className="shrink-0 border-t px-6 py-4">
                        <Button type="button" variant="outline" onClick={requestClose} disabled={pending}>
                            {text.cancel}
                        </Button>
                        <Button type="button" onClick={onSave} disabled={pending}>
                            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                            {pending ? text.saving : text.save}
                        </Button>
                    </SheetFooter>
                </SheetContent>
            </Sheet>
            <AssetPickerDialog
                open={assetPickerOpen}
                onClose={() => onAssetPickerOpen(false)}
                onSelect={assets => update('logoAsset', assets[0] ?? null)}
                initialSelectedAssets={draft.logoAsset ? [draft.logoAsset] : []}
                title={text.selectLogo}
                imageGuidance="logo"
            />
        </>
    );
}

function validStorefrontName(value: string): boolean {
    const normalized = value.trim();
    const units = Array.from(normalized).reduce(
        (total, character) => total + (/\p{Script=Han}|[\uFF01-\uFF60]/u.test(character) ? 2 : 1),
        0,
    );
    return units >= 1 && units <= 16;
}

function Field({
    label,
    htmlFor,
    className,
    children,
}: Readonly<{ label: string; htmlFor: string; className?: string; children: ReactNode }>) {
    return (
        <div className={`space-y-2 ${className ?? ''}`}>
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
        </div>
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
