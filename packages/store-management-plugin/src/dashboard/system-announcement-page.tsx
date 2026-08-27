import {
    Badge,
    Button,
    ConfirmationDialog,
    DashboardRouteDefinition,
    Input,
    Label,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Skeleton,
    Switch,
    Textarea,
    api,
    toast,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { Megaphone, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';

import {
    SystemAnnouncementRecord,
    SystemAnnouncementsResult,
    createSystemAnnouncementMutation,
    deleteSystemAnnouncementMutation,
    systemAnnouncementsQuery,
    updateSystemAnnouncementMutation,
} from './system-announcement.graphql';

interface AnnouncementDraft {
    id?: string;
    enabled: boolean;
    priority: string;
    titleZh: string;
    titleEn: string;
    contentZh: string;
    contentEn: string;
    linkUrl: string;
    startsAt: string;
    endsAt: string;
}

export const systemAnnouncementRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'system',
        id: 'system-announcements',
        url: '/system-announcements',
        title: '系统公告',
        icon: Megaphone,
        requiresPermission: ['SuperAdmin'],
    },
    path: '/system-announcements',
    loader: () => ({ breadcrumb: () => '系统公告' }),
    component: () => <SystemAnnouncementPage />,
};

function SystemAnnouncementPage() {
    const queryClient = useQueryClient();
    const queryKey = ['system-announcements'];
    const [draft, setDraft] = useState<AnnouncementDraft | null>(null);
    const query = useQuery({
        queryKey,
        queryFn: () => api.query<SystemAnnouncementsResult>(systemAnnouncementsQuery),
    });
    const refresh = () => queryClient.invalidateQueries({ queryKey });
    const updateMutation = useMutation({
        mutationFn: (input: AnnouncementDraft) =>
            api.mutate(updateSystemAnnouncementMutation, { input: announcementInput(input, true) }),
        onSuccess: refresh,
        onError: error => toast.error(errorMessage(error)),
    });
    const deleteMutation = useMutation({
        mutationFn: (id: string) => api.mutate(deleteSystemAnnouncementMutation, { id }),
        onSuccess: async () => {
            toast.success('系统公告已删除');
            await refresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    return (
        <Page pageId="system-announcements">
            <PageTitle>系统公告</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button onClick={() => setDraft(newAnnouncementDraft())}>
                        <Plus className="size-4" />
                        新建公告
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="system-announcement-list"
                    title="公告列表"
                    description="只有系统管理员可维护；启用且在生效时间内的公告会进入客户端首页滚动公告。"
                >
                    {query.isLoading ? (
                        <div className="space-y-3">
                            <Skeleton className="h-24" />
                            <Skeleton className="h-24" />
                        </div>
                    ) : query.isError ? (
                        <div className="flex items-center justify-between rounded-md border p-4">
                            <span className="text-sm text-destructive">系统公告加载失败</span>
                            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                                <RefreshCw className="size-4" />
                                重试
                            </Button>
                        </div>
                    ) : query.data?.systemAnnouncements.length ? (
                        <div className="space-y-3">
                            {query.data.systemAnnouncements.map(announcement => (
                                <article key={announcement.id} className="rounded-lg border p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <strong>{announcement.titleZh}</strong>
                                                <Badge
                                                    variant={announcement.enabled ? 'default' : 'secondary'}
                                                >
                                                    {announcement.enabled ? '启用' : '停用'}
                                                </Badge>
                                                <Badge variant="outline">
                                                    优先级 {announcement.priority}
                                                </Badge>
                                            </div>
                                            <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                                                {announcement.contentZh}
                                            </p>
                                            <p className="mt-2 text-xs text-muted-foreground">
                                                {formatDateRange(announcement.startsAt, announcement.endsAt)}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Switch
                                                checked={announcement.enabled}
                                                disabled={updateMutation.isPending}
                                                onCheckedChange={enabled =>
                                                    updateMutation.mutate({
                                                        ...draftFromAnnouncement(announcement),
                                                        enabled,
                                                    })
                                                }
                                            />
                                            <Button
                                                type="button"
                                                size="icon-sm"
                                                variant="ghost"
                                                aria-label="编辑公告"
                                                onClick={() => setDraft(draftFromAnnouncement(announcement))}
                                            >
                                                <Pencil className="size-4" />
                                            </Button>
                                            <ConfirmationDialog
                                                title="删除这条系统公告？"
                                                description="删除后将立即从客户端公告中移除，且无法恢复。"
                                                confirmText="确认删除"
                                                cancelText="取消"
                                                onConfirm={() => deleteMutation.mutate(announcement.id)}
                                            >
                                                <Button
                                                    type="button"
                                                    size="icon-sm"
                                                    variant="ghost"
                                                    aria-label="删除公告"
                                                    disabled={deleteMutation.isPending}
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </ConfirmationDialog>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground">还没有系统公告。</p>
                    )}
                </PageBlock>
            </PageLayout>
            <AnnouncementEditor
                draft={draft}
                onClose={() => setDraft(null)}
                onSaved={async () => {
                    setDraft(null);
                    await refresh();
                }}
            />
        </Page>
    );
}

function AnnouncementEditor({
    draft,
    onClose,
    onSaved,
}: {
    draft: AnnouncementDraft | null;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const [localDraft, setLocalDraft] = useState<AnnouncementDraft | null>(draft);
    const [editEnglish, setEditEnglish] = useState(false);
    useEffect(() => {
        setLocalDraft(draft);
        setEditEnglish(false);
    }, [draft]);
    const mutation = useMutation({
        mutationFn: (value: AnnouncementDraft) =>
            value.id
                ? api.mutate(updateSystemAnnouncementMutation, {
                      input: announcementInput(value, true),
                  })
                : api.mutate(createSystemAnnouncementMutation, {
                      input: announcementInput(value, false),
                  }),
        onSuccess: async () => {
            toast.success(localDraft?.id ? '系统公告已更新' : '系统公告已创建');
            await onSaved();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const update = <K extends keyof AnnouncementDraft>(key: K, value: AnnouncementDraft[K]) =>
        setLocalDraft(current => (current ? { ...current, [key]: value } : current));
    const save = () => {
        if (!localDraft) return;
        const validationError = announcementDraftError(localDraft);
        if (validationError) return toast.error(validationError);
        mutation.mutate(localDraft);
    };
    const requestClose = () => {
        const isDirty = JSON.stringify(localDraft) !== JSON.stringify(draft);
        if (isDirty && !window.confirm('有未保存的修改，确定放弃吗？')) return;
        onClose();
    };
    return (
        <Sheet open={Boolean(draft)} onOpenChange={open => !open && requestClose()}>
            <SheetContent className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:w-[640px] sm:max-w-[640px]">
                <SheetHeader className="shrink-0 border-b px-6 py-5 text-left">
                    <SheetTitle>{draft?.id ? '编辑系统公告' : '新建系统公告'}</SheetTitle>
                    <SheetDescription>填写中文即可，保存时会自动生成英文。</SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                    {localDraft ? (
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                                <p className="text-xs text-muted-foreground">
                                    通常只需填写中文；仅在需要人工修改英文译文时切换到英文校对。
                                </p>
                                <div className="flex shrink-0 rounded-md border bg-background p-1">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={editEnglish ? 'ghost' : 'secondary'}
                                        onClick={() => setEditEnglish(false)}
                                    >
                                        常用模式
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant={editEnglish ? 'secondary' : 'ghost'}
                                        onClick={() => setEditEnglish(true)}
                                    >
                                        英文校对
                                    </Button>
                                </div>
                            </div>
                            <Field label="公告标题" className={editEnglish ? undefined : 'sm:col-span-2'}>
                                <Input
                                    value={localDraft.titleZh}
                                    maxLength={120}
                                    onChange={event => update('titleZh', event.target.value)}
                                />
                            </Field>
                            {editEnglish ? (
                                <Field label="英文标题（人工覆盖）">
                                    <Input
                                        value={localDraft.titleEn}
                                        maxLength={120}
                                        onChange={event => update('titleEn', event.target.value)}
                                    />
                                </Field>
                            ) : null}
                            <Field label="公告内容" className="sm:col-span-2">
                                <Textarea
                                    rows={4}
                                    value={localDraft.contentZh}
                                    maxLength={2000}
                                    onChange={event => update('contentZh', event.target.value)}
                                />
                            </Field>
                            {editEnglish ? (
                                <Field label="英文内容（人工覆盖）" className="sm:col-span-2">
                                    <Textarea
                                        rows={3}
                                        value={localDraft.contentEn}
                                        maxLength={2000}
                                        onChange={event => update('contentEn', event.target.value)}
                                    />
                                </Field>
                            ) : null}
                            <Field
                                label="跳转链接"
                                hint="可留空；支持 HTTPS、HTTP 或站内相对路径。"
                                className="sm:col-span-2"
                            >
                                <Input
                                    value={localDraft.linkUrl}
                                    onChange={event => update('linkUrl', event.target.value)}
                                />
                            </Field>
                            <Field label="开始时间">
                                <Input
                                    type="datetime-local"
                                    value={localDraft.startsAt}
                                    onChange={event => update('startsAt', event.target.value)}
                                />
                            </Field>
                            <Field label="结束时间">
                                <Input
                                    type="datetime-local"
                                    value={localDraft.endsAt}
                                    onChange={event => update('endsAt', event.target.value)}
                                />
                            </Field>
                            <Field label="优先级" hint="数字越大，滚动顺序越靠前。">
                                <Input
                                    type="number"
                                    min={0}
                                    max={999}
                                    value={localDraft.priority}
                                    onChange={event => update('priority', event.target.value)}
                                />
                            </Field>
                            <Field label="启用公告">
                                <div className="flex h-9 items-center">
                                    <Switch
                                        checked={localDraft.enabled}
                                        onCheckedChange={enabled => update('enabled', enabled)}
                                    />
                                </div>
                            </Field>
                        </div>
                    ) : null}
                </div>
                <SheetFooter className="shrink-0 border-t px-6 py-4">
                    <Button variant="outline" onClick={requestClose}>
                        取消
                    </Button>
                    <Button disabled={mutation.isPending} onClick={save}>
                        {mutation.isPending ? '保存中' : '保存公告'}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

function Field({
    label,
    hint,
    className,
    children,
}: {
    label: string;
    hint?: string;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div className={`space-y-2 ${className ?? ''}`}>
            <Label>{label}</Label>
            {children}
            {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
    );
}

function newAnnouncementDraft(): AnnouncementDraft {
    return {
        enabled: true,
        priority: '0',
        titleZh: '',
        titleEn: '',
        contentZh: '',
        contentEn: '',
        linkUrl: '',
        startsAt: '',
        endsAt: '',
    };
}

function draftFromAnnouncement(value: SystemAnnouncementRecord): AnnouncementDraft {
    return {
        id: value.id,
        enabled: value.enabled,
        priority: String(value.priority),
        titleZh: value.titleZh,
        titleEn: value.titleEn,
        contentZh: value.contentZh,
        contentEn: value.contentEn,
        linkUrl: value.linkUrl ?? '',
        startsAt: localDateTime(value.startsAt),
        endsAt: localDateTime(value.endsAt),
    };
}

function announcementInput(value: AnnouncementDraft, includeId: boolean) {
    return {
        ...(includeId && value.id ? { id: value.id } : {}),
        enabled: value.enabled,
        priority: Number(value.priority),
        titleZh: value.titleZh,
        titleEn: value.titleEn,
        contentZh: value.contentZh,
        contentEn: value.contentEn,
        linkUrl: value.linkUrl || null,
        startsAt: isoDate(value.startsAt),
        endsAt: isoDate(value.endsAt),
    };
}

function announcementDraftError(value: AnnouncementDraft): string | null {
    if (!value.titleZh.trim()) return '请填写中文标题';
    if (!value.contentZh.trim()) return '请填写中文内容';
    const priority = Number(value.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 999) return '优先级必须是 0 到 999 的整数';
    if (value.startsAt && value.endsAt && Date.parse(value.startsAt) >= Date.parse(value.endsAt))
        return '结束时间必须晚于开始时间';
    return null;
}

function isoDate(value: string): string | null {
    return value ? new Date(value).toISOString() : null;
}
function localDateTime(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}
function formatDateRange(startsAt: string | null, endsAt: string | null): string {
    return `${startsAt ? new Date(startsAt).toLocaleString() : '立即开始'} 至 ${endsAt ? new Date(endsAt).toLocaleString() : '长期有效'}`;
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
