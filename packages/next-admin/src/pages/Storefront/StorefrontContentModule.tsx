import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    CheckCircle2,
    Code2,
    ExternalLink,
    FileText,
    LoaderCircle,
    Megaphone,
    Pencil,
    Plus,
    RefreshCw,
    RotateCcw,
    Save,
    Send,
    Trash2,
    X,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import {
    CREATE_STOREFRONT_BLOCK_MUTATION,
    CREATE_SYSTEM_ANNOUNCEMENT_MUTATION,
    DELETE_SYSTEM_ANNOUNCEMENT_MUTATION,
    PREVIEW_STOREFRONT_PROMOTION_PAGE_MUTATION,
    PUBLISH_STOREFRONT_PROMOTION_PAGE_MUTATION,
    RESET_STOREFRONT_PROMOTION_PAGE_MUTATION,
    SAVE_STOREFRONT_PROMOTION_DRAFT_MUTATION,
    STOREFRONT_CONTENT_QUERY,
    STOREFRONT_PROMOTION_PAGE_QUERY,
    SYSTEM_ANNOUNCEMENTS_QUERY,
    UPDATE_STOREFRONT_BLOCK_MUTATION,
    UPDATE_SYSTEM_ANNOUNCEMENT_MUTATION,
    type StorefrontContentBlock,
    type StorefrontContentResult,
    type StorefrontPromotionRecord,
    type SystemAnnouncementRecord,
} from '../../graphql/storefront.graphql';
import { useAccessibleDialog } from '../../hooks/use-accessible-dialog';
import { useUrlTab } from '../../hooks/use-url-tab';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    blockTranslation,
    contentModuleDescriptors,
    errorText,
    fromLocalDateTime,
    newContentBlock,
    storefrontBlockInput,
    toLocalDateTime,
} from './storefront-content-utils';
import { StorefrontBlockEditor } from './StorefrontBlockEditor';

type ContentTab = 'PAGES' | 'ANNOUNCEMENTS' | 'LANDING';
const CONTENT_TABS = { pages: 'PAGES', announcements: 'ANNOUNCEMENTS', landing: 'LANDING' } as const;

