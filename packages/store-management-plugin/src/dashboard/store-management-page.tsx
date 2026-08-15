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
    Textarea,
    api,
    toast,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { Globe2, ImagePlus, LoaderCircle, Pencil, RefreshCw, Store, X } from 'lucide-react';
import { ReactNode, useState } from 'react';

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
    status: StoreProfileStatus;
    isPublished: boolean;
    sortOrder: string;
    descriptionZh: string;
    descriptionEn: string;
    logoAsset: Asset | null;
    primaryDomain: string | null;
}

const zhCopy = {
    title: '网店管理',
    description: '管理独立网店的 App 展示状态、顺序和基础资料。',
    refresh: '刷新网店列表',
    loadingError: '网店列表加载失败',
    retry: '重试',
    empty: '暂时没有网店 Profile',
    stores: '家网店',
    published: '已发布',
    draft: '草稿',
    active: '正常',
    suspended: '已停用',
    hidden: '未发布',
    noDomain: '尚未验证主域名',
    order: '排序',
    edit: '编辑网店资料',
    editTitle: '编辑网店',
    editDescription: '只有正常状态且已验证主域名的网店才能发布到 App。',
    status: '网店状态',
    appVisibility: '在 App 中展示',
    appVisibilityHint: '关闭后，App 的网店目录不会返回这家店。',
    sortOrder: 'App 排序',
    descriptionZh: '中文简介',
    descriptionEn: '英文简介',
    logo: '网店 Logo',
    selectLogo: '选择 Logo',
    clearLogo: '移除 Logo',
    cancel: '取消',
    save: '保存',
    saving: '正在保存',
    saved: '网店资料已保存',
    invalidOrder: '排序必须是大于或等于 0 的整数',
    publishNeedsDomain: '请先绑定并验证主域名',
};

