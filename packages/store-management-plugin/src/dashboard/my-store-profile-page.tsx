import { useLingui } from '@lingui/react';
import {
    Alert,
    AlertDescription,
    Asset,
    AssetPickerDialog,
    Badge,
    Button,
    DashboardRouteDefinition,
    Input,
    Label,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    Skeleton,
    Textarea,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { Check, CircleAlert, Globe2, ImagePlus, LoaderCircle, RefreshCw, Save, Store, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
    MyStoreProfileRecord,
    MyStoreProfileResult,
    UpdateMyStoreProfileResult,
    myStoreProfileQuery,
    updateMyStoreProfileMutation,
} from './merchant-store.graphql';

interface ProfileDraft {
    storefrontNameZh: string;
    storefrontNameEn: string;
    originalStorefrontNameZh: string;
    originalStorefrontNameEn: string;
    descriptionZh: string;
    descriptionEn: string;
    logoAsset: Asset | null;
}

const zhCopy = {
    title: '店铺资料',
    description: '管理当前店铺对顾客展示的名称、简介和 Logo。',
    save: '保存店铺资料',
    saving: '正在保存',
    saved: '店铺资料已保存',
    loadError: '店铺资料加载失败',
    retry: '重试',
    basic: '基础资料',
    storefrontNameZh: '中文店铺名称',
    storefrontNameEn: '英文店铺名称',
    descriptionZh: '公开中文简介',
    descriptionEn: '公开英文简介',
    descriptionHelp: '公开简介会显示在对应语言的商城首页，并用于搜索与分享摘要。',
    logo: '店铺 Logo',
    selectLogo: '选择 Logo',
    clearLogo: '移除 Logo',
    operation: '运营状态',
    merchant: '商家主体',
    code: '店铺编码',
    domain: '当前主域名',
    noDomain: '尚未验证主域名',
    active: '已上线',
    draft: '草稿',
    accessible: '可访问',
    suspended: '已停用',
    invalidName: '中英文店铺名称都必须是 1 至 16 个显示单位',
    readiness: '上线检查',
    ready: '已满足全部上线条件',
    notReady: '仍有未完成项目，请完成后联系平台管理员启用店铺',
};

const enCopy: typeof zhCopy = {
    title: 'Store profile',
    description: 'Manage the customer-facing names, descriptions, and logo for the active store.',
    save: 'Save store profile',
    saving: 'Saving',
    saved: 'Store profile saved',
    loadError: 'Could not load the store profile',
    retry: 'Retry',
    basic: 'Store details',
    storefrontNameZh: 'Chinese store name',
    storefrontNameEn: 'English store name',
    descriptionZh: 'Public Chinese description',
    descriptionEn: 'Public English description',
    descriptionHelp: 'Public descriptions appear on the storefront and in search/share summaries.',
    logo: 'Store logo',
    selectLogo: 'Select logo',
    clearLogo: 'Remove logo',
    operation: 'Operational status',
    merchant: 'Merchant',
    code: 'Store code',
    domain: 'Primary domain',
    noDomain: 'No verified primary domain',
    active: 'Active',
    draft: 'Draft',
    accessible: 'Accessible',
    suspended: 'Suspended',
    invalidName: 'Both store names must use 1 to 16 display units',
    readiness: 'Launch checks',
    ready: 'All launch requirements are complete',
    notReady: 'Complete the remaining items, then ask the platform administrator to activate the store',
};

export const myStoreProfileRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'settings',
        id: 'my-store-profile',
        url: '/my-store-profile',
        title: '店铺资料',
        icon: Store,
        order: 10,
        requiresPermission: ['ReadStoreProfile'],
    },
    path: '/my-store-profile',
    loader: () => ({ breadcrumb: () => '店铺资料' }),
    component: () => <MyStoreProfilePage />,
};