export function StorefrontContentModule() {
    const [tab, setTab] = useUrlTab<ContentTab>(CONTENT_TABS, 'pages');
    const [searchParams, setSearchParams] = useSearchParams();
    const [editingBlock, setEditingBlock] = useState<StorefrontContentBlock | null>(null);
    const [editingAnnouncement, setEditingAnnouncement] = useState<SystemAnnouncementRecord | 'NEW' | null>(
        null,
    );
    const [deletingAnnouncement, setDeletingAnnouncement] = useState<SystemAnnouncementRecord | null>(null);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const content = useQuery<StorefrontContentResult>(STOREFRONT_CONTENT_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    const announcements = useQuery<{ systemAnnouncements: SystemAnnouncementRecord[] }>(
        SYSTEM_ANNOUNCEMENTS_QUERY,
        {
            skip: tab !== 'ANNOUNCEMENTS',
            fetchPolicy: 'cache-and-network',
        },
    );
    const promotion = useQuery<{ storefrontPromotionPage: StorefrontPromotionRecord }>(
        STOREFRONT_PROMOTION_PAGE_QUERY,
        {
            skip: tab !== 'LANDING',
            fetchPolicy: 'cache-and-network',
        },
    );
    const requestedAnnouncementId = searchParams.get('announcementId');
    const requestedAnnouncement = announcements.data?.systemAnnouncements.find(
        item => item.id === requestedAnnouncementId,
    );
    const activeAnnouncementEditor = editingAnnouncement ?? requestedAnnouncement ?? null;
    const closeAnnouncementEditor = () => {
        setEditingAnnouncement(null);
        if (!requestedAnnouncementId) return;
        setSearchParams(
            current => {
                const next = new URLSearchParams(current);
                next.delete('announcementId');
                return next;
            },
            { replace: true },
        );
    };
    const [createBlock, createBlockState] = useMutation(CREATE_STOREFRONT_BLOCK_MUTATION);
    const [updateBlock, updateBlockState] = useMutation(UPDATE_STOREFRONT_BLOCK_MUTATION);
    const [deleteAnnouncement, deleteAnnouncementState] = useMutation<{
        deleteSystemAnnouncement: { result: string; message?: string | null };
    }>(DELETE_SYSTEM_ANNOUNCEMENT_MUTATION);
    const pageBlocks = (content.data?.storefrontContentBlocks ?? []).filter(block =>
        contentModuleDescriptors.some(item => item.type === block.type),
    );

    const showNotice = (message: string) => {
        setNotice(message);
        setActionError('');
    };
    const showError = (error: unknown) => {
        setActionError(errorText(error));
        setNotice('');
    };

    const saveBlock = async (block: StorefrontContentBlock) => {
        try {
            if (block.id) {
                if (!block.updatedAt) throw new Error('缺少内容版本，请刷新后重试');
                await updateBlock({
                    variables: {
                        input: {
                            id: block.id,
                            expectedUpdatedAt: block.updatedAt,
                            ...storefrontBlockInput(block),
                        },
                    },
                });
            } else {
                await createBlock({ variables: { input: storefrontBlockInput(block) } });
            }
            setEditingBlock(null);
            showNotice('店铺内容已保存并向客户端生效');
            await content.refetch();
        } catch (error) {
            showError(error);
        }
    };

    const toggleBlock = async (block: StorefrontContentBlock) => {
        if (!block.id || !block.updatedAt) return;
        try {
            await updateBlock({
                variables: {
                    input: { id: block.id, expectedUpdatedAt: block.updatedAt, enabled: !block.enabled },
                },
            });
            showNotice(`《${block.internalName}》已${block.enabled ? '停用' : '启用'}`);
            await content.refetch();
        } catch (error) {
            showError(error);
        }
    };

    const confirmDeleteAnnouncement = async () => {
        if (!deletingAnnouncement) return;
        try {
            const response = await deleteAnnouncement({ variables: { id: deletingAnnouncement.id } });
            const deletion = response.data?.deleteSystemAnnouncement;
            if (!deletion || deletion.result !== 'DELETED') {
                throw new Error(deletion?.message || '后端拒绝删除该公告');
            }
            showNotice(`已删除公告《${deletingAnnouncement.titleZh}》`);
            setDeletingAnnouncement(null);
            await announcements.refetch();
        } catch (error) {
            showError(error);
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="text-xl font-bold text-slate-900">店铺内容与页面</h1>
                        <p className="mt-1 text-xs text-slate-500">
                            法律客服、登录视觉、导航、公告和推广落地页集中管理
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() =>
                            void Promise.all([
                                content.refetch(),
                                tab === 'ANNOUNCEMENTS' ? announcements.refetch() : Promise.resolve(),
                                tab === 'LANDING' ? promotion.refetch() : Promise.resolve(),
                            ])
                        }
                        className="flex items-center gap-1.5 self-start rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                    >
                        <RefreshCw
                            className={`h-3.5 w-3.5 ${content.loading || announcements.loading || promotion.loading ? 'animate-spin' : ''}`}
                        />
                        刷新
                    </button>
                </div>
            </header>
            <nav className="shrink-0 border-b border-slate-200 bg-white px-5 sm:px-8">
                <div className="mx-auto flex max-w-[1500px] gap-6 overflow-x-auto text-xs font-bold">
                    <TabButton
                        active={tab === 'PAGES'}
                        onClick={() => setTab('PAGES')}
                        icon={FileText}
                        label="固定内容"
                    />
                    <TabButton
                        active={tab === 'ANNOUNCEMENTS'}
                        onClick={() => setTab('ANNOUNCEMENTS')}
                        icon={Megaphone}
                        label="系统公告"
                    />
                    <TabButton
                        active={tab === 'LANDING'}
                        onClick={() => setTab('LANDING')}
                        icon={Code2}
                        label="推广落地页"
                    />
                </div>
            </nav>

            <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                {tab === 'PAGES' &&
                    (content.loading && !content.data ? (
                        <LoadingState label="正在读取店铺内容…" />
                    ) : content.error ? (
                        <ErrorState message={content.error.message} onRetry={() => void content.refetch()} />
                    ) : (
                        <PageBlockList
                            blocks={pageBlocks}
                            allCount={content.data?.storefrontContentBlocks.length ?? 0}
                            pending={updateBlockState.loading}
                            onEdit={setEditingBlock}
                            onCreate={descriptor =>
                                setEditingBlock(
                                    newContentBlock(
                                        descriptor.type,
                                        content.data?.storefrontContentBlocks.length ?? 0,
                                        descriptor.name,
                                    ),
                                )
                            }
                            onToggle={block => void toggleBlock(block)}
                        />
                    ))}
                {tab === 'ANNOUNCEMENTS' &&
                    (announcements.loading && !announcements.data ? (
                        <LoadingState label="正在读取系统公告…" />
                    ) : announcements.error ? (
                        <ErrorState
                            message={announcements.error.message}
                            onRetry={() => void announcements.refetch()}
                        />
                    ) : (
                        <AnnouncementList
                            items={announcements.data?.systemAnnouncements ?? []}
                            onCreate={() => setEditingAnnouncement('NEW')}
                            onEdit={setEditingAnnouncement}
                            onDelete={setDeletingAnnouncement}
                        />
                    ))}
                {tab === 'LANDING' &&
                    (promotion.loading && !promotion.data ? (
                        <LoadingState label="正在读取推广页…" />
                    ) : promotion.error ? (
                        <ErrorState
                            message={promotion.error.message}
                            onRetry={() => void promotion.refetch()}
                        />
                    ) : (
                        promotion.data && (
                            <PromotionPageEditor
                                key={`${promotion.data.storefrontPromotionPage.id ?? 'default'}-${promotion.data.storefrontPromotionPage.publishedVersion}-${promotion.data.storefrontPromotionPage.draftSource.length}`}
                                value={promotion.data.storefrontPromotionPage}
                                onNotice={showNotice}
                                onError={showError}
                                onRefresh={() => promotion.refetch()}
                            />
                        )
                    ))}
            </main>

            {editingBlock && (
                <StorefrontBlockEditor
                    key={editingBlock.id ?? editingBlock.code}
                    value={editingBlock}
                    saving={createBlockState.loading || updateBlockState.loading}
                    onClose={() => setEditingBlock(null)}
                    onSave={saveBlock}
                />
            )}
            {activeAnnouncementEditor && (
                <AnnouncementEditor
                    key={activeAnnouncementEditor === 'NEW' ? 'new' : activeAnnouncementEditor.id}
                    value={activeAnnouncementEditor === 'NEW' ? null : activeAnnouncementEditor}
                    onClose={closeAnnouncementEditor}
                    onSaved={async message => {
                        closeAnnouncementEditor();
                        showNotice(message);
                        await announcements.refetch();
                    }}
                    onError={showError}
                />
            )}
            {deletingAnnouncement && (
                <ConfirmDialog
                    title="删除系统公告"
                    description={`确认删除《${deletingAnnouncement.titleZh}》？已打开公告页的买家刷新后将无法再查看。`}
                    pending={deleteAnnouncementState.loading}
                    onClose={() => setDeletingAnnouncement(null)}
                    onConfirm={() => void confirmDeleteAnnouncement()}
                />
            )}
        </div>
    );
}

function PageBlockList({
    blocks,
    allCount,
    pending,
    onEdit,
    onCreate,
    onToggle,
}: {
    blocks: StorefrontContentBlock[];
    allCount: number;
    pending: boolean;
    onEdit: (block: StorefrontContentBlock) => void;
    onCreate: (descriptor: (typeof contentModuleDescriptors)[number]) => void;
    onToggle: (block: StorefrontContentBlock) => void;
}) {
    return (
        <div>
            <div className="mb-4">
                <h2 className="text-sm font-bold text-slate-900">固定内容配置</h2>
                <p className="mt-1 text-xs text-slate-500">
                    首页轮播与营销楼层已放到“商城首页装修”，这里不再重复。
                </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {contentModuleDescriptors.map(descriptor => {
                    const block = blocks.find(item => item.type === descriptor.type);
                    const copy = block ? blockTranslation(block, 'zh_Hans') : null;
                    return (
                        <article
                            key={descriptor.type}
                            className="flex min-h-52 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                                    <FileText className="h-4 w-4" />
                                </div>
                                <span
                                    className={`rounded px-2 py-1 text-[10px] font-bold ${block?.enabled ? 'bg-emerald-50 text-emerald-700' : block ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'}`}
                                >
                                    {block?.enabled ? '前台已启用' : block ? '已停用' : '待配置'}
                                </span>
                            </div>
                            <h3 className="mt-4 text-sm font-bold text-slate-900">{descriptor.name}</h3>
                            <p className="mt-1 text-xs leading-5 text-slate-500">{descriptor.description}</p>
                            {copy?.title && (
                                <div className="mt-3 truncate rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                                    当前：{copy.title}
                                </div>
                            )}
                            <div className="mt-auto flex gap-2 pt-5">
                                {block ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => onEdit(block)}
                                            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                            编辑内容
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onToggle(block)}
                                            disabled={pending}
                                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                                        >
                                            {block.enabled ? '停用' : '启用'}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => onCreate(descriptor)}
                                        className="flex w-full items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        开始配置
                                    </button>
                                )}
                            </div>
                        </article>
                    );
                })}
            </div>
            <p className="mt-4 text-[10px] text-slate-400">
                当前店铺共有 {allCount} 个内容区块，本页只管理其中的固定页面类型。
            </p>
        </div>
    );
}

