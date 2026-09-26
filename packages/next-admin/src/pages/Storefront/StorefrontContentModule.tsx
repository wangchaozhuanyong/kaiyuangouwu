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
import { useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { channelRequestContext, getActiveChannelToken } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
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
    SYSTEM_ANNOUNCEMENT_CHANNELS_QUERY,
    SYSTEM_ANNOUNCEMENTS_QUERY,
    UPDATE_STOREFRONT_BLOCK_MUTATION,
    UPDATE_SYSTEM_ANNOUNCEMENT_MUTATION,
    type StorefrontContentBlock,
    type StorefrontContentResult,
    type StorefrontPromotionRecord,
    type SystemAnnouncementChannel,
    type SystemAnnouncementRecord,
} from '../../graphql/storefront.graphql';
import { useAccessibleDialog } from '../../hooks/use-accessible-dialog';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useUrlTab } from '../../hooks/use-url-tab';
import { getChannelDisplayName, isDefaultChannelCode } from '../../utils/channel-display';
import { omitUnchangedEnglish } from '../../utils/english-edit-intent';
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
import { contentPublicationLabels, contentPublicationStatus } from './storefront-publication';
import {
    verifyAnnouncement,
    verifyContentChannel,
    verifyPromotion,
    verifySavedBlock,
} from './storefront-save-verification';
import { StorefrontBlockEditor } from './StorefrontBlockEditor';

type ContentTab = 'PAGES' | 'ANNOUNCEMENTS' | 'LANDING';
const CONTENT_TABS = { pages: 'PAGES', announcements: 'ANNOUNCEMENTS', landing: 'LANDING' } as const;