function MyStoreProfilePage() {
    const { i18n } = useLingui();
    const isZh = i18n.locale.toLowerCase().startsWith('zh');
    const text = isZh ? zhCopy : enCopy;
    const { activeChannel } = useChannel();
    const [draft, setDraft] = useState<ProfileDraft | null>(null);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const profileQuery = useQuery({
        queryKey: ['my-store-profile', activeChannel?.id],
        queryFn: () => api.query<MyStoreProfileResult>(myStoreProfileQuery),
        enabled: Boolean(activeChannel?.id),
    });
    const profile = profileQuery.data?.myStoreProfile;
    useEffect(() => {
        if (profile) {
            setDraft(toDraft(profile));
        }
    }, [profile]);

    const mutation = useMutation({
        mutationFn: (input: ProfileDraft) => {
            const updateInput: Record<string, unknown> = {
                descriptionZh: input.descriptionZh,
                descriptionEn: input.descriptionEn,
                logoAssetId: input.logoAsset?.id ?? null,
            };
            if (input.storefrontNameZh !== input.originalStorefrontNameZh) {
                updateInput.storefrontNameZh = input.storefrontNameZh;
            }
            if (input.storefrontNameEn !== input.originalStorefrontNameEn) {
                updateInput.storefrontNameEn = input.storefrontNameEn;
            }
            return api.mutate(updateMyStoreProfileMutation, {
                input: updateInput,
            }) as Promise<UpdateMyStoreProfileResult>;
        },
        onSuccess: result => {
            setDraft(toDraft(result.updateMyStoreProfile));
            toast.success(text.saved);
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const save = () => {
        if (!draft) return;
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
    const update = <K extends keyof ProfileDraft>(field: K, value: ProfileDraft[K]) => {
        if (draft) setDraft({ ...draft, [field]: value });
    };

    return (
        <Page pageId="my-store-profile">
            <PageTitle>{text.title}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button type="button" onClick={save} disabled={!draft || mutation.isPending}>
                        {mutation.isPending ? (
                            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                            <Save className="size-4" aria-hidden="true" />
                        )}
                        {mutation.isPending ? text.saving : text.save}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="main"
                    blockId="merchant-store-profile"
                    title={text.basic}
                    description={text.description}
                >
                    {profileQuery.isPending ? (
                        <ProfileSkeleton />
                    ) : profileQuery.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription className="flex items-center justify-between gap-3">
                                <span>{text.loadError}</span>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void profileQuery.refetch()}
                                >
                                    <RefreshCw className="size-4" aria-hidden="true" />
                                    {text.retry}
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : draft ? (
                        <div className="grid gap-5 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="my-store-name-zh">{text.storefrontNameZh}</Label>
                                <Input
                                    id="my-store-name-zh"
                                    value={draft.storefrontNameZh}
                                    onChange={event => update('storefrontNameZh', event.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="my-store-name-en">{text.storefrontNameEn}</Label>
                                <Input
                                    id="my-store-name-en"
                                    value={draft.storefrontNameEn}
                                    onChange={event => update('storefrontNameEn', event.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="my-store-description-zh">{text.descriptionZh}</Label>
                                <Textarea
                                    id="my-store-description-zh"
                                    rows={5}
                                    maxLength={800}
                                    value={draft.descriptionZh}
                                    onChange={event => update('descriptionZh', event.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="my-store-description-en">{text.descriptionEn}</Label>
                                <Textarea
                                    id="my-store-description-en"
                                    rows={5}
                                    maxLength={800}
                                    value={draft.descriptionEn}
                                    onChange={event => update('descriptionEn', event.target.value)}
                                />
                            </div>
                            <p className="text-xs text-muted-foreground sm:col-span-2">
                                {text.descriptionHelp}
                            </p>
                            <div className="space-y-2 sm:col-span-2">
                                <Label>{text.logo}</Label>
                                <div className="flex flex-wrap items-center gap-3 border-t pt-3">
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
                                        onClick={() => setAssetPickerOpen(true)}
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
                            <div className="border-t pt-4 sm:hidden">
                                <Button
                                    type="button"
                                    className="w-full"
                                    onClick={save}
                                    disabled={mutation.isPending}
                                >
                                    {mutation.isPending ? (
                                        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                                    ) : (
                                        <Save className="size-4" aria-hidden="true" />
                                    )}
                                    {mutation.isPending ? text.saving : text.save}
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </PageBlock>
                <PageBlock column="side" blockId="merchant-store-operation" title={text.operation}>
                    {profile ? (
                        <StoreOperation profile={profile} text={text} isZh={isZh} />
                    ) : (
                        <ProfileSkeleton />
                    )}
                </PageBlock>
            </PageLayout>
            {draft && (
                <AssetPickerDialog
                    open={assetPickerOpen}
                    onClose={() => setAssetPickerOpen(false)}
                    onSelect={assets => update('logoAsset', assets[0] ?? null)}
                    initialSelectedAssets={draft.logoAsset ? [draft.logoAsset] : []}
                    title={text.selectLogo}
                />
            )}
        </Page>
    );
}

function StoreOperation({
    profile,
    text,
    isZh,
}: Readonly<{ profile: MyStoreProfileRecord; text: typeof zhCopy; isZh: boolean }>) {
    const statusLabel =
        profile.status === 'ACTIVE'
            ? text.active
            : profile.status === 'SUSPENDED'
              ? text.suspended
              : text.draft;
    return (
        <dl className="divide-y text-sm">
            <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <dt className="text-muted-foreground">{text.operation}</dt>
                <dd className="flex flex-wrap justify-end gap-1">
                    <Badge variant={profile.status === 'SUSPENDED' ? 'destructive' : 'secondary'}>
                        {statusLabel}
                    </Badge>
                    {profile.isOperational && profile.status !== 'ACTIVE' && (
                        <Badge variant="secondary">{text.accessible}</Badge>
                    )}
                </dd>
            </div>
            <DataRow label={text.merchant} value={profile.channel.seller?.name ?? profile.channel.code} />
            <DataRow label={text.code} value={profile.channel.code} />
            <div className="py-3 last:pb-0">
                <dt className="text-muted-foreground">{text.domain}</dt>
                <dd className="mt-1 flex min-w-0 items-center gap-1">
                    <Globe2 className="size-3.5 shrink-0" aria-hidden="true" />
                    {profile.primaryDomain ? (
                        <a
                            className="truncate hover:underline"
                            href={profile.storefrontUrl ?? '#'}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {profile.primaryDomain}
                        </a>
                    ) : (
                        <span className="text-muted-foreground">{text.noDomain}</span>
                    )}
                </dd>
            </div>
            <div className="py-3 last:pb-0">
                <dt className="text-muted-foreground">{text.readiness}</dt>
                <dd className="mt-2">
                    <p className="text-xs text-muted-foreground">
                        {profile.activationReadiness.ready ? text.ready : text.notReady}
                    </p>
                    <ul className="mt-3 space-y-2">
                        {profile.activationReadiness.checks.map(check => (
                            <li key={check.code} className="flex items-start gap-2 text-xs">
                                {check.ready ? (
                                    <Check
                                        className="mt-0.5 size-3.5 shrink-0 text-success"
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <CircleAlert
                                        className="mt-0.5 size-3.5 shrink-0 text-destructive"
                                        aria-hidden="true"
                                    />
                                )}
                                <span>{isZh ? check.message : check.messageEn}</span>
                            </li>
                        ))}
                    </ul>
                </dd>
            </div>
        </dl>
    );
}

function DataRow({ label, value }: Readonly<{ label: string; value: string }>) {
    return (
        <div className="flex items-start justify-between gap-3 py-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
        </div>
    );
}

function ProfileSkeleton() {
    return (
        <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-10 w-2/3" />
        </div>
    );
}

function toDraft(profile: MyStoreProfileRecord): ProfileDraft {
    return {
        storefrontNameZh: profile.channel.customFields.storefrontNameZh,
        storefrontNameEn: profile.channel.customFields.storefrontNameEn,
        originalStorefrontNameZh: profile.channel.customFields.storefrontNameZh,
        originalStorefrontNameEn: profile.channel.customFields.storefrontNameEn,
        descriptionZh: profile.descriptionZh,
        descriptionEn: profile.descriptionEn,
        logoAsset: profile.logoAsset,
    };
}

function validStorefrontName(value: string): boolean {
    const normalized = value.trim();
    const units = Array.from(normalized).reduce(
        (total, character) => total + (/\p{Script=Han}|[\uFF01-\uFF60]/u.test(character) ? 2 : 1),
        0,
    );
    return units >= 1 && units <= 16;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
