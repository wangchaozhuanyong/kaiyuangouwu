/* eslint-disable max-len -- compact bilingual UI copy and class lists are intentional. */
import {
    ArrowDownToLine,
    CheckCircle2,
    CircleAlert,
    ImagePlus,
    LoaderCircle,
    RefreshCw,
    RotateCcw,
    Sparkles,
    Trash2,
    WandSparkles,
    X,
} from 'lucide-react';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ShopApi } from '../api';
import { PageSkeleton } from '../route-loading';
import { EmptyState, Subpage } from '../storefront-ui/page-shell';
import { SafeImage } from '../storefront-ui/product-display';
import {
    ActiveCustomer,
    ImageGenerationJob,
    ImageModelQuotaStatus,
    ImagePrivateAssetView,
    ImagePromptQuotaStatus,
    ImageReferenceMode,
    ImageStudioConfig,
    MarketConfig,
    StorefrontLanguage,
} from '../types';

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
    const [quantity, setQuantity] = useState(1);
    const [referenceMode, setReferenceMode] = useState<ImageReferenceMode>('NONE');
    const [reference, setReference] = useState<ImagePrivateAssetView | null>(null);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [busy, setBusy] = useState<'OPTIMIZE' | 'UPLOAD' | 'GENERATE' | ''>('');
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
    const selectedQuota = modelQuotas.find(item => item.modelCode === selectedModel?.code);
    const freeRemaining = selectedQuota?.free.unlimited
        ? quantity
        : Math.min(quantity, selectedQuota?.free.remaining ?? 0);
    const paidQuantity = Math.max(0, quantity - freeRemaining);
    const estimatedPrice = (selectedModel?.unitPrice ?? 0) * paidQuantity;
    const canGenerate = Boolean(
        customer &&
        config?.enabled &&
        selectedModel &&
        prompt.trim() &&
        termsAccepted &&
        balance >= estimatedPrice &&
        (selectedQuota?.safety.remaining ?? 0) >= quantity &&
        (paidQuantity === 0 || Boolean(selectedQuota?.paidAfterFreeEnabled)) &&
        !busy,
    );
    const statusSummary = useMemo(
        () =>
            jobs.reduce(
                (total, job) => total + job.outputs.filter(output => output.state === 'SUCCEEDED').length,
                0,
            ),
        [jobs],
    );

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
                setModelCode(result.recommendedModelCode);
            }
        } catch (error) {
            setActionError(errorMessage(error));
        } finally {
            setBusy('');
        }
    };

    const uploadReference = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!termsAccepted) {
            setActionError(
                isZh
                    ? '请先阅读并勾选服务条款，再上传参考图'
                    : 'Accept the terms before uploading a reference',
            );
            return;
        }
        if (config && file.size > config.maxReferenceBytes) {
            setActionError(isZh ? '参考图不能超过 10MB' : 'Reference images must be 10MB or smaller');
            return;
        }
        setBusy('UPLOAD');
        setActionError('');
        try {
            const uploaded = await api.uploadImageReference(file, true);
            setReference(uploaded);
            setReferenceMode('EDIT');
        } catch (error) {
            setActionError(errorMessage(error));
        } finally {
            setBusy('');
        }
    };

    const generate = async () => {
        if (!canGenerate || !selectedModel || !config) return;
        setBusy('GENERATE');
        setActionError('');
        try {
            const job = await api.createImageGeneration({
                modelCode: selectedModel.code,
                prompt: optimized ? originalPrompt || prompt : prompt,
                optimizedPrompt: optimized ? prompt : null,
                referenceAssetId: reference?.id ?? null,
                referenceMode: reference ? referenceMode : 'NONE',
                aspectRatio,
                quantity,
                expectedUnitPrice: selectedModel.unitPrice,
                expectedChargeAmount: estimatedPrice,
                currencyCode: selectedModel.currencyCode,
                idempotencyKey: requestId(),
                termsAccepted: true,
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
        setModelCode(job.modelCodeSnapshot);
        setAspectRatio(job.aspectRatio);
        setQuantity(job.quantity);
        setReference(null);
        setReferenceMode('NONE');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

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
                        <div className="ai-studio-heading">
                            <div>
                                <span>{isZh ? '描述你的画面' : 'Describe your image'}</span>
                                <h2>
                                    {isZh ? '一句话也可以，AI 会帮你完善' : 'Start simple — AI can refine it'}
                                </h2>
                            </div>
                            <div className="ai-studio-balance">
                                <small>{isZh ? '返利可用余额' : 'Available rewards'}</small>
                                <strong>
                                    {formatBillingMoney(
                                        balance,
                                        selectedModel?.currencyCode ?? market.currencyCode,
                                        market.locale,
                                    )}
                                </strong>
                            </div>
                        </div>
                        <div className="ai-studio-prompt-wrap">
                            <textarea
                                maxLength={optimized ? 8000 : 2000}
                                rows={6}
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
                                    {promptQuota ? (
                                        <small>
                                            {promptQuota.daily.unlimited || promptQuota.daily.remaining > 0
                                                ? isZh
                                                    ? `今日免费剩余 ${quotaRemainingLabel(promptQuota.daily)} 次`
                                                    : `${quotaRemainingLabel(promptQuota.daily)} free today`
                                                : formatBillingMoney(
                                                      promptQuota.paidPrice,
                                                      promptQuota.currencyCode,
                                                      market.locale,
                                                  ) + (isZh ? '/次' : '/use')}
                                        </small>
                                    ) : null}
                                </button>
                            </div>
                        </div>
                        {actionError && busy !== 'GENERATE' ? (
                            <div className="ai-studio-error">
                                <CircleAlert />
                                {actionError}
                            </div>
                        ) : null}
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
                        <div className="ai-studio-reference">
                            <label className={termsAccepted ? '' : 'is-disabled'}>
                                <ImagePlus />
                                {busy === 'UPLOAD'
                                    ? isZh
                                        ? '上传中…'
                                        : 'Uploading…'
                                    : reference
                                      ? isZh
                                          ? '更换参考图'
                                          : 'Replace reference'
                                      : isZh
                                        ? '添加一张参考图'
                                        : 'Add one reference'}
                                <input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    disabled={!termsAccepted || Boolean(busy)}
                                    onChange={event => void uploadReference(event)}
                                />
                            </label>
                            {reference ? (
                                <div className="ai-studio-reference-preview">
                                    <SafeImage
                                        src={reference.previewUrl ?? ''}
                                        alt={reference.originalName}
                                    />
                                    <span>
                                        {reference.width} × {reference.height}
                                    </span>
                                    <button
                                        type="button"
                                        aria-label={isZh ? '移除参考图' : 'Remove reference'}
                                        onClick={() => {
                                            setReference(null);
                                            setReferenceMode('NONE');
                                        }}
                                    >
                                        <X />
                                    </button>
                                </div>
                            ) : null}
                            {reference ? (
                                <select
                                    value={referenceMode}
                                    onChange={event =>
                                        setReferenceMode(event.target.value as ImageReferenceMode)
                                    }
                                >
                                    <option value="EDIT">{isZh ? '按描述编辑' : 'Edit'}</option>
                                    <option value="PRODUCT">{isZh ? '保持商品' : 'Preserve product'}</option>
                                    <option value="IDENTITY">
                                        {isZh ? '保持人物身份' : 'Preserve identity'}
                                    </option>
                                    <option value="STYLE">{isZh ? '参考风格' : 'Use style'}</option>
                                    <option value="COMPOSITION">
                                        {isZh ? '参考构图' : 'Use composition'}
                                    </option>
                                </select>
                            ) : null}
                        </div>
                    </section>

                    <section className="ai-studio-options">
                        <h3>{isZh ? '选择模型' : 'Choose a model'}</h3>
                        <p className="ai-studio-billing-note">
                            {isZh
                                ? 'AI 工坊按模型标注的币种计费，不随商城展示币种切换。'
                                : 'AI Studio bills in each model’s listed currency, independently of the store display currency.'}
                        </p>
                        <div className="ai-studio-model-grid">
                            {config.models.map(model => (
                                <button
                                    type="button"
                                    key={model.code}
                                    className={model.code === selectedModel?.code ? 'is-selected' : ''}
                                    onClick={() => setModelCode(model.code)}
                                >
                                    <span>{isZh ? model.displayNameZh : model.displayNameEn}</span>
                                    <code>{model.officialModelId}</code>
                                    <small>{isZh ? model.descriptionZh : model.descriptionEn}</small>
                                    <strong>
                                        {formatBillingMoney(
                                            model.unitPrice,
                                            model.currencyCode,
                                            market.locale,
                                        )}{' '}
                                        / {isZh ? '张' : 'image'}
                                    </strong>
                                    <small>
                                        {model.dailyFreeImageUnlimited
                                            ? isZh
                                                ? '每日免费不限张数'
                                                : 'Unlimited daily free images'
                                            : model.freeImageEnabled
                                              ? isZh
                                                  ? `每日免费 ${model.dailyFreeImageLimit} 张，今日剩余 ${modelQuotaRemaining(modelQuotas, model.code)} 张`
                                                  : `${modelQuotaRemaining(modelQuotas, model.code)} free images left today`
                                              : isZh
                                                ? '无免费张数'
                                                : 'No free images'}
                                    </small>
                                </button>
                            ))}
                        </div>
                        <div className="ai-studio-option-row">
                            <label>
                                <span>{isZh ? '图片比例' : 'Aspect ratio'}</span>
                                <select
                                    value={aspectRatio}
                                    onChange={event => setAspectRatio(event.target.value)}
                                >
                                    {aspectRatios.map(value => (
                                        <option key={value}>{value}</option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                <span>{isZh ? '生成张数' : 'Quantity'}</span>
                                <select
                                    value={quantity}
                                    onChange={event => setQuantity(Number(event.target.value))}
                                >
                                    {Array.from({ length: config.maxQuantity }, (_, index) => index + 1).map(
                                        value => (
                                            <option key={value}>{value}</option>
                                        ),
                                    )}
                                </select>
                            </label>
                            <div>
                                <span>{isZh ? '清晰度' : 'Resolution'}</span>
                                <strong>{config.resolution}</strong>
                            </div>
                        </div>
                    </section>

                    <section className="ai-studio-checkout">
                        <label>
                            <input
                                type="checkbox"
                                checked={termsAccepted}
                                onChange={event => setTermsAccepted(event.target.checked)}
                            />
                            <span>
                                {isZh
                                    ? `我已阅读并同意 AI 图片服务条款（${config.termsVersion}）`
                                    : `I accept the AI image terms (${config.termsVersion})`}
                            </span>
                        </label>
                        <details>
                            <summary>{isZh ? '查看数据与使用说明' : 'View data and usage terms'}</summary>
                            <p>{isZh ? config.termsZh : config.termsEn}</p>
                        </details>
                        <div className="ai-studio-submit">
                            <div>
                                <small>{isZh ? '预计冻结' : 'Estimated hold'}</small>
                                <strong>
                                    {formatBillingMoney(
                                        estimatedPrice,
                                        selectedModel?.currencyCode ?? market.currencyCode,
                                        market.locale,
                                    )}
                                </strong>
                                <span>
                                    {isZh
                                        ? `免费 ${freeRemaining} 张 + 付费 ${paidQuantity} 张 = 预计 ${formatBillingMoney(
                                              estimatedPrice,
                                              selectedModel?.currencyCode ?? market.currencyCode,
                                              market.locale,
                                          )}；仅成功图片结算，失败自动释放`
                                        : 'Only successful images are charged'}
                                </span>
                            </div>
                            <button type="button" disabled={!canGenerate} onClick={() => void generate()}>
                                {busy === 'GENERATE' ? <LoaderCircle className="spin" /> : <WandSparkles />}
                                {isZh ? '开始生成' : 'Generate'}
                            </button>
                        </div>
                        {balance < estimatedPrice ? (
                            <p className="ai-studio-low-balance">
                                {isZh
                                    ? '返利可用余额不足，请先通过邀请返利获得余额。'
                                    : 'Not enough referral balance.'}
                            </p>
                        ) : null}
                        {selectedQuota && selectedQuota.safety.remaining < quantity ? (
                            <p className="ai-studio-low-balance">
                                {isZh
                                    ? '今天的生图安全额度不足，请降低张数或明天再试。'
                                    : 'Daily safety limit reached.'}
                            </p>
                        ) : null}
                    </section>

                    <section className="ai-studio-history">
                        <div className="ai-studio-history-heading">
                            <div>
                                <h3>{isZh ? '我的生成记录' : 'My generations'}</h3>
                                <p>
                                    {isZh
                                        ? `已成功生成 ${statusSummary} 张；生成图保留 ${config.outputRetentionDays} 天。`
                                        : `${statusSummary} images created; outputs are kept for ${config.outputRetentionDays} days.`}
                                </p>
                            </div>
                            <button type="button" onClick={() => void load()}>
                                <RefreshCw />
                                {isZh ? '刷新' : 'Refresh'}
                            </button>
                        </div>
                        {jobs.length ? (
                            jobs.map(job => (
                                <GenerationCard
                                    key={job.id}
                                    job={job}
                                    language={language}
                                    locale={market.locale}
                                    onCancel={() => void cancel(job.id)}
                                    onDelete={outputId => void deleteOutput(outputId)}
                                    onDeleteJob={() => void deleteJob(job.id)}
                                    onRegenerate={() => regenerate(job)}
                                />
                            ))
                        ) : (
                            <div className="ai-studio-empty">
                                {isZh
                                    ? '还没有生成记录，从上方输入一句描述开始。'
                                    : 'No generations yet. Start with a prompt above.'}
                            </div>
                        )}
                    </section>
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
    onDelete,
    onDeleteJob,
    onRegenerate,
}: Readonly<{
    job: ImageGenerationJob;
    language: StorefrontLanguage;
    locale: string;
    onCancel(): void;
    onDelete(outputId: string): void;
    onDeleteJob(): void;
    onRegenerate(): void;
}>) {
    const isZh = language === 'zh';
    return (
        <article className="ai-generation-card">
            <header>
                <div>
                    <strong>{job.modelNameSnapshot}</strong>
                    <code>{job.officialModelIdSnapshot}</code>
                </div>
                <span className={`ai-generation-status is-${job.state.toLowerCase()}`}>
                    {stateLabel(job.state, isZh)}
                </span>
            </header>
            <p>{job.originalPrompt}</p>
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
            <footer>
                <span>
                    {isZh
                        ? `免费成功 ${job.freeQuantityCaptured} 张 · 付费预留 ${job.paidQuantityReserved} 张 · `
                        : `${job.freeQuantityCaptured} free · ${job.paidQuantityReserved} paid reserved · `}
                    {formatBillingMoney(job.capturedAmount, job.currencyCode, locale)}{' '}
                    {isZh ? '已结算' : 'charged'} ·{' '}
                    {formatBillingMoney(job.releasedAmount, job.currencyCode, locale)}{' '}
                    {isZh ? '已退回' : 'released'}
                </span>
                <div>
                    {job.outputs.some(output => output.state === 'QUEUED') ? (
                        <button type="button" onClick={onCancel}>
                            <X />
                            {isZh ? '取消排队' : 'Cancel queued'}
                        </button>
                    ) : null}
                    <button type="button" onClick={onRegenerate}>
                        <RotateCcw />
                        {isZh ? '再次创作' : 'Use again'}
                    </button>
                    {terminalStates.has(job.state) ? (
                        <button type="button" onClick={onDeleteJob}>
                            <Trash2 />
                            {isZh ? '删除记录' : 'Delete job'}
                        </button>
                    ) : null}
                </div>
            </footer>
        </article>
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
function modelQuotaRemaining(quotas: ImageModelQuotaStatus[], modelCode: string): string {
    const quota = quotas.find(item => item.modelCode === modelCode)?.free;
    return quota?.unlimited ? '不限' : String(quota?.remaining ?? 0);
}
function requestId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `img-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
