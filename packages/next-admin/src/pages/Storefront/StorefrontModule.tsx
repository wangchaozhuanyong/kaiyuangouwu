import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    ArrowDown,
    ArrowUp,
    CheckCircle2,
    Eye,
    EyeOff,
    Image as ImageIcon,
    LayoutGrid,
    LoaderCircle,
    Monitor,
    Pencil,
    Plus,
    RefreshCw,
    Smartphone,
    Trash2,
    X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { channelRequestContext } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    CREATE_STOREFRONT_BLOCK_MUTATION,
    DELETE_STOREFRONT_BLOCK_MUTATION,
    REORDER_STOREFRONT_BLOCKS_MUTATION,
    STOREFRONT_CONTENT_QUERY,
    UPDATE_STOREFRONT_BLOCK_MUTATION,
    UPDATE_STOREFRONT_SETTINGS_MUTATION,
    type StorefrontContentBlock,
    type StorefrontContentResult,
    type StorefrontLanguageCode,
} from '../../graphql/storefront.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { StorefrontBlockEditor } from './StorefrontBlockEditor';
import { StorefrontFloorList } from './StorefrontFloorList';
import { StorefrontVisualPresetPanel } from './StorefrontVisualPresetPanel';
import {
    blockTranslation,
    errorText,
    homepageModuleDescriptors,
    newContentBlock,
    storefrontBlockInput,
} from './storefront-content-utils';
import { contentPublicationLabels, contentPublicationStatus } from './storefront-publication';

import {
    dropHomepageRow,
    homepageOrderIds,
    isHomepageBlock,
    moveCarouselSlide,
    moveHomepageRow,
    storefrontHomepageRows,
} from './storefront-homepage-order';

type Viewport = 'MOBILE' | 'DESKTOP';

