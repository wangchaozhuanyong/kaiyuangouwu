import { useMutation, useQuery } from '@apollo/client/react';
import { Camera, Check, LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { uploadAdminFile } from '../../apollo';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import type { UploadedImageAsset } from '../../components/ImageAssetUploadButton';
import {
    CATALOG_IMAGE_GENERATION_JOBS,
    CATALOG_IMAGE_STUDIO_CONFIG,
    CREATE_CATALOG_IMAGE_GENERATION,
    UPLOAD_CATALOG_IMAGE_REFERENCE,
    USE_CATALOG_IMAGE_OUTPUT,
} from '../../graphql/catalog-image-studio.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { toUserFacingError } from '../../utils/user-facing-error';

export const DEFAULT_PRODUCT_IMAGE_DESCRIPTION =
    '保持商品主体、外形、Logo、包装文字和颜色，清理杂乱背景，生成干净专业的正方形电商主图，不添加新文字。';

const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TERMINAL_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIAL_SUCCESS']);

interface CatalogImageConfigData {
    catalogImageStudioConfig: {
        enabled: boolean;
        unavailableReason?: string | null;
        defaultModelName: string;
        termsZh: string;
        maxReferenceBytes: number;
        aspectRatio: string;
        resolution: string;
        quantity: number;
    };
}

interface CatalogImageJob {
    id: string;
    createdAt: string;
    state: string;
    modelNameSnapshot: string;
    productName: string;
    description: string;
    errorMessage?: string | null;
    referenceAsset?: { id: string; previewUrl?: string | null } | null;
    outputs: Array<{
        id: string;
        state: string;
        errorMessage?: string | null;
        imageUrl?: string | null;
        catalogAssetId?: string | null;
    }>;
}

interface CatalogImageJobsData {
    catalogImageGenerationJobs: { items: CatalogImageJob[]; totalItems: number };
}

interface UsedAssetData {
    useCatalogImageOutput: UploadedImageAsset;
}

interface CreatedGenerationData {
    createCatalogImageGeneration: { id: string; state: string };
}

const statusText: Record<string, string> = {
    QUEUED: '排队中',
    RUNNING: '生成中',
    UNKNOWN: '结果核对中，请勿重复提交',
    SUCCEEDED: '结果待确认',
    PARTIAL_SUCCESS: '结果待确认',
    FAILED: '生成失败',
    CANCELLED: '已取消',
};

export function ProductAiImageDialog({
    open,
    productName,
    onClose,
    onUse,
}: {
    open: boolean;
    productName: string;
    onClose: () => void;
    onUse: (asset: UploadedImageAsset) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [file, setFile] = useState<File | null>(null);
    const [description, setDescription] = useState(DEFAULT_PRODUCT_IMAGE_DESCRIPTION);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const { permissions } = useAdminPermissions();
    const isSuperAdmin = permissions.includes('SuperAdmin');
    const configQuery = useQuery<CatalogImageConfigData>(CATALOG_IMAGE_STUDIO_CONFIG, {
        skip: !open,
        fetchPolicy: 'network-only',
    });
    const jobsQuery = useQuery<CatalogImageJobsData>(CATALOG_IMAGE_GENERATION_JOBS, {
        variables: { skip: 0, take: 8 },
        skip: !open,
        fetchPolicy: 'network-only',
        pollInterval: open ? 2_500 : 0,
    });
    const [createGeneration] = useMutation<CreatedGenerationData>(CREATE_CATALOG_IMAGE_GENERATION);
    const [applyOutputMutation] = useMutation<UsedAssetData>(USE_CATALOG_IMAGE_OUTPUT);
    const jobs = jobsQuery.data?.catalogImageGenerationJobs.items;
    const selectedJob = jobs?.find(job => job.id === selectedJobId) ?? jobs?.[0] ?? null;
    const result = selectedJob?.outputs.find(output => output.state === 'SUCCEEDED') ?? null;
    const preview = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);

    useEffect(() => {
        return () => {
            if (preview) URL.revokeObjectURL(preview);
        };
    }, [preview]);

    if (!open) return null;
    const config = configQuery.data?.catalogImageStudioConfig;

    const chooseFile = (next: File | undefined) => {
        setError('');
        if (!next) return;
        if (!SUPPORTED_TYPES.has(next.type)) {
            setError('仅支持 JPEG、PNG 或 WebP 照片');
            return;
        }
        if (next.size > (config?.maxReferenceBytes ?? 10 * 1024 * 1024)) {
            setError('照片超过 10MB，请压缩后重试');
            return;
        }
        setFile(next);
    };

    const generate = async () => {
        if (!file) return setError('请先拍摄或选择一张商品照片');
        if (!productName.trim()) return setError('请先填写商品名称');
        if (!description.trim()) return setError('请填写主图效果描述');
        if (!termsAccepted) return setError('请先确认图片使用权并同意服务条款');
        setWorking(true);
        setError('');
        let referenceId = '';
        try {
            const uploaded = await uploadAdminFile<{
                uploadCatalogImageReference: { id: string };
            }>(UPLOAD_CATALOG_IMAGE_REFERENCE, file, { file: null, termsAccepted: true });
            referenceId = uploaded.uploadCatalogImageReference.id;
            const idempotencyKey = `catalog-${crypto.randomUUID()}`;
            const created = await createGeneration({
                variables: {
                    input: {
                        referenceAssetId: referenceId,
                        productName: productName.trim(),
                        description: description.trim(),
                        idempotencyKey,
                        termsAccepted: true,
                    },
                },
            });
            const id = created.data?.createCatalogImageGeneration?.id as string | undefined;
            if (!id) throw new Error('后端未返回生图任务');
            setSelectedJobId(id);
            await jobsQuery.refetch();
        } catch (cause) {
            setError(toUserFacingError(cause, '商品主图生成请求失败'));
        } finally {
            setWorking(false);
        }
    };

    const applyResult = async () => {
        if (!result) return;
        setWorking(true);
        setError('');
        try {
            const response = await applyOutputMutation({ variables: { outputId: result.id } });
            const asset = response.data?.useCatalogImageOutput;
            if (!asset) throw new Error('后端未返回正式素材');
            onUse(asset);
            onClose();
        } catch (cause) {
            setError(toUserFacingError(cause, '应用商品主图失败'));
        } finally {
            setWorking(false);
        }
    };

    return (
        <div className="fixed inset-0 z-70 flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-4">
            <AccessibleDialogSurface
                accessibleName="AI 生成商品主图"
                onRequestClose={onClose}
                className="flex max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-2xl"
            >
                <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-6">
                    <div>
                        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                            <Sparkles className="h-5 w-5 text-violet-600" /> AI 生成商品主图
                            <FeatureHelpButton topic="plugins.ai-usage" title="AI 生成商品主图" />
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                            固定生成 1 张 1:1 / 1K 主图，使用后还需保存商品
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-2 hover:bg-slate-100"
                        aria-label="关闭"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </header>

                <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1.05fr_.95fr]">
                    <section className="space-y-4 border-b border-slate-200 p-4 sm:p-6 lg:border-b-0 lg:border-r">
                        {configQuery.loading ? (
                            <p className="text-sm text-slate-500">正在读取店铺生图配置…</p>
                        ) : config && !config.enabled ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                                {config.unavailableReason}
                                {isSuperAdmin && (
                                    <a href="/plugins/ai-settings" className="ml-2 font-bold underline">
                                        前往配置
                                    </a>
                                )}
                            </div>
                        ) : (
                            <>
                                <div>
                                    <div className="mb-2 flex items-center justify-between">
                                        <label className="text-sm font-bold text-slate-800">商品照片</label>
                                        {file && (
                                            <button
                                                type="button"
                                                onClick={() => inputRef.current?.click()}
                                                className="text-xs font-bold text-blue-600"
                                            >
                                                <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
                                                重新拍摄/选择
                                            </button>
                                        )}
                                    </div>
                                    <input
                                        ref={inputRef}
                                        className="sr-only"
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        capture="environment"
                                        onChange={event => chooseFile(event.target.files?.[0])}
                                    />
                                    {preview ? (
                                        <div className="relative aspect-square overflow-hidden rounded-xl border bg-slate-50">
                                            <img
                                                src={preview}
                                                alt="原始商品照片预览"
                                                className="h-full w-full object-contain"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setFile(null)}
                                                className="absolute right-2 top-2 rounded-full bg-slate-950/70 p-2 text-white"
                                                aria-label="移除照片"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => inputRef.current?.click()}
                                            className="flex aspect-square w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 text-slate-600 hover:border-violet-400 hover:bg-violet-50 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300"
                                        >
                                            <Camera className="mb-3 h-9 w-9 text-violet-500" />
                                            <span className="font-bold">拍照或选择照片</span>
                                            <span className="mt-1 text-xs">
                                                支持 JPEG、PNG、WebP，最大 10MB
                                            </span>
                                        </button>
                                    )}
                                </div>
                                <div>
                                    <label
                                        htmlFor="catalog-image-description"
                                        className="mb-2 block text-sm font-bold text-slate-800"
                                    >
                                        主图效果描述
                                    </label>
                                    <textarea
                                        id="catalog-image-description"
                                        rows={5}
                                        maxLength={1500}
                                        value={description}
                                        onChange={event => setDescription(event.target.value)}
                                        className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                                    />
                                    <p className="mt-1 text-right text-[11px] text-slate-400">
                                        {description.length}/1500
                                    </p>
                                </div>
                                <label className="flex items-start gap-2 text-xs leading-5 text-slate-600">
                                    <input
                                        type="checkbox"
                                        checked={termsAccepted}
                                        onChange={event => setTermsAccepted(event.target.checked)}
                                        className="mt-0.5 h-4 w-4 rounded text-violet-600"
                                    />
                                    <span>
                                        我拥有该照片使用权，并同意{config?.termsZh || 'AI 图片服务条款'}。
                                    </span>
                                </label>
                                <button
                                    type="button"
                                    disabled={working || !config?.enabled}
                                    onClick={generate}
                                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    {working ? (
                                        <LoaderCircle className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Sparkles className="h-4 w-4" />
                                    )}
                                    生成商品主图
                                </button>
                            </>
                        )}
                    </section>

                    <section className="space-y-4 p-4 sm:p-6">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                                生成结果与最近任务
                                <FeatureHelpButton topic="plugins.ai-usage" title="生成结果与最近任务" />
                            </h3>
                            <span className="text-[11px] text-slate-400">{config?.defaultModelName}</span>
                        </div>
                        {selectedJob ? (
                            <div className="rounded-xl border border-slate-200 p-3">
                                <div className="mb-3 flex items-center justify-between text-xs">
                                    <span className="font-bold text-slate-700">
                                        {statusText[selectedJob.state] ?? selectedJob.state}
                                    </span>
                                    {!TERMINAL_STATES.has(selectedJob.state) && (
                                        <LoaderCircle className="h-4 w-4 animate-spin text-violet-600" />
                                    )}
                                </div>
                                {result?.imageUrl ? (
                                    <img
                                        src={result.imageUrl}
                                        alt="AI 生成商品主图"
                                        className="aspect-square w-full rounded-lg bg-slate-50 object-contain"
                                    />
                                ) : (
                                    <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-50 px-6 text-center text-sm text-slate-500">
                                        {selectedJob.errorMessage ||
                                            selectedJob.outputs[0]?.errorMessage ||
                                            '任务会在后台继续，关闭后可从最近任务恢复'}
                                    </div>
                                )}
                                {result && (
                                    <button
                                        type="button"
                                        disabled={working}
                                        onClick={applyResult}
                                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                        <Check className="h-4 w-4" />
                                        {result.catalogAssetId ? '已使用，再次返回同一素材' : '使用为主图'}
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
                                暂无后台商品图任务
                            </div>
                        )}
                        {(jobs?.length ?? 0) > 1 && (
                            <div className="space-y-2">
                                {jobs?.map(job => (
                                    <button
                                        key={job.id}
                                        type="button"
                                        onClick={() => setSelectedJobId(job.id)}
                                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs ${selectedJob?.id === job.id ? 'border-violet-400 bg-violet-50' : 'border-slate-200'}`}
                                    >
                                        <span className="truncate font-bold">
                                            {job.productName || '未命名商品'}
                                        </span>
                                        <span className="ml-3 shrink-0 text-slate-500">
                                            {statusText[job.state] ?? job.state}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                        {(error || configQuery.error || jobsQuery.error) && (
                            <div
                                role="alert"
                                className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"
                            >
                                {error ||
                                    toUserFacingError(
                                        configQuery.error || jobsQuery.error,
                                        '生图服务暂时不可用',
                                    )}
                            </div>
                        )}
                    </section>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}
