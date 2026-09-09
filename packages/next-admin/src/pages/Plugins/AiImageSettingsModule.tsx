import { useMutation, useQuery } from '@apollo/client/react';
import {
    Activity,
    AlertCircle,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    CircleDollarSign,
    Cpu,
    FileText,
    Image as ImageIcon,
    LoaderCircle,
    PanelRightOpen,
    Power,
    RefreshCw,
    RotateCcw,
    Save,
    ShieldCheck,
    Sparkles,
    X,
} from 'lucide-react';
import { useState } from 'react';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { PageSizeSelect } from '../../components/PageSizeSelect';
import {
    ACTIVATE_IMAGE_SKILL_MUTATION,
    IMAGE_GENERATION_ADMIN_QUERY,
    REFUND_IMAGE_OUTPUT_MUTATION,
    RETRY_IMAGE_OUTPUT_MUTATION,
    SAVE_IMAGE_GENERATION_CONFIG_MUTATION,
    SAVE_IMAGE_MODEL_MUTATION,
    TEST_IMAGE_MODEL_MUTATION,
    type ImageGenerationAdminResult,
    type ImageGenerationConfigRecord,
    type ImageGenerationJobRecord,
    type ImageModelRecord,
    type ImageProviderProtocol,
} from '../../graphql/plugins.graphql';
import { usePageSize } from '../../hooks/use-page-size';
import { useUrlTab } from '../../hooks/use-url-tab';
import { getStatusLabel } from '../../utils/status-labels';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime, formatMoney, majorInputToMoney, moneyToMajorInput } from '../Sales/sales-utils';
import { buildImageGenerationConfigInput, buildImageModelInput } from './ai-image-settings-input';

type StudioTab = 'CONFIG' | 'JOBS' | 'SKILLS';
const AI_STUDIO_TABS = { config: 'CONFIG', jobs: 'JOBS', skills: 'SKILLS' } as const;
type OutputAction =
    { kind: 'RETRY'; jobId: string; outputId: string } | { kind: 'REFUND'; jobId: string; outputId: string };
type JobStateFilter =
    'ALL' | 'QUEUED' | 'RUNNING' | 'PARTIAL_SUCCESS' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
type ConfigEditor = { kind: 'SERVICE' } | { kind: 'MODEL'; modelId: string } | { kind: 'TERMS' };

const JOB_STATE_OPTIONS: Array<[JobStateFilter, string]> = [
    ['ALL', '全部状态'],
    ['QUEUED', '排队中'],
    ['RUNNING', '生成中'],
    ['PARTIAL_SUCCESS', '部分成功'],
    ['SUCCEEDED', '已完成'],
    ['FAILED', '失败'],
    ['UNKNOWN', '结果待确认'],
    ['CANCELLED', '已取消'],
];