export function StorefrontModule() {
    const { hasAnyPermission } = useAdminPermissions();
    const canCreate = hasAnyPermission(['CreateStorefrontContent']);
    const canUpdate = hasAnyPermission(['UpdateStorefrontContent']);
    const canDelete = hasAnyPermission(['DeleteStorefrontContent']);
    const [previewLanguage, setPreviewLanguage] = useState<StorefrontLanguageCode>('zh_Hans');
    const [viewport, setViewport] = useState<Viewport>('MOBILE');
    const [carouselOpen, setCarouselOpen] = useState(false);
    const [actionPending, setActionPending] = useState(false);
    const [editing, setEditing] = useState<StorefrontContentBlock | null>(null);
    const [deleting, setDeleting] = useState<StorefrontContentBlock | null>(null);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const query = useQuery<StorefrontContentResult>(STOREFRONT_CONTENT_QUERY, {
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const mutationOptions = query.data
        ? { context: channelRequestContext(query.data.activeChannel.token) }
        : {};
    const [createBlock, createState] = useMutation(CREATE_STOREFRONT_BLOCK_MUTATION, mutationOptions);
    const [updateBlock, updateState] = useMutation(UPDATE_STOREFRONT_BLOCK_MUTATION, mutationOptions);
    const [reorderBlocks, reorderState] = useMutation(REORDER_STOREFRONT_BLOCKS_MUTATION, mutationOptions);
    const [deleteBlock, deleteState] = useMutation<{
        deleteStorefrontContentBlock: { result: string; message?: string | null };
    }>(DELETE_STOREFRONT_BLOCK_MUTATION, mutationOptions);
    const [updateSettings, settingsState] = useMutation(UPDATE_STOREFRONT_SETTINGS_MUTATION, mutationOptions);
    const allBlocks = query.data?.storefrontContentBlocks ?? [];
    const homepageRows = storefrontHomepageRows(allBlocks);
    const homepageBlocks = homepageRows.flatMap(row => row.blocks);
    const configuredTypes = new Set(homepageBlocks.map(block => block.type));
    const visibleBlocks = allBlocks.filter(
        block =>
            isHomepageBlock(block) && contentPublicationStatus(block, undefined, 'zh_Hans') === 'PUBLISHED',
    );
    const visibleRows = storefrontHomepageRows(visibleBlocks);
    const heroes = homepageBlocks.filter(block => block.type === 'HERO');
    const heroCount = heroes.length;
    const savePending = createState.loading || updateState.loading || actionPending;
    const pending =
        savePending ||
        reorderState.loading ||
        deleteState.loading ||
        settingsState.loading ||
        query.loading ||
        Boolean(query.error);

    const openEditor = (block: StorefrontContentBlock) => {
        if (!(block.id ? canUpdate : canCreate) || query.loading || query.error) return;
        setActionError('');
        setNotice('');
        setEditing(block);
    };
    const addHero = () =>
        openEditor(
            newContentBlock(
                'HERO',
                Math.max(-1, ...allBlocks.map(block => block.position)) + 1,
                `首页轮播图 ${heroCount + 1}`,
            ),
        );

    const showNotice = (message: string) => {
        setNotice(message);
        setActionError('');
    };
    const showError = (error: unknown) => {
        setActionError(errorText(error));
        setNotice('');
    };

    const saveEditor = async (block: StorefrontContentBlock) => {
        if (savePending || !(block.id ? canUpdate : canCreate) || query.loading || query.error) return;
        setActionPending(true);
        setActionError('');
        try {
            if (block.id) {
                if (!block.updatedAt) throw new Error('缺少内容版本，请刷新后重试');
                await updateBlock({
                    variables: {
                        input: {
                            id: block.id,
                            expectedUpdatedAt: block.updatedAt,
                            ...storefrontBlockInput(block, editing),
                        },
                    },
                });
            } else {
                await createBlock({ variables: { input: storefrontBlockInput(block, editing) } });
            }
            setEditing(null);
            showNotice('中文已保存，英文待同步；人工英文保持原设置');
            try {
                const refreshed = await query.refetch();
                if (!block.id && block.type === 'HERO' && canUpdate && refreshed.data) {
                    const blocks = refreshed.data.storefrontContentBlocks;
                    await reorderBlocks({
                        variables: { ids: homepageOrderIds(blocks, storefrontHomepageRows(blocks)) },
                    });
                    await query.refetch();
                }
            } catch (error) {
                setActionError(`内容已保存，但顺序整理或重新读取失败，请刷新检查。${errorText(error)}`);
            }
        } catch (error) {
            showError(error);
        } finally {
            setActionPending(false);
        }
    };

    const toggleBlock = async (block: StorefrontContentBlock) => {
        if (!canUpdate || query.loading || query.error) return;
        if (!block.id || !block.updatedAt) return;
        try {
            await updateBlock({
                variables: {
                    input: { id: block.id, expectedUpdatedAt: block.updatedAt, enabled: !block.enabled },
                },
            });
            showNotice(`《${block.internalName}》已${block.enabled ? '停用' : '启用'}`);
            await query.refetch();
        } catch (error) {
            showError(error);
        }
    };

    const saveOrder = async (ids: string[] | null, message: string) => {
        if (!ids || pending || !canUpdate) return;
        setActionPending(true);
        setNotice('');
        setActionError('');
        try {
            await reorderBlocks({ variables: { ids } });
            showNotice(message);
            await query.refetch();
        } catch (error) {
            showError(error);
        } finally {
            setActionPending(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleting?.id || pending || !canDelete) return;
        try {
            const response = await deleteBlock({ variables: { id: deleting.id } });
            const deletion = response.data?.deleteStorefrontContentBlock;
            if (!deletion || deletion.result !== 'DELETED') {
                throw new Error(deletion?.message || '后端拒绝删除该楼层');
            }
            showNotice(`已删除《${deleting.internalName}》`);
            setDeleting(null);
            await query.refetch();
        } catch (error) {
            showError(error);
        }
    };

    const changeHeroInterval = async (seconds: number) => {
        if (pending || !canUpdate) return;
        if (!Number.isInteger(seconds) || seconds < 3 || seconds > 30) {
            showError('轮播间隔请输入 3–30 的整数秒数');
            return;
        }
        setActionPending(true);
        try {
            await updateSettings({ variables: { input: { heroAutoplayIntervalSeconds: seconds } } });
            showNotice(`轮播间隔已设为 ${seconds} 秒`);
            await query.refetch();
        } catch (error) {
            showError(error);
        } finally {
            setActionPending(false);
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            商城首页装修
                            <FeatureHelpButton topic="storefront.decoration" title="商城首页装修" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            管理当前店铺真实楼层、展示顺序、排期与中英文内容
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => void query.refetch()}
                            disabled={query.loading}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${query.loading ? 'animate-spin' : ''}`} />
                            刷新
                        </button>
                        <button
                            type="button"
                            onClick={() => setCarouselOpen(true)}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                        >
                            <ImageIcon className="h-3.5 w-3.5" />
                            首页轮播图
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto grid w-full max-w-[1600px] flex-1 gap-5 overflow-y-auto p-5 sm:p-8 xl:grid-cols-[minmax(440px,620px)_minmax(0,1fr)]">
                <StorefrontVisualPresetPanel />
                <div className="space-y-4">
                    {notice && !carouselOpen && (
                        <Message kind="success" onClose={() => setNotice('')}>
                            {notice}
                        </Message>
                    )}
                    {actionError && !carouselOpen && !editing && (
                        <Message kind="error" onClose={() => setActionError('')}>
                            {actionError}
                        </Message>
                    )}
                    <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3">
                        <Metric
                            label="已配置楼层"
                            value={`${homepageRows.length} 个`}
                            detail={`${configuredTypes.size} 种类型`}
                        />
                        <Metric
                            label="当前展示"
                            value={`${visibleRows.length} 个`}
                            detail="已按中文内容、排期和图片检查"
                        />
                        <Metric
                            label="当前店铺"
                            value={query.data ? getChannelDisplayName(query.data.activeChannel.code) : '—'}
                            detail={`${heroCount} 张首页轮播图`}
                        />
                    </section>

                    <section aria-label="首页楼层" className="rounded-xl border border-slate-200 bg-white">
                        <div className="flex items-center justify-between border-b border-slate-100 p-4">
                            <div>
                                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                    楼层顺序与状态
                                    <FeatureHelpButton
                                        topic="storefront.floor-order"
                                        title="楼层顺序与状态"
                                    />
                                </h2>
                                <p className="mt-1 text-[11px] text-slate-400">
                                    拖动左侧手柄调整顺序，松开后自动保存；首页轮播整组移动
                                </p>
                            </div>
                        </div>
                        {query.loading && !query.data ? (
                            <LoadingState />
                        ) : query.error ? (
                            <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
                        ) : (
                            <div>
                                <StorefrontFloorList
                                    key={query.data?.activeChannel.id}
                                    rows={homepageRows}
                                    disabled={pending || !canUpdate}
                                    onReorder={(source, target, placement) =>
                                        void saveOrder(
                                            dropHomepageRow(allBlocks, source, target, placement),
                                            '首页楼层顺序已保存',
                                        )
                                    }
                                    renderRow={(row, index, handle) =>
                                        row.key === 'carousel' ? (
                                            <CarouselRow
                                                dragHandle={handle}
                                                blocks={row.blocks}
                                                index={index}
                                                count={homepageRows.length}
                                                pending={pending}
                                                onManage={() => setCarouselOpen(true)}
                                                onMove={direction =>
                                                    void saveOrder(
                                                        moveHomepageRow(allBlocks, row.key, direction),
                                                        '首页轮播位置已更新',
                                                    )
                                                }
                                            />
                                        ) : (
                                            <BlockRow
                                                dragHandle={handle}
                                                block={row.blocks[0]}
                                                index={index}
                                                count={homepageRows.length}
                                                pending={pending}
                                                onEdit={() => openEditor(row.blocks[0])}
                                                onToggle={() => void toggleBlock(row.blocks[0])}
                                                onMove={direction =>
                                                    void saveOrder(
                                                        moveHomepageRow(allBlocks, row.key, direction),
                                                        '首页楼层顺序已更新',
                                                    )
                                                }
                                                onDelete={() => setDeleting(row.blocks[0])}
                                            />
                                        )
                                    }
                                />
                                {!homepageBlocks.length && (
                                    <div className="p-10 text-center">
                                        <LayoutGrid className="mx-auto h-8 w-8 text-slate-300" />
                                        <h3 className="mt-3 text-sm font-bold text-slate-800">
                                            还没有首页楼层
                                        </h3>
                                        <p className="mt-1 text-xs text-slate-400">
                                            从下方模块清单开始配置。
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>

                    <section className="rounded-xl border border-slate-200 bg-white p-4">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            可用首页模块
                            <FeatureHelpButton topic="storefront.available-blocks" title="可用首页模块" />
                        </h2>
                        <p className="mt-1 text-[11px] text-slate-400">未配置的模块不会在客户端显示</p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {homepageModuleDescriptors
                                .filter(descriptor => descriptor.type !== 'HERO')
                                .map(descriptor => {
                                    const existing = homepageBlocks.find(
                                        block => block.type === descriptor.type,
                                    );
                                    return (
                                        <button
                                            key={descriptor.type}
                                            type="button"
                                            disabled={pending || !(existing ? canUpdate : canCreate)}
                                            onClick={() =>
                                                openEditor(
                                                    existing ??
                                                        newContentBlock(
                                                            descriptor.type,
                                                            allBlocks.length,
                                                            descriptor.name,
                                                        ),
                                                )
                                            }
                                            className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50/40"
                                        >
                                            <span className="min-w-0">
                                                <strong className="block text-xs text-slate-800">
                                                    {descriptor.name}
                                                </strong>
                                                <small className="mt-1 block text-[10px] leading-4 text-slate-400">
                                                    {descriptor.description}
                                                </small>
                                            </span>
                                            <span
                                                className={`shrink-0 rounded px-2 py-1 text-[10px] font-bold ${existing ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                                            >
                                                {existing ? '已配置' : '配置'}
                                            </span>
                                        </button>
                                    );
                                })}
                        </div>
                    </section>
                </div>

                <section className="min-h-[680px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 xl:sticky xl:top-0 xl:self-start">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                        <div>
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                结构预览
                                <FeatureHelpButton topic="storefront.structure-preview" title="结构预览" />
                            </h2>
                            <p className="mt-1 text-[10px] text-slate-400">
                                按已保存的发布状态、顺序和语言预览；商品数据和精确样式以客户端为准
                            </p>
                        </div>
                        <div className="flex flex-wrap rounded-lg bg-slate-100 p-1 text-[11px] font-bold">
                            <select
                                aria-label="预览语言"
                                value={previewLanguage}
                                onChange={event =>
                                    setPreviewLanguage(event.target.value as StorefrontLanguageCode)
                                }
                                className="rounded-md bg-white px-2 text-slate-700"
                            >
                                <option value="zh_Hans">中文</option>
                                <option value="en">English</option>
                            </select>
                            <button
                                type="button"
                                onClick={() => setViewport('MOBILE')}
                                className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 ${viewport === 'MOBILE' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-500'}`}
                            >
                                <Smartphone className="h-3.5 w-3.5" />
                                手机
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewport('DESKTOP')}
                                className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 ${viewport === 'DESKTOP' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-500'}`}
                            >
                                <Monitor className="h-3.5 w-3.5" />
                                电脑
                            </button>
                        </div>
                    </div>
                    <StorefrontPreview
                        blocks={visibleBlocks}
                        viewport={viewport}
                        language={previewLanguage}
                    />
                </section>
            </main>

            {carouselOpen && (
                <CarouselManager
                    blocks={heroes}
                    interval={query.data?.storefrontContentSettings.heroAutoplayIntervalSeconds}
                    pending={pending}
                    loading={query.loading && !query.data}
                    error={query.error?.message}
                    notice={notice}
                    actionError={actionError}
                    covered={Boolean(editing || deleting)}
                    onClose={() => {
                        if (!pending) setCarouselOpen(false);
                    }}
                    onRetry={() => void query.refetch()}
                    onAdd={addHero}
                    onEdit={openEditor}
                    onToggle={block => void toggleBlock(block)}
                    onDelete={block => {
                        setActionError('');
                        setDeleting(block);
                    }}
                    onMove={(block, direction) =>
                        void saveOrder(
                            moveCarouselSlide(allBlocks, block.id!, direction),
                            '轮播图播放顺序已更新',
                        )
                    }
                    onIntervalSave={changeHeroInterval}
                />
            )}
            {editing && (
                <StorefrontBlockEditor
                    key={editing.id ?? editing.code}
                    value={editing}
                    saving={savePending}
                    error={actionError}
                    onClose={() => {
                        setEditing(null);
                        setActionError('');
                    }}
                    onSave={saveEditor}
                />
            )}
            {deleting && (
                <ConfirmDialog
                    title={deleting.type === 'HERO' ? '删除轮播图' : '删除首页楼层'}
                    description={`确认删除《${deleting.internalName}》？删除后客户端将立即移除${deleting.type === 'HERO' ? '这张轮播图' : '该楼层'}。`}
                    error={actionError}
                    pending={deleteState.loading}
                    onClose={() => setDeleting(null)}
                    onConfirm={() => void confirmDelete()}
                />
            )}
        </div>
    );
}

function CarouselRow({
    blocks,
    index,
    count,
    pending,
    onManage,
    onMove,
    dragHandle,
}: {
    blocks: StorefrontContentBlock[];
    index: number;
    count: number;
    pending: boolean;
    onManage: () => void;
    onMove: (direction: -1 | 1) => void;
    dragHandle?: ReactNode;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canUpdate = hasAnyPermission(['UpdateStorefrontContent']);
    const visible = blocks.filter(
        block => contentPublicationStatus(block, undefined, 'zh_Hans') === 'PUBLISHED',
    ).length;
    return (
        <article aria-label="首页轮播" className="flex flex-wrap items-center gap-3 p-4 hover:bg-slate-50">
            {dragHandle}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <ImageIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
                <h3 className="text-xs font-bold text-slate-900">
                    首页轮播 <FeatureHelpButton topic="storefront.carousel" title="首页轮播" />
                </h3>
                <p className="mt-1 text-[10px] text-slate-500">
                    {blocks.length} 张轮播图 · {visible} 张展示中
                </p>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
                <ActionIcon
                    label="上移首页轮播"
                    disabled={pending || !canUpdate || index === 0}
                    onClick={() => onMove(-1)}
                    icon={ArrowUp}
                />
                <ActionIcon
                    label="下移首页轮播"
                    disabled={pending || !canUpdate || index === count - 1}
                    onClick={() => onMove(1)}
                    icon={ArrowDown}
                />
                <button
                    type="button"
                    onClick={onManage}
                    className="ml-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
                >
                    管理轮播图
                </button>
            </div>
        </article>
    );
}

function CarouselManager({
    blocks,
    interval,
    pending,
    loading,
    error,
    notice,
    actionError,
    covered,
    onClose,
    onRetry,
    onAdd,
    onEdit,
    onToggle,
    onDelete,
    onMove,
    onIntervalSave,
}: {
    blocks: StorefrontContentBlock[];
    interval?: number;
    pending: boolean;
    loading: boolean;
    error?: string;
    notice: string;
    actionError: string;
    covered: boolean;
    onClose: () => void;
    onRetry: () => void;
    onAdd: () => void;
    onEdit: (block: StorefrontContentBlock) => void;
    onToggle: (block: StorefrontContentBlock) => void;
    onDelete: (block: StorefrontContentBlock) => void;
    onMove: (block: StorefrontContentBlock, direction: -1 | 1) => void;
    onIntervalSave: (seconds: number) => Promise<void>;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canCreate = hasAnyPermission(['CreateStorefrontContent']);
    const canUpdate = hasAnyPermission(['UpdateStorefrontContent']);
    const disabled = pending || Boolean(error) || interval === undefined;
    return (
        <AccessibleDialogSurface
            accessibleName="首页轮播图"
            onRequestClose={onClose}
            inert={covered}
            className="fixed inset-0 z-40 flex justify-end bg-slate-950/45"
        >
            <div className="flex h-full w-full max-w-3xl flex-col bg-slate-50 shadow-2xl">
                <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
                    <div>
                        <h2 className="text-base font-bold text-slate-900">
                            首页轮播图 <FeatureHelpButton topic="storefront.carousel" title="首页轮播图" />
                        </h2>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                            统一管理图片、文案、跳转链接、播放顺序和轮播间隔。
                        </p>
                    </div>
                    <button
                        type="button"
                        aria-label="关闭轮播图管理"
                        disabled={pending}
                        onClick={onClose}
                        className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </header>
                <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-7">
                    {notice && (
                        <p
                            role="status"
                            className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800"
                        >
                            {notice}
                        </p>
                    )}
                    {actionError && (
                        <p
                            role="alert"
                            className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800"
                        >
                            {actionError}
                        </p>
                    )}
                    {loading ? (
                        <LoadingState />
                    ) : error ? (
                        <ErrorState message={error} onRetry={onRetry} />
                    ) : (
                        <>
                            {interval !== undefined && (
                                <CarouselInterval
                                    key={interval}
                                    value={interval}
                                    pending={disabled || !canUpdate}
                                    onSave={onIntervalSave}
                                />
                            )}
                            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                                    <div>
                                        <h3 className="text-sm font-bold text-slate-900">
                                            轮播图片 · {blocks.length} 张{' '}
                                            <FeatureHelpButton topic="storefront.carousel" title="轮播图片" />
                                        </h3>
                                        <p className="mt-1 text-[11px] leading-5 text-slate-500">
                                            按从上到下的顺序播放；编辑可设置图片、文案、链接和排期。
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        disabled={disabled || !canCreate}
                                        onClick={onAdd}
                                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        新增轮播图
                                    </button>
                                </div>
                                <div className="divide-y divide-slate-100">
                                    {blocks.map((block, index) => (
                                        <BlockRow
                                            key={block.id ?? block.code}
                                            block={block}
                                            index={index}
                                            count={blocks.length}
                                            pending={disabled}
                                            onEdit={() => onEdit(block)}
                                            onToggle={() => onToggle(block)}
                                            onDelete={() => onDelete(block)}
                                            onMove={direction => onMove(block, direction)}
                                        />
                                    ))}
                                    {!blocks.length && (
                                        <div className="p-10 text-center">
                                            <ImageIcon className="mx-auto h-8 w-8 text-slate-300" />
                                            <h3 className="mt-3 text-sm font-bold text-slate-800">
                                                还没有轮播图
                                            </h3>
                                            <p className="mt-1 text-xs text-slate-500">
                                                点击“新增轮播图”开始配置。
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </section>
                            <p className="text-xs leading-5 text-slate-500">
                                整组轮播在首页的位置，请回到“楼层顺序与状态”调整。
                            </p>
                        </>
                    )}
                </div>
            </div>
        </AccessibleDialogSurface>
    );
}

function CarouselInterval({
    value,
    pending,
    onSave,
}: {
    value: number;
    pending: boolean;
    onSave: (seconds: number) => Promise<void>;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canUpdate = hasAnyPermission(['UpdateStorefrontContent']);
    const [draft, setDraft] = useState(String(value));
    return (
        <form
            className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
            onSubmit={event => {
                event.preventDefault();
                void onSave(Number(draft));
            }}
        >
            <label className="flex-1 text-xs font-bold text-slate-700">
                轮播间隔（秒）
                <input
                    type="number"
                    required
                    min={3}
                    max={30}
                    step={1}
                    value={draft}
                    disabled={!canUpdate || pending}
                    onChange={event => setDraft(event.target.value)}
                    className="mt-2 block w-full min-w-24 rounded-lg border border-slate-300 px-3 py-2 font-mono disabled:opacity-50"
                />
            </label>
            <button
                type="submit"
                disabled={!canUpdate || pending || draft === String(value)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
                保存间隔
            </button>
            <p className="w-full text-[11px] text-slate-500">所有轮播图共用，支持 3–30 秒。</p>
        </form>
    );
}

function CarouselPreview({
    blocks,
    desktop,
    language,
}: {
    blocks: StorefrontContentBlock[];
    desktop: boolean;
    language: StorefrontLanguageCode;
}) {
    const [selected, setSelected] = useState<string | null>(null);
    const active = blocks.find(block => (block.id ?? block.code) === selected) ?? blocks[0];
    return (
        <section aria-label="首页轮播预览" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <span className="text-[11px] font-bold text-slate-700">首页轮播 · {blocks.length} 张</span>
                <div className="flex flex-wrap gap-1">
                    {blocks.map((block, index) => (
                        <button
                            key={block.id ?? block.code}
                            type="button"
                            aria-label={`预览第 ${index + 1} 张轮播图`}
                            aria-pressed={block === active}
                            onClick={() => setSelected(block.id ?? block.code)}
                            className={`min-h-7 min-w-7 rounded-md px-2 text-[10px] font-bold ${block === active ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}
                        >
                            {index + 1}
                        </button>
                    ))}
                </div>
            </div>
            <PreviewBlock block={active} desktop={desktop} language={language} />
        </section>
    );
}

function BlockRow({
    block,
    index,
    count,
    pending,
    onEdit,
    onToggle,
    onMove,
    onDelete,
    dragHandle,
}: {
    block: StorefrontContentBlock;
    index: number;
    count: number;
    pending: boolean;
    onEdit: () => void;
    onToggle: () => void;
    onMove: (direction: -1 | 1) => void;
    onDelete: () => void;
    dragHandle?: ReactNode;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canUpdate = hasAnyPermission(['UpdateStorefrontContent']);
    const canDelete = hasAnyPermission(['DeleteStorefrontContent']);
    const translation = blockTranslation(block, 'zh_Hans');
    const status = contentPublicationStatus(block, undefined, 'zh_Hans');
    const scheduled = status !== 'PUBLISHED' && block.enabled;
    return (
        <article
            aria-label={block.internalName || block.code}
            className="flex flex-wrap items-center gap-3 p-4 hover:bg-slate-50"
        >
            {dragHandle}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                {block.imageAsset?.preview || block.imageUrl ? (
                    <img
                        src={block.imageAsset?.preview ?? block.imageUrl ?? ''}
                        alt=""
                        className="h-full w-full rounded-lg object-cover"
                    />
                ) : (
                    <ImageIcon className="h-4 w-4" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <h3
                        title={block.internalName || block.code}
                        className="truncate text-xs font-bold text-slate-900"
                    >
                        {block.internalName || block.code}
                    </h3>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">
                        {block.type}
                    </span>
                    <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${block.enabled ? (scheduled ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700') : 'bg-slate-100 text-slate-400'}`}
                    >
                        {contentPublicationLabels[status]}
                    </span>
                </div>
                <p className="mt-1 truncate text-[10px] text-slate-400">
                    前台标题：{translation.title || '未填写'} · {block.items.length} 个子项
                </p>
            </div>
            <div className="ml-auto flex shrink-0 gap-0.5">
                <ActionIcon
                    label="上移"
                    disabled={pending || !canUpdate || index === 0}
                    onClick={() => onMove(-1)}
                    icon={ArrowUp}
                />
                <ActionIcon
                    label="下移"
                    disabled={pending || !canUpdate || index === count - 1}
                    onClick={() => onMove(1)}
                    icon={ArrowDown}
                />
                <ActionIcon
                    label={block.enabled ? '停用' : '启用'}
                    disabled={pending || !canUpdate}
                    onClick={onToggle}
                    icon={block.enabled ? EyeOff : Eye}
                />
                <ActionIcon label="编辑" disabled={pending || !canUpdate} onClick={onEdit} icon={Pencil} />
                <ActionIcon
                    label="删除"
                    disabled={pending || !canDelete}
                    onClick={onDelete}
                    icon={Trash2}
                    danger
                />
            </div>
        </article>
    );
}

function StorefrontPreview({
    blocks,
    viewport,
    language,
}: {
    blocks: StorefrontContentBlock[];
    viewport: Viewport;
    language: StorefrontLanguageCode;
}) {
    return (
        <div className="flex min-h-[620px] justify-center overflow-y-auto p-5 sm:p-8">
            <div
                className={`overflow-hidden bg-white shadow-xl transition-all ${viewport === 'MOBILE' ? 'w-[375px] rounded-[2rem] border-[8px] border-slate-800' : 'w-full max-w-5xl rounded-xl border border-slate-300'}`}
            >
                <div
                    className={`${viewport === 'MOBILE' ? 'h-9' : 'h-12'} flex items-center justify-center border-b border-slate-100 text-xs font-bold text-slate-800`}
                >
                    {viewport === 'MOBILE' ? '当前店铺' : '商城首页楼层结构'}
                </div>
                <div className="space-y-2 bg-slate-50 p-2">
                    {storefrontHomepageRows(blocks).map(row =>
                        row.key === 'carousel' ? (
                            <CarouselPreview
                                key={row.key}
                                blocks={row.blocks}
                                desktop={viewport === 'DESKTOP'}
                                language={language}
                            />
                        ) : (
                            <PreviewBlock
                                key={row.key}
                                block={row.blocks[0]}
                                desktop={viewport === 'DESKTOP'}
                                language={language}
                            />
                        ),
                    )}
                    {!blocks.length && (
                        <div className="flex min-h-96 flex-col items-center justify-center text-center">
                            <LayoutGrid className="h-8 w-8 text-slate-300" />
                            <h3 className="mt-3 text-sm font-bold text-slate-700">暂无可展示楼层</h3>
                            <p className="mt-1 max-w-xs text-xs leading-5 text-slate-400">
                                启用并完成楼层配置后，预览将按真实顺序展示。
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function PreviewBlock({
    block,
    desktop,
    language,
}: {
    block: StorefrontContentBlock;
    desktop: boolean;
    language: StorefrontLanguageCode;
}) {
    const copy = blockTranslation(block, language);
    const image = block.imageAsset?.preview ?? block.imageUrl;
    const productAutomation = ['COUPONS', 'FLASH_SALE', 'BEST_SELLERS', 'RECOMMENDATIONS'].includes(
        block.type,
    );
    return (
        <article
            className={`overflow-hidden rounded-xl border border-slate-200 bg-white ${desktop ? 'p-5' : 'p-3'}`}
        >
            <div
                className={`flex gap-4 ${desktop && ['HERO', 'CATEGORY_AD', 'STORY'].includes(block.type) ? 'items-center' : 'flex-col'}`}
            >
                {image && (
                    <img
                        src={image}
                        alt={copy.title}
                        className={`${desktop ? 'max-h-64 min-w-0 flex-1' : 'max-h-44 w-full'} rounded-lg object-cover`}
                    />
                )}
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[9px] text-blue-700">
                            {block.type}
                        </span>
                        {productAutomation && (
                            <span className="text-[9px] text-slate-400">内容由真实业务数据自动生成</span>
                        )}
                    </div>
                    <h3 className={`${desktop ? 'mt-3 text-xl' : 'mt-2 text-sm'} font-bold text-slate-900`}>
                        {copy.title}
                    </h3>
                    {copy.subtitle && <p className="mt-1 text-xs text-slate-500">{copy.subtitle}</p>}
                    {copy.body && (
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[11px] leading-5 text-slate-600">
                            {copy.body}
                        </p>
                    )}
                    {block.items.length > 0 && (
                        <div className={`mt-3 grid gap-2 ${desktop ? 'grid-cols-4' : 'grid-cols-2'}`}>
                            {block.items
                                .filter(item => item.enabled)
                                .map((item, index) => (
                                    <div key={item.id ?? index} className="rounded-lg bg-slate-50 p-2">
                                        <div className="truncate text-[10px] font-bold text-slate-700">
                                            {item.translations.find(value => value.languageCode === language)
                                                ?.label ?? ''}
                                        </div>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>
            </div>
        </article>
    );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
    return (
        <div className="border-b border-slate-100 p-4 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <div className="text-[10px] font-bold text-slate-400">{label}</div>
            <div className="mt-1 font-mono text-lg font-bold text-slate-900">{value}</div>
            <div className="mt-1 text-[10px] text-slate-400">{detail}</div>
        </div>
    );
}
function LoadingState() {
    return (
        <div className="flex min-h-64 items-center justify-center gap-2 text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在读取真实楼层…
        </div>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center">
            <AlertCircle className="h-7 w-7 text-rose-500" />
            <h3 className="mt-3 text-sm font-bold text-slate-800">楼层加载失败</h3>
            <p className="mt-1 max-w-md text-xs text-rose-600">{toUserFacingError(message)}</p>
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
function ActionIcon({
    label,
    disabled,
    onClick,
    icon: Icon,
    danger = false,
}: {
    label: string;
    disabled: boolean;
    onClick: () => void;
    icon: typeof ArrowUp;
    danger?: boolean;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const canAct = hasAnyPermission([danger ? 'DeleteStorefrontContent' : 'UpdateStorefrontContent']);
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled || !canAct}
            onClick={onClick}
            className={`rounded-md p-1.5 disabled:opacity-30 ${danger ? 'text-rose-500 hover:bg-rose-50' : 'text-slate-500 hover:bg-slate-100'}`}
        >
            <Icon className="h-3.5 w-3.5" />
        </button>
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
            {success ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
            )}
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
    error,
    onClose,
    onConfirm,
}: {
    title: string;
    description: string;
    pending: boolean;
    error?: string;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4">
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={() => {
                    if (!pending) onClose();
                }}
                role="alertdialog"
                className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
            >
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                    <Trash2 className="h-5 w-5" />
                </div>
                <h2 className="mt-4 font-bold text-slate-900">{title}</h2>
                <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
                {error && (
                    <p role="alert" className="mt-3 text-xs text-rose-600">
                        {error}
                    </p>
                )}
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
                        {pending ? '正在删除…' : '确认删除'}
                    </button>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}
