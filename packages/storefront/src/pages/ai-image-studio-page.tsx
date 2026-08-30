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
    RefreshCw,
    RotateCcw,
    Sparkles,
    Trash2,
    WandSparkles,
    X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ShopApi } from '../api';
import { PageSkeleton } from '../route-loading';
import { EmptyState, Sheet, Subpage } from '../storefront-ui/page-shell';
import { SafeImage } from '../storefront-ui/product-display';
import {
    ActiveCustomer,
    ImageGenerationJob,
    ImageModelQuotaStatus,
    ImagePrivateAssetView,
    ImagePromptQuotaStatus,
    ImageReferenceMode,
    ImageResolution,
    ImageStudioConfig,
    MarketConfig,
    StorefrontLanguage,
} from '../types';

import { customerImageResolutions, imageResolutionAvailability } from './ai-image-studio-resolution';

interface AiImageStudioPageProps {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
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
const activeStates = new Set(['QUEUED', 'RUNNING', 'UNKNOWN']);
const terminalStates = new Set(['PARTIAL_SUCCESS', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
const successStates = new Set(['PARTIAL_SUCCESS', 'SUCCEEDED']);
const failedStates = new Set(['FAILED', 'CANCELLED']);

type AiStudioSetting = 'ASPECT_RATIO' | 'QUANTITY' | 'RESOLUTION';
type HistoryFilter = 'ALL' | 'SUCCESS' | 'PROCESSING' | 'FAILED';

export function AiImageStudioPage(props: Readonly<AiImageStudioPageProps>) {
    const { api, customer, market, language, onBack, onSignIn, onNotify } = props;
    const isZh = language === 'zh';
    const [config, setConfig] = useState<ImageStudioConfig | null>(null);
    const [balance, setBalance] = useState(0);
    const [promptQuota, setPromptQuota] = useState<ImagePromptQuotaStatus | null>(null);
    const [modelQuotas, setModelQuotas] = useState<ImageModelQuotaStatus[]>([]);
    const [jobs, setJobs] = useState<ImageGenerationJob[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [prompt, setPrompt] = useState('');
    const [originalPrompt, setOriginalPrompt] = useState('');
    const [optimized, setOptimized] = useState(false);
    const [optimizationReason, setOptimizationReason] = useState('');
    const [modelCode, setModelCode] = useState('');
    const [aspectRatio, setAspectRatio] = useState('1:1');
    const [resolution, setResolution] = useState<ImageResolution>('1K');
    const [quantity, setQuantity] = useState(1);
    // Consent must be an explicit customer action. Keeping this false also
    // prevents a stale form state from silently authorizing a new charge.
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [referenceAsset, setReferenceAsset] = useState<ImagePrivateAssetView | null>(null);
    const [referenceMode, setReferenceMode] = useState<ImageReferenceMode>('NONE');
    const [referenceBusy, setReferenceBusy] = useState(false);
    const referenceInputRef = useRef<HTMLInputElement>(null);
    const [activeSetting, setActiveSetting] = useState<AiStudioSetting | null>(null);
    const [termsInfoOpen, setTermsInfoOpen] = useState(false);
    const [historyInfoOpen, setHistoryInfoOpen] = useState(false);
    const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('ALL');
    const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
    const [busy, setBusy] = useState<'OPTIMIZE' | 'GENERATE' | ''>('');
    const [actionError, setActionError] = useState('');
    const pollStartedAt = useRef(Date.now());

    const load = useCallback(async () => {
        setLoadError('');
        try {
            const studioConfig = await api.imageStudioConfig();
            setConfig(studioConfig);
            setModelCode(
                current => current || studioConfig.defaultModelCode || studioConfig.models[0]?.code || '',
            );
            if (customer) {
                const [availableBalance, history, currentPromptQuota, currentModelQuotas] = await Promise.all(
                    [
                        api.imageStudioBalance(),
                        api.myImageGenerationJobs(0, 20),
                        api.imagePromptQuotaStatus(),
                        api.imageModelQuotaStatus(),
                    ],
                );
                setBalance(availableBalance);
                setJobs(history.items);
                setPromptQuota(currentPromptQuota);
                setModelQuotas(currentModelQuotas);
            }
        } catch (error) {
            setLoadError(errorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [api, customer]);

    useEffect(() => {
        void load();
    }, [load]);
    useEffect(() => {
        // Consent and private reference assets belong to a customer session;
        // never carry either across logout/login changes.
        setTermsAccepted(false);
        setReferenceAsset(null);
        setReferenceMode('NONE');
        if (referenceInputRef.current) referenceInputRef.current.value = '';
    }, [customer?.id]);
    useEffect(() => {
        if (!jobs.some(job => activeStates.has(job.state))) return;
        const timeout = window.setTimeout(
            () => {
                void load();
            },
            Date.now() - pollStartedAt.current < 60_000 ? 2_000 : 5_000,
        );
        return () => window.clearTimeout(timeout);
    }, [jobs, load]);

    const selectedModel = config?.models.find(model => model.code === modelCode) ?? config?.models[0];
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
    const canGenerate = Boolean(
        customer &&
        config?.enabled &&
        selectedModel &&
        selectedResolutionOption &&
        prompt.trim() &&
        termsAccepted &&
        balance >= estimatedPrice &&
        (selectedQuota?.safety.remaining ?? 0) >= quantity &&
        (paidQuantity === 0 || Boolean(selectedQuota?.paidAfterFreeEnabled)) &&
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
        setBusy('OPTIMIZE');
        setActionError('');
        try {
            const paidPrompt = Boolean(
                promptQuota && !promptQuota.daily.unlimited && promptQuota.daily.remaining <= 0,
            );
            const result = await api.optimizeImagePrompt(prompt, referenceMode, {
                expectedPrice: paidPrompt ? promptQuota?.paidPrice : null,
                currencyCode: paidPrompt ? promptQuota?.currencyCode : null,
                idempotencyKey: requestId(),
            });
            setOriginalPrompt(prompt);
            setPrompt(result.optimizedPrompt);
            setOptimized(true);
            setOptimizationReason(result.recommendationReason);
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
            setActionError(errorMessage(error));
        } finally {
            setBusy('');
        }
    };

    const uploadReference = async (file: File) => {
        if (!termsAccepted) {
            setActionError(isZh ? '请先阅读并同意 AI 图片服务条款。' : 'Accept the AI image terms first.');
            return;
        }
        setReferenceBusy(true);
        setActionError('');
        try {
            const uploaded = await api.uploadImageReference(file, termsAccepted);
            setReferenceAsset(uploaded);
            setReferenceMode('PRODUCT');
            onNotify(isZh ? '参考图已上传，可继续生成' : 'Reference image uploaded');
        } catch (error) {
            setActionError(errorMessage(error));
        } finally {
            setReferenceBusy(false);
        }
    };

    const clearReference = () => {
        setReferenceAsset(null);
        setReferenceMode('NONE');
        if (referenceInputRef.current) referenceInputRef.current.value = '';
    };

    const generate = async () => {
        if (!canGenerate || !selectedModel || !selectedResolutionOption || !config) return;
        setBusy('GENERATE');
        setActionError('');
        try {
            const job = await api.createImageGeneration({
                modelCode: selectedModel.code,
                prompt: optimized ? originalPrompt || prompt : prompt,
                optimizedPrompt: optimized ? prompt : null,
                referenceAssetId: referenceAsset?.id ?? null,
                referenceMode,
                aspectRatio,
                resolution: selectedResolutionOption.resolution,
                quantity,
                expectedUnitPrice: selectedResolutionOption.unitPrice,
                expectedChargeAmount: estimatedPrice,
                currencyCode: selectedModel.currencyCode,
                idempotencyKey: requestId(),
                termsAccepted,
            });
            pollStartedAt.current = Date.now();
            setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
            setBalance(value => Math.max(0, value - job.reservedAmount));
            const [nextPromptQuota, nextModelQuotas] = await Promise.all([
                api.imagePromptQuotaStatus(),
                api.imageModelQuotaStatus(),
            ]);
            setPromptQuota(nextPromptQuota);
            setModelQuotas(nextModelQuotas);
            onNotify(isZh ? '任务已提交，正在逐张生成' : 'Generation queued');
        } catch (error) {
            setActionError(errorMessage(error));
        } finally {
            setBusy('');
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
    const deleteOutput = async (outputId: string) => {
        try {
            await api.deleteMyGeneratedImage(outputId);
            await load();
        } catch (error) {
            setActionError(errorMessage(error));
        }
    };
    const deleteJob = async (id: string) => {
        const confirmed = window.confirm(
            isZh
                ? '删除后将立即清理生成图并在前台隐藏任务；提示词、调用和计费审计记录仍按合规要求保留。是否继续？'
                : 'This removes generated images and hides the task. Audit records remain for compliance. Continue?',
        );
        if (!confirmed) return;
        try {
            await api.deleteMyImageGenerationJob(id);
            await load();
        } catch (error) {
            setActionError(errorMessage(error));
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
    const selectedResolutionLabel = `${selectedResolutionOption?.resolution ?? resolution} · ${formatBillingMoney(
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
                                    {busy === 'OPTIMIZE' ? <LoaderCircle className="spin" /> : <Sparkles />}
                                    {isZh ? '智能优化' : 'Improve prompt'}
                                </button>
                            </div>
                        </div>
                        <div className="ai-studio-reference" aria-label={isZh ? '参考图' : 'Reference image'}>
                            <label className={referenceBusy ? 'is-disabled' : undefined}>
                                <ImagePlus aria-hidden="true" />
                                {referenceBusy
                                    ? isZh
                                        ? '上传中…'
                                        : 'Uploading…'
                                    : isZh
                                      ? '添加参考图'
                                      : 'Add reference'}
                                <input
                                    ref={referenceInputRef}
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    disabled={referenceBusy}
                                    onChange={event => {
                                        const file = event.target.files?.[0];
                                        if (file) void uploadReference(file);
                                    }}
                                />
                            </label>
                            {referenceAsset ? (
                                <>
                                    <select
                                        aria-label={isZh ? '参考图用途' : 'Reference image role'}
                                        value={referenceMode}
                                        onChange={event =>
                                            setReferenceMode(event.target.value as ImageReferenceMode)
                                        }
                                    >
                                        <option value="PRODUCT">{isZh ? '商品主体' : 'Product'}</option>
                                        <option value="STYLE">{isZh ? '风格参考' : 'Style'}</option>
                                        <option value="COMPOSITION">
                                            {isZh ? '构图参考' : 'Composition'}
                                        </option>
                                        <option value="EDIT">{isZh ? '编辑原图' : 'Edit'}</option>
                                    </select>
                                    <div className="ai-studio-reference-preview">
                                        {referenceAsset.previewUrl ? (
                                            <img
                                                src={referenceAsset.previewUrl}
                                                alt={referenceAsset.originalName}
                                            />
                                        ) : (
                                            <span aria-label={referenceAsset.originalName}>参考图</span>
                                        )}
                                        <span>{referenceAsset.originalName}</span>
                                        <button
                                            type="button"
                                            aria-label={isZh ? '移除参考图' : 'Remove reference image'}
                                            onClick={clearReference}
                                        >
                                            <X aria-hidden="true" />
                                        </button>
                                    </div>
                                </>
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
                                        aria-label={`${modelName}，${formatBillingMoney(option?.unitPrice ?? 0, model.currencyCode, market.locale)}${isZh ? '每张' : ' per image'}`}
                                        onClick={() => selectModel(model.code)}
                                    >
                                        <span className="ai-studio-radio-mark" aria-hidden="true">
                                            {selected ? <Check /> : null}
                                        </span>
                                        <span className="ai-studio-model-description">{modelName}</span>
                                        <strong>
                                            {formatBillingMoney(
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
                                        {formatBillingMoney(balance, billingCurrencyCode, market.locale)}
                                    </strong>
                                </div>
                                <div className="ai-studio-settlement-amount" aria-live="polite">
                                    <small>{isZh ? '预计冻结金额' : 'Estimated hold'}</small>
                                    <strong>
                                        {formatBillingMoney(
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
                                                ? `免费 ${freeRemaining} 张 + 付费 ${paidQuantity} 张；仅成功图片结算，失败自动释放`
                                                : `${freeRemaining} free + ${paidQuantity} paid; only successful images are charged`}
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
                                </button>{' '}
                                <small>({config.termsVersion})</small>
                            </span>
                        </label>
                    </section>

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
                                    onDeleteJob={() => void deleteJob(job.id)}
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
                                                          ? `${value} · ${formatBillingMoney(
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
                                onDelete={outputId => void deleteOutput(outputId)}
                            />
                        </Sheet>
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
            <div className="ai-generation-card-preview">
                {preview?.imageUrl ? (
                    <SafeImage src={preview.imageUrl} alt={job.originalPrompt} />
                ) : (
                    <span aria-hidden="true">
                        {activeStates.has(job.state) ? <LoaderCircle className="spin" /> : <CircleAlert />}
                    </span>
                )}
                {job.outputs.length > 1 ? <small>+{job.outputs.length - 1}</small> : null}
            </div>
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
                    <span className="ai-generation-progress-copy">
                        {isZh ? '任务正在处理中，请稍候…' : 'Your generation is in progress…'}
                    </span>
                ) : job.errorMessage ? (
                    <span className="ai-generation-error-copy">{job.errorMessage}</span>
                ) : null}
                <div className="ai-generation-meta">
                    <span>{job.aspectRatio}</span>
                    <span>{job.resolution}</span>
                    <span>{isZh ? `${job.quantity} 张` : `${job.quantity} images`}</span>
                </div>
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
    onDelete,
}: Readonly<{
    job: ImageGenerationJob;
    language: StorefrontLanguage;
    locale: string;
    onDelete(outputId: string): void;
}>) {
    const isZh = language === 'zh';
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
                <span>{job.aspectRatio}</span>
                <span>{job.resolution}</span>
                <span>{isZh ? `${job.quantity} 张` : `${job.quantity} images`}</span>
            </div>
            <div className="ai-generation-grid">
                {job.outputs.map(output => (
                    <div key={output.id} className={`ai-generation-output is-${output.state.toLowerCase()}`}>
                        {output.imageUrl ? (
                            <SafeImage
                                src={output.imageUrl}
                                alt={`${job.originalPrompt} ${output.outputIndex + 1}`}
                            />
                        ) : (
                            <div className="ai-generation-placeholder">
                                {['QUEUED', 'RUNNING'].includes(output.state) ? (
                                    <LoaderCircle className="spin" />
                                ) : (
                                    <CircleAlert />
                                )}
                                <span>{stateLabel(output.state, isZh)}</span>
                                {output.errorMessage ? <small>{output.errorMessage}</small> : null}
                            </div>
                        )}
                        <div className="ai-generation-output-actions">
                            {output.imageUrl ? (
                                <a href={output.imageUrl} target="_blank" rel="noreferrer">
                                    <Eye />
                                    {isZh ? '查看' : 'View'}
                                </a>
                            ) : null}
                            {output.downloadUrl ? (
                                <a href={output.downloadUrl}>
                                    <ArrowDownToLine />
                                    {isZh ? '下载' : 'Download'}
                                </a>
                            ) : null}
                            {output.imageUrl ? (
                                <button type="button" onClick={() => onDelete(output.id)}>
                                    <Trash2 />
                                    {isZh ? '删除' : 'Delete'}
                                </button>
                            ) : null}
                        </div>
                    </div>
                ))}
            </div>
        </div>
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
function requestId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
