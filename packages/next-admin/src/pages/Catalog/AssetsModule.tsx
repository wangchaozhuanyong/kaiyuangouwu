import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    AlertTriangle,
    Check,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Copy,
    File,
    FileEdit,
    Image as ImageIcon,
    RefreshCw,
    Search,
    Trash2,
    UploadCloud,
    Video,
    X,
} from 'lucide-react';
import { useDeferredValue, useRef, useState } from 'react';
import { sensitiveActionContext, uploadAdminFiles } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { CREATE_ASSETS_MULTIPART, DELETE_ASSET, UPDATE_ASSET } from '../../graphql/catalog-admin.graphql';
import { GET_ASSETS } from '../../graphql/catalog.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';

interface AssetItem {
    id: string;
    name: string;
    type: 'IMAGE' | 'VIDEO' | 'BINARY';
    fileSize: number;
    mimeType: string;
    width?: number | null;
    height?: number | null;
    preview: string;
    source: string;
    tags: Array<{ id: string; value: string }>;
}

interface PendingFile {
    id: string;
    file: globalThis.File;
    previewUrl: string;
    status: 'READY' | 'UPLOADING' | 'SUCCESS' | 'FAILED';
    errorMsg?: string;
}

interface GetAssetsData {
    assets: { items: AssetItem[]; totalItems: number };
}

interface CreateAssetResult extends Partial<AssetItem> {
    __typename: 'Asset' | 'MimeTypeError';
    message?: string;
}

interface CreateAssetsData {
    createAssets: CreateAssetResult[];
}

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const PAGE_SIZE = 40;
const SUPPORTED_FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4']);

