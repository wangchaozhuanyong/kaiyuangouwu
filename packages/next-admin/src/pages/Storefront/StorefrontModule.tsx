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
import { useMemo, useState } from 'react';
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
} from '../../graphql/storefront.graphql';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { StorefrontBlockEditor } from './StorefrontBlockEditor';
import {
    blockTranslation,
    errorText,
    homepageModuleDescriptors,
    newContentBlock,
    storefrontBlockInput,
} from './storefront-content-utils';

type Viewport = 'MOBILE' | 'DESKTOP';

export function StorefrontModule() {
    const [viewport, setViewport] = useState<Viewport>('MOBILE');
    const [editing, setEditing] = useState<StorefrontContentBlock | null>(null);
    const [deleting, setDeleting] = useState<StorefrontContentBlock | null>(null);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const query = useQuery<StorefrontContentResult>(STOREFRONT_CONTENT_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    const [createBlock, createState] = useMutation(CREATE_STOREFRONT_BLOCK_MUTATION);
    const [updateBlock, updateState] = useMutation(UPDATE_STOREFRONT_BLOCK_MUTATION);
    const [reorderBlocks, reorderState] = useMutation(REORDER_STOREFRONT_BLOCKS_MUTATION);
    const [deleteBlock, deleteState] = useMutation<{
        deleteStorefrontContentBlock: { result: string; message?: string | null };
    }>(DELETE_STOREFRONT_BLOCK_MUTATION);
    const [updateSettings] = useMutation(UPDATE_STOREFRONT_SETTINGS_MUTATION);
    const allBlocks = query.data?.storefrontContentBlocks ?? [];
    const homepageTypes = useMemo(() => new Set(homepageModuleDescriptors.map(item => item.type)), []);
    const homepageBlocks = allBlocks.filter(
        block => homepageTypes.has(block.type) || block.type === 'CUSTOM',
    );
    const configuredTypes = new Set(homepageBlocks.map(block => block.type));
    const visibleBlocks = homepageBlocks.filter(block => block.enabled && isCurrentlyVisible(block));
    const heroCount = homepageBlocks.filter(block => block.type === 'HERO').length;
    const savePending = createState.loading || updateState.loading;

    const showNotice = (message: string) => {
        setNotice(message);
        setActionError('');
    };
    const showError = (error: unknown) => {
        setActionError(errorText(error));
        setNotice('');
    };

    const saveEditor = async (block: StorefrontContentBlock) => {
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
            setEditing(null);
            showNotice(block.id ? '楼层内容已保存并同步到前台' : '新楼层已创建');
            await query.refetch();
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
            await query.refetch();
        } catch (error) {
            showError(error);
        }
    };

    const moveBlock = async (block: StorefrontContentBlock, direction: -1 | 1) => {
        if (!block.id) return;
        const index = homepageBlocks.findIndex(item => item.id === block.id);
        const target = homepageBlocks[index + direction];
        if (!target?.id) return;
        const ids = allBlocks.flatMap(item => (item.id ? [item.id] : []));
        const from = ids.indexOf(block.id);
        const to = ids.indexOf(target.id);
        if (from < 0 || to < 0) return;
        const next = [...ids];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        try {
            await reorderBlocks({ variables: { ids: next } });
            showNotice('首页楼层顺序已更新');
            await query.refetch();
        } catch (error) {
            showError(error);
        }
    };

    const confirmDelete = async () => {
        if (!deleting?.id) return;
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

    const changeHeroInterval = async (value: number) => {
        const seconds = Math.max(3, Math.min(30, Math.round(value)));
        try {
            await updateSettings({ variables: { input: { heroAutoplayIntervalSeconds: seconds } } });
            showNotice(`轮播间隔已设为 ${seconds} 秒`);
            await query.refetch();
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
                            onClick={() =>
                                setEditing(
                                    newContentBlock('HERO', allBlocks.length, `首页轮播图 ${heroCount + 1}`),
                                )
                            }
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            新增轮播图
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto grid w-full max-w-[1600px] flex-1 gap-5 overflow-y-auto p-5 sm:p-8 xl:grid-cols-[minmax(440px,620px)_minmax(0,1fr)]">
                <div className="space-y-4">
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
                    <section className="grid overflow-hidden rounded-xl border border-slate-200 bg-white sm:grid-cols-3">
                        <Metric
                            label="已配置楼层"
                            value={`${homepageBlocks.length} 个`}
                            detail={`${configuredTypes.size} 种类型`}
                        />
                        <Metric
                            label="当前展示"
                            value={`${visibleBlocks.length} 个`}
                            detail="已排除停用和过期内容"
                        />
                        <Metric
                            label="当前店铺"
                            value={query.data ? getChannelDisplayName(query.data.activeChannel.code) : '—'}
                            detail={`${heroCount} 张首页轮播图`}
                        />
                    </section>

                    <section className="rounded-xl border border-slate-200 bg-white">
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
                                    上下移动会立即更新客户端顺序
                                </p>
                            </div>
                            {query.data && (
                                <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
                                    轮播间隔
                                    <input
                                        type="number"
                                        min={3}
                                        max={30}
                                        defaultValue={
                                            query.data.storefrontContentSettings.heroAutoplayIntervalSeconds
                                        }
                                        onBlur={event => {
                                            const next = Number(event.target.value);
                                            if (
                                                next !==
                                                query.data?.storefrontContentSettings
                                                    .heroAutoplayIntervalSeconds
                                            )
                                                void changeHeroInterval(next);
                                        }}
                                        className="w-16 rounded-md border border-slate-300 px-2 py-1.5 font-mono"
                                    />
                                    秒
                                </label>
                            )}
                        </div>
                        {query.loading && !query.data ? (
                            <LoadingState />
                        ) : query.error ? (
                            <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {homepageBlocks.map((block, index) => (
                                    <BlockRow
                                        key={block.id ?? block.code}
                                        block={block}
                                        index={index}
                                        count={homepageBlocks.length}
                                        pending={updateState.loading || reorderState.loading}
                                        onEdit={() => setEditing(block)}
                                        onToggle={() => void toggleBlock(block)}
                                        onMove={direction => void moveBlock(block, direction)}
                                        onDelete={() => setDeleting(block)}
                                    />
                                ))}
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
                                            onClick={() =>
                                                setEditing(
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
                                显示真实楼层内容，不会伪造商品与价格
                            </p>
                        </div>
                        <div className="flex rounded-lg bg-slate-100 p-1 text-[11px] font-bold">
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
                    <StorefrontPreview blocks={visibleBlocks} viewport={viewport} />
                </section>
            </main>

            {editing && (
                <StorefrontBlockEditor
                    key={editing.id ?? editing.code}
                    value={editing}
                    saving={savePending}
                    onClose={() => setEditing(null)}
                    onSave={saveEditor}
                />
            )}
            {deleting && (
                <ConfirmDialog
                    title="删除首页楼层"
                    description={`确认删除《${deleting.internalName}》？删除后客户端将立即移除该楼层。`}
                    pending={deleteState.loading}
                    onClose={() => setDeleting(null)}
                    onConfirm={() => void confirmDelete()}
                />
            )}
        </div>
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
}: {
    block: StorefrontContentBlock;
    index: number;
    count: number;
    pending: boolean;
    onEdit: () => void;
    onToggle: () => void;
    onMove: (direction: -1 | 1) => void;
    onDelete: () => void;
}) {
    const translation = blockTranslation(block, 'zh_Hans');
    const scheduled = !isCurrentlyVisible(block) && block.enabled;
    return (
        <article className="flex items-center gap-3 p-4 hover:bg-slate-50">
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
                    <h3 className="truncate text-xs font-bold text-slate-900">
                        {translation.title || block.internalName}
                    </h3>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[9px] text-slate-500">
                        {block.type}
                    </span>
                    <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${block.enabled ? (scheduled ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700') : 'bg-slate-100 text-slate-400'}`}
                    >
                        {block.enabled ? (scheduled ? '排期中' : '展示中') : '已停用'}
                    </span>
                </div>
                <p className="mt-1 truncate text-[10px] text-slate-400">
                    {block.internalName} · {block.items.length} 个子项
                </p>
            </div>
            <div className="flex shrink-0 gap-0.5">
                <ActionIcon
                    label="上移"
                    disabled={pending || index === 0}
                    onClick={() => onMove(-1)}
                    icon={ArrowUp}
                />
                <ActionIcon
                    label="下移"
                    disabled={pending || index === count - 1}
                    onClick={() => onMove(1)}
                    icon={ArrowDown}
                />
                <ActionIcon
                    label={block.enabled ? '停用' : '启用'}
                    disabled={pending}
                    onClick={onToggle}
                    icon={block.enabled ? EyeOff : Eye}
                />
                <ActionIcon label="编辑" disabled={pending} onClick={onEdit} icon={Pencil} />
                <ActionIcon label="删除" disabled={pending} onClick={onDelete} icon={Trash2} danger />
            </div>
        </article>
    );
}

function StorefrontPreview({ blocks, viewport }: { blocks: StorefrontContentBlock[]; viewport: Viewport }) {
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
                    {blocks.map(block => (
                        <PreviewBlock
                            key={block.id ?? block.code}
                            block={block}
                            desktop={viewport === 'DESKTOP'}
                        />
                    ))}
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

function PreviewBlock({ block, desktop }: { block: StorefrontContentBlock; desktop: boolean }) {
    const copy = blockTranslation(block, 'zh_Hans');
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
                        alt={copy.title || block.internalName}
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
                        {copy.title || block.internalName}
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
                                .slice(0, desktop ? 8 : 4)
                                .map((item, index) => (
                                    <div key={item.id ?? index} className="rounded-lg bg-slate-50 p-2">
                                        <div className="truncate text-[10px] font-bold text-slate-700">
                                            {item.translations.find(value => value.languageCode === 'zh_Hans')
                                                ?.label || `子项 ${index + 1}`}
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

function isCurrentlyVisible(block: StorefrontContentBlock) {
    const now = Date.now();
    const start = block.startsAt ? new Date(block.startsAt).getTime() : null;
    const end = block.endsAt ? new Date(block.endsAt).getTime() : null;
    return (!start || start <= now) && (!end || end > now);
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
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled}
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
                        {pending ? '正在删除…' : '确认删除'}
                    </button>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}
