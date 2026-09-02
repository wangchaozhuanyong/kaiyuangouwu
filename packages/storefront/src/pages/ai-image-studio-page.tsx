/* eslint-disable max-len -- compact bilingual UI copy and class lists are intentional. */
import {
    ArrowDownToLine,
    Check,
    CheckCircle2,
    ChevronDown,
    CircleAlert,
    Eye,
    ImagePlus,
    Info,
    LoaderCircle,
    Maximize2,
    RefreshCw,
    RotateCcw,
    Sparkles,
    Trash2,
    WandSparkles,
    X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ShopApi, ShopApiTimeoutError } from '../api';
import { formatDisplayMoney } from '../money-display';
import { PageSkeleton } from '../route-loading';
import { EmptyState, Sheet, Subpage } from '../storefront-ui/page-shell';
import { SafeImage } from '../storefront-ui/product-display';
import {
    ActiveCustomer,
    ImageGenerationJob,
    ImageGenerationOutput,
    ImageModelQuotaStatus,
    ImagePrivateAssetView,
    ImagePromptQuotaStatus,
    ImageReferenceMode,
    ImageResolution,
    ImageStudioConfig,
    MarketConfig,
    StorefrontLanguage,
} from '../types';

import {
    formatImageDimensions,
    generationOutputAspectRatio,
    imageAspectRatioMismatch,
    summarizeImageOutputDimensions,
} from './ai-image-studio-dimensions';
import { StableImageStudioRequest, stableImageStudioRequest } from './ai-image-studio-idempotency';
import {
    imageGenerationElapsedSeconds,
    imageGenerationPollDelay,
    imageGenerationProgress,
    startImageGenerationPolling,
} from './ai-image-studio-progress';
import {
    aspectRatioSupports4K,
    customerImageResolutions,
    imageResolutionAvailability,
} from './ai-image-studio-resolution';

interface AiImageStudioPageProps {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    displayCurrencyCode: string;
    language: StorefrontLanguage;
    onBack: () => void;
    onSignIn: () => void;
    onNotify: (message: string) => void;
}

function formatBillingMoney(value: number, currencyCode: string, locale: string): string {
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currencyCode,
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(value / 100);
}

const aspectRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'];
const referenceImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const referenceImageMaxBytes = 10 * 1024 * 1024;
const referenceImageLimit = 3;
const activeStates = new Set(['QUEUED', 'RUNNING', 'UNKNOWN']);
const terminalStates = new Set(['PARTIAL_SUCCESS', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
const successStates = new Set(['PARTIAL_SUCCESS', 'SUCCEEDED']);
const failedStates = new Set(['FAILED', 'CANCELLED']);

type AiStudioSetting = 'ASPECT_RATIO' | 'QUANTITY' | 'RESOLUTION';
type HistoryFilter = 'ALL' | 'SUCCESS' | 'PROCESSING' | 'FAILED';
type ReferenceUploadItem = {
    id: string;
    fileName: string;
    previewUrl: string;
    asset: ImagePrivateAssetView | null;
    state: 'UPLOADING' | 'SUCCEEDED' | 'FAILED';
    error: string;
};

export function AiImageStudioPage(props: Readonly<AiImageStudioPageProps>) {
    const { api, customer, market, displayCurrencyCode, language, onBack, onSignIn, onNotify } = props;
    const isZh = language === 'zh';
    const [config, setConfig] = useState<ImageStudioConfig | null>(null);
    const [balance, setBalance] = useState(0);
    const [walletCurrencyCode, setWalletCurrencyCode] = useState(market.currencyCode);
    const [promptQuota, setPromptQuota] = useState<ImagePromptQuotaStatus | null>(null);
    const [modelQuotas, setModelQuotas] = useState<ImageModelQuotaStatus[]>([]);
    const [jobs, setJobs] = useState<ImageGenerationJob[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [refreshWarning, setRefreshWarning] = useState('');
    const [prompt, setPrompt] = useState('');
    const [originalPrompt, setOriginalPrompt] = useState('');
    const [optimized, setOptimized] = useState(false);
    const [optimizationReason, setOptimizationReason] = useState('');
    const [lastOptimizerModelId, setLastOptimizerModelId] = useState<string | null>(null);
    const [modelCode, setModelCode] = useState('');
    const [aspectRatio, setAspectRatio] = useState('1:1');
    const [resolution, setResolution] = useState<ImageResolution>('1K');
    const [quantity, setQuantity] = useState(1);
    // The storefront defaults the consent row to checked while keeping it editable.
    const [termsAccepted, setTermsAccepted] = useState(true);
    const [referenceItems, setReferenceItems] = useState<ReferenceUploadItem[]>([]);
    const [referenceMode, setReferenceMode] = useState<ImageReferenceMode>('NONE');
    const [referenceInstruction, setReferenceInstruction] = useState('');
    const [referenceSettingsOpen, setReferenceSettingsOpen] = useState(false);
    const [referenceError, setReferenceError] = useState('');
    const referenceInputRef = useRef<HTMLInputElement>(null);
    const localReferencePreviewUrlsRef = useRef(new Set<string>());
    const [activeSetting, setActiveSetting] = useState<AiStudioSetting | null>(null);
    const [termsInfoOpen, setTermsInfoOpen] = useState(false);
    const [historyInfoOpen, setHistoryInfoOpen] = useState(false);
    const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('ALL');
    const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
    const [pendingDeleteJobId, setPendingDeleteJobId] = useState<string | null>(null);
    const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
    const [busy, setBusy] = useState<'OPTIMIZE' | 'GENERATE' | ''>('');
    const [actionError, setActionError] = useState('');
    const pollStartedAt = useRef(Date.now());
    const loadEpoch = useRef(0);
    const settlementEpoch = useRef(0);
    const jobsRef = useRef<ImageGenerationJob[]>([]);
    const optimizeRequestRef = useRef<StableImageStudioRequest | null>(null);
    const generateRequestRef = useRef<StableImageStudioRequest | null>(null);

    const revokeReferencePreview = useCallback((url: string) => {
        if (!url || !localReferencePreviewUrlsRef.current.has(url)) return;
        URL.revokeObjectURL(url);
        localReferencePreviewUrlsRef.current.delete(url);
    }, []);
    const clearReferencePreviews = useCallback(() => {
        for (const url of localReferencePreviewUrlsRef.current) URL.revokeObjectURL(url);
        localReferencePreviewUrlsRef.current.clear();
    }, []);

    const load = useCallback(async () => {
        const epoch = ++loadEpoch.current;
        setLoadError('');
        setRefreshWarning('');
        try {
            const studioConfig = await api.imageStudioConfig();
            if (epoch !== loadEpoch.current) return;
            setConfig(studioConfig);
            setModelCode(current =>
                studioConfig.models.some(model => model.code === current)
                    ? current
                    : studioConfig.defaultModelCode || studioConfig.models[0]?.code || '',
            );
            if (!customer) {
                setBalance(0);
                setWalletCurrencyCode(market.currencyCode);
                setJobs([]);
                setPromptQuota(null);
                setModelQuotas([]);
                return;
            }
            const [wallet, history, loadedPromptQuota, loadedModelQuotas] = await Promise.allSettled([
                api.imageStudioWallet(),
                api.myImageGenerationJobs(0, 20),
                api.imagePromptQuotaStatus(),
                api.imageModelQuotaStatus(),
            ]);
            if (epoch !== loadEpoch.current) return;
            if (wallet.status === 'fulfilled') {
                setBalance(wallet.value.availableBalance);
                setWalletCurrencyCode(wallet.value.currencyCode);
            }
            if (history.status === 'fulfilled') setJobs(history.value.items);
            if (loadedPromptQuota.status === 'fulfilled') setPromptQuota(loadedPromptQuota.value);
            if (loadedModelQuotas.status === 'fulfilled') setModelQuotas(loadedModelQuotas.value);
            if (
                [wallet, history, loadedPromptQuota, loadedModelQuotas].some(
                    result => result.status === 'rejected',
                )
            ) {
                setRefreshWarning(
                    isZh
                        ? '部分数据刷新失败，已保留现有内容并将在后台重试。'
                        : 'Some data could not be refreshed. Existing data is preserved.',
                );
            }
        } catch (error) {
            if (epoch === loadEpoch.current) setLoadError(errorMessage(error));
        } finally {
            if (epoch === loadEpoch.current) setLoading(false);
        }
    }, [api, customer, isZh, market.currencyCode]);

    useEffect(() => {
        jobsRef.current = jobs;
    }, [jobs]);

    const refreshActiveJobs = useCallback(async () => {
        if (!customer) return;
        const activeIds = jobsRef.current.filter(job => activeStates.has(job.state)).map(job => job.id);
        if (!activeIds.length) return;
        const [jobResults, wallet, loadedPromptQuota, loadedModelQuotas] = await Promise.allSettled([
            Promise.allSettled(activeIds.map(id => api.myImageGenerationJob(id))),
            api.imageStudioWallet(),
            api.imagePromptQuotaStatus(),
            api.imageModelQuotaStatus(),
        ]);
        let partialFailure = false;
        if (jobResults.status === 'fulfilled') {
            const refreshed = new Map<string, ImageGenerationJob>();
            for (const result of jobResults.value) {
                if (result.status === 'fulfilled') refreshed.set(result.value.id, result.value);
                else partialFailure = true;
            }
            if (refreshed.size) {
                setJobs(current => current.map(job => refreshed.get(job.id) ?? job));
            }
        } else partialFailure = true;
        if (wallet.status === 'fulfilled') {
            setBalance(wallet.value.availableBalance);
            setWalletCurrencyCode(wallet.value.currencyCode);
        } else partialFailure = true;
        if (loadedPromptQuota.status === 'fulfilled') setPromptQuota(loadedPromptQuota.value);
        else partialFailure = true;
        if (loadedModelQuotas.status === 'fulfilled') setModelQuotas(loadedModelQuotas.value);
        else partialFailure = true;
        setRefreshWarning(
            partialFailure
                ? isZh
                    ? '刷新失败，正在重试；任务状态和已有数据不会被清空。'
                    : 'Refresh failed; retrying without clearing current data.'
                : '',
        );
    }, [api, customer, isZh]);

    useEffect(() => {
        settlementEpoch.current += 1;
        setLoading(true);
        setConfig(null);
        setBalance(0);
        setWalletCurrencyCode(market.currencyCode);
        setPromptQuota(null);
        setModelQuotas([]);
        setLastOptimizerModelId(null);
        setBusy('');
        setActionError('');
        setRefreshWarning('');
        optimizeRequestRef.current = null;
        generateRequestRef.current = null;
        void load();
        return () => {
            settlementEpoch.current += 1;
            loadEpoch.current += 1;
        };
    }, [load, market.currencyCode]);
    useEffect(() => {
        // Consent and private reference assets belong to a customer session;
        // never carry either across logout/login changes.
        setTermsAccepted(true);
        clearReferencePreviews();
        setReferenceItems([]);
        setReferenceMode('NONE');
        setReferenceInstruction('');
        setReferenceSettingsOpen(false);
        setReferenceError('');
        if (referenceInputRef.current) referenceInputRef.current.value = '';
    }, [clearReferencePreviews, customer?.id]);
    useEffect(() => () => clearReferencePreviews(), [clearReferencePreviews]);
    const hasActiveJobs = jobs.some(job => activeStates.has(job.state));
    useEffect(() => {
        if (!hasActiveJobs) return;
        const polling = startImageGenerationPolling(refreshActiveJobs, () =>
            imageGenerationPollDelay(pollStartedAt.current),
        );
        const refreshWhenVisible = () => {
            if (document.visibilityState === 'visible') polling.refreshNow();
        };
        const refreshWhenOnline = () => polling.refreshNow();
        document.addEventListener('visibilitychange', refreshWhenVisible);
        window.addEventListener('online', refreshWhenOnline);
        return () => {
            document.removeEventListener('visibilitychange', refreshWhenVisible);
            window.removeEventListener('online', refreshWhenOnline);
            polling.stop();
        };
    }, [hasActiveJobs, refreshActiveJobs]);

    const selectedModel = config?.models.find(model => model.code === modelCode) ?? config?.models[0];
    const referenceAssets = referenceItems.flatMap(item => (item.asset ? [item.asset] : []));
    const referenceBusy = referenceItems.some(item => item.state === 'UPLOADING');
    const referenceHasFailure = referenceItems.some(item => item.state === 'FAILED');
    const optimizerModelIds =
        lastOptimizerModelId !== null
            ? [lastOptimizerModelId || (isZh ? '本地规则' : 'Local rules')]
            : (config?.promptOptimizerModelIds ?? []);
    const optimizerModelLabel = optimizerModelIds.map(value => value.replace(/^models\//iu, '')).join(' / ');
    const pricedResolutionOptions =
        selectedModel?.resolutionOptions.filter(option => option.unitPrice > 0) ?? [];
    const selectedResolutionOption =
        pricedResolutionOptions.find(
            option => option.resolution === resolution && option.supportedAspectRatios.includes(aspectRatio),
        ) ?? pricedResolutionOptions.find(option => option.supportedAspectRatios.includes(aspectRatio));
    const effectiveResolution = selectedResolutionOption?.resolution;
    useEffect(() => {
        if (effectiveResolution && effectiveResolution !== resolution) setResolution(effectiveResolution);
    }, [effectiveResolution, resolution]);
    const selectedQuota = modelQuotas.find(item => item.modelCode === selectedModel?.code);
    const freeRemaining = selectedQuota?.free.unlimited
        ? quantity
        : Math.min(quantity, selectedQuota?.free.remaining ?? 0);
    const paidQuantity = Math.max(0, quantity - freeRemaining);
    const estimatedPrice = (selectedResolutionOption?.unitPrice ?? 0) * paidQuantity;
    const quoteCurrencyReady = Boolean(
        selectedModel &&
        selectedModel.currencyCode === market.currencyCode &&
        walletCurrencyCode === market.currencyCode,
    );
    const canGenerate = Boolean(
        customer &&
        config?.enabled &&
        selectedModel &&
        selectedResolutionOption &&
        prompt.trim() &&
        termsAccepted &&
        quoteCurrencyReady &&
        balance >= estimatedPrice &&
        (selectedQuota?.safety.remaining ?? 0) >= quantity &&
        (paidQuantity === 0 || Boolean(selectedQuota?.paidAfterFreeEnabled)) &&
        !referenceBusy &&
        !referenceHasFailure &&
        (!referenceAssets.length || referenceMode !== 'NONE') &&
        !busy,
    );
    const selectModel = (code: string) => {
        setModelCode(code);
        const model = config?.models.find(item => item.code === code);
        if (!model) return;
        const priced = model.resolutionOptions.filter(option => option.unitPrice > 0);
        const next =
            priced.find(
                option =>
                    option.resolution === resolution && option.supportedAspectRatios.includes(aspectRatio),
            ) ?? priced.find(option => option.supportedAspectRatios.includes(aspectRatio));
        if (next) setResolution(next.resolution);
    };
    const filteredJobs = useMemo(
        () =>
            jobs.filter(job => {
                if (historyFilter === 'SUCCESS') return successStates.has(job.state);
                if (historyFilter === 'PROCESSING') return activeStates.has(job.state);
                if (historyFilter === 'FAILED') return failedStates.has(job.state);
                return true;
            }),
        [historyFilter, jobs],
    );
    const selectedJob = jobs.find(job => job.id === selectedJobId) ?? null;

    const optimizePrompt = async () => {
        if (!prompt.trim() || busy) return;
        const epoch = settlementEpoch.current;
        setBusy('OPTIMIZE');
        setActionError('');
        try {
            const paidPrompt = Boolean(
                promptQuota && !promptQuota.daily.unlimited && promptQuota.daily.remaining <= 0,
            );
            const fingerprint = JSON.stringify({
                prompt: prompt.trim(),
                referenceMode,
                expectedPrice: paidPrompt ? promptQuota?.paidPrice : null,
                currencyCode: paidPrompt ? promptQuota?.currencyCode : null,
            });
            const idempotencyKey = stableRequestId(optimizeRequestRef, fingerprint);
            const result = await api.optimizeImagePrompt(prompt, referenceMode, {
                expectedPrice: paidPrompt ? promptQuota?.paidPrice : null,
                currencyCode: paidPrompt ? promptQuota?.currencyCode : null,
                idempotencyKey,
            });
            if (epoch !== settlementEpoch.current) return;
            optimizeRequestRef.current = null;
            setOriginalPrompt(prompt);
            setPrompt(result.optimizedPrompt);
            setOptimized(true);
            setOptimizationReason(result.recommendationReason);
            setLastOptimizerModelId(result.optimizerModelId ?? '');
            setPromptQuota(result.promptQuota);
            onNotify(
                isZh
                    ? `优化完成，今日免费剩余 ${quotaRemainingLabel(result.promptQuota.daily)} 次，本分钟剩余 ${result.promptQuota.minute.remaining}/${result.promptQuota.minute.limit} 次`
                    : 'Prompt optimized',
            );
            if (config?.models.some(model => model.code === result.recommendedModelCode)) {
                selectModel(result.recommendedModelCode);
            }
        } catch (error) {
            if (epoch === settlementEpoch.current) setActionError(actionErrorMessage(error, isZh));
        } finally {
            if (epoch === settlementEpoch.current) setBusy('');
        }
    };

    const uploadReferences = async (files: File[]) => {
        if (!termsAccepted) {
            setReferenceError(
                isZh ? '请先阅读并同意 AI 图片服务条款，再添加参考图。' : 'Accept the AI image terms first.',
            );
            if (referenceInputRef.current) referenceInputRef.current.value = '';
            return;
        }
        const availableSlots = Math.max(0, referenceImageLimit - referenceItems.length);
        if (!availableSlots) {
            setReferenceError(
                isZh
                    ? `每次最多上传 ${referenceImageLimit} 张参考图。`
                    : `Upload up to ${referenceImageLimit} reference images.`,
            );
            return;
        }
        const validationErrors: string[] = [];
        const pendingUploads = files.slice(0, availableSlots).flatMap<{
            file: File;
            item: ReferenceUploadItem;
        }>(file => {
            if (!referenceImageTypes.has(file.type)) {
                validationErrors.push(
                    isZh
                        ? `${file.name}：仅支持 JPEG、PNG 或 WebP。`
                        : `${file.name}: use JPEG, PNG, or WebP.`,
                );
                return [];
            }
            if (file.size > referenceImageMaxBytes) {
                validationErrors.push(
                    isZh ? `${file.name}：不能超过 10MB。` : `${file.name}: must be 10MB or smaller.`,
                );
                return [];
            }
            const previewUrl = URL.createObjectURL(file);
            localReferencePreviewUrlsRef.current.add(previewUrl);
            return [
                {
                    file,
                    item: {
                        id: requestId(),
                        fileName: file.name,
                        previewUrl,
                        asset: null,
                        state: 'UPLOADING',
                        error: '',
                    },
                },
            ];
        });
        const pendingItems = pendingUploads.map(upload => upload.item);
        if (files.length > availableSlots) {
            validationErrors.push(
                isZh
                    ? `本次只添加了前 ${availableSlots} 张，每次最多 ${referenceImageLimit} 张。`
                    : `Only the first ${availableSlots} images were added.`,
            );
        }
        setReferenceError(validationErrors.join(' '));
        if (!pendingItems.length) {
            if (referenceInputRef.current) referenceInputRef.current.value = '';
            return;
        }
        setActionError('');
        setReferenceItems(current => [...current, ...pendingItems]);
        const results = await Promise.all(
            pendingUploads.map(async ({ file, item }) => {
                try {
                    const uploaded = await api.uploadImageReference(file, termsAccepted);
                    setReferenceItems(current =>
                        current.map(currentItem =>
                            currentItem.id === item.id
                                ? { ...currentItem, asset: uploaded, state: 'SUCCEEDED', error: '' }
                                : currentItem,
                        ),
                    );
                    return true;
                } catch (error) {
                    const message = errorMessage(error);
                    setReferenceItems(current =>
                        current.map(currentItem =>
                            currentItem.id === item.id
                                ? { ...currentItem, state: 'FAILED', error: message }
                                : currentItem,
                        ),
                    );
                    return false;
                }
            }),
        );
        const uploadedCount = results.filter(Boolean).length;
        if (uploadedCount) {
            setReferenceMode(current => (current === 'NONE' ? 'PRODUCT' : current));
            onNotify(
                isZh ? `已成功上传 ${uploadedCount} 张参考图` : `${uploadedCount} reference images uploaded`,
            );
        }
        if (results.some(result => !result)) {
            setReferenceError(
                isZh
                    ? '部分参考图上传失败，请移除失败项后重试。'
                    : 'Some uploads failed. Remove them and try again.',
            );
        }
        if (referenceInputRef.current) referenceInputRef.current.value = '';
    };

    const removeReference = (id: string) => {
        const target = referenceItems.find(item => item.id === id);
        if (target) revokeReferencePreview(target.previewUrl);
        setReferenceItems(current => {
            const next = current.filter(item => item.id !== id);
            if (!next.some(item => item.asset)) {
                setReferenceMode('NONE');
                setReferenceInstruction('');
                setReferenceSettingsOpen(false);
            }
            return next;
        });
        setReferenceError('');
    };

    const generate = async () => {
        if (!canGenerate || !selectedModel || !selectedResolutionOption || !config) return;
        const epoch = settlementEpoch.current;
        setBusy('GENERATE');
        setActionError('');
        try {
            const requestInput = {
                modelCode: selectedModel.code,
                prompt: optimized ? originalPrompt || prompt : prompt,
                optimizedPrompt: optimized ? prompt : null,
                referenceAssetId: referenceAssets[0]?.id ?? null,
                referenceAssetIds: referenceAssets.map(asset => asset.id),
                referenceMode,
                referenceInstruction: referenceInstruction.trim() || null,
                aspectRatio,
                resolution: selectedResolutionOption.resolution,
                quantity,
                expectedUnitPrice: selectedResolutionOption.unitPrice,
                expectedChargeAmount: estimatedPrice,
                currencyCode: selectedModel.currencyCode,
                termsAccepted,
            };
            const fingerprint = JSON.stringify(requestInput);
            const job = await api.createImageGeneration({
                ...requestInput,
                idempotencyKey: stableRequestId(generateRequestRef, fingerprint),
            });
            if (epoch !== settlementEpoch.current) return;
            generateRequestRef.current = null;
            pollStartedAt.current = Date.now();
            setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
            setBalance(value => Math.max(0, value - job.reservedAmount));
            const [nextPromptQuota, nextModelQuotas, nextWallet] = await Promise.allSettled([
                api.imagePromptQuotaStatus(),
                api.imageModelQuotaStatus(),
                api.imageStudioWallet(),
            ]);
            if (epoch !== settlementEpoch.current) return;
            if (nextPromptQuota.status === 'fulfilled') setPromptQuota(nextPromptQuota.value);
            if (nextModelQuotas.status === 'fulfilled') setModelQuotas(nextModelQuotas.value);
            if (nextWallet.status === 'fulfilled') {
                setBalance(nextWallet.value.availableBalance);
                setWalletCurrencyCode(nextWallet.value.currencyCode);
            }
            if ([nextPromptQuota, nextModelQuotas, nextWallet].some(result => result.status === 'rejected')) {
                setRefreshWarning(
                    isZh
                        ? '任务已提交，但余额或额度刷新失败；任务状态仍会继续更新。'
                        : 'Generation was submitted, but balance or quota refresh failed.',
                );
            }
            onNotify(isZh ? '任务已提交，正在逐张生成' : 'Generation queued');
        } catch (error) {
            if (epoch === settlementEpoch.current) setActionError(actionErrorMessage(error, isZh));
        } finally {
            if (epoch === settlementEpoch.current) setBusy('');
        }
    };

    const cancel = async (id: string) => {
        try {
            await api.cancelQueuedImageGeneration(id);
            await load();
        } catch (error) {
            setActionError(errorMessage(error));
        }
    };
    const deleteJob = async () => {
        const id = pendingDeleteJobId;
        if (!id || deletingJobId) return;
        setDeletingJobId(id);
        try {
            await api.deleteMyImageGenerationJob(id);
            setPendingDeleteJobId(null);
            if (selectedJobId === id) setSelectedJobId(null);
            await load();
        } catch (error) {
            setActionError(errorMessage(error));
        } finally {
            setDeletingJobId(null);
        }
    };
    const regenerate = (job: ImageGenerationJob) => {
        setPrompt(job.originalPrompt);
        setOriginalPrompt('');
        setOptimized(false);
        setOptimizationReason('');
        selectModel(job.modelCodeSnapshot);
        setAspectRatio(job.aspectRatio);
        setResolution(job.resolution);
        setQuantity(job.quantity);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const selectAspectRatio = (nextAspectRatio: string) => {
        setAspectRatio(nextAspectRatio);
        const current = pricedResolutionOptions.find(option => option.resolution === resolution);
        if (!current?.supportedAspectRatios.includes(nextAspectRatio)) {
            const fallback = pricedResolutionOptions.find(option =>
                option.supportedAspectRatios.includes(nextAspectRatio),
            );
            if (fallback) setResolution(fallback.resolution);
        }
        setActiveSetting(null);
    };

    const selectResolution = (value: ImageResolution) => {
        const availability = imageResolutionAvailability(selectedModel, value, aspectRatio);
        if (availability.status !== 'AVAILABLE') {
            onNotify(
                isZh
                    ? availability.status === 'ASPECT_RATIO_UNSUPPORTED'
                        ? `当前模型的 ${value} 不支持 ${aspectRatio} 比例`
                        : `当前模型不支持 ${value}`
                    : `${value} is not available for the current model and aspect ratio`,
            );
            return;
        }
        setResolution(value);
        setActiveSetting(null);
    };

    const billingCurrencyCode = selectedModel?.currencyCode ?? market.currencyCode;
    const selectedResolutionLabel = `${selectedResolutionOption?.resolution ?? resolution} · ${formatDisplayMoney(
        selectedResolutionOption?.unitPrice ?? 0,
        billingCurrencyCode,
        market.locale,
    )}`;
    const settingSheetTitle =
        activeSetting === 'ASPECT_RATIO'
            ? isZh
                ? '选择图片比例'
                : 'Choose aspect ratio'
            : activeSetting === 'QUANTITY'
              ? isZh
                  ? '选择生成张数'
                  : 'Choose quantity'
              : isZh
                ? '选择清晰度'
                : 'Choose resolution';

    return (
        <Subpage title={isZh ? 'AI 图片工坊' : 'AI Image Studio'} language={language} onBack={onBack}>
            {loading ? (
                <PageSkeleton label={isZh ? '正在加载图片工坊' : 'Loading image studio'} />
            ) : loadError ? (
                <EmptyState
                    icon={<CircleAlert />}
                    title={isZh ? '暂时无法加载' : 'Could not load'}
                    detail={loadError}
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void load()}
                />
            ) : !customer ? (
                <EmptyState
                    icon={<WandSparkles />}
                    title={isZh ? '登录后开始生图' : 'Sign in to create images'}
                    detail={
                        isZh
                            ? '生图费用从你的邀请返利可用余额中扣除。'
                            : 'Image fees use your available referral balance.'
                    }
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={onSignIn}
                />
            ) : !config?.enabled ? (
                <EmptyState
                    icon={<ImagePlus />}
                    title={isZh ? '图片工坊尚未开放' : 'Image Studio is not available'}
                    detail={
                        isZh
                            ? '店铺管理员启用中转站和至少一个模型后即可使用。'
                            : 'It will appear after the store enables a provider and model.'
                    }
                />
            ) : (
                <div className="ai-studio-shell">
                    <section className="ai-studio-composer">
                        <div className="ai-studio-prompt-wrap">
                            <textarea
                                maxLength={optimized ? 8000 : 2000}
                                rows={4}
                                value={prompt}
                                onChange={event => {
                                    setPrompt(event.target.value);
                                    if (optimized) setOptimized(false);
                                }}
                                placeholder={
                                    isZh
                                        ? '例如：一只白色保温杯放在浅色木桌上，晨光从左侧照入，干净高级的电商摄影…'
                                        : 'Example: A white insulated bottle on a light wood table, soft morning light from the left, clean premium ecommerce photography…'
                                }
                            />
                            <div className="ai-studio-prompt-tools">
                                <span>
                                    {prompt.length}/{optimized ? 8000 : 2000}
                                </span>
                                <div className="ai-studio-prompt-actions">
                                    {optimizerModelLabel ? (
                                        <span
                                            className="ai-studio-optimizer-model"
                                            title={optimizerModelIds.join(' / ')}
                                            aria-label={`${isZh ? '优化模型' : 'Optimizer model'}：${optimizerModelIds.join(' / ')}`}
                                        >
                                            <span>{isZh ? '优化模型' : 'Optimizer'}</span>
                                            <strong>{optimizerModelLabel}</strong>
                                        </span>
                                    ) : null}
                                    <button
                                        type="button"
                                        disabled={
                                            !config.promptOptimizationEnabled ||
                                            !prompt.trim() ||
                                            Boolean(busy) ||
                                            Boolean(
                                                promptQuota &&
                                                !promptQuota.daily.unlimited &&
                                                promptQuota.daily.remaining <= 0 &&
                                                !promptQuota.paidEnabled,
                                            )
                                        }
                                        onClick={() => void optimizePrompt()}
                                    >
                                        {busy === 'OPTIMIZE' ? (
                                            <LoaderCircle className="spin" />
                                        ) : (
                                            <Sparkles />
                                        )}
                                        {isZh ? '智能优化' : 'Improve prompt'}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div
                            className={`ai-studio-reference${referenceItems.length ? ' has-reference' : ''}`}
                            aria-label={isZh ? '参考图' : 'Reference images'}
                        >
                            {referenceItems.length ? (
                                <div className="ai-studio-reference-list" aria-live="polite">
                                    {referenceItems.map((item, index) => (
                                        <div
                                            key={item.id}
                                            className={`ai-studio-reference-card is-${item.state.toLowerCase()}`}
                                        >
                                            <div className="ai-studio-reference-preview">
                                                <img src={item.previewUrl} alt={item.fileName} />
                                                <span
                                                    className="ai-studio-reference-index"
                                                    aria-hidden="true"
                                                >
                                                    {index + 1}
                                                </span>
                                                {item.state === 'UPLOADING' ? (
                                                    <span
                                                        className="ai-studio-reference-preview-loading"
                                                        aria-hidden="true"
                                                    >
                                                        <LoaderCircle className="spin" />
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="ai-studio-reference-meta">
                                                <span
                                                    className={
                                                        item.state === 'SUCCEEDED'
                                                            ? 'is-success'
                                                            : item.state === 'FAILED'
                                                              ? 'is-error'
                                                              : 'is-uploading'
                                                    }
                                                >
                                                    {item.state === 'UPLOADING' ? (
                                                        <LoaderCircle className="spin" aria-hidden="true" />
                                                    ) : item.state === 'SUCCEEDED' ? (
                                                        <CheckCircle2 aria-hidden="true" />
                                                    ) : (
                                                        <CircleAlert aria-hidden="true" />
                                                    )}
                                                    {item.state === 'UPLOADING'
                                                        ? isZh
                                                            ? '正在上传'
                                                            : 'Uploading'
                                                        : item.state === 'SUCCEEDED'
                                                          ? isZh
                                                              ? '上传成功'
                                                              : 'Upload complete'
                                                          : isZh
                                                            ? '上传失败'
                                                            : 'Upload failed'}
                                                </span>
                                                <strong title={item.asset?.originalName || item.fileName}>
                                                    {item.asset?.originalName || item.fileName}
                                                </strong>
                                                <small title={item.error || undefined}>
                                                    {item.asset
                                                        ? `${formatReferenceSize(item.asset.byteSize)} · ${item.asset.width} × ${item.asset.height}`
                                                        : item.error ||
                                                          (isZh
                                                              ? '正在安全处理图片…'
                                                              : 'Processing image securely…')}
                                                </small>
                                            </div>
                                            <div className="ai-studio-reference-actions">
                                                <button
                                                    type="button"
                                                    aria-label={
                                                        isZh
                                                            ? `移除第 ${index + 1} 张参考图`
                                                            : `Remove reference image ${index + 1}`
                                                    }
                                                    onClick={() => removeReference(item.id)}
                                                >
                                                    <Trash2 aria-hidden="true" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                            {referenceItems.length < referenceImageLimit ? (
                                <label
                                    className={`ai-studio-reference-add${referenceItems.length ? ' is-compact' : ''}`}
                                >
                                    <span className="ai-studio-reference-add-icon" aria-hidden="true">
                                        <ImagePlus />
                                    </span>
                                    <span className="ai-studio-reference-add-copy">
                                        <strong>
                                            {referenceItems.length
                                                ? isZh
                                                    ? `继续添加（${referenceItems.length}/${referenceImageLimit}）`
                                                    : `Add more (${referenceItems.length}/${referenceImageLimit})`
                                                : isZh
                                                  ? '添加参考图'
                                                  : 'Add reference images'}
                                        </strong>
                                        <small>
                                            {isZh
                                                ? `可选 · 最多 ${referenceImageLimit} 张，单张最大 10MB`
                                                : `Optional · up to ${referenceImageLimit} images, 10MB each`}
                                        </small>
                                    </span>
                                    <input
                                        ref={referenceInputRef}
                                        type="file"
                                        multiple
                                        accept="image/png,image/jpeg,image/webp"
                                        onChange={event => {
                                            const files = Array.from(event.target.files ?? []);
                                            if (files.length) void uploadReferences(files);
                                        }}
                                    />
                                </label>
                            ) : null}
                            {referenceAssets.length ? (
                                <button
                                    type="button"
                                    className="ai-studio-reference-mode"
                                    aria-haspopup="dialog"
                                    aria-expanded={referenceSettingsOpen}
                                    onClick={() => setReferenceSettingsOpen(true)}
                                >
                                    <span>{isZh ? '参考图要求' : 'Reference instructions'}</span>
                                    <strong>
                                        {referenceInstruction.trim() ||
                                            referenceModeLabel(referenceMode, isZh)}
                                    </strong>
                                    <ChevronDown aria-hidden="true" />
                                </button>
                            ) : null}
                            {referenceError ? (
                                <div className="ai-studio-reference-error" role="alert">
                                    <CircleAlert aria-hidden="true" />
                                    <span>{referenceError}</span>
                                </div>
                            ) : null}
                        </div>
                        {optimized ? (
                            <div className="ai-studio-optimized">
                                <CheckCircle2 />
                                <span>{isZh ? `已优化：${optimizationReason}` : optimizationReason}</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPrompt(originalPrompt);
                                        setOptimized(false);
                                    }}
                                >
                                    {isZh ? '恢复原文' : 'Undo'}
                                </button>
                            </div>
                        ) : null}
                    </section>

                    <aside
                        className="ai-studio-controls"
                        aria-label={isZh ? '生成参数与结算' : 'Generation settings and checkout'}
                    >
                        <section className="ai-studio-options">
                            <h3>{isZh ? '选择生成方案' : 'Choose a generation option'}</h3>
                            <div
                                className="ai-studio-model-grid"
                                role="radiogroup"
                                aria-label={isZh ? '生成方案' : 'Generation option'}
                            >
                                {config.models.map(model => {
                                    const selected = model.code === selectedModel?.code;
                                    const option =
                                        model.resolutionOptions.find(
                                            item =>
                                                item.resolution === resolution &&
                                                item.supportedAspectRatios.includes(aspectRatio),
                                        ) ??
                                        model.resolutionOptions.find(item =>
                                            item.supportedAspectRatios.includes(aspectRatio),
                                        );
                                    const modelName = model.officialModelId;
                                    return (
                                        <button
                                            type="button"
                                            key={model.code}
                                            className={selected ? 'is-selected' : ''}
                                            role="radio"
                                            aria-checked={selected}
                                            aria-label={`${modelName}，${formatDisplayMoney(option?.unitPrice ?? 0, model.currencyCode, market.locale)}${isZh ? '每张' : ' per image'}`}
                                            onClick={() => selectModel(model.code)}
                                        >
                                            <span className="ai-studio-radio-mark" aria-hidden="true">
                                                {selected ? <Check /> : null}
                                            </span>
                                            <span className="ai-studio-model-description">{modelName}</span>
                                            <strong>
                                                {formatDisplayMoney(
                                                    option?.unitPrice ?? 0,
                                                    model.currencyCode,
                                                    market.locale,
                                                )}
                                                {isZh ? ' / 张' : ' / image'}
                                            </strong>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="ai-studio-option-row">
                                <SettingTrigger
                                    label={isZh ? '图片比例' : 'Aspect ratio'}
                                    value={aspectRatio}
                                    onClick={() => setActiveSetting('ASPECT_RATIO')}
                                />
                                <SettingTrigger
                                    label={isZh ? '生成张数' : 'Quantity'}
                                    value={String(quantity)}
                                    onClick={() => setActiveSetting('QUANTITY')}
                                />
                                <SettingTrigger
                                    label={isZh ? '清晰度' : 'Resolution'}
                                    value={selectedResolutionLabel}
                                    onClick={() => setActiveSetting('RESOLUTION')}
                                />
                            </div>
                        </section>

                        <section className="ai-studio-checkout">
                            <div className="ai-studio-settlement">
                                <div className="ai-studio-settlement-summary">
                                    <div className="ai-studio-settlement-amount">
                                        <small>{isZh ? '返利可用余额' : 'Available rewards'}</small>
                                        <strong className="is-balance">
                                            {formatDisplayMoney(balance, billingCurrencyCode, market.locale)}
                                        </strong>
                                    </div>
                                    <div className="ai-studio-settlement-amount" aria-live="polite">
                                        <small>{isZh ? '预计冻结金额' : 'Estimated hold'}</small>
                                        <strong>
                                            {formatDisplayMoney(
                                                estimatedPrice,
                                                billingCurrencyCode,
                                                market.locale,
                                            )}
                                        </strong>
                                    </div>
                                    <div className="ai-studio-settlement-refund">
                                        <RotateCcw aria-hidden="true" />
                                        <div>
                                            <strong>
                                                {isZh ? '按成功图片结算' : 'Charged for successful images'}
                                            </strong>
                                            <span>
                                                {isZh
                                                    ? `免费 ${freeRemaining} 张 + 付费 ${paidQuantity} 张；仅成功图片结算，失败自动释放${displayCurrencyCode === 'USDT' ? `；USDT 仅供估算展示，实际按 ${billingCurrencyCode} 结算` : ''}`
                                                    : `${freeRemaining} free + ${paidQuantity} paid; only successful images are charged${displayCurrencyCode === 'USDT' ? `; USDT is an estimate and settles in ${billingCurrencyCode}` : ''}`}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {actionError ? (
                                <div className="ai-studio-error">
                                    <CircleAlert />
                                    {actionError}
                                </div>
                            ) : null}
                            {refreshWarning ? (
                                <div className="ai-studio-error" role="status">
                                    <RefreshCw aria-hidden="true" />
                                    {refreshWarning}
                                </div>
                            ) : null}
                            {balance < estimatedPrice ? (
                                <div className="ai-studio-low-balance" role="alert">
                                    <CircleAlert aria-hidden="true" />
                                    <span>
                                        {isZh
                                            ? '返利可用余额不足，请先通过邀请返利获得余额。'
                                            : 'Not enough referral balance.'}
                                    </span>
                                </div>
                            ) : null}
                            {selectedQuota && selectedQuota.safety.remaining < quantity ? (
                                <p className="ai-studio-low-balance">
                                    {isZh
                                        ? '今天的生图安全额度不足，请降低张数或明天再试。'
                                        : 'Daily safety limit reached.'}
                                </p>
                            ) : null}
                            <label className="ai-studio-terms-row">
                                <input
                                    type="checkbox"
                                    checked={termsAccepted}
                                    onChange={event => setTermsAccepted(event.target.checked)}
                                />
                                <span>
                                    {isZh ? '我已阅读并同意' : 'I have read and accept'}{' '}
                                    <button
                                        type="button"
                                        onClick={event => {
                                            event.preventDefault();
                                            setTermsInfoOpen(true);
                                        }}
                                    >
                                        {isZh ? 'AI 图片服务条款' : 'AI image terms'}
                                    </button>
                                </span>
                            </label>
                        </section>

                        <div className="ai-studio-fixed-generate">
                            <button
                                className="ai-studio-generate-button"
                                type="button"
                                disabled={!canGenerate}
                                onClick={() => void generate()}
                            >
                                {busy === 'GENERATE' ? <LoaderCircle className="spin" /> : <WandSparkles />}
                                {isZh ? '开始生成' : 'Generate'}
                            </button>
                        </div>
                    </aside>

                    <section className="ai-studio-history">
                        <div className="ai-studio-history-heading">
                            <div>
                                <h3>{isZh ? '我的生成记录' : 'My generations'}</h3>
                                <button
                                    type="button"
                                    className="ai-studio-history-info"
                                    aria-label={isZh ? '查看生成记录说明' : 'View generation history details'}
                                    onClick={() => setHistoryInfoOpen(true)}
                                >
                                    <Info />
                                </button>
                            </div>
                            <button type="button" onClick={() => void load()}>
                                <RefreshCw />
                                {isZh ? '刷新' : 'Refresh'}
                            </button>
                        </div>
                        <div className="ai-studio-history-filters" role="tablist">
                            {(
                                [
                                    ['ALL', isZh ? '全部' : 'All'],
                                    ['SUCCESS', isZh ? '已完成' : 'Completed'],
                                    ['PROCESSING', isZh ? '生成中' : 'Processing'],
                                    ['FAILED', isZh ? '失败' : 'Failed'],
                                ] as Array<[HistoryFilter, string]>
                            ).map(([value, label]) => (
                                <button
                                    type="button"
                                    key={value}
                                    role="tab"
                                    aria-selected={historyFilter === value}
                                    className={historyFilter === value ? 'is-active' : ''}
                                    onClick={() => setHistoryFilter(value)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        {filteredJobs.length ? (
                            filteredJobs.map(job => (
                                <GenerationCard
                                    key={job.id}
                                    job={job}
                                    language={language}
                                    locale={market.locale}
                                    onCancel={() => void cancel(job.id)}
                                    onDeleteJob={() => setPendingDeleteJobId(job.id)}
                                    onRegenerate={() => regenerate(job)}
                                    onRefresh={() => void load()}
                                    onView={() => setSelectedJobId(job.id)}
                                />
                            ))
                        ) : (
                            <div className="ai-studio-empty">
                                {jobs.length
                                    ? isZh
                                        ? '当前筛选下暂无记录。'
                                        : 'No records match this filter.'
                                    : isZh
                                      ? '还没有生成记录，从上方输入一句描述开始。'
                                      : 'No generations yet. Start with a prompt above.'}
                            </div>
                        )}
                    </section>

                    {activeSetting ? (
                        <Sheet
                            title={settingSheetTitle}
                            language={language}
                            onClose={() => setActiveSetting(null)}
                            className="ai-studio-bottom-sheet"
                        >
                            <div
                                className="ai-studio-setting-sheet"
                                role="radiogroup"
                                aria-label={settingSheetTitle}
                            >
                                {activeSetting === 'ASPECT_RATIO'
                                    ? aspectRatios.map(value => (
                                          <SheetOption
                                              key={value}
                                              selected={value === aspectRatio}
                                              label={value}
                                              description={
                                                  aspectRatioSupports4K(selectedModel, value)
                                                      ? isZh
                                                          ? '支持 4K'
                                                          : 'Supports 4K'
                                                      : undefined
                                              }
                                              onClick={() => selectAspectRatio(value)}
                                          />
                                      ))
                                    : null}
                                {activeSetting === 'QUANTITY'
                                    ? Array.from({ length: config.maxQuantity }, (_, index) => index + 1).map(
                                          value => (
                                              <SheetOption
                                                  key={value}
                                                  selected={value === quantity}
                                                  label={
                                                      isZh
                                                          ? `${value} 张`
                                                          : `${value} image${value > 1 ? 's' : ''}`
                                                  }
                                                  onClick={() => {
                                                      setQuantity(value);
                                                      setActiveSetting(null);
                                                  }}
                                              />
                                          ),
                                      )
                                    : null}
                                {activeSetting === 'RESOLUTION'
                                    ? customerImageResolutions.map(value => {
                                          const availability = imageResolutionAvailability(
                                              selectedModel,
                                              value,
                                              aspectRatio,
                                          );
                                          return (
                                              <SheetOption
                                                  key={value}
                                                  selected={
                                                      availability.status === 'AVAILABLE' &&
                                                      selectedResolutionOption?.resolution === value
                                                  }
                                                  disabled={availability.status !== 'AVAILABLE'}
                                                  label={
                                                      availability.status === 'AVAILABLE'
                                                          ? `${value} · ${formatDisplayMoney(
                                                                availability.option.unitPrice,
                                                                billingCurrencyCode,
                                                                market.locale,
                                                            )}`
                                                          : value
                                                  }
                                                  description={
                                                      availability.status === 'AVAILABLE'
                                                          ? isZh
                                                              ? value === '1K'
                                                                  ? '适合社交媒体与日常使用'
                                                                  : '适合商品展示与精细查看'
                                                              : value === '1K'
                                                                ? 'Best for social and everyday use'
                                                                : 'Best for products and detailed viewing'
                                                          : isZh
                                                            ? '当前模型或比例不支持'
                                                            : 'Not supported for this model or ratio'
                                                  }
                                                  onClick={() => selectResolution(value)}
                                              />
                                          );
                                      })
                                    : null}
                            </div>
                        </Sheet>
                    ) : null}

                    {referenceSettingsOpen ? (
                        <Sheet
                            title={isZh ? '设置参考图要求' : 'Reference image instructions'}
                            language={language}
                            onClose={() => setReferenceSettingsOpen(false)}
                            className="ai-studio-bottom-sheet"
                        >
                            <div className="ai-studio-reference-sheet">
                                <div
                                    className="ai-studio-setting-sheet"
                                    role="radiogroup"
                                    aria-label={isZh ? '参考图用途' : 'Reference image role'}
                                >
                                    {referenceModeOptions(isZh).map(option => (
                                        <SheetOption
                                            key={option.value}
                                            selected={referenceMode === option.value}
                                            label={option.label}
                                            description={option.description}
                                            onClick={() => setReferenceMode(option.value)}
                                        />
                                    ))}
                                </div>
                                <label className="ai-studio-reference-instruction">
                                    <span>
                                        {isZh ? '具体参考要求（可选）' : 'Specific requirements (optional)'}
                                    </span>
                                    <textarea
                                        value={referenceInstruction}
                                        maxLength={500}
                                        rows={4}
                                        placeholder={
                                            isZh
                                                ? '例如：把图1的人物放到图2的室内场景中，保留人物面部特征和图2光线。'
                                                : 'Example: Place the person from image 1 into the scene from image 2 while preserving their face and the lighting.'
                                        }
                                        onChange={event => setReferenceInstruction(event.target.value)}
                                    />
                                    <small>{referenceInstruction.length}/500</small>
                                </label>
                                <button
                                    type="button"
                                    className="ai-studio-reference-sheet-done"
                                    onClick={() => setReferenceSettingsOpen(false)}
                                >
                                    {isZh ? '完成' : 'Done'}
                                </button>
                            </div>
                        </Sheet>
                    ) : null}

                    {termsInfoOpen ? (
                        <Sheet
                            title={isZh ? 'AI 图片服务条款' : 'AI image terms'}
                            language={language}
                            onClose={() => setTermsInfoOpen(false)}
                            className="ai-studio-bottom-sheet"
                        >
                            <div className="ai-studio-info-sheet">
                                <p>{isZh ? config.termsZh : config.termsEn}</p>
                                <small>
                                    {isZh ? '条款版本' : 'Terms version'}：{config.termsVersion}
                                </small>
                            </div>
                        </Sheet>
                    ) : null}

                    {historyInfoOpen ? (
                        <Sheet
                            title={isZh ? '生成记录说明' : 'Generation history'}
                            language={language}
                            onClose={() => setHistoryInfoOpen(false)}
                            className="ai-studio-bottom-sheet"
                        >
                            <div className="ai-studio-info-sheet">
                                <strong>
                                    {isZh
                                        ? `生成图片保留 ${config.outputRetentionDays} 天`
                                        : `Generated images are kept for ${config.outputRetentionDays} days`}
                                </strong>
                                <p>
                                    {isZh
                                        ? '请在保留期内下载需要的图片。删除记录不会退回已结算费用。'
                                        : 'Download images before they expire. Deleting a record does not refund settled charges.'}
                                </p>
                            </div>
                        </Sheet>
                    ) : null}

                    {selectedJob ? (
                        <Sheet
                            title={isZh ? '生成详情' : 'Generation details'}
                            language={language}
                            onClose={() => setSelectedJobId(null)}
                            className="ai-studio-bottom-sheet ai-studio-history-detail-sheet"
                        >
                            <GenerationDetail
                                job={selectedJob}
                                language={language}
                                locale={market.locale}
                                onNotify={onNotify}
                            />
                        </Sheet>
                    ) : null}
                    {pendingDeleteJobId ? (
                        <ConfirmationDialog
                            title={isZh ? '确认删除这条生成记录？' : 'Delete this generation?'}
                            description={
                                isZh
                                    ? '删除后将立即清理生成图并在前台隐藏任务；提示词、调用和计费审计记录仍按合规要求保留。'
                                    : 'Generated images will be removed and the task will be hidden. Compliance audit records remain.'
                            }
                            language={language}
                            busy={deletingJobId === pendingDeleteJobId}
                            onCancel={() => setPendingDeleteJobId(null)}
                            onConfirm={() => void deleteJob()}
                        />
                    ) : null}
                </div>
            )}
        </Subpage>
    );
}

function GenerationCard({
    job,
    language,
    locale,
    onCancel,
    onDeleteJob,
    onRegenerate,
    onRefresh,
    onView,
}: Readonly<{
    job: ImageGenerationJob;
    language: StorefrontLanguage;
    locale: string;
    onCancel(): void;
    onDeleteJob(): void;
    onRegenerate(): void;
    onRefresh(): void;
    onView(): void;
}>) {
    const isZh = language === 'zh';
    const preview = job.outputs.find(output => output.imageUrl) ?? job.outputs[0];
    const statusClass = job.state.toLowerCase();
    const progress = imageGenerationProgress(job);
    const dimensionSummary = summarizeImageOutputDimensions(job.outputs, job.aspectRatio);
    const actualSizeLabel = dimensionSummary.sharedDimensions
        ? dimensionSummary.sharedDimensions
        : dimensionSummary.distinctSizeCount > 1
          ? isZh
              ? `${dimensionSummary.distinctSizeCount} 种尺寸`
              : `${dimensionSummary.distinctSizeCount} sizes`
          : null;
    const [progressClock, setProgressClock] = useState(() => Date.now());
    useEffect(() => {
        if (!activeStates.has(job.state)) return;
        setProgressClock(Date.now());
        const interval = window.setInterval(() => setProgressClock(Date.now()), 1_000);
        return () => window.clearInterval(interval);
    }, [job.id, job.state]);
    const elapsedSeconds = imageGenerationElapsedSeconds(job.createdAt, progressClock);
    const amountLabel = activeStates.has(job.state)
        ? isZh
            ? `已冻结 ${formatBillingMoney(job.reservedAmount, job.currencyCode, locale)}`
            : `Held ${formatBillingMoney(job.reservedAmount, job.currencyCode, locale)}`
        : failedStates.has(job.state)
          ? isZh
              ? `已释放 ${formatBillingMoney(job.releasedAmount, job.currencyCode, locale)}`
              : `Released ${formatBillingMoney(job.releasedAmount, job.currencyCode, locale)}`
          : isZh
            ? `实付 ${formatBillingMoney(job.capturedAmount, job.currencyCode, locale)}`
            : `Paid ${formatBillingMoney(job.capturedAmount, job.currencyCode, locale)}`;
    return (
        <article className={`ai-generation-card is-${statusClass}`}>
            <button
                type="button"
                className="ai-generation-card-preview"
                aria-label={isZh ? '查看生成详情' : 'View generation details'}
                onClick={onView}
            >
                {preview?.imageUrl ? (
                    <SafeImage src={preview.imageUrl} alt={job.originalPrompt} />
                ) : (
                    <span aria-hidden="true">
                        {activeStates.has(job.state) ? <LoaderCircle className="spin" /> : <CircleAlert />}
                    </span>
                )}
                {job.outputs.length > 1 ? <small>+{job.outputs.length - 1}</small> : null}
            </button>
            <div className="ai-generation-card-content">
                <header>
                    <span className={`ai-generation-status is-${statusClass}`}>
                        {successStates.has(job.state) ? <CheckCircle2 /> : null}
                        {activeStates.has(job.state) ? <LoaderCircle /> : null}
                        {failedStates.has(job.state) ? <CircleAlert /> : null}
                        {stateLabel(job.state, isZh)}
                    </span>
                    <time dateTime={job.createdAt}>{formatGenerationTime(job.createdAt, locale, isZh)}</time>
                </header>
                <p>{job.originalPrompt}</p>
                {activeStates.has(job.state) ? (
                    <div className="ai-generation-progress">
                        <div>
                            <span className="ai-generation-progress-copy">
                                {job.state === 'UNKNOWN'
                                    ? isZh
                                        ? '正在核对上游结果…'
                                        : 'Checking the provider result…'
                                    : isZh
                                      ? '任务正在处理中，请稍候…'
                                      : 'Your generation is in progress…'}
                            </span>
                            <strong aria-live="polite">
                                {progress.determinate
                                    ? `${progress.processed}/${progress.total} · ${progress.percentage}%`
                                    : isZh
                                      ? `已等待 ${formatGenerationElapsed(elapsedSeconds, true)}`
                                      : `Elapsed ${formatGenerationElapsed(elapsedSeconds, false)}`}
                            </strong>
                        </div>
                        <progress
                            max={progress.total}
                            value={progress.determinate ? progress.processed : undefined}
                            aria-label={
                                progress.determinate
                                    ? isZh
                                        ? `已处理 ${progress.processed}/${progress.total} 张，${progress.percentage}%`
                                        : `${progress.processed} of ${progress.total} processed, ${progress.percentage}%`
                                    : isZh
                                      ? `图片生成中，已等待 ${formatGenerationElapsed(elapsedSeconds, true)}`
                                      : `Image generation in progress, elapsed ${formatGenerationElapsed(elapsedSeconds, false)}`
                            }
                        />
                    </div>
                ) : job.errorMessage ? (
                    <span className="ai-generation-error-copy">
                        {job.errorMessage}
                        {failureSuggestion(job.outputs.find(output => output.failureCode)?.failureCode, isZh)}
                    </span>
                ) : null}
                <div className="ai-generation-meta">
                    <span>{isZh ? `目标 ${job.aspectRatio}` : `Target ${job.aspectRatio}`}</span>
                    <span>{job.resolution}</span>
                    <span>{isZh ? `${job.quantity} 张` : `${job.quantity} images`}</span>
                    {actualSizeLabel ? (
                        <span className={dimensionSummary.mismatchCount ? 'is-mismatch' : 'is-actual-size'}>
                            {isZh ? `实际 ${actualSizeLabel}` : `Actual ${actualSizeLabel}`}
                        </span>
                    ) : null}
                </div>
                {dimensionSummary.mismatchCount ? (
                    <div className="ai-generation-ratio-warning">
                        <CircleAlert aria-hidden="true" />
                        <span>
                            {isZh
                                ? `${dimensionSummary.mismatchCount} 张图片的实际比例与目标 ${job.aspectRatio} 不一致`
                                : `${dimensionSummary.mismatchCount} output${
                                      dimensionSummary.mismatchCount > 1 ? 's' : ''
                                  } do not match target ${job.aspectRatio}`}
                        </span>
                    </div>
                ) : null}
                <footer>
                    <strong>{amountLabel}</strong>
                    <div>
                        <button type="button" onClick={onView}>
                            <Eye />
                            {isZh ? '查看' : 'View'}
                        </button>
                        {job.state === 'UNKNOWN' ? (
                            <button type="button" onClick={onRefresh}>
                                <RefreshCw />
                                {isZh ? '刷新状态' : 'Refresh status'}
                            </button>
                        ) : job.outputs.some(output => output.state === 'QUEUED') ? (
                            <button type="button" onClick={onCancel}>
                                <X />
                                {isZh ? '取消' : 'Cancel'}
                            </button>
                        ) : terminalStates.has(job.state) ? (
                            <button type="button" onClick={onRegenerate}>
                                <RotateCcw />
                                {isZh ? '再次创作' : 'Use again'}
                            </button>
                        ) : null}
                        {terminalStates.has(job.state) ? (
                            <button
                                type="button"
                                className="ai-generation-delete-button"
                                aria-label={isZh ? '删除记录' : 'Delete record'}
                                onClick={onDeleteJob}
                            >
                                <Trash2 />
                            </button>
                        ) : null}
                    </div>
                </footer>
            </div>
        </article>
    );
}

function GenerationDetail({
    job,
    language,
    locale,
    onNotify,
}: Readonly<{
    job: ImageGenerationJob;
    language: StorefrontLanguage;
    locale: string;
    onNotify(message: string): void;
}>) {
    const isZh = language === 'zh';
    const [previewOutput, setPreviewOutput] = useState<ImageGenerationOutput | null>(null);
    const [downloadingOutputId, setDownloadingOutputId] = useState<string | null>(null);
    const downloadOutput = async (output: ImageGenerationOutput) => {
        const source = output.downloadUrl ?? output.imageUrl;
        if (!source || downloadingOutputId) return;
        setDownloadingOutputId(output.id);
        try {
            await saveGeneratedImage(source, `ai-image-${job.id}-${output.outputIndex + 1}`);
            onNotify(isZh ? '图片已保存' : 'Image saved');
        } catch {
            onNotify(
                isZh ? '下载失败，请刷新页面后重试' : 'Download failed. Refresh the page and try again.',
            );
        } finally {
            setDownloadingOutputId(null);
        }
    };
    const settlementLabel =
        job.state === 'UNKNOWN'
            ? isZh
                ? '结果核对中，暂不结算'
                : 'Result pending, not settled'
            : activeStates.has(job.state)
              ? isZh
                  ? `已冻结 ${formatBillingMoney(job.reservedAmount, job.currencyCode, locale)}`
                  : `Held ${formatBillingMoney(job.reservedAmount, job.currencyCode, locale)}`
              : failedStates.has(job.state)
                ? isZh
                    ? `已释放 ${formatBillingMoney(job.releasedAmount, job.currencyCode, locale)}`
                    : `Released ${formatBillingMoney(job.releasedAmount, job.currencyCode, locale)}`
                : isZh
                  ? `实付 ${formatBillingMoney(job.capturedAmount, job.currencyCode, locale)}`
                  : `Paid ${formatBillingMoney(job.capturedAmount, job.currencyCode, locale)}`;
    const dimensionSummary = summarizeImageOutputDimensions(job.outputs, job.aspectRatio);
    const actualSizeLabel = dimensionSummary.sharedDimensions
        ? dimensionSummary.sharedDimensions
        : dimensionSummary.distinctSizeCount > 1
          ? isZh
              ? `${dimensionSummary.distinctSizeCount} 种尺寸`
              : `${dimensionSummary.distinctSizeCount} sizes`
          : null;
    return (
        <div className="ai-generation-detail">
            <div className="ai-generation-detail-summary">
                <span className={`ai-generation-status is-${job.state.toLowerCase()}`}>
                    {stateLabel(job.state, isZh)}
                </span>
                <strong>{settlementLabel}</strong>
            </div>
            <p>{job.originalPrompt}</p>
            <div className="ai-generation-meta">
                <span>{isZh ? `目标 ${job.aspectRatio}` : `Target ${job.aspectRatio}`}</span>
                <span>{job.resolution}</span>
                <span>{isZh ? `${job.quantity} 张` : `${job.quantity} images`}</span>
                {actualSizeLabel ? (
                    <span className={dimensionSummary.mismatchCount ? 'is-mismatch' : 'is-actual-size'}>
                        {isZh ? `实际 ${actualSizeLabel}` : `Actual ${actualSizeLabel}`}
                    </span>
                ) : null}
            </div>
            {dimensionSummary.mismatchCount ? (
                <div className="ai-generation-ratio-warning">
                    <CircleAlert aria-hidden="true" />
                    <span>
                        {isZh
                            ? `${dimensionSummary.mismatchCount} 张图片的实际比例与目标 ${job.aspectRatio} 不一致`
                            : `${dimensionSummary.mismatchCount} output${
                                  dimensionSummary.mismatchCount > 1 ? 's' : ''
                              } do not match target ${job.aspectRatio}`}
                    </span>
                </div>
            ) : null}
            <div className="ai-generation-grid">
                {job.outputs.map(output => {
                    const dimensionsLabel = formatImageDimensions(output);
                    const ratioMismatch = imageAspectRatioMismatch(job.aspectRatio, output);
                    return (
                        <div
                            key={output.id}
                            className={`ai-generation-output is-${output.state.toLowerCase()}`}
                        >
                            {output.imageUrl ? (
                                <button
                                    type="button"
                                    className="ai-generation-output-preview"
                                    style={{
                                        aspectRatio: generationOutputAspectRatio(job.aspectRatio, output),
                                    }}
                                    aria-label={
                                        isZh
                                            ? `全屏查看第 ${output.outputIndex + 1} 张图片`
                                            : `View image ${output.outputIndex + 1} fullscreen`
                                    }
                                    onClick={() => setPreviewOutput(output)}
                                >
                                    <SafeImage
                                        src={output.imageUrl}
                                        alt={`${job.originalPrompt} ${output.outputIndex + 1}`}
                                    />
                                    {dimensionsLabel ? (
                                        <span
                                            className={`ai-generation-output-size${
                                                ratioMismatch ? ' is-mismatch' : ''
                                            }`}
                                        >
                                            {dimensionsLabel}
                                        </span>
                                    ) : null}
                                    <span aria-hidden="true">
                                        <Maximize2 />
                                        {isZh ? '全屏' : 'Fullscreen'}
                                    </span>
                                </button>
                            ) : (
                                <div className="ai-generation-placeholder">
                                    {['QUEUED', 'RUNNING'].includes(output.state) ? (
                                        <LoaderCircle className="spin" />
                                    ) : (
                                        <CircleAlert />
                                    )}
                                    <span>{stateLabel(output.state, isZh)}</span>
                                    {output.errorMessage ? (
                                        <small>
                                            {output.errorMessage}
                                            {failureSuggestion(output.failureCode, isZh)}
                                        </small>
                                    ) : null}
                                </div>
                            )}
                            <div className="ai-generation-output-actions">
                                {output.imageUrl ? (
                                    <button type="button" onClick={() => setPreviewOutput(output)}>
                                        <Eye />
                                        {isZh ? '查看' : 'View'}
                                    </button>
                                ) : null}
                                {output.downloadUrl || output.imageUrl ? (
                                    <button
                                        type="button"
                                        disabled={downloadingOutputId === output.id}
                                        onClick={() => void downloadOutput(output)}
                                    >
                                        <ArrowDownToLine />
                                        {downloadingOutputId === output.id
                                            ? isZh
                                                ? '保存中'
                                                : 'Saving'
                                            : isZh
                                              ? '下载'
                                              : 'Download'}
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    );
                })}
            </div>
            {previewOutput?.imageUrl ? (
                <GenerationImagePreview
                    imageUrl={previewOutput.imageUrl}
                    alt={`${job.originalPrompt} ${previewOutput.outputIndex + 1}`}
                    title={
                        isZh
                            ? `生成图片 ${previewOutput.outputIndex + 1}/${job.outputs.length}`
                            : `Generated image ${previewOutput.outputIndex + 1}/${job.outputs.length}`
                    }
                    language={language}
                    downloading={downloadingOutputId === previewOutput.id}
                    onClose={() => setPreviewOutput(null)}
                    onDownload={() => downloadOutput(previewOutput)}
                />
            ) : null}
        </div>
    );
}

function GenerationImagePreview({
    imageUrl,
    alt,
    title,
    language,
    downloading,
    onClose,
    onDownload,
}: Readonly<{
    imageUrl: string;
    alt: string;
    title: string;
    language: StorefrontLanguage;
    downloading: boolean;
    onClose(): void;
    onDownload(): Promise<void>;
}>) {
    const isZh = language === 'zh';
    const dialogRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);
    useEffect(() => {
        previousFocusRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.focus());
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusableElements = Array.from(
                dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'),
            ).filter(element => element !== dialogRef.current && !element.hidden);
            if (!focusableElements.length) {
                event.preventDefault();
                event.stopImmediatePropagation();
                dialogRef.current.focus();
                return;
            }
            const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
            const nextIndex = event.shiftKey
                ? currentIndex <= 0
                    ? focusableElements.length - 1
                    : currentIndex - 1
                : currentIndex < 0 || currentIndex === focusableElements.length - 1
                  ? 0
                  : currentIndex + 1;
            event.preventDefault();
            event.stopImmediatePropagation();
            focusableElements[nextIndex].focus();
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            window.removeEventListener('keydown', handleKeyDown, true);
            document.body.style.overflow = previousOverflow;
            previousFocusRef.current?.focus();
        };
    }, []);

    const content = (
        <div className="ai-generation-lightbox" role="presentation">
            <button
                type="button"
                className="ai-generation-lightbox-mask"
                aria-label={isZh ? '关闭全屏预览' : 'Close fullscreen preview'}
                onClick={onClose}
            />
            <div
                ref={dialogRef}
                className="ai-generation-lightbox-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
            >
                <header>
                    <strong>{title}</strong>
                    <button type="button" onClick={onClose} aria-label={isZh ? '关闭' : 'Close'}>
                        <X aria-hidden="true" />
                    </button>
                </header>
                <div className="ai-generation-lightbox-media">
                    <SafeImage src={imageUrl} alt={alt} />
                </div>
                <footer>
                    <button type="button" disabled={downloading} onClick={() => void onDownload()}>
                        <ArrowDownToLine />
                        {downloading
                            ? isZh
                                ? '保存中…'
                                : 'Saving…'
                            : isZh
                              ? '下载原图'
                              : 'Download original'}
                    </button>
                </footer>
            </div>
        </div>
    );
    return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

function ConfirmationDialog({
    title,
    description,
    language,
    busy,
    onCancel,
    onConfirm,
}: Readonly<{
    title: string;
    description: string;
    language: StorefrontLanguage;
    busy: boolean;
    onCancel(): void;
    onConfirm(): void;
}>) {
    const isZh = language === 'zh';
    const cancelButtonRef = useRef<HTMLButtonElement>(null);
    const onCancelRef = useRef(onCancel);
    useEffect(() => {
        onCancelRef.current = onCancel;
    }, [onCancel]);
    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const focusFrame = window.requestAnimationFrame(() => cancelButtonRef.current?.focus());
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || busy) return;
            event.preventDefault();
            onCancelRef.current();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(focusFrame);
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
        };
    }, [busy]);
    const content = (
        <div className="ai-confirmation-dialog-layer" role="presentation">
            <button
                type="button"
                className="ai-confirmation-dialog-mask"
                aria-label={isZh ? '取消删除' : 'Cancel deletion'}
                disabled={busy}
                onClick={onCancel}
            />
            <section
                className="ai-confirmation-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="ai-delete-confirmation-title"
                aria-describedby="ai-delete-confirmation-description"
            >
                <span className="ai-confirmation-dialog-icon" aria-hidden="true">
                    <Trash2 />
                </span>
                <h2 id="ai-delete-confirmation-title">{title}</h2>
                <p id="ai-delete-confirmation-description">{description}</p>
                <footer>
                    <button ref={cancelButtonRef} type="button" disabled={busy} onClick={onCancel}>
                        {isZh ? '取消' : 'Cancel'}
                    </button>
                    <button type="button" className="is-danger" disabled={busy} onClick={onConfirm}>
                        {busy ? <LoaderCircle className="spin" /> : <Trash2 />}
                        {busy ? (isZh ? '删除中…' : 'Deleting…') : isZh ? '确认删除' : 'Delete'}
                    </button>
                </footer>
            </section>
        </div>
    );
    return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

function referenceModeOptions(isZh: boolean): Array<{
    value: ImageReferenceMode;
    label: string;
    description: string;
}> {
    return [
        {
            value: 'PRODUCT',
            label: isZh ? '商品 / 物体主体' : 'Product / object',
            description: isZh
                ? '保留外形、材质、颜色和品牌细节'
                : 'Preserve shape, material, color, and brand details',
        },
        {
            value: 'IDENTITY',
            label: isZh ? '人物主体' : 'Person identity',
            description: isZh ? '保留人物面部与身份特征' : 'Preserve facial and identity characteristics',
        },
        {
            value: 'STYLE',
            label: isZh ? '风格参考' : 'Visual style',
            description: isZh ? '参考色彩、质感和视觉氛围' : 'Use its palette, texture, and visual mood',
        },
        {
            value: 'COMPOSITION',
            label: isZh ? '构图 / 场景参考' : 'Composition / scene',
            description: isZh
                ? '参考空间关系、布局和镜头'
                : 'Use its layout, spatial relationships, and framing',
        },
        {
            value: 'EDIT',
            label: isZh ? '编辑原图' : 'Edit source image',
            description: isZh ? '只改动明确提出的区域' : 'Change only the explicitly requested areas',
        },
    ];
}

function referenceModeLabel(mode: ImageReferenceMode, isZh: boolean): string {
    return (
        referenceModeOptions(isZh).find(option => option.value === mode)?.label ??
        (isZh ? '请设置参考要求' : 'Set reference instructions')
    );
}

function SettingTrigger({
    label,
    value,
    onClick,
}: Readonly<{ label: string; value: string; onClick(): void }>) {
    return (
        <button type="button" className="ai-studio-setting-trigger" onClick={onClick}>
            <span>{label}</span>
            <strong>{value}</strong>
            <ChevronDown aria-hidden="true" />
        </button>
    );
}

function SheetOption({
    label,
    description,
    selected,
    disabled = false,
    onClick,
}: Readonly<{
    label: string;
    description?: string;
    selected: boolean;
    disabled?: boolean;
    onClick(): void;
}>) {
    return (
        <button
            type="button"
            className={selected ? 'is-selected' : ''}
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={onClick}
        >
            <span>
                <strong>{label}</strong>
                {description ? <small>{description}</small> : null}
            </span>
            <i aria-hidden="true">{selected ? <Check /> : null}</i>
        </button>
    );
}

function formatGenerationElapsed(totalSeconds: number, isZh: boolean): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 1) return isZh ? `${seconds} 秒` : `${seconds}s`;
    return isZh ? `${minutes} 分 ${seconds} 秒` : `${minutes}m ${seconds}s`;
}

async function saveGeneratedImage(url: string, fileNameBase: string): Promise<void> {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`Image download failed (${response.status})`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('The generated image is empty');
    const extension =
        {
            'image/avif': 'avif',
            'image/gif': 'gif',
            'image/jpeg': 'jpg',
            'image/png': 'png',
            'image/webp': 'webp',
        }[blob.type.toLowerCase()] ?? 'png';
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${fileNameBase}.${extension}`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
}

function stateLabel(state: string, isZh: boolean): string {
    const zh: Record<string, string> = {
        QUEUED: '排队中',
        RUNNING: '生成中',
        SUCCEEDED: '成功',
        PARTIAL_SUCCESS: '部分成功',
        FAILED: '失败已退回',
        UNKNOWN: '结果待确认',
        CANCELLED: '已取消',
    };
    const en: Record<string, string> = {
        QUEUED: 'Queued',
        RUNNING: 'Generating',
        SUCCEEDED: 'Succeeded',
        PARTIAL_SUCCESS: 'Partial success',
        FAILED: 'Failed / released',
        UNKNOWN: 'Checking result',
        CANCELLED: 'Cancelled',
    };
    return (isZh ? zh : en)[state] ?? state;
}
function quotaRemainingLabel(quota: ImagePromptQuotaStatus['daily']): string {
    return quota.unlimited ? '不限' : `${quota.remaining}/${quota.limit}`;
}
function formatGenerationTime(value: string, locale: string, isZh: boolean): string {
    const createdAt = new Date(value);
    const now = new Date();
    const sameDay = createdAt.toDateString() === now.toDateString();
    const time = new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(createdAt);
    return sameDay ? `${isZh ? '今天' : 'Today'} ${time}` : new Intl.DateTimeFormat(locale).format(createdAt);
}
function formatReferenceSize(byteSize: number): string {
    if (!Number.isFinite(byteSize) || byteSize <= 0) return '0 KB';
    const kilobytes = byteSize / 1024;
    if (kilobytes < 1024) return `${Math.max(1, Math.round(kilobytes))} KB`;
    return `${(kilobytes / 1024).toFixed(1)} MB`;
}
function requestId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function stableRequestId(ref: { current: StableImageStudioRequest | null }, fingerprint: string): string {
    ref.current = stableImageStudioRequest(ref.current, fingerprint, requestId);
    return ref.current.idempotencyKey;
}
function actionErrorMessage(error: unknown, isZh: boolean): string {
    if (error instanceof ShopApiTimeoutError && error.resultUnknown) {
        return isZh
            ? '提交结果暂时无法确认。请保持当前参数后重试，系统会复用同一请求，不会重复创建任务。'
            : 'The result is temporarily unknown. Retry with the same settings to reuse this request.';
    }
    return errorMessage(error);
}
function failureSuggestion(failureCode: string | null | undefined, isZh: boolean): string {
    if (!failureCode) return '';
    if (failureCode === 'UNKNOWN_RESULT' || failureCode.startsWith('UPSTREAM_')) {
        return isZh ? ' 建议稍后使用相同参数重试。' : ' Retry later with the same settings.';
    }
    if (failureCode === 'CREDENTIAL_UNAVAILABLE') {
        return isZh ? ' 请稍后重试或联系管理员检查生图 Key。' : ' Retry later or contact an administrator.';
    }
    if (failureCode === 'IMAGE_RESOLUTION_MISMATCH') {
        return isZh ? ' 可降低清晰度或更换画幅后重试。' : ' Try a lower resolution or another aspect ratio.';
    }
    return isZh ? ' 可稍后重新创作。' : ' You can retry this generation later.';
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