const enCopy: typeof zhCopy = {
    title: 'Store management',
    description: 'Manage each independent store profile, App visibility, and ordering.',
    refresh: 'Refresh stores',
    loadingError: 'Could not load stores',
    retry: 'Retry',
    empty: 'No store profiles yet',
    stores: 'stores',
    published: 'Published',
    draft: 'Draft',
    active: 'Active',
    suspended: 'Suspended',
    hidden: 'Hidden',
    noDomain: 'No verified primary domain',
    order: 'Order',
    edit: 'Edit store profile',
    editTitle: 'Edit store',
    editDescription: 'A store must be active and have a verified primary domain before publishing.',
    status: 'Store status',
    appVisibility: 'Show in App',
    appVisibilityHint: 'When disabled, this store is omitted from the App directory.',
    sortOrder: 'App order',
    descriptionZh: 'Chinese description',
    descriptionEn: 'English description',
    logo: 'Store logo',
    selectLogo: 'Select logo',
    clearLogo: 'Remove logo',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving',
    saved: 'Store profile saved',
    invalidOrder: 'Order must be an integer greater than or equal to 0',
    publishNeedsDomain: 'Bind and verify a primary domain first',
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
        queryFn: () => api.query(storeProfilesQuery) as Promise<StoreProfilesResult>,
    });
    const profiles = profilesQuery.data?.storeProfiles ?? [];
    const mutation = useMutation({
        mutationFn: (input: ProfileDraft) =>
            api.mutate(updateStoreProfileMutation, {
                input: {
                    id: input.id,
                    status: input.status,
                    isPublished: input.isPublished,
                    sortOrder: Number(input.sortOrder),
                    descriptionZh: input.descriptionZh,
                    descriptionEn: input.descriptionEn,
                    logoAssetId: input.logoAsset?.id ?? null,
                },
            }) as Promise<UpdateStoreProfileResult>,
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
            status: profile.status,
            isPublished: profile.isPublished,
            sortOrder: String(profile.sortOrder),
            descriptionZh: profile.descriptionZh,
            descriptionEn: profile.descriptionEn,
            logoAsset: profile.logoAsset,
            primaryDomain: profile.primaryDomain,
        });
    };
    const save = () => {
        if (!draft) return;
        const sortOrder = Number(draft.sortOrder);
        if (!Number.isInteger(sortOrder) || sortOrder < 0) {
            toast.error(text.invalidOrder);
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
                                {profiles.filter(profile => profile.isPublished).length} {text.published}
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
                        <span className="truncate text-sm font-medium">{name || profile.channel.code}</span>
                        <StatusBadge status={profile.status} text={text} />
                        <Badge variant={profile.isPublished ? 'default' : 'outline'}>
                            {profile.isPublished ? text.published : text.hidden}
                        </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{profile.channel.seller?.name ?? profile.channel.code}</span>
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
    pending,
    assetPickerOpen,
    onAssetPickerOpen,
    onChange,
    onClose,
    onSave,
}: Readonly<{
    draft: ProfileDraft | null;
    text: typeof zhCopy;
    pending: boolean;
    assetPickerOpen: boolean;
    onAssetPickerOpen: (open: boolean) => void;
    onChange: (draft: ProfileDraft | null) => void;
    onClose: () => void;
    onSave: () => void;
}>) {
    if (!draft) return null;
    const update = <K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]) =>
        onChange({ ...draft, [field]: value });
    const canPublish = draft.status === 'ACTIVE' && draft.primaryDomain != null;

    return (
        <>
            <Dialog open onOpenChange={open => !open && onClose()}>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{text.editTitle}</DialogTitle>
                        <DialogDescription>{text.editDescription}</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-5 py-2 sm:grid-cols-2">
                        <Field label={text.status} htmlFor="profile-status">
                            <Select
                                value={draft.status}
                                onValueChange={value => {
                                    const status = value as StoreProfileStatus;
                                    onChange({
                                        ...draft,
                                        status,
                                        isPublished: status === 'ACTIVE' ? draft.isPublished : false,
                                    });
                                }}
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
                        <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2.5 sm:col-span-2">
                            <div>
                                <Label htmlFor="profile-published">{text.appVisibility}</Label>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {canPublish ? text.appVisibilityHint : text.publishNeedsDomain}
                                </p>
                            </div>
                            <Switch
                                id="profile-published"
                                checked={draft.isPublished}
                                disabled={!canPublish && !draft.isPublished}
                                onCheckedChange={value => update('isPublished', value)}
                            />
                        </div>
                        <Field label={text.descriptionZh} htmlFor="profile-description-zh">
                            <Textarea
                                id="profile-description-zh"
                                rows={4}
                                maxLength={800}
                                value={draft.descriptionZh}
                                onChange={event => update('descriptionZh', event.target.value)}
                            />
                        </Field>
                        <Field label={text.descriptionEn} htmlFor="profile-description-en">
                            <Textarea
                                id="profile-description-en"
                                rows={4}
                                maxLength={800}
                                value={draft.descriptionEn}
                                onChange={event => update('descriptionEn', event.target.value)}
                            />
                        </Field>
                        <div className="space-y-2 sm:col-span-2">
                            <Label>{text.logo}</Label>
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
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                            {text.cancel}
                        </Button>
                        <Button type="button" onClick={onSave} disabled={pending}>
                            {pending && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                            {pending ? text.saving : text.save}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <AssetPickerDialog
                open={assetPickerOpen}
                onClose={() => onAssetPickerOpen(false)}
                onSelect={assets => update('logoAsset', assets[0] ?? null)}
                initialSelectedAssets={draft.logoAsset ? [draft.logoAsset] : []}
                title={text.selectLogo}
            />
        </>
    );
}

function Field({
    label,
    htmlFor,
    children,
}: Readonly<{ label: string; htmlFor: string; children: ReactNode }>) {
    return (
        <div className="space-y-2">
            <Label htmlFor={htmlFor}>{label}</Label>
            {children}
        </div>
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