export function AiImageSettingsModule() {
    const [tab, setTab] = useUrlTab<StudioTab>(AI_STUDIO_TABS, 'config');
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [outputAction, setOutputAction] = useState<OutputAction | null>(null);
    const [activateRelease, setActivateRelease] = useState<{ id: string; version: number } | null>(null);
    const [jobPage, setJobPage] = useState(0);
    const [pageSize, setPageSize] = usePageSize(setJobPage);
    const [jobState, setJobState] = useState<JobStateFilter>('ALL');
    const query = useQuery<ImageGenerationAdminResult>(IMAGE_GENERATION_ADMIN_QUERY, {
        variables: {
            skip: jobPage * pageSize,
            take: pageSize,
            state: jobState === 'ALL' ? null : jobState,
        },
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [retryOutput, retryState] = useMutation(RETRY_IMAGE_OUTPUT_MUTATION);
    const [refundOutput, refundState] = useMutation(REFUND_IMAGE_OUTPUT_MUTATION);
    const [activateSkill, skillState] = useMutation(ACTIVATE_IMAGE_SKILL_MUTATION);
    const config = query.data?.imageGenerationAdminConfig;
    const jobs = query.data?.imageGenerationJobs.items ?? [];
    const jobTotal = query.data?.imageGenerationJobs.totalItems ?? 0;
    const jobTotalPages = Math.max(1, Math.ceil(jobTotal / pageSize));
    const unknownCount = jobs.flatMap(job => job.outputs).filter(output => output.state === 'UNKNOWN').length;

    const showNotice = (message: string) => {
        setNotice(message);
        setActionError('');
    };
    const showError = (error: unknown) => {
        setActionError(errorText(error));
        setNotice('');
    };
    const executeOutputAction = async (reason: string) => {
        if (!outputAction) return;
        try {
            if (outputAction.kind === 'RETRY')
                await retryOutput({ variables: { outputId: outputAction.outputId } });
            else
                await refundOutput({ variables: { outputId: outputAction.outputId, reason: reason.trim() } });
            showNotice(
                outputAction.kind === 'RETRY'
                    ? '未知结果已使用原幂等键重新入队'
                    : '该张已成功图片的费用已退回用户钱包',
            );
            setOutputAction(null);
            await query.refetch();
        } catch (error) {
            showError(error);
        }
    };
    const executeActivateSkill = async () => {
        if (!activateRelease) return;
        try {
            await activateSkill({ variables: { id: activateRelease.id } });
            showNotice(`提示词规则包 v${activateRelease.version} 已激活`);
            setActivateRelease(null);
            await query.refetch();
        } catch (error) {
            showError(error);
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <Sparkles className="h-5 w-5 text-blue-600" />
                            AI 图片工坊管理
                            <FeatureHelpButton topic="plugins.ai-settings" title="AI 图片工坊管理" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            店铺开关、模型定价、服务协议、生图任务和提示词规则包
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void query.refetch()}
                        disabled={query.loading}
                        className="flex items-center gap-1.5 self-start rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${query.loading ? 'animate-spin' : ''}`} />
                        刷新
                    </button>
                </div>
            </header>
            <nav className="shrink-0 border-b border-slate-200 bg-white px-5 sm:px-8">
                <div className="mx-auto flex w-full max-w-none gap-6 overflow-x-auto text-xs font-bold">
                    <Tab
                        active={tab === 'CONFIG'}
                        onClick={() => setTab('CONFIG')}
                        icon={Cpu}
                        label="运营配置"
                    />
                    <Tab
                        active={tab === 'JOBS'}
                        onClick={() => setTab('JOBS')}
                        icon={ImageIcon}
                        label={`任务与售后 ${query.data?.imageGenerationJobs.totalItems ?? 0}`}
                        badge={unknownCount ? `${unknownCount} 本页待确认` : undefined}
                    />
                    <Tab
                        active={tab === 'SKILLS'}
                        onClick={() => setTab('SKILLS')}
                        icon={ShieldCheck}
                        label="提示词规则包"
                    />
                </div>
            </nav>
            <main className="mx-auto w-full max-w-none flex-1 space-y-4 overflow-y-auto p-5 sm:p-8">
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
                {query.loading && !query.data ? (
                    <LoadingState />
                ) : query.error ? (
                    <ErrorState
                        message={toUserFacingError(query.error, 'AI 图片配置读取失败')}
                        onRetry={() => void query.refetch()}
                    />
                ) : config && tab === 'CONFIG' ? (
                    <ConfigPanel
                        key={config.id}
                        value={config}
                        currencyCode={query.data?.activeChannel.defaultCurrencyCode ?? 'CNY'}
                        onSaved={async message => {
                            showNotice(message);
                            await query.refetch();
                        }}
                        onError={showError}
                    />
                ) : tab === 'JOBS' ? (
                    <JobsPanel
                        pageSize={pageSize}
                        onPageSizeChange={setPageSize}
                        jobs={jobs}
                        total={jobTotal}
                        page={jobPage}
                        totalPages={jobTotalPages}
                        state={jobState}
                        loading={query.loading}
                        onPageChange={setJobPage}
                        onStateChange={value => {
                            setJobState(value);
                            setJobPage(0);
                        }}
                        onAction={setOutputAction}
                    />
                ) : (
                    <SkillPanel
                        releases={query.data?.imagePromptSkillReleases ?? []}
                        activeHash={config?.activeSkillHash ?? ''}
                        onActivate={release =>
                            setActivateRelease({ id: release.id, version: release.bundleVersion })
                        }
                    />
                )}
            </main>
            {outputAction && (
                <OutputActionDialog
                    action={outputAction}
                    pending={retryState.loading || refundState.loading}
                    onClose={() => setOutputAction(null)}
                    onConfirm={executeOutputAction}
                />
            )}
            {activateRelease && (
                <ConfirmDialog
                    title="激活提示词规则包"
                    description={`确认激活 v${activateRelease.version}？新的提示词优化和模型路由规则会对新任务立即生效。`}
                    pending={skillState.loading}
                    onClose={() => setActivateRelease(null)}
                    onConfirm={() => void executeActivateSkill()}
                />
            )}
        </div>
    );
}

function ConfigPanel({
    value,
    currencyCode,
    onSaved,
    onError,
}: {
    value: ImageGenerationConfigRecord;
    currencyCode: string;
    onSaved: (message: string) => Promise<void>;
    onError: (error: unknown) => void;
}) {
    const [editor, setEditor] = useState<ConfigEditor | null>(null);
    const [editorError, setEditorError] = useState('');
    const [enabled, setEnabled] = useState(value.enabled);
    const [optimization, setOptimization] = useState(value.promptOptimizationEnabled);
    const [defaultModelCode, setDefaultModelCode] = useState(value.defaultModelCode);
    const [termsVersion, setTermsVersion] = useState(value.termsVersion);
    const [termsZh, setTermsZh] = useState(value.termsZh);
    const [termsEn, setTermsEn] = useState(value.termsEn);
    const [saveConfig, saveState] = useMutation(SAVE_IMAGE_GENERATION_CONFIG_MUTATION);
    const enabledModels = value.models.filter(model => model.enabled);
    const defaultModel = value.models.find(model => model.code === value.defaultModelCode);
    const selectedModel =
        editor?.kind === 'MODEL' ? value.models.find(model => model.id === editor.modelId) : undefined;
    const serviceValidation =
        enabled && !enabledModels.length
            ? '启用图片工坊前至少需要启用一个模型'
            : enabled && !enabledModels.some(model => model.code === defaultModelCode)
              ? '默认模型必须处于启用状态'
              : !value.termsVersion.trim() || !value.termsZh.trim()
                ? '请先完成买家服务条款设置'
                : null;
    const termsValidation = !termsVersion.trim()
        ? '请填写条款版本'
        : !termsZh.trim()
          ? '请填写中文服务条款，英文由系统自动维护'
          : null;
    const serviceDirty =
        enabled !== value.enabled ||
        optimization !== value.promptOptimizationEnabled ||
        defaultModelCode !== value.defaultModelCode;
    const termsDirty =
        termsVersion !== value.termsVersion || termsZh !== value.termsZh || termsEn !== value.termsEn;

    const openEditor = (nextEditor: ConfigEditor) => {
        setEditorError('');
        setEnabled(value.enabled);
        setOptimization(value.promptOptimizationEnabled);
        setDefaultModelCode(value.defaultModelCode);
        setTermsVersion(value.termsVersion);
        setTermsZh(value.termsZh);
        setTermsEn(value.termsEn);
        setEditor(nextEditor);
    };
    const submit = async (message: string) => {
        if (editor?.kind === 'SERVICE' ? serviceValidation : termsValidation) return;
        try {
            await saveConfig({
                variables: {
                    input: buildImageGenerationConfigInput(value, {
                        enabled,
                        promptOptimizationEnabled: optimization,
                        defaultModelCode,
                        termsVersion: termsVersion.trim(),
                        termsZh: termsZh.trim(),
                        termsEn: termsEn.trim(),
                    }),
                },
            });
            await onSaved(message);
            setEditor(null);
        } catch (error) {
            setEditorError(errorText(error));
            onError(error);
        }
    };

    return (
        <>
            <div className="mx-auto w-full max-w-5xl space-y-4">
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="border-b border-slate-100 px-4 py-3.5 sm:px-5">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            基础设置
                            <FeatureHelpButton topic="plugins.ai-settings" title="基础设置" />
                        </h2>
                        <p className="mt-1 text-[11px] text-slate-500">
                            先查看当前状态，需要调整时再从右侧打开设置。
                        </p>
                    </div>
                    <div className="grid gap-px bg-slate-100 xl:grid-cols-2 [&>article]:bg-white">
                        <ConfigSettingRow
                            icon={Power}
                            title="店铺服务开关"
                            helpTitle="AI 店铺服务开关"
                            description={
                                '默认模型：' +
                                (defaultModel?.displayNameZh || value.defaultModelCode || '未设置')
                            }
                            onOpen={() => openEditor({ kind: 'SERVICE' })}
                        >
                            <StatusPill tone={value.enabled ? 'success' : 'neutral'}>
                                {value.enabled ? '买家端已开放' : '买家端已关闭'}
                            </StatusPill>
                            <StatusPill tone={value.promptOptimizationEnabled ? 'info' : 'neutral'}>
                                提示词优化{value.promptOptimizationEnabled ? '已开启' : '已关闭'}
                            </StatusPill>
                            {!value.credentialEnabled && (
                                <StatusPill tone="warning">服务凭据未启用</StatusPill>
                            )}
                        </ConfigSettingRow>
                        <ConfigSettingRow
                            icon={FileText}
                            title="买家服务条款与免责声明"
                            helpTitle="买家服务条款与免责声明"
                            description="条款版本会写入每个生图任务快照，便于后续审计。"
                            onOpen={() => openEditor({ kind: 'TERMS' })}
                        >
                            <StatusPill tone="info">版本 {value.termsVersion || '未设置'}</StatusPill>
                            <StatusPill tone={value.termsZh.trim() ? 'success' : 'warning'}>
                                中文{value.termsZh.trim() ? '已配置' : '待配置'}
                            </StatusPill>
                            <StatusPill tone={value.termsEn.trim() ? 'success' : 'neutral'}>
                                英文{value.termsEn.trim() ? '已配置' : '未配置'}
                            </StatusPill>
                        </ConfigSettingRow>
                    </div>
                </section>

                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
                        <div>
                            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                生图模型与单张定价
                                <FeatureHelpButton topic="plugins.ai-settings" title="生图模型与单张定价" />
                            </h2>
                            <p className="mt-1 text-[11px] text-slate-500">
                                每个模型单独设置，价格按 Vendure 货币单位结算。
                            </p>
                        </div>
                        <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                            {value.models.length} 个模型
                        </span>
                    </div>
                    <div className="grid gap-px bg-slate-100 xl:grid-cols-2 [&>article]:bg-white">
                        {value.models.map(model => (
                            <ConfigSettingRow
                                key={model.id}
                                icon={ImageIcon}
                                title={model.displayNameZh}
                                description={
                                    '官方标识 ' +
                                    model.officialModelId +
                                    ' · ' +
                                    formatMoney(model.unitPrice, model.currencyCode || currencyCode) +
                                    ' / 张'
                                }
                                onOpen={() => openEditor({ kind: 'MODEL', modelId: model.id })}
                            >
                                {model.isDefault && <StatusPill tone="info">默认模型</StatusPill>}
                                <StatusPill tone={model.enabled ? 'success' : 'neutral'}>
                                    {model.enabled ? '已开放' : '已停用'}
                                </StatusPill>
                                <HealthBadge status={model.healthStatus} />
                                <span className="font-mono text-[10px] text-slate-400">{model.code}</span>
                            </ConfigSettingRow>
                        ))}
                        {!value.models.length && (
                            <div className="p-8 text-center text-xs text-slate-400">当前没有可配置模型</div>
                        )}
                    </div>
                </section>
            </div>

            {editor?.kind === 'SERVICE' && (
                <SettingsDrawer
                    title="店铺服务开关"
                    description="控制买家端入口、提示词优化与默认生图模型。"
                    pending={saveState.loading}
                    error={editorError}
                    onClose={() => setEditor(null)}
                    footer={
                        <DrawerFooter
                            dirty={serviceDirty}
                            validation={serviceValidation}
                            pending={saveState.loading}
                            onClose={() => setEditor(null)}
                            onSave={() => void submit('AI 图片工坊服务设置已保存')}
                            saveLabel="保存服务设置"
                        />
                    }
                >
                    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            服务状态
                            <FeatureHelpButton topic="plugins.ai-settings" title="服务状态" />
                        </h3>
                        <p className="mt-1 text-[11px] leading-5 text-slate-500">
                            只有凭据健康且至少一个模型可用时，买家端才会真正开放。
                        </p>
                        <div className="mt-4 space-y-3">
                            <ToggleCard
                                label="开放 AI 图片工坊"
                                detail="控制买家端整个功能入口"
                                value={enabled}
                                onChange={setEnabled}
                            />
                            <ToggleCard
                                label="提示词自动优化"
                                detail="需要服务商的文本模型可用"
                                value={optimization}
                                onChange={setOptimization}
                            />
                        </div>
                    </section>
                    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            默认生图模型
                            <FeatureHelpButton topic="plugins.ai-settings" title="默认生图模型" />
                        </h3>
                        <p className="mt-1 text-[11px] leading-5 text-slate-500">
                            新任务会优先使用这里选择且已启用的模型。
                        </p>
                        <div className="mt-4">
                            <Field label="默认模型">
                                <select
                                    value={defaultModelCode}
                                    onChange={event => setDefaultModelCode(event.target.value)}
                                    className={inputClass}
                                >
                                    {value.models.map(model => (
                                        <option
                                            key={model.code}
                                            value={model.code}
                                            disabled={enabled && !model.enabled}
                                        >
                                            {model.displayNameZh} {model.enabled ? '' : '（已停用）'}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                        </div>
                        {!value.credentialEnabled && (
                            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                                当前没有启用的平台服务商凭据，即使打开服务，买家端也不会展示可用模型。
                            </div>
                        )}
                    </section>
                </SettingsDrawer>
            )}
            {editor?.kind === 'TERMS' && (
                <SettingsDrawer
                    title="买家服务条款与免责声明"
                    description="条款版本会写入每个生图任务快照，用于后续审计。"
                    pending={saveState.loading}
                    error={editorError}
                    onClose={() => setEditor(null)}
                    footer={
                        <DrawerFooter
                            dirty={termsDirty}
                            validation={termsValidation}
                            pending={saveState.loading}
                            onClose={() => setEditor(null)}
                            onSave={() => void submit('买家服务条款已保存')}
                            saveLabel="保存服务条款"
                        />
                    }
                >
                    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                        <Field label="条款版本 *">
                            <input
                                value={termsVersion}
                                onChange={event => setTermsVersion(event.target.value)}
                                className={inputClass + ' font-mono'}
                            />
                        </Field>
                        <Field label="中文条款 *">
                            <textarea
                                rows={10}
                                value={termsZh}
                                onChange={event => setTermsZh(event.target.value)}
                                className={inputClass + ' resize-y leading-6'}
                            />
                        </Field>
                        <Field label="英文条款（自动生成，可选修改）">
                            <textarea
                                rows={10}
                                value={termsEn}
                                onChange={event => setTermsEn(event.target.value)}
                                className={inputClass + ' resize-y leading-6'}
                            />
                        </Field>
                    </section>
                </SettingsDrawer>
            )}
            {editor?.kind === 'MODEL' && selectedModel && (
                <ModelConfigDrawer
                    key={
                        selectedModel.id +
                        '-' +
                        selectedModel.healthStatus +
                        '-' +
                        (selectedModel.lastTestedAt ?? '') +
                        '-' +
                        selectedModel.unitPrice
                    }
                    value={selectedModel}
                    fallbackCurrency={currencyCode}
                    onSaved={onSaved}
                    onError={error => {
                        setEditorError(errorText(error));
                        onError(error);
                    }}
                    error={editorError}
                    onClose={() => setEditor(null)}
                />
            )}
        </>
    );
}

function ModelConfigDrawer({
    value,
    fallbackCurrency,
    onSaved,
    onError,
    error,
    onClose,
}: {
    value: ImageModelRecord;
    fallbackCurrency: string;
    onSaved: (message: string) => Promise<void>;
    onError: (error: unknown) => void;
    error: string;
    onClose: () => void;
}) {
    const [enabled, setEnabled] = useState(value.enabled);
    const [nameZh, setNameZh] = useState(value.displayNameZh);
    const [nameEn, setNameEn] = useState(value.displayNameEn);
    const [descriptionZh, setDescriptionZh] = useState(value.descriptionZh);
    const [descriptionEn, setDescriptionEn] = useState(value.descriptionEn);
    const [providerModelId, setProviderModelId] = useState(value.providerModelId);
    const [protocol, setProtocol] = useState(value.protocol);
    const [unitPrice, setUnitPrice] = useState(moneyToMajorInput(value.unitPrice, value.currencyCode));
    const [position, setPosition] = useState(String(value.position));
    const [saveModel, saveState] = useMutation(SAVE_IMAGE_MODEL_MUTATION);
    const [testModel, testState] = useMutation<{
        testImageModel: { ok: boolean; message: string; testedAt: string };
    }>(TEST_IMAGE_MODEL_MUTATION);
    const [testResult, setTestResult] = useState<{
        ok: boolean;
        message: string;
        testedAt: string;
    } | null>(null);
    const currency = value.currencyCode || fallbackCurrency;
    const priceMoney = majorInputToMoney(unitPrice, currency);
    const validation = !nameZh.trim()
        ? '请填写中文模型名称，英文由系统自动维护'
        : !providerModelId.trim()
          ? '请填写服务商模型 ID'
          : priceMoney == null || (enabled && priceMoney <= 0)
            ? '启用模型时单张价格必须大于 0'
            : null;
    const dirty =
        enabled !== value.enabled ||
        nameZh !== value.displayNameZh ||
        nameEn !== value.displayNameEn ||
        descriptionZh !== value.descriptionZh ||
        descriptionEn !== value.descriptionEn ||
        providerModelId !== value.providerModelId ||
        protocol !== value.protocol ||
        priceMoney !== value.unitPrice ||
        Number(position) !== value.position;
    const submit = async () => {
        if (validation || priceMoney == null) return;
        try {
            await saveModel({
                variables: {
                    input: buildImageModelInput(value, {
                        enabled,
                        displayNameZh: nameZh.trim(),
                        displayNameEn: nameEn.trim(),
                        descriptionZh: descriptionZh.trim(),
                        descriptionEn: descriptionEn.trim(),
                        providerModelId: providerModelId.trim(),
                        protocol,
                        unitPrice: priceMoney,
                        currencyCode: currency,
                        position: Number.parseInt(position, 10) || 0,
                    }),
                },
            });
            await onSaved('模型《' + nameZh + '》已保存');
            onClose();
        } catch (error) {
            onError(error);
        }
    };
    const test = async () => {
        try {
            const result = await testModel({ variables: { code: value.code } });
            if (result.data) setTestResult(result.data.testImageModel);
            await onSaved('模型《' + value.displayNameZh + '》健康检查已完成');
        } catch (error) {
            onError(error);
        }
    };
    const health = testResult ? (testResult.ok ? 'HEALTHY' : 'UNHEALTHY') : value.healthStatus;
    const pending = saveState.loading || testState.loading;

    return (
        <SettingsDrawer
            title={'设置模型：' + value.displayNameZh}
            description={'模型编码 ' + value.code + ' · 官方标识 ' + value.officialModelId}
            pending={pending}
            error={error}
            onClose={onClose}
            footer={
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p
                        className={
                            'min-w-0 text-xs ' +
                            (validation ? 'text-rose-600' : dirty ? 'text-blue-700' : 'text-slate-500')
                        }
                    >
                        {validation ?? (dirty ? '有未保存修改' : '没有待保存修改')}
                    </p>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => void test()}
                            disabled={pending || dirty}
                            title={dirty ? '请先保存模型变更' : undefined}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40"
                        >
                            <Activity className="h-3.5 w-3.5" />
                            {testState.loading ? '测试中…' : '测试模型'}
                        </button>
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
                            onClick={() => void submit()}
                            disabled={saveState.loading || !dirty || Boolean(validation)}
                            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                        >
                            <Save className="h-3.5 w-3.5" />
                            {saveState.loading ? '正在保存…' : '保存模型'}
                        </button>
                    </div>
                </div>
            }
        >
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                    <HealthBadge status={health} />
                    {value.isDefault && <StatusPill tone="info">默认模型</StatusPill>}
                    <StatusPill tone={enabled ? 'success' : 'neutral'}>
                        {enabled ? '向买家开放' : '未向买家开放'}
                    </StatusPill>
                </div>
                {(testResult?.message ?? value.healthMessage) && (
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                        {testResult?.message ?? value.healthMessage}
                    </p>
                )}
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    模型名称与服务商
                    <FeatureHelpButton topic="plugins.ai-settings" title="模型名称与服务商" />
                </h3>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="中文名称">
                        <input
                            value={nameZh}
                            onChange={event => setNameZh(event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="英文名称（自动生成，可选修改）">
                        <input
                            value={nameEn}
                            onChange={event => setNameEn(event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="服务商模型 ID">
                        <input
                            value={providerModelId}
                            onChange={event => setProviderModelId(event.target.value)}
                            className={inputClass + ' font-mono'}
                        />
                    </Field>
                    <Field label="协议">
                        <select
                            value={protocol}
                            onChange={event => setProtocol(event.target.value as ImageProviderProtocol)}
                            className={inputClass}
                        >
                            {protocolOptions.map(item => (
                                <option key={item} value={item}>
                                    {item}
                                </option>
                            ))}
                        </select>
                    </Field>
                </div>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    展示与定价
                    <FeatureHelpButton topic="plugins.ai-settings" title="展示与定价" />
                </h3>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label={'单张价格 (' + currency + ')'}>
                        <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={unitPrice}
                            onChange={event => setUnitPrice(event.target.value)}
                            className={inputClass + ' font-mono'}
                        />
                    </Field>
                    <Field label="排序">
                        <input
                            type="number"
                            min="0"
                            max="1000"
                            value={position}
                            onChange={event => setPosition(event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="中文说明">
                        <input
                            value={descriptionZh}
                            onChange={event => setDescriptionZh(event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                    <Field label="英文说明（自动生成，可选修改）">
                        <input
                            value={descriptionEn}
                            onChange={event => setDescriptionEn(event.target.value)}
                            className={inputClass}
                        />
                    </Field>
                </div>
                <div className="mt-4">
                    <ToggleCard
                        label="向买家开放模型"
                        detail="关闭后，新任务将不能选择这个模型。"
                        value={enabled}
                        onChange={setEnabled}
                    />
                </div>
            </section>
        </SettingsDrawer>
    );
}

function ConfigSettingRow({
    icon: Icon,
    title,
    helpTitle,
    description,
    onOpen,
    children,
}: {
    icon: typeof Cpu;
    title: string;
    helpTitle?: string;
    description: string;
    onOpen: () => void;
    children: React.ReactNode;
}) {
    return (
        <article className="flex min-w-0 flex-col gap-2 px-4 py-3 transition-colors hover:bg-slate-50/70 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                    <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                    <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900">
                        {title}
                        {helpTitle && <FeatureHelpButton topic="plugins.ai-settings" title={helpTitle} />}
                    </h3>
                    <p className="mt-1 break-words text-[11px] leading-5 text-slate-500">{description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">{children}</div>
                </div>
            </div>
            <button
                type="button"
                onClick={onOpen}
                className="flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 sm:w-auto"
            >
                <PanelRightOpen className="h-3.5 w-3.5" />
                设置修改
            </button>
        </article>
    );
}

function StatusPill({
    tone,
    children,
}: {
    tone: 'success' | 'warning' | 'info' | 'neutral';
    children: React.ReactNode;
}) {
    const classes = {
        success: 'bg-emerald-50 text-emerald-700',
        warning: 'bg-amber-50 text-amber-700',
        info: 'bg-blue-50 text-blue-700',
        neutral: 'bg-slate-100 text-slate-600',
    }[tone];
    return <span className={'rounded px-2 py-0.5 text-[9px] font-bold ' + classes}>{children}</span>;
}

function SettingsDrawer({
    title,
    description,
    pending,
    error,
    onClose,
    footer,
    children,
}: {
    title: string;
    description: string;
    pending: boolean;
    error?: string;
    onClose: () => void;
    footer: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <AccessibleDialogSurface
            accessibleName={title}
            onRequestClose={() => {
                if (!pending) onClose();
            }}
            onMouseDown={event => {
                if (!pending && event.target === event.currentTarget) onClose();
            }}
            className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 backdrop-blur-xs"
        >
            <div className="flex h-full w-full max-w-2xl flex-col bg-slate-50 shadow-2xl">
                <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
                    <div className="min-w-0">
                        <h2 className="text-base font-bold text-slate-900">{title}</h2>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={pending}
                        aria-label={'关闭' + title}
                        className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </header>
                <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
                    {error && (
                        <p
                            role="alert"
                            className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800"
                        >
                            {error}
                        </p>
                    )}
                    {children}
                </div>
                <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
                    {footer}
                </footer>
            </div>
        </AccessibleDialogSurface>
    );
}

function DrawerFooter({
    dirty,
    validation,
    pending,
    onClose,
    onSave,
    saveLabel,
}: {
    dirty: boolean;
    validation: string | null;
    pending: boolean;
    onClose: () => void;
    onSave: () => void;
    saveLabel: string;
}) {
    return (
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p
                className={
                    'text-xs ' + (validation ? 'text-rose-600' : dirty ? 'text-blue-700' : 'text-slate-500')
                }
            >
                {validation ?? (dirty ? '有未保存修改' : '没有待保存修改')}
            </p>
            <div className="flex shrink-0 justify-end gap-2">
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
                    onClick={onSave}
                    disabled={pending || !dirty || Boolean(validation)}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                    <Save className="h-3.5 w-3.5" />
                    {pending ? '正在保存…' : saveLabel}
                </button>
            </div>
        </div>
    );
}

function JobsPanel({
    pageSize,
    onPageSizeChange,
    jobs,
    total,
    page,
    totalPages,
    state,
    loading,
    onPageChange,
    onStateChange,
    onAction,
}: {
    pageSize: number;
    onPageSizeChange: (size: number) => void;
    jobs: ImageGenerationJobRecord[];
    total: number;
    page: number;
    totalPages: number;
    state: JobStateFilter;
    loading: boolean;
    onPageChange: (page: number) => void;
    onStateChange: (state: JobStateFilter) => void;
    onAction: (action: OutputAction) => void;
}) {
    const [selectedJob, setSelectedJob] = useState<ImageGenerationJobRecord | null>(null);

    const selectOutputAction = (action: OutputAction) => {
        setSelectedJob(null);
        onAction(action);
    };

    return (
        <section className="space-y-3">
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        生图任务流水
                        <FeatureHelpButton topic="plugins.ai-settings" title="生图任务流水" />
                    </h2>
                    <p className="mt-1 text-[11px] text-slate-400">
                        当前条件共 {total} 条；FAILED 输出会自动释放预占费用
                    </p>
                </div>
                <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
                    任务状态
                    <select
                        value={state}
                        onChange={event => onStateChange(event.target.value as JobStateFilter)}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800"
                    >
                        {JOB_STATE_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {!jobs.length && !loading && (
                <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white text-center">
                    <ImageIcon className="h-9 w-9 text-slate-300" />
                    <h2 className="mt-3 text-sm font-bold text-slate-800">
                        {state === 'ALL' ? '还没有生图任务' : '当前状态下没有任务'}
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                        {state === 'ALL'
                            ? '买家发起生图后，费用与每张输出状态会在此记录。'
                            : '可以切换状态查看其他任务。'}
                    </p>
                </div>
            )}
            {jobs.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1480px] border-collapse text-left text-xs">
                            <thead>
                                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                                    <th
                                        scope="col"
                                        className="sticky left-0 z-10 w-56 whitespace-nowrap bg-slate-50 px-3 py-3"
                                    >
                                        任务 ID
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        创建时间
                                    </th>
                                    <th scope="col" className="min-w-40 whitespace-nowrap px-3 py-3">
                                        模型
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3 text-center">
                                        数量
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        单价
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        已扣金额
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        已退金额
                                    </th>
                                    <th scope="col" className="whitespace-nowrap px-3 py-3">
                                        任务状态
                                    </th>
                                    <th scope="col" className="min-w-52 whitespace-nowrap px-3 py-3">
                                        输出结果
                                    </th>
                                    <th scope="col" className="min-w-56 whitespace-nowrap px-3 py-3">
                                        错误
                                    </th>
                                    <th
                                        scope="col"
                                        className="sticky right-0 z-10 w-28 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                                    >
                                        操作
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {jobs.map(job => {
                                    const errorMessage =
                                        job.errorMessage ??
                                        job.outputs.find(output => output.errorMessage)?.errorMessage ??
                                        '';
                                    return (
                                        <tr key={job.id} className="group h-12 hover:bg-slate-50/80">
                                            <td className="sticky left-0 z-[1] max-w-56 bg-white px-3 py-2 group-hover:bg-slate-50">
                                                <span
                                                    className="block truncate font-mono font-bold text-slate-900"
                                                    title={job.id}
                                                >
                                                    {job.id}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-slate-500">
                                                {formatDateTime(job.createdAt)}
                                            </td>
                                            <td className="max-w-48 px-3 py-2">
                                                <span
                                                    className="block truncate font-semibold text-slate-800"
                                                    title={job.modelNameSnapshot}
                                                >
                                                    {job.modelNameSnapshot}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-center font-mono font-bold text-slate-800">
                                                {job.quantity}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-700">
                                                {formatMoney(job.unitPriceSnapshot, job.currencyCode)}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 font-mono font-bold text-slate-900">
                                                {formatMoney(job.capturedAmount, job.currencyCode)}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-600">
                                                {formatMoney(job.releasedAmount, job.currencyCode)}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2">
                                                <StateBadge state={job.state} />
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2">
                                                <OutputStateSummary outputs={job.outputs} />
                                            </td>
                                            <td className="max-w-56 px-3 py-2">
                                                <span
                                                    className={`block truncate text-[10px] ${errorMessage ? 'text-rose-600' : 'text-slate-400'}`}
                                                    title={errorMessage || undefined}
                                                >
                                                    {errorMessage || '-'}
                                                </span>
                                            </td>
                                            <td className="sticky right-0 border-l border-slate-100 bg-white px-3 py-2 text-right group-hover:bg-slate-50">
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedJob(job)}
                                                    className="whitespace-nowrap rounded-lg bg-blue-50 px-3 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                                                >
                                                    查看输出 {job.outputs.length}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex flex-wrap gap-y-3 gap-x-4 items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
                        <span>
                            共 {total} 条，第 {page + 1}/{totalPages} 页
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                            <PageSizeSelect
                                pageSize={pageSize}
                                onPageSizeChange={onPageSizeChange}
                                disabled={loading}
                            />
                            <button
                                type="button"
                                disabled={page === 0 || loading}
                                onClick={() => onPageChange(page - 1)}
                                className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                                aria-label="上一页"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                disabled={page + 1 >= totalPages || loading}
                                onClick={() => onPageChange(page + 1)}
                                className="rounded border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                                aria-label="下一页"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {selectedJob && (
                <JobOutputsDialog
                    job={selectedJob}
                    onClose={() => setSelectedJob(null)}
                    onAction={selectOutputAction}
                />
            )}
        </section>
    );
}

function OutputStateSummary({ outputs }: { outputs: ImageGenerationJobRecord['outputs'] }) {
    const counts = new Map<string, number>();
    outputs.forEach(output => {
        const state = output.refundedAt ? 'REFUNDED' : output.state;
        counts.set(state, (counts.get(state) ?? 0) + 1);
    });
    const states = [
        ['SUCCEEDED', '成功', 'text-emerald-700'],
        ['UNKNOWN', '待确认', 'text-amber-700'],
        ['FAILED', '失败', 'text-rose-700'],
        ['REFUNDED', '已退', 'text-blue-700'],
        ['RUNNING', '生成中', 'text-slate-600'],
        ['QUEUED', '排队', 'text-slate-600'],
        ['CANCELLED', '取消', 'text-slate-500'],
    ] as const;
    const visibleStates = states.filter(([state]) => counts.has(state));

    if (!visibleStates.length) return <span className="text-slate-400">无输出</span>;
    return (
        <div className="flex items-center gap-2">
            {visibleStates.map(([state, label, className]) => (
                <span key={state} className={`font-mono text-[10px] font-bold ${className}`}>
                    {label} {counts.get(state)}
                </span>
            ))}
        </div>
    );
}

function JobOutputsDialog({
    job,
    onClose,
    onAction,
}: {
    job: ImageGenerationJobRecord;
    onClose: () => void;
    onAction: (action: OutputAction) => void;
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
            onClick={onClose}
        >
            <AccessibleDialogSurface
                accessibleName={`任务 ${job.id} 的输出明细`}
                onRequestClose={onClose}
                className="flex max-h-[85dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
                onClick={event => event.stopPropagation()}
            >
                <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
                    <div className="min-w-0">
                        <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            任务输出明细
                            <FeatureHelpButton topic="plugins.ai-settings" title="任务输出明细" />
                        </h2>
                        <p className="mt-1 truncate font-mono text-[10px] text-slate-400" title={job.id}>
                            {job.id}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="关闭输出明细"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="overflow-auto p-4">
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[820px] border-collapse text-left text-xs">
                                <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                                        <th scope="col" className="whitespace-nowrap px-3 py-3">
                                            输出
                                        </th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-3">
                                            状态
                                        </th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-3">
                                            尝试次数
                                        </th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-3">
                                            完成时间
                                        </th>
                                        <th scope="col" className="min-w-64 whitespace-nowrap px-3 py-3">
                                            错误
                                        </th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-3 text-right">
                                            操作
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {job.outputs.map(output => (
                                        <tr key={output.id} className="h-12 hover:bg-slate-50/80">
                                            <td className="whitespace-nowrap px-3 py-2 font-mono font-bold text-slate-800">
                                                #{output.outputIndex + 1}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2">
                                                <StateBadge
                                                    state={output.refundedAt ? 'REFUNDED' : output.state}
                                                />
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-center font-mono text-slate-600">
                                                {output.attemptCount}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-slate-500">
                                                {output.completedAt
                                                    ? formatDateTime(output.completedAt)
                                                    : '-'}
                                            </td>
                                            <td className="max-w-64 px-3 py-2">
                                                <span
                                                    className={`block truncate text-[10px] ${output.errorMessage ? 'text-rose-600' : 'text-slate-400'}`}
                                                    title={output.errorMessage || undefined}
                                                >
                                                    {output.errorMessage || '-'}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-right">
                                                {output.state === 'UNKNOWN' && !output.refundedAt ? (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            onAction({
                                                                kind: 'RETRY',
                                                                jobId: job.id,
                                                                outputId: output.id,
                                                            })
                                                        }
                                                        className="rounded-lg bg-amber-100 px-3 py-1.5 text-[10px] font-bold text-amber-800 hover:bg-amber-200"
                                                    >
                                                        确认后重试
                                                    </button>
                                                ) : output.state === 'SUCCEEDED' && !output.refundedAt ? (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            onAction({
                                                                kind: 'REFUND',
                                                                jobId: job.id,
                                                                outputId: output.id,
                                                            })
                                                        }
                                                        className="rounded-lg bg-blue-100 px-3 py-1.5 text-[10px] font-bold text-blue-800 hover:bg-blue-200"
                                                    >
                                                        售后退费
                                                    </button>
                                                ) : (
                                                    <span className="text-slate-400">-</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {!job.outputs.length && (
                                        <tr>
                                            <td
                                                colSpan={6}
                                                className="p-10 text-center text-xs text-slate-400"
                                            >
                                                当前任务还没有输出记录
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}

function SkillPanel({
    releases,
    activeHash,
    onActivate,
}: {
    releases: ImageGenerationAdminResult['imagePromptSkillReleases'];
    activeHash: string;
    onActivate: (release: ImageGenerationAdminResult['imagePromptSkillReleases'][number]) => void;
}) {
    if (!releases.length)
        return (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-xs text-slate-400">
                后端尚未发布提示词规则包
            </div>
        );
    return (
        <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    提示词编译规则发布
                    <FeatureHelpButton topic="plugins.ai-settings" title="提示词编译规则发布" />
                </h2>
                <p className="mt-1 text-[11px] text-slate-400">
                    规则包由后端构建发布，本页只允许激活已经过校验的版本
                </p>
            </div>
            <div className="divide-y divide-slate-100">
                {releases.map(release => {
                    const active = release.status === 'ACTIVE' || release.sourceHash === activeHash;
                    return (
                        <article
                            key={release.id}
                            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <h3 className="text-xs font-bold text-slate-900">
                                        规则包 v{release.bundleVersion}
                                    </h3>
                                    <span
                                        className={`rounded px-2 py-0.5 text-[9px] font-bold ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                                    >
                                        {active ? '当前激活' : getStatusLabel(release.status)}
                                    </span>
                                </div>
                                <p className="mt-1 truncate font-mono text-[9px] text-slate-400">
                                    {release.sourceHash}
                                </p>
                                <p className="mt-1 text-[9px] text-slate-400">
                                    发布 {formatDateTime(release.createdAt)}
                                    {release.activatedAt
                                        ? ` · 激活 ${formatDateTime(release.activatedAt)}`
                                        : ''}
                                </p>
                            </div>
                            {!active && (
                                <button
                                    type="button"
                                    onClick={() => onActivate(release)}
                                    className="self-start rounded-lg bg-blue-600 px-3 py-2 text-[11px] font-bold text-white"
                                >
                                    激活此版本
                                </button>
                            )}
                        </article>
                    );
                })}
            </div>
        </section>
    );
}

function OutputActionDialog({
    action,
    pending,
    onClose,
    onConfirm,
}: {
    action: OutputAction;
    pending: boolean;
    onClose: () => void;
    onConfirm: (reason: string) => Promise<void>;
}) {
    const [reason, setReason] = useState('');
    const refund = action.kind === 'REFUND';
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <AccessibleDialogSurface
                accessibleName="AI 生图任务操作"
                onRequestClose={() => {
                    if (!pending) onClose();
                }}
                role="alertdialog"
                className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            >
                <div
                    className={`flex h-11 w-11 items-center justify-center rounded-full ${refund ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}
                >
                    {refund ? <CircleDollarSign className="h-5 w-5" /> : <RotateCcw className="h-5 w-5" />}
                </div>
                <h2 className="mt-4 font-bold text-slate-900">
                    {refund ? '对已成功图片执行售后退费' : '重试未知结果'}
                </h2>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                    {refund
                        ? '退费只针对该张图片，等额退回买家钱包，并写入审计流水。'
                        : '只有 UNKNOWN 输出可重试。后端会使用原幂等键，避免重复扣费。'}
                </p>
                <div className="mt-3 rounded-lg bg-slate-50 p-2 font-mono text-[10px] text-slate-500">
                    任务 {action.jobId}
                    <br />
                    输出 {action.outputId}
                </div>
                {refund && (
                    <Field label="退费原因 *">
                        <textarea
                            rows={3}
                            maxLength={300}
                            value={reason}
                            onChange={event => setReason(event.target.value)}
                            className={`${inputClass} mt-3`}
                        />
                    </Field>
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
                        onClick={() => void onConfirm(reason)}
                        disabled={pending || (refund && !reason.trim())}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {pending ? '处理中…' : refund ? '确认退费' : '确认重试'}
                    </button>
                </div>
            </AccessibleDialogSurface>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
            <AccessibleDialogSurface
                accessibleName="激活提示词规则"
                onRequestClose={() => {
                    if (!pending) onClose();
                }}
                role="alertdialog"
                className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
            >
                <ShieldCheck className="h-8 w-8 text-blue-600" />
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
                        className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                        {pending ? '正在激活…' : '确认激活'}
                    </button>
                </div>
            </AccessibleDialogSurface>
        </div>
    );
}
function ToggleCard({
    label,
    detail,
    value,
    onChange,
}: {
    label: string;
    detail: string;
    value: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <span>
                <strong className="block text-xs text-slate-800">{label}</strong>
                <small className="mt-1 block text-[10px] leading-4 text-slate-400">{detail}</small>
            </span>
            <input
                type="checkbox"
                checked={value}
                onChange={event => onChange(event.target.checked)}
                className="mt-0.5"
            />
        </label>
    );
}
function HealthBadge({ status }: { status: string }) {
    const classes =
        status === 'HEALTHY'
            ? 'bg-emerald-50 text-emerald-700'
            : status === 'UNHEALTHY'
              ? 'bg-rose-50 text-rose-700'
              : 'bg-amber-50 text-amber-700';
    return (
        <span className={`rounded px-2 py-0.5 text-[9px] font-bold ${classes}`}>
            {status === 'HEALTHY' ? '健康' : status === 'UNHEALTHY' ? '异常' : '待测试'}
        </span>
    );
}
function StateBadge({ state }: { state: string }) {
    const classes =
        state === 'SUCCEEDED'
            ? 'bg-emerald-50 text-emerald-700'
            : state === 'FAILED' || state === 'CANCELLED'
              ? 'bg-rose-50 text-rose-700'
              : state === 'UNKNOWN'
                ? 'bg-amber-50 text-amber-700'
                : state === 'REFUNDED'
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-slate-100 text-slate-600';
    const labels: Record<string, string> = {
        QUEUED: '排队中',
        RUNNING: '生成中',
        PARTIAL_SUCCESS: '部分成功',
        SUCCEEDED: '已成功',
        FAILED: '已失败',
        UNKNOWN: '结果待确认',
        CANCELLED: '已取消',
        REFUNDED: '已退费',
    };
    return (
        <span className={`whitespace-nowrap rounded px-2 py-0.5 text-[9px] font-bold ${classes}`}>
            {labels[state] ?? getStatusLabel(state)}
        </span>
    );
}
function Tab({
    active,
    onClick,
    icon: Icon,
    label,
    badge,
}: {
    active: boolean;
    onClick: () => void;
    icon: typeof Cpu;
    label: string;
    badge?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 py-3.5 ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}
        >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {badge && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] text-amber-800">{badge}</span>
            )}
        </button>
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
function LoadingState() {
    return (
        <div className="flex min-h-96 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在读取 AI 图片工坊真实配置…
        </div>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex min-h-96 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <h2 className="mt-3 text-sm font-bold text-slate-800">AI 配置加载失败</h2>
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
function errorText(error: unknown) {
    return toUserFacingError(error, 'AI 图片任务操作失败，请稍后重试');
}
const protocolOptions: ImageProviderProtocol[] = [
    'OPENAI_RESPONSES_IMAGE',
    'OPENAI_IMAGES',
    'OPENAI_COMPATIBLE_CHAT',
    'GEMINI_INTERACTIONS',
    'GEMINI_NATIVE',
    'GEMINI_NATIVE_STREAM',
];
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