function AnnouncementList({
    items,
    onCreate,
    onEdit,
    onDelete,
}: {
    items: SystemAnnouncementRecord[];
    onCreate: () => void;
    onEdit: (item: SystemAnnouncementRecord) => void;
    onDelete: (item: SystemAnnouncementRecord) => void;
}) {
    const sorted = [...items].sort(
        (a, b) =>
            b.priority - a.priority || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
                <div>
                    <h2 className="text-sm font-bold text-slate-900">全站系统公告</h2>
                    <p className="mt-1 text-[11px] text-slate-400">
                        优先级数字越大越靠前，可设定自动上线和下线时间
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onCreate}
                    className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"
                >
                    <Plus className="h-3.5 w-3.5" />
                    新建公告
                </button>
            </div>
            {sorted.length ? (
                <div className="divide-y divide-slate-100">
                    {sorted.map(item => (
                        <article
                            key={item.id}
                            className="flex flex-col gap-3 p-4 hover:bg-slate-50 sm:flex-row sm:items-start"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-xs font-bold text-slate-900">{item.titleZh}</h3>
                                    <span
                                        className={`rounded px-2 py-0.5 text-[9px] font-bold ${item.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}
                                    >
                                        {item.enabled ? '已启用' : '已停用'}
                                    </span>
                                    <span className="rounded bg-blue-50 px-2 py-0.5 text-[9px] font-bold text-blue-700">
                                        优先级 {item.priority}
                                    </span>
                                </div>
                                <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-slate-500">
                                    {item.contentZh}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-3 font-mono text-[9px] text-slate-400">
                                    <span>更新 {formatDate(item.updatedAt)}</span>
                                    {item.startsAt && <span>上线 {formatDate(item.startsAt)}</span>}
                                    {item.endsAt && <span>下线 {formatDate(item.endsAt)}</span>}
                                </div>
                            </div>
                            <div className="flex shrink-0 gap-2">
                                <button
                                    type="button"
                                    onClick={() => onEdit(item)}
                                    className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-700"
                                >
                                    编辑
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onDelete(item)}
                                    className="rounded-lg p-1.5 text-rose-500 hover:bg-rose-50"
                                    aria-label="删除公告"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                        </article>
                    ))}
                </div>
            ) : (
                <EmptyState
                    icon={Megaphone}
                    title="还没有系统公告"
                    detail="新建后将按排期和优先级向买家展示。"
                    action="新建公告"
                    onAction={onCreate}
                />
            )}
        </section>
    );
}

interface AnnouncementDraft {
    enabled: boolean;
    priority: string;
    titleZh: string;
    titleEn: string;
    titleEnLocked: boolean;
    contentZh: string;
    contentEn: string;
    contentEnLocked: boolean;
    linkUrl: string;
    startsAt: string;
    endsAt: string;
}

function AnnouncementEditor({
    value,
    onClose,
    onSaved,
    onError,
}: {
    value: SystemAnnouncementRecord | null;
    onClose: () => void;
    onSaved: (message: string) => Promise<void>;
    onError: (error: unknown) => void;
}) {
    const [draft, setDraft] = useState<AnnouncementDraft>(() => ({
        enabled: value?.enabled ?? true,
        priority: String(value?.priority ?? 0),
        titleZh: value?.titleZh ?? '',
        titleEn: value?.titleEn ?? '',
        titleEnLocked: value?.titleEnLocked ?? false,
        contentZh: value?.contentZh ?? '',
        contentEn: value?.contentEn ?? '',
        contentEnLocked: value?.contentEnLocked ?? false,
        linkUrl: value?.linkUrl ?? '',
        startsAt: toLocalDateTime(value?.startsAt ?? null),
        endsAt: toLocalDateTime(value?.endsAt ?? null),
    }));
    const [create, createState] = useMutation(CREATE_SYSTEM_ANNOUNCEMENT_MUTATION);
    const [update, updateState] = useMutation(UPDATE_SYSTEM_ANNOUNCEMENT_MUTATION);
    const validation = announcementDraftError(draft);
    const submit = async () => {
        if (validation) return;
        const input = {
            enabled: draft.enabled,
            priority: Number.parseInt(draft.priority, 10) || 0,
            titleZh: draft.titleZh.trim(),
            titleEn: draft.titleEn.trim(),
            titleEnLocked: draft.titleEnLocked,
            contentZh: draft.contentZh.trim(),
            contentEn: draft.contentEn.trim(),
            contentEnLocked: draft.contentEnLocked,
            linkUrl: draft.linkUrl.trim() || null,
            startsAt: fromLocalDateTime(draft.startsAt),
            endsAt: fromLocalDateTime(draft.endsAt),
        };
        try {
            if (value) await update({ variables: { input: { id: value.id, ...input } } });
            else await create({ variables: { input } });
            await onSaved(value ? '系统公告已更新' : '系统公告已创建');
        } catch (error) {
            onError(error);
        }
    };
    const pending = createState.loading || updateState.loading;
    return (
        <Modal
            title={value ? '编辑系统公告' : '新建系统公告'}
            description="中文是源内容；英文默认自动翻译，需要人工定稿时再锁定"
            onClose={onClose}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="中文标题 *">
                    <input
                        value={draft.titleZh}
                        onChange={event => setDraft({ ...draft, titleZh: event.target.value })}
                        className={inputClass}
                    />
                </Field>
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                        <label htmlFor="announcement-title-en" className="text-xs font-bold text-slate-700">
                            英文标题
                        </label>
                        <label className="flex items-center gap-1.5 text-[11px] font-bold text-amber-700">
                            <input
                                type="checkbox"
                                checked={draft.titleEnLocked}
                                onChange={event =>
                                    setDraft({ ...draft, titleEnLocked: event.target.checked })
                                }
                            />
                            人工锁定
                        </label>
                    </div>
                    <input
                        id="announcement-title-en"
                        value={draft.titleEn}
                        onChange={event => setDraft({ ...draft, titleEn: event.target.value })}
                        disabled={!draft.titleEnLocked}
                        className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-500`}
                    />
                    <p className="text-[10px] leading-4 text-slate-400">
                        {draft.titleEnLocked
                            ? '保存后不会被自动翻译覆盖；中文变更后会标记为待复核。'
                            : '由系统自动维护；取消锁定并保存后会重新翻译。'}
                    </p>
                </div>
                <div className="sm:col-span-2">
                    <Field label="中文正文 *">
                        <textarea
                            rows={4}
                            value={draft.contentZh}
                            onChange={event => setDraft({ ...draft, contentZh: event.target.value })}
                            className={inputClass}
                        />
                    </Field>
                </div>
                <div className="sm:col-span-2">
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                            <label
                                htmlFor="announcement-content-en"
                                className="text-xs font-bold text-slate-700"
                            >
                                英文正文
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] font-bold text-amber-700">
                                <input
                                    type="checkbox"
                                    checked={draft.contentEnLocked}
                                    onChange={event =>
                                        setDraft({ ...draft, contentEnLocked: event.target.checked })
                                    }
                                />
                                人工锁定
                            </label>
                        </div>
                        <textarea
                            id="announcement-content-en"
                            rows={4}
                            value={draft.contentEn}
                            onChange={event => setDraft({ ...draft, contentEn: event.target.value })}
                            disabled={!draft.contentEnLocked}
                            className={`${inputClass} disabled:bg-slate-50 disabled:text-slate-500`}
                        />
                        <p className="text-[10px] leading-4 text-slate-400">
                            {draft.contentEnLocked
                                ? '保存后不会被自动翻译覆盖；中文变更后会标记为待复核。'
                                : '由系统自动维护；取消锁定并保存后会重新翻译。'}
                        </p>
                    </div>
                </div>
                <Field label="优先级">
                    <input
                        type="number"
                        value={draft.priority}
                        onChange={event => setDraft({ ...draft, priority: event.target.value })}
                        className={inputClass}
                    />
                </Field>
                <Field label="跳转网址">
                    <input
                        value={draft.linkUrl}
                        onChange={event => setDraft({ ...draft, linkUrl: event.target.value })}
                        placeholder="https://..."
                        className={inputClass}
                    />
                </Field>
                <Field label="上线时间">
                    <input
                        type="datetime-local"
                        value={draft.startsAt}
                        onChange={event => setDraft({ ...draft, startsAt: event.target.value })}
                        className={inputClass}
                    />
                </Field>
                <Field label="下线时间">
                    <input
                        type="datetime-local"
                        value={draft.endsAt}
                        onChange={event => setDraft({ ...draft, endsAt: event.target.value })}
                        className={inputClass}
                    />
                </Field>
            </div>
            <label className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-700">
                <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={event => setDraft({ ...draft, enabled: event.target.checked })}
                />
                保存后启用
            </label>
            {validation && <p className="mt-3 text-xs text-rose-600">{validation}</p>}
            <ModalFooter
                pending={pending}
                disabled={Boolean(validation)}
                confirmLabel={value ? '保存公告' : '创建公告'}
                onCancel={onClose}
                onConfirm={() => void submit()}
            />
        </Modal>
    );
}

function PromotionPageEditor({
    value,
    onNotice,
    onError,
    onRefresh,
}: {
    value: StorefrontPromotionRecord;
    onNotice: (message: string) => void;
    onError: (error: unknown) => void;
    onRefresh: () => Promise<unknown>;
}) {
    const [contentType, setContentType] = useState(value.contentType);
    const [source, setSource] = useState(value.draftSource);
    const [previewHtml, setPreviewHtml] = useState('');
    const [confirmReset, setConfirmReset] = useState(false);
    const [save, saveState] = useMutation(SAVE_STOREFRONT_PROMOTION_DRAFT_MUTATION);
    const [preview, previewState] = useMutation<{ previewStorefrontPromotionPage: string }>(
        PREVIEW_STOREFRONT_PROMOTION_PAGE_MUTATION,
    );
    const [publish, publishState] = useMutation(PUBLISH_STOREFRONT_PROMOTION_PAGE_MUTATION);
    const [reset, resetState] = useMutation(RESET_STOREFRONT_PROMOTION_PAGE_MUTATION);
    const dirty = contentType !== value.contentType || source !== value.draftSource;
    const saveDraft = async () => {
        if (!source.trim()) return onError(new Error('推广页内容不能为空'));
        try {
            await save({ variables: { input: { contentType, source } } });
            onNotice('推广页草稿已保存');
            await onRefresh();
        } catch (error) {
            onError(error);
        }
    };
    const showPreview = async () => {
        if (!source.trim()) return;
        try {
            const result = await preview({ variables: { input: { contentType, source } } });
            setPreviewHtml(result.data?.previewStorefrontPromotionPage ?? '');
        } catch (error) {
            onError(error);
        }
    };
    const publishPage = async () => {
        try {
            if (dirty) await save({ variables: { input: { contentType, source } } });
            await publish();
            onNotice('推广落地页已发布');
            await onRefresh();
        } catch (error) {
            onError(error);
        }
    };
    const resetPage = async () => {
        try {
            await reset();
            setConfirmReset(false);
            onNotice('推广页已恢复平台默认模板');
            await onRefresh();
        } catch (error) {
            onError(error);
        }
    };
    const pending = saveState.loading || previewState.loading || publishState.loading || resetState.loading;
    return (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.8fr)]">
            <section className="rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-bold text-slate-900">推广落地页源码</h2>
                            <span
                                className={`rounded px-2 py-0.5 text-[9px] font-bold ${value.isCustomized ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}
                            >
                                {value.isCustomized ? '自定义模板' : '平台默认模板'}
                            </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-400">
                            发布版本 {value.publishedVersion}，默认模板版本 {value.defaultTemplateVersion}
                            {value.publishedAt ? ` · 上次发布 ${formatDate(value.publishedAt)}` : ''}
                        </p>
                    </div>
                    {value.publicUrl && (
                        <a
                            href={value.publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs font-bold text-blue-700"
                        >
                            打开前台
                            <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                    )}
                </div>
                <div className="p-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <select
                            value={contentType}
                            onChange={event => setContentType(event.target.value as 'HTML' | 'MARKDOWN')}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold"
                        >
                            <option value="HTML">HTML</option>
                            <option value="MARKDOWN">Markdown</option>
                        </select>
                        {dirty && <span className="text-[10px] font-bold text-amber-600">有未保存更改</span>}
                    </div>
                    <textarea
                        value={source}
                        onChange={event => setSource(event.target.value)}
                        rows={24}
                        spellCheck={false}
                        className="w-full resize-y rounded-xl border border-slate-300 bg-slate-950 p-4 font-mono text-xs leading-6 text-slate-100 outline-none focus:border-blue-500"
                    />
                    <div className="mt-4 flex flex-wrap justify-between gap-3">
                        <button
                            type="button"
                            onClick={() => setConfirmReset(true)}
                            disabled={pending}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            恢复默认模板
                        </button>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => void showPreview()}
                                disabled={pending || !source.trim()}
                                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
                            >
                                <Code2 className="h-3.5 w-3.5" />
                                生成预览
                            </button>
                            <button
                                type="button"
                                onClick={() => void saveDraft()}
                                disabled={pending || !dirty || !source.trim()}
                                className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-50"
                            >
                                <Save className="h-3.5 w-3.5" />
                                保存草稿
                            </button>
                            <button
                                type="button"
                                onClick={() => void publishPage()}
                                disabled={pending || !source.trim()}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                            >
                                <Send className="h-3.5 w-3.5" />
                                发布上线
                            </button>
                        </div>
                    </div>
                </div>
            </section>
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white xl:sticky xl:top-0 xl:self-start">
                <div className="border-b border-slate-100 p-4">
                    <h2 className="text-sm font-bold text-slate-900">安全预览</h2>
                    <p className="mt-1 text-[10px] text-slate-400">预览在沙箱中渲染，不执行页面脚本</p>
                </div>
                {previewHtml ? (
                    <iframe
                        title="推广落地页预览"
                        sandbox=""
                        srcDoc={previewHtml}
                        className="h-[720px] w-full bg-white"
                    />
                ) : (
                    <div className="flex min-h-[620px] flex-col items-center justify-center p-8 text-center">
                        <Code2 className="h-9 w-9 text-slate-300" />
                        <h3 className="mt-3 text-sm font-bold text-slate-700">还没有生成预览</h3>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                            点击“生成预览”，后端会按与正式发布相同的规则处理内容。
                        </p>
                    </div>
                )}
            </section>
            {confirmReset && (
                <ConfirmDialog
                    title="恢复默认推广页"
                    description="当前自定义草稿将被平台默认模板覆盖。此操作不会删除订单或营销活动数据。"
                    pending={resetState.loading}
                    onClose={() => setConfirmReset(false)}
                    onConfirm={() => void resetPage()}
                />
            )}
        </div>
    );
}

function TabButton({
    active,
    onClick,
    icon: Icon,
    label,
}: {
    active: boolean;
    onClick: () => void;
    icon: typeof FileText;
    label: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 py-3.5 ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
            <Icon className="h-3.5 w-3.5" />
            {label}
        </button>
    );
}
function Modal({
    title,
    description,
    onClose,
    children,
}: {
    title: string;
    description?: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    const { dialogRef, titleId } = useAccessibleDialog(onClose);
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={dialogRef as React.RefObject<HTMLDivElement>}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none"
            >
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <h2 id={titleId} className="font-bold text-slate-900">
                            {title}
                        </h2>
                        {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
                    </div>
                    <button type="button" onClick={onClose} className="p-1 text-slate-400" aria-label="关闭">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}
function ModalFooter({
    pending,
    disabled,
    confirmLabel,
    onCancel,
    onConfirm,
}: {
    pending: boolean;
    disabled: boolean;
    confirmLabel: string;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
                type="button"
                onClick={onCancel}
                disabled={pending}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
            >
                取消
            </button>
            <button
                type="button"
                onClick={onConfirm}
                disabled={pending || disabled}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
                {pending ? '正在保存…' : confirmLabel}
            </button>
        </div>
    );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            {children}
        </label>
    );
}
function LoadingState({ label }: { label: string }) {
    return (
        <div className="flex min-h-80 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {label}
        </div>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <h2 className="mt-3 text-sm font-bold text-slate-800">数据加载失败</h2>
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
function EmptyState({
    icon: Icon,
    title,
    detail,
    action,
    onAction,
}: {
    icon: typeof Megaphone;
    title: string;
    detail: string;
    action: string;
    onAction: () => void;
}) {
    return (
        <div className="flex min-h-80 flex-col items-center justify-center p-8 text-center">
            <Icon className="h-9 w-9 text-slate-300" />
            <h3 className="mt-3 text-sm font-bold text-slate-800">{title}</h3>
            <p className="mt-1 text-xs text-slate-400">{detail}</p>
            <button
                type="button"
                onClick={onAction}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white"
            >
                {action}
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
function ConfirmDialog({
    title,
    description,
    pending,
    onClose,
    onConfirm,
}: {
    title: string;
    description: string;
    pending: boolean;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4">
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={onClose}
                role="alertdialog"
                className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
            >
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                    <Trash2 className="h-5 w-5" />
                </div>
                <h2 className="mt-4 font-bold text-slate-900">{title}</h2>
                <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
                <div className="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={pending}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={pending}
                        className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {pending ? '处理中…' : '确认'}
                    </button>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}
function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function validHttpUrl(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}
function containsHan(value: string) {
    return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}
function announcementDraftError(draft: AnnouncementDraft): string | null {
    if (!draft.titleZh.trim()) return '请填写中文标题';
    if (!draft.contentZh.trim()) return '请填写中文正文';
    if (draft.titleEnLocked && !draft.titleEn.trim()) {
        return '人工锁定英文标题前，请先填写英文标题';
    }
    if (draft.titleEnLocked && containsHan(draft.titleEn)) return '人工锁定的英文标题不能包含中文';
    if (draft.contentEnLocked && !draft.contentEn.trim()) {
        return '人工锁定英文正文前，请先填写英文正文';
    }
    if (draft.contentEnLocked && containsHan(draft.contentEn)) return '人工锁定的英文正文不能包含中文';
    if (draft.linkUrl.trim() && !validHttpUrl(draft.linkUrl)) {
        return '跳转地址必须是有效的 HTTP(S) 网址';
    }
    if (draft.startsAt && draft.endsAt && new Date(draft.startsAt) >= new Date(draft.endsAt)) {
        return '下线时间必须晚于上线时间';
    }
    return null;
}
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