export function StorefrontContentModule() {
    const { hasAnyPermission } = useAdminPermissions();
    const canCreate = hasAnyPermission(['CreateStorefrontContent']);
    const canUpdate = hasAnyPermission(['UpdateStorefrontContent']);
    const canManageAnnouncements = hasAnyPermission(['SuperAdmin']);
    const [requestedTab, setTab] = useUrlTab<ContentTab>(CONTENT_TABS, 'pages');
    const tab = requestedTab === 'ANNOUNCEMENTS' && !canManageAnnouncements ? 'PAGES' : requestedTab;
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
            skip: tab !== 'ANNOUNCEMENTS' || !canManageAnnouncements,
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
    const mutationOptions = content.data
        ? { context: channelRequestContext(content.data.activeChannel.token) }
        : {};
    const [createBlock, createBlockState] = useMutation<{
        createStorefrontContentBlock: StorefrontContentBlock;
    }>(CREATE_STOREFRONT_BLOCK_MUTATION, mutationOptions);
    const [updateBlock, updateBlockState] = useMutation<{
        updateStorefrontContentBlock: StorefrontContentBlock;
    }>(UPDATE_STOREFRONT_BLOCK_MUTATION, mutationOptions);
    const [deleteAnnouncement, deleteAnnouncementState] = useMutation<{
        deleteSystemAnnouncement: { result: string; message?: string | null };
    }>(DELETE_SYSTEM_ANNOUNCEMENT_MUTATION);
    const channelId = content.data?.activeChannel.id;
    const channelRef = useRef(channelId);
    const actionLock = useRef(false);
    const [actionPending, setActionPending] = useState(false);
    const consistent = Boolean(
        content.data &&
        (!getActiveChannelToken() || content.data.activeChannel.token === getActiveChannelToken()),
    );
    /* oxlint-disable react/set-state-in-effect -- A store switch invalidates the previous store's drafts and feedback. */
    useLayoutEffect(() => {
        channelRef.current = channelId;
        setEditingBlock(null);
        setEditingAnnouncement(null);
        setDeletingAnnouncement(null);
        setNotice('');
        setActionError('');
    }, [channelId]);
    /* oxlint-enable react/set-state-in-effect */
    const blockPending =
        actionPending ||
        createBlockState.loading ||
        updateBlockState.loading ||
        content.loading ||
        Boolean(content.error) ||
        !consistent;
    const pageBlocks = (consistent ? (content.data?.storefrontContentBlocks ?? []) : []).filter(block =>
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

    const runBlockAction = async (
        operation: (scope: {
            context: ReturnType<typeof channelRequestContext>;
            reread: () => Promise<StorefrontContentResult>;
        }) => Promise<void>,
    ) => {
        const channel = content.data?.activeChannel;
        if (blockPending || actionLock.current || !channel) return;
        const token = getActiveChannelToken();
        const stillCurrent = () => getActiveChannelToken() === token && channelRef.current === channel.id;
        actionLock.current = true;
        setActionPending(true);
        setNotice('');
        setActionError('');
        try {
            await operation({
                context: channelRequestContext(channel.token),
                reread: async () => {
                    if (!stillCurrent()) throw new Error('店铺已切换，请重新读取');
                    const response = await content.refetch();
                    if (!stillCurrent()) throw new Error('店铺已切换，请重新读取');
                    return verifyContentChannel(response.data, channel.id);
                },
            });
        } catch (error) {
            if (stillCurrent()) showError(error);
        } finally {
            actionLock.current = false;
            setActionPending(false);
        }
    };
    const publicationNotice = (block: StorefrontContentBlock) =>
        `《${block.internalName}》已保存并重新读取核对。中文：${contentPublicationLabels[contentPublicationStatus(block, undefined, 'zh_Hans')]}；英文：${contentPublicationLabels[contentPublicationStatus(block, undefined, 'en')]}`;
    const saveBlock = async (block: StorefrontContentBlock) => {
        if (!(block.id ? canUpdate : canCreate)) return;
        await runBlockAction(async scope => {
            const input = storefrontBlockInput(block, editingBlock);
            let saved: StorefrontContentBlock;
            if (block.id) {
                if (!block.updatedAt) throw new Error('缺少内容版本，请刷新后重试');
                const response = await updateBlock({
                    context: scope.context,
                    variables: { input: { id: block.id, expectedUpdatedAt: block.updatedAt, ...input } },
                });
                saved = verifySavedBlock(response.data?.updateStorefrontContentBlock, {
                    id: block.id,
                    ...input,
                });
            } else {
                const response = await createBlock({ context: scope.context, variables: { input } });
                saved = verifySavedBlock(response.data?.createStorefrontContentBlock, input);
            }
            const refreshed = await scope.reread();
            const readback = verifySavedBlock(
                refreshed.storefrontContentBlocks.find(candidate => candidate.id === saved.id),
                { id: saved.id, ...input },
                saved,
            );
            setEditingBlock(null);
            showNotice(publicationNotice(readback));
        });
    };
    const toggleBlock = async (block: StorefrontContentBlock) => {
        if (!block.id || !block.updatedAt || !canUpdate) return;
        await runBlockAction(async scope => {
            const input = { id: block.id!, enabled: !block.enabled };
            const response = await updateBlock({
                context: scope.context,
                variables: { input: { ...input, expectedUpdatedAt: block.updatedAt } },
            });
            verifySavedBlock(response.data?.updateStorefrontContentBlock, input);
            const refreshed = await scope.reread();
            const saved = verifySavedBlock(
                refreshed.storefrontContentBlocks.find(candidate => candidate.id === block.id),
                input,
            );
            showNotice(publicationNotice(saved));
        });
    };

    const confirmDeleteAnnouncement = async () => {
        if (!deletingAnnouncement) return;
        try {
            const response = await deleteAnnouncement({ variables: { id: deletingAnnouncement.id } });
            const deletion = response.data?.deleteSystemAnnouncement;
            if (!deletion || deletion.result !== 'DELETED') {
                throw new Error(deletion?.message || '后端拒绝删除该公告');
            }
            const refreshed = await announcements.refetch();
            if (!refreshed.data) throw new Error('公告重新读取未返回结果');
            if (refreshed.data.systemAnnouncements.some(item => item.id === deletingAnnouncement.id))
                throw new Error('公告删除后仍可读取，请刷新确认');
            showNotice(`已删除公告《${deletingAnnouncement.titleZh}》，已重新读取核对`);
            setDeletingAnnouncement(null);
        } catch (error) {
            showError(error);
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            店铺内容与页面
                            <FeatureHelpButton topic="storefront.content" title="店铺内容与页面" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            法律客服、登录视觉、导航、公告和推广落地页集中管理
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() =>
                            void Promise.all([
                                content.refetch(),
                                tab === 'ANNOUNCEMENTS' && canManageAnnouncements
                                    ? announcements.refetch()
                                    : Promise.resolve(),
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
                <div className="mx-auto flex w-full max-w-[1600px] gap-6 overflow-x-auto text-xs font-bold">
                    <TabButton
                        active={tab === 'PAGES'}
                        onClick={() => setTab('PAGES')}
                        icon={FileText}
                        label="固定内容"
                    />
                    {canManageAnnouncements && (
                        <TabButton
                            active={tab === 'ANNOUNCEMENTS'}
                            onClick={() => setTab('ANNOUNCEMENTS')}
                            icon={Megaphone}
                            label="首页公告"
                        />
                    )}
                    <TabButton
                        active={tab === 'LANDING'}
                        onClick={() => setTab('LANDING')}
                        icon={Code2}
                        label="推广落地页"
                    />
                </div>
            </nav>

            <main className="mx-auto w-full max-w-[1600px] flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                        <ErrorState
                            message={toUserFacingError(content.error, '店铺内容读取失败')}
                            onRetry={() => void content.refetch()}
                        />
                    ) : (
                        <PageBlockList
                            blocks={pageBlocks}
                            allCount={content.data?.storefrontContentBlocks.length ?? 0}
                            pending={blockPending}
                            onEdit={block => {
                                if (!blockPending) setEditingBlock(block);
                            }}
                            onCreate={descriptor =>
                                !blockPending &&
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
                {tab === 'ANNOUNCEMENTS' && !canManageAnnouncements && (
                    <p role="status">当前角色没有首页公告管理权限。</p>
                )}
                {tab === 'ANNOUNCEMENTS' &&
                    canManageAnnouncements &&
                    (announcements.loading && !announcements.data ? (
                        <LoadingState label="正在读取首页公告…" />
                    ) : announcements.error ? (
                        <ErrorState
                            message={toUserFacingError(announcements.error, '首页公告读取失败')}
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
                            message={toUserFacingError(promotion.error, '店铺促销页读取失败')}
                            onRetry={() => void promotion.refetch()}
                        />
                    ) : (
                        promotion.data && (
                            <PromotionPageEditor
                                channel={content.data?.activeChannel}
                                key={`${channelId}-${promotion.data.storefrontPromotionPage.id ?? 'default'}-${promotion.data.storefrontPromotionPage.publishedVersion}-${promotion.data.storefrontPromotionPage.draftSource.length}`}
                                value={promotion.data.storefrontPromotionPage}
                                onNotice={showNotice}
                                onError={showError}
                                onRefresh={async () =>
                                    (await promotion.refetch()).data?.storefrontPromotionPage
                                }
                            />
                        )
                    ))}
            </main>

            {editingBlock && (
                <StorefrontBlockEditor
                    key={editingBlock.id ?? editingBlock.code}
                    value={editingBlock}
                    error={actionError}
                    saving={blockPending}
                    onClose={() => setEditingBlock(null)}
                    onSave={saveBlock}
                />
            )}
            {activeAnnouncementEditor && canManageAnnouncements && (
                <AnnouncementEditor
                    key={`${channelId}-${activeAnnouncementEditor === 'NEW' ? 'new' : activeAnnouncementEditor.id}`}
                    value={activeAnnouncementEditor === 'NEW' ? null : activeAnnouncementEditor}
                    activeChannel={content.data?.activeChannel ?? null}
                    onClose={closeAnnouncementEditor}
                    onSaved={async expected => {
                        if (channelRef.current !== channelId) return;
                        const refreshed = await announcements.refetch();
                        if (channelRef.current !== channelId) return;
                        verifyAnnouncement(
                            refreshed.data?.systemAnnouncements.find(item => item.id === expected.id),
                            expected,
                        );
                        closeAnnouncementEditor();
                        showNotice('中文公告已保存并重新读取核对，英文按翻译设置同步');
                    }}
                    onError={error => {
                        if (channelRef.current === channelId) showError(error);
                    }}
                />
            )}
            {deletingAnnouncement && (
                <ConfirmDialog
                    title="删除首页公告"
                    description={`确认删除《${deletingAnnouncement.titleZh}》？刷新首页后，这条公告将不再显示。`}
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
    const { hasAnyPermission } = useAdminPermissions();
    const canCreate = hasAnyPermission(['CreateStorefrontContent']);
    const canUpdate = hasAnyPermission(['UpdateStorefrontContent']);
    return (
        <div>
            <div className="mb-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    固定内容配置
                    <FeatureHelpButton topic="storefront.fixed-content" title="固定内容配置" />
                </h2>
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
                                    {block
                                        ? contentPublicationLabels[
                                              contentPublicationStatus(block, undefined, 'zh_Hans')
                                          ]
                                        : '待配置'}
                                </span>
                            </div>
                            <h3 className="mt-4 break-words text-sm font-bold text-slate-900">
                                {block?.internalName || descriptor.name}
                            </h3>
                            <p className="mt-1 text-xs leading-5 text-slate-500">{descriptor.description}</p>
                            {copy?.title && (
                                <div className="mt-3 truncate rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                                    前台标题：{copy.title}
                                </div>
                            )}
                            <div className="mt-auto flex gap-2 pt-5">
                                {block ? (
                                    <>
                                        <button
                                            type="button"
                                            disabled={!canUpdate || pending}
                                            onClick={() => onEdit(block)}
                                            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                                        >
                                            <Pencil className="h-3.5 w-3.5" />
                                            编辑内容
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onToggle(block)}
                                            disabled={pending || !canUpdate}
                                            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                                        >
                                            {block.enabled ? '停用' : '启用'}
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={!canCreate || pending}
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
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        首页公告
                        <FeatureHelpButton topic="storefront.announcements" title="首页公告" />
                    </h2>
                    <p className="mt-1 text-[11px] text-slate-400">
                        此处列出全部店铺的系统公告，后台按优先级排序；首页按上线时间（未设置则按创建时间）展示近
                        30 天内的有效公告，与手动公告合计最多 5 条。
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
                                    <span className="rounded bg-violet-50 px-2 py-0.5 text-[9px] font-bold text-violet-700">
                                        {item.targetMode === 'ALL'
                                            ? '全部店铺'
                                            : item.channels.length
                                              ? item.channels
                                                    .map(channel => getChannelDisplayName(channel, 'zh_Hans'))
                                                    .join('、')
                                              : '指定店铺未找到'}
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
                    title="还没有首页公告"
                    detail="新建后须符合上线排期；首页只显示近 30 天内的有效公告。"
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
    activeChannel,
    onClose,
    onSaved,
    onError,
}: {
    value: SystemAnnouncementRecord | null;
    activeChannel: SystemAnnouncementChannel | null;
    onClose: () => void;
    onSaved: (expected: Parameters<typeof verifyAnnouncement>[1]) => Promise<void>;
    onError: (error: unknown) => void;
}) {
    const channels = useQuery<{ channels: { items: SystemAnnouncementChannel[] } }>(
        SYSTEM_ANNOUNCEMENT_CHANNELS_QUERY,
        { fetchPolicy: 'cache-and-network' },
    );
    const [allChannels, setAllChannels] = useState(value?.targetMode === 'ALL');
    const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>(
        () =>
            value?.channels.map(channel => channel.id) ??
            (activeChannel && !isDefaultChannelCode(activeChannel.code) ? [activeChannel.id] : []),
    );
    const availableChannels = Array.from(
        new Map(
            [activeChannel, ...(value?.channels ?? []), ...(channels.data?.channels.items ?? [])]
                .filter((channel): channel is SystemAnnouncementChannel => Boolean(channel))
                .filter(
                    channel =>
                        !isDefaultChannelCode(channel.code) ||
                        value?.channels.some(selected => selected.id === channel.id),
                )
                .map(channel => [channel.id, channel]),
        ).values(),
    );
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
    const [originalEnglish] = useState(() => ({
        titleEn: value?.titleEn ?? '',
        contentEn: value?.contentEn ?? '',
    }));
    const [create, createState] = useMutation<{ createSystemAnnouncement: { id: string } }>(
        CREATE_SYSTEM_ANNOUNCEMENT_MUTATION,
    );
    const [update, updateState] = useMutation<{ updateSystemAnnouncement: { id: string; enabled: boolean } }>(
        UPDATE_SYSTEM_ANNOUNCEMENT_MUTATION,
    );
    const validation =
        (!allChannels && selectedChannelIds.length === 0 ? '请至少选择一个目标店铺' : null) ??
        announcementDraftError(draft);
    const submit = async () => {
        if (verifying || createState.loading || updateState.loading || validation) return;
        const input = {
            targetMode: (allChannels
                ? 'ALL'
                : selectedChannelIds.length === 1
                  ? 'SINGLE'
                  : 'MULTIPLE') as SystemAnnouncementRecord['targetMode'],
            channelIds: allChannels ? [] : selectedChannelIds,
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
        setVerifying(true);
        try {
            let savedId: string | undefined;
            if (value) {
                const response = await update({
                    variables: { input: { id: value.id, ...omitUnchangedEnglish(input, originalEnglish) } },
                });
                if (
                    response.data?.updateSystemAnnouncement.id !== value.id ||
                    response.data.updateSystemAnnouncement.enabled !== input.enabled
                )
                    throw new Error('公告保存未返回对应结果');
                savedId = response.data.updateSystemAnnouncement.id;
            } else {
                const response = await create({ variables: { input } });
                savedId = response.data?.createSystemAnnouncement.id;
            }
            if (!savedId) throw new Error('公告保存未返回对应结果');
            await onSaved({ ...input, id: savedId });
        } catch (error) {
            onError(error);
        } finally {
            setVerifying(false);
        }
    };
    const [verifying, setVerifying] = useState(false);
    const pending = verifying || createState.loading || updateState.loading;
    return (
        <Modal
            title={value ? '编辑首页公告' : '新建首页公告'}
            description="中文是源内容；英文默认自动翻译，需要人工定稿时再锁定"
            onClose={onClose}
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <fieldset className="rounded-lg border border-slate-200 p-3 sm:col-span-2">
                    <legend className="px-1 text-xs font-bold text-slate-700">公告展示范围 *</legend>
                    <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-700">
                        <label className="flex items-center gap-2">
                            <input
                                type="radio"
                                name="announcement-scope"
                                checked={!allChannels}
                                onChange={() => setAllChannels(false)}
                            />
                            指定店铺
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="radio"
                                name="announcement-scope"
                                checked={allChannels}
                                onChange={() => setAllChannels(true)}
                            />
                            全部店铺
                        </label>
                    </div>
                    {!allChannels && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {availableChannels.map(channel => (
                                <label
                                    key={channel.id}
                                    className="flex items-center gap-2 text-xs text-slate-700"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedChannelIds.includes(channel.id)}
                                        onChange={event =>
                                            setSelectedChannelIds(current =>
                                                event.target.checked
                                                    ? [...current, channel.id]
                                                    : current.filter(id => id !== channel.id),
                                            )
                                        }
                                    />
                                    {getChannelDisplayName(channel, 'zh_Hans')}
                                </label>
                            ))}
                        </div>
                    )}
                    {channels.error && !allChannels && (
                        <p className="mt-2 text-xs text-amber-700">
                            店铺列表读取失败，仅能选择当前或已保存的店铺。
                        </p>
                    )}
                    {!value && !allChannels && activeChannel && !isDefaultChannelCode(activeChannel.code) && (
                        <p className="mt-2 text-[11px] text-slate-500">
                            新公告默认只展示在当前店铺：
                            {getChannelDisplayName(activeChannel, 'zh_Hans')}。
                        </p>
                    )}
                    {!value && !allChannels && activeChannel && isDefaultChannelCode(activeChannel.code) && (
                        <p className="mt-2 text-[11px] text-amber-700">
                            当前是平台管理频道，请手动选择经营店铺。
                        </p>
                    )}
                </fieldset>
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
                <div>
                    <Field label="优先级">
                        <input
                            type="number"
                            value={draft.priority}
                            onChange={event => setDraft({ ...draft, priority: event.target.value })}
                            className={inputClass}
                        />
                    </Field>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        首页主要按上线时间排序，调高优先级不能保证置顶。
                    </p>
                </div>
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
    channel,
}: {
    channel?: StorefrontContentResult['activeChannel'];
    value: StorefrontPromotionRecord;
    onNotice: (message: string) => void;
    onError: (error: unknown) => void;
    onRefresh: () => Promise<StorefrontPromotionRecord | undefined>;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canUpdate = hasAnyPermission(['UpdateStorefrontContent']);
    const [contentType, setContentType] = useState(value.contentType);
    const [source, setSource] = useState(value.draftSource);
    const [previewHtml, setPreviewHtml] = useState('');
    const [confirmReset, setConfirmReset] = useState(false);
    const [save, saveState] = useMutation<{ saveStorefrontPromotionDraft: StorefrontPromotionRecord }>(
        SAVE_STOREFRONT_PROMOTION_DRAFT_MUTATION,
    );
    const [preview, previewState] = useMutation<{ previewStorefrontPromotionPage: string }>(
        PREVIEW_STOREFRONT_PROMOTION_PAGE_MUTATION,
    );
    const [publish, publishState] = useMutation<{
        publishStorefrontPromotionPage: StorefrontPromotionRecord;
    }>(PUBLISH_STOREFRONT_PROMOTION_PAGE_MUTATION);
    const [reset, resetState] = useMutation<{ resetStorefrontPromotionPage: StorefrontPromotionRecord }>(
        RESET_STOREFRONT_PROMOTION_PAGE_MUTATION,
    );
    const dirty = contentType !== value.contentType || source !== value.draftSource;
    const [verifying, setVerifying] = useState(false);
    const pending =
        verifying || saveState.loading || previewState.loading || publishState.loading || resetState.loading;
    const run = async (operation: (context: ReturnType<typeof channelRequestContext>) => Promise<void>) => {
        if (!canUpdate || pending || !channel) return;
        const token = getActiveChannelToken();
        if (token && token !== channel.token) return;
        const current = () => getActiveChannelToken() === token;
        setVerifying(true);
        try {
            await operation(channelRequestContext(channel.token));
        } catch (error) {
            if (current()) onError(error);
        } finally {
            setVerifying(false);
        }
    };
    const reread = async (
        expected: StorefrontPromotionRecord | undefined,
        message: string,
        token: string | null,
    ) => {
        if (getActiveChannelToken() !== token) return;
        if (!expected) throw new Error('推广页保存未返回对应结果');
        const refreshed = await onRefresh();
        if (getActiveChannelToken() !== token) return;
        verifyPromotion(refreshed, expected);
        onNotice(`${message}，已重新读取核对`);
    };
    const saveDraft = async () => {
        if (!source.trim()) return onError(new Error('推广页内容不能为空'));
        await run(async context => {
            const token = getActiveChannelToken();
            const response = await save({ context, variables: { input: { contentType, source } } });
            await reread(response.data?.saveStorefrontPromotionDraft, '推广页草稿已保存', token);
        });
    };
    const showPreview = async () => {
        if (!source.trim()) return;
        await run(async context => {
            const token = getActiveChannelToken();
            const result = await preview({ context, variables: { input: { contentType, source } } });
            if (getActiveChannelToken() === token)
                setPreviewHtml(result.data?.previewStorefrontPromotionPage ?? '');
        });
    };
    const publishPage = async () => {
        await run(async context => {
            const token = getActiveChannelToken();
            if (dirty) {
                const saved = await save({ context, variables: { input: { contentType, source } } });
                if (!saved.data?.saveStorefrontPromotionDraft) throw new Error('推广页草稿保存未返回结果');
            }
            if (getActiveChannelToken() !== token) return;
            const response = await publish({ context });
            await reread(response.data?.publishStorefrontPromotionPage, '推广落地页已发布', token);
        });
    };
    const resetPage = async () => {
        await run(async context => {
            const token = getActiveChannelToken();
            const response = await reset({ context });
            await reread(response.data?.resetStorefrontPromotionPage, '推广页已恢复平台默认模板', token);
            if (getActiveChannelToken() === token) setConfirmReset(false);
        });
    };

    return (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.8fr)]">
            <section className="rounded-xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-sm font-bold text-slate-900">推广落地页源码</h2>
                            <FeatureHelpButton topic="storefront.landing-source" title="推广落地页源码" />
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
                            disabled={!canUpdate || pending}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                            恢复默认模板
                        </button>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => void showPreview()}
                                disabled={!canUpdate || pending || !source.trim()}
                                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
                            >
                                <Code2 className="h-3.5 w-3.5" />
                                生成预览
                            </button>
                            <button
                                type="button"
                                onClick={() => void saveDraft()}
                                disabled={!canUpdate || pending || !dirty || !source.trim()}
                                className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-50"
                            >
                                <Save className="h-3.5 w-3.5" />
                                保存草稿
                            </button>
                            <button
                                type="button"
                                onClick={() => void publishPage()}
                                disabled={!canUpdate || pending || !source.trim()}
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
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        安全预览
                        <FeatureHelpButton topic="storefront.safe-preview" title="安全预览" />
                    </h2>
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
            role={success ? 'status' : 'alert'}
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