const formatFileSize = (size: number) => {
    if (size >= 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.max(1, Math.round(size / 1024)) + ' KB';
};

const cleanupPreview = (file: PendingFile) => {
    if (file.previewUrl.startsWith('blob:')) URL.revokeObjectURL(file.previewUrl);
};

export function AssetsModule() {
    const requestConfirmation = useConfirmDialog();
    const [selectedAsset, setSelectedAsset] = useState<AssetItem | null>(null);
    const [activeTypeFilter, setActiveTypeFilter] = useState<'ALL' | 'IMAGE' | 'VIDEO'>('ALL');
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(0);
    const [notification, setNotification] = useState('');
    const [actionError, setActionError] = useState('');
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [editName, setEditName] = useState('');
    const [editTags, setEditTags] = useState('');
    const [savingAsset, setSavingAsset] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const deferredSearch = useDeferredValue(searchTerm.trim());
    const assetFilter = {
        ...(activeTypeFilter === 'ALL' ? {} : { type: { eq: activeTypeFilter } }),
        ...(deferredSearch ? { name: { contains: deferredSearch } } : {}),
    };

    const { data, loading, error, refetch } = useQuery<GetAssetsData>(GET_ASSETS, {
        variables: {
            options: {
                skip: page * PAGE_SIZE,
                take: PAGE_SIZE,
                sort: { updatedAt: 'DESC' },
                filter: assetFilter,
            },
        },
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [updateAsset] = useMutation(UPDATE_ASSET);
    const [deleteAsset] = useMutation<{ deleteAsset: { result: string; message?: string } }>(DELETE_ASSET);
    const assets = data?.assets.items ?? [];
    const totalItems = data?.assets.totalItems ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    const showNotice = (message: string) => {
        setNotification(message);
        setActionError('');
        window.setTimeout(() => setNotification(''), 3500);
    };
    const showError = (message: string) => {
        setActionError(message);
        setNotification('');
    };

    const openUploadModal = () => {
        pendingFiles.forEach(cleanupPreview);
        setPendingFiles([]);
        setActionError('');
        setIsUploadModalOpen(true);
    };
    const closeUploadModal = () => {
        if (isUploading) return;
        pendingFiles.forEach(cleanupPreview);
        setPendingFiles([]);
        setIsUploadModalOpen(false);
    };

    const handleNativeFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length === 0) return;
        const stamp = Date.now();
        const items = files.map((file, index): PendingFile => {
            const errorMsg = !SUPPORTED_FILE_TYPES.has(file.type)
                ? '不支持该文件类型，请选择 JPG、PNG、WEBP 或 MP4'
                : file.size > MAX_FILE_SIZE_BYTES
                  ? '文件超过 20MB，请压缩后重新选择'
                  : undefined;
            return {
                id: 'upload-' + stamp + '-' + index,
                file,
                previewUrl: !errorMsg && file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
                status: errorMsg ? 'FAILED' : 'READY',
                errorMsg,
            };
        });
        setPendingFiles(current => [...current, ...items]);
        event.target.value = '';
    };

    const removePendingFile = (id: string) => {
        setPendingFiles(current => {
            const target = current.find(file => file.id === id);
            if (target) cleanupPreview(target);
            return current.filter(file => file.id !== id);
        });
    };

    const handleConfirmUpload = async () => {
        const ready = pendingFiles.filter(file => file.status === 'READY');
        if (ready.length === 0 || isUploading) return;
        setIsUploading(true);
        setActionError('');
        const readyIds = new Set(ready.map(file => file.id));
        setPendingFiles(current =>
            current.map(file => (readyIds.has(file.id) ? { ...file, status: 'UPLOADING' } : file)),
        );
        try {
            const result = await uploadAdminFiles<CreateAssetsData>(
                CREATE_ASSETS_MULTIPART,
                ready.map(item => item.file),
                placeholders => ({
                    input: placeholders.map(file => ({
                        file,
                        tags: ['后台上传'],
                    })),
                }),
            );
            let successCount = 0;
            setPendingFiles(current =>
                current.map(file => {
                    const resultIndex = ready.findIndex(item => item.id === file.id);
                    if (resultIndex < 0) return file;
                    const uploaded = result.createAssets[resultIndex];
                    if (uploaded?.__typename === 'Asset') {
                        successCount += 1;
                        return { ...file, status: 'SUCCESS', errorMsg: undefined };
                    }
                    return {
                        ...file,
                        status: 'FAILED',
                        errorMsg: uploaded?.message || 'Vendure 拒绝了该文件',
                    };
                }),
            );
            await refetch();
            if (successCount > 0) showNotice('已成功上传 ' + successCount + ' 个素材到 Vendure');
            window.setTimeout(() => {
                setPendingFiles(current => {
                    current.filter(file => file.status === 'SUCCESS').forEach(cleanupPreview);
                    const failed = current.filter(file => file.status === 'FAILED');
                    if (failed.length === 0) setIsUploadModalOpen(false);
                    return failed;
                });
            }, 700);
        } catch (uploadError) {
            const message = toUserFacingError(uploadError, '素材上传失败，请稍后重试');
            setPendingFiles(current =>
                current.map(file =>
                    readyIds.has(file.id) ? { ...file, status: 'FAILED', errorMsg: message } : file,
                ),
            );
            showError(message);
        } finally {
            setIsUploading(false);
        }
    };

    const openAsset = (asset: AssetItem) => {
        setSelectedAsset(asset);
        setEditName(asset.name);
        setEditTags(asset.tags.map(tag => tag.value).join('，'));
        setActionError('');
    };

    const handleSaveAsset = async () => {
        if (!selectedAsset) return;
        const name = editName.trim();
        if (!name) {
            showError('素材名称不能为空');
            return;
        }
        const tags = editTags
            .split(/[，,\n]/)
            .map(tag => tag.trim())
            .filter(Boolean);
        setSavingAsset(true);
        setActionError('');
        try {
            await updateAsset({ variables: { input: { id: selectedAsset.id, name, tags } } });
            await refetch();
            setSelectedAsset(null);
            showNotice('已保存素材《' + name + '》的名称与标签');
        } catch (saveError) {
            showError(toUserFacingError(saveError, '素材保存失败，请稍后重试'));
        } finally {
            setSavingAsset(false);
        }
    };

    const handleDeleteAsset = async (asset: AssetItem) => {
        const confirmation = await requestConfirmation({
            title: '删除素材？',
            description: `即将删除《${asset.name}》。如果该素材仍被商品引用，系统会阻止删除。`,
            confirmLabel: '确认删除',
            tone: 'danger',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        setSavingAsset(true);
        setActionError('');
        try {
            const result = await deleteAsset({
                variables: {
                    input: {
                        assetId: asset.id,
                        force: false,
                        deleteFromAllChannels: false,
                    },
                },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            if (result.data?.deleteAsset.result !== 'DELETED') {
                throw new Error(result.data?.deleteAsset.message || '后端拒绝删除该素材');
            }
            if (page > 0 && assets.length === 1) {
                setPage(current => current - 1);
            } else {
                await refetch();
            }
            setSelectedAsset(null);
            showNotice('已删除素材《' + asset.name + '》');
        } catch (deleteError) {
            showError(toUserFacingError(deleteError, '素材删除失败，请稍后重试'));
        } finally {
            setSavingAsset(false);
        }
    };

    const readyFileCount = pendingFiles.filter(file => file.status === 'READY').length;

    return (
        <div className="flex h-full flex-col bg-[#f8fafc]">
            <div className="flex shrink-0 flex-col gap-4 border-b border-slate-200 bg-white px-5 py-5 shadow-2xs sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                        <ImageIcon className="h-5 w-5 text-blue-600" />
                        素材媒体库
                    </h1>
                    <p className="mt-1 text-xs text-slate-500">
                        管理 Vendure 全局图片、视频与文件素材，支持真实上传、标签编辑和安全删除
                    </p>
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => refetch()}
                        disabled={loading}
                        className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-700 disabled:opacity-50"
                    >
                        <RefreshCw className={'h-3.5 w-3.5 ' + (loading ? 'animate-spin' : '')} />
                        刷新
                    </button>
                    <button
                        type="button"
                        onClick={openUploadModal}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700"
                    >
                        <UploadCloud className="h-4 w-4" />
                        上传新素材
                    </button>
                </div>
            </div>
            <div className="mx-auto w-full max-w-7xl flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
                {notification && (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800">
                        <CheckCircle2 className="h-4 w-4" />
                        {notification}
                    </div>
                )}
                {(error || actionError) && (
                    <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <span>
                                {actionError || toUserFacingError(error, '素材库读取失败，请稍后重试')}
                            </span>
                        </div>
                        {error && (
                            <button
                                type="button"
                                onClick={() => refetch()}
                                className="rounded bg-rose-600 px-3 py-1 font-bold text-white"
                            >
                                重试
                            </button>
                        )}
                    </div>
                )}
                <div className="min-h-[500px] overflow-hidden rounded-xl border border-slate-200 bg-white text-xs shadow-2xs">
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/50 p-4">
                        <div className="flex gap-2">
                            {(['ALL', 'IMAGE', 'VIDEO'] as const).map(type => (
                                <button
                                    type="button"
                                    key={type}
                                    onClick={() => {
                                        setActiveTypeFilter(type);
                                        setPage(0);
                                    }}
                                    className={
                                        'rounded-lg border px-3 py-1.5 font-bold ' +
                                        (activeTypeFilter === type
                                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                                            : 'border-slate-200 bg-white text-slate-600')
                                    }
                                >
                                    {type === 'ALL' ? '全部' : type === 'IMAGE' ? '图片' : '视频'}
                                </button>
                            ))}
                        </div>
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                            <input
                                value={searchTerm}
                                onChange={event => {
                                    setSearchTerm(event.target.value);
                                    setPage(0);
                                }}
                                aria-label="搜索素材"
                                placeholder="搜索素材名称..."
                                className="w-64 rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-4 text-xs outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                    {loading && !data ? (
                        <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4 md:grid-cols-5">
                            {[1, 2, 3, 4, 5].map(item => (
                                <div
                                    key={item}
                                    className="aspect-square animate-pulse rounded-xl bg-slate-100"
                                />
                            ))}
                        </div>
                    ) : assets.length === 0 ? (
                        <div className="space-y-2 p-16 text-center text-slate-400">
                            <ImageIcon className="mx-auto h-10 w-10 text-slate-300" />
                            <p>当前筛选条件下暂无真实素材</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-4 md:grid-cols-5">
                            {assets.map(asset => (
                                <button
                                    type="button"
                                    key={asset.id}
                                    onClick={() => openAsset(asset)}
                                    className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left hover:border-blue-400 hover:shadow-md"
                                >
                                    <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-slate-100">
                                        {asset.type === 'IMAGE' ? (
                                            <img
                                                src={asset.preview}
                                                alt={asset.name}
                                                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                                            />
                                        ) : asset.type === 'VIDEO' ? (
                                            <Video className="h-9 w-9 text-slate-400" />
                                        ) : (
                                            <File className="h-9 w-9 text-slate-400" />
                                        )}
                                        <span className="absolute right-1.5 top-1.5 rounded-lg bg-white/90 p-1.5 text-slate-600 opacity-0 shadow-sm group-hover:opacity-100">
                                            <FileEdit className="h-3.5 w-3.5" />
                                        </span>
                                    </div>
                                    <div className="p-3">
                                        <div className="truncate font-bold text-slate-900">{asset.name}</div>
                                        <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
                                            <span>
                                                {asset.width && asset.height
                                                    ? asset.width + '×' + asset.height
                                                    : asset.type}
                                            </span>
                                            <span>{formatFileSize(asset.fileSize)}</span>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex flex-col gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                        <span>
                            共 {totalItems} 个素材，第 {Math.min(page + 1, totalPages)} / {totalPages} 页
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setPage(current => Math.max(0, current - 1))}
                                disabled={page === 0 || loading}
                                className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 disabled:opacity-40"
                                aria-label="上一页"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => setPage(current => Math.min(totalPages - 1, current + 1))}
                                disabled={page >= totalPages - 1 || loading}
                                className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-600 disabled:opacity-40"
                                aria-label="下一页"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {isUploadModalOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs"
                    onClick={closeUploadModal}
                >
                    <AccessibleDialogSurface
                        accessibleName="上传多媒体文件"
                        onRequestClose={closeUploadModal}
                        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-xs shadow-2xl"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-6 py-4">
                            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                                <UploadCloud className="h-5 w-5 text-blue-600" />
                                上传多媒体文件
                            </h2>
                            <button
                                type="button"
                                onClick={closeUploadModal}
                                disabled={isUploading}
                                className="text-slate-400"
                                aria-label="关闭上传窗口"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="space-y-4 overflow-y-auto p-6">
                            <div className="flex flex-col items-center space-y-2 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 p-6 text-center">
                                <UploadCloud className="h-8 w-8 text-blue-500" />
                                <div className="font-bold text-slate-800">选择本地图片或视频</div>
                                <p className="text-[11px] text-slate-400">
                                    支持 JPG、PNG、WEBP、MP4，单文件最大 20MB
                                </p>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    accept=".jpg,.jpeg,.png,.webp,.mp4,image/jpeg,image/png,image/webp,video/mp4"
                                    onChange={handleNativeFileSelect}
                                    className="hidden"
                                />
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={isUploading}
                                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-bold text-slate-700"
                                >
                                    从电脑选择文件
                                </button>
                            </div>
                            {pendingFiles.length > 0 && (
                                <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
                                    {pendingFiles.map(file => (
                                        <div
                                            key={file.id}
                                            className="flex items-center justify-between gap-3 p-3"
                                        >
                                            <div className="flex min-w-0 items-center gap-2.5">
                                                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                                                    {file.previewUrl ? (
                                                        <img
                                                            src={file.previewUrl}
                                                            alt={file.file.name}
                                                            className="h-full w-full object-cover"
                                                        />
                                                    ) : file.status === 'FAILED' ? (
                                                        <AlertTriangle className="h-4 w-4 text-rose-500" />
                                                    ) : (
                                                        <Video className="h-4 w-4 text-slate-500" />
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="truncate font-bold text-slate-900">
                                                        {file.file.name}
                                                    </div>
                                                    <div className="font-mono text-[10px] text-slate-400">
                                                        {formatFileSize(file.file.size)}
                                                    </div>
                                                    {file.errorMsg && (
                                                        <div className="mt-0.5 text-[10px] text-rose-600">
                                                            {file.errorMsg}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                                {file.status === 'READY' && (
                                                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                                                        就绪
                                                    </span>
                                                )}
                                                {file.status === 'UPLOADING' && (
                                                    <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                                                )}
                                                {file.status === 'SUCCESS' && (
                                                    <Check className="h-4 w-4 text-emerald-600" />
                                                )}
                                                {!isUploading && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removePendingFile(file.id)}
                                                        className="text-slate-300 hover:text-rose-600"
                                                        aria-label="移除待上传文件"
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-4">
                            <button
                                type="button"
                                onClick={closeUploadModal}
                                disabled={isUploading}
                                className="rounded-lg bg-slate-100 px-4 py-2 font-bold text-slate-700"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmUpload}
                                disabled={readyFileCount === 0 || isUploading}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 font-bold text-white disabled:opacity-50"
                            >
                                {isUploading ? (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Check className="h-3.5 w-3.5" />
                                )}
                                确认上传 ({readyFileCount})
                            </button>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}

            {selectedAsset && (
                <div
                    className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs"
                    onClick={() => !savingAsset && setSelectedAsset(null)}
                >
                    <AccessibleDialogSurface
                        accessibleName="素材属性"
                        onRequestClose={() => {
                            if (!savingAsset) setSelectedAsset(null);
                        }}
                        className="fixed right-0 top-0 flex h-full w-full flex-col bg-white text-xs shadow-2xl sm:w-[420px]"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-6">
                            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                                <ImageIcon className="h-5 w-5 text-blue-600" />
                                素材属性
                            </h2>
                            <button
                                type="button"
                                onClick={() => setSelectedAsset(null)}
                                disabled={savingAsset}
                                className="text-slate-400"
                                aria-label="关闭素材属性"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="flex-1 space-y-5 overflow-y-auto p-6">
                            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                                {selectedAsset.type === 'IMAGE' ? (
                                    <img
                                        src={selectedAsset.preview}
                                        alt={selectedAsset.name}
                                        className="h-full w-full object-contain"
                                    />
                                ) : selectedAsset.type === 'VIDEO' ? (
                                    <Video className="h-16 w-16 text-slate-400" />
                                ) : (
                                    <File className="h-16 w-16 text-slate-400" />
                                )}
                            </div>
                            <div>
                                <label className="mb-1 block font-bold text-slate-700">素材名称</label>
                                <input
                                    value={editName}
                                    onChange={event => setEditName(event.target.value)}
                                    className="w-full rounded-lg border border-slate-300 p-2.5 outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1 block font-bold text-slate-700">尺寸</label>
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono">
                                        {selectedAsset.width && selectedAsset.height
                                            ? selectedAsset.width + '×' + selectedAsset.height
                                            : '—'}
                                    </div>
                                </div>
                                <div>
                                    <label className="mb-1 block font-bold text-slate-700">文件大小</label>
                                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono">
                                        {formatFileSize(selectedAsset.fileSize)}
                                    </div>
                                </div>
                            </div>
                            <div>
                                <label className="mb-1 block font-bold text-slate-700">
                                    标签（逗号分隔）
                                </label>
                                <textarea
                                    value={editTags}
                                    onChange={event => setEditTags(event.target.value)}
                                    rows={3}
                                    className="w-full rounded-lg border border-slate-300 p-2.5 outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block font-bold text-slate-700">素材源地址</label>
                                <div className="flex gap-2">
                                    <input
                                        readOnly
                                        value={selectedAsset.source}
                                        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-[10px] text-slate-500"
                                    />
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            await navigator.clipboard.writeText(selectedAsset.source);
                                            showNotice('素材地址已复制');
                                        }}
                                        className="rounded-lg border border-slate-200 bg-slate-100 px-3"
                                        aria-label="复制素材地址"
                                    >
                                        <Copy className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                            {actionError && (
                                <div className="rounded-lg bg-rose-50 p-3 text-rose-700">{actionError}</div>
                            )}
                            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
                                <button
                                    type="button"
                                    onClick={() => handleDeleteAsset(selectedAsset)}
                                    disabled={savingAsset}
                                    className="flex items-center gap-1 rounded-lg px-3 py-2 font-bold text-rose-600 hover:bg-rose-50"
                                >
                                    <Trash2 className="h-4 w-4" />
                                    删除素材
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveAsset}
                                    disabled={savingAsset}
                                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 font-bold text-white disabled:opacity-50"
                                >
                                    {savingAsset && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                                    保存属性
                                </button>
                            </div>
                        </div>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}
