import { useMutation, useQuery } from '@apollo/client/react';
import {
    Activity,
    AlertCircle,
    CheckCircle2,
    KeyRound,
    LoaderCircle,
    PanelRightOpen,
    RefreshCw,
    Save,
    ShieldCheck,
    X,
} from 'lucide-react';
import { useState } from 'react';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    IMAGE_PROVIDER_ADMIN_QUERY,
    SAVE_IMAGE_PROVIDER_MUTATION,
    TEST_IMAGE_PROVIDER_MUTATION,
    type ImageProviderRecord,
    type ImageProviderScope,
} from '../../graphql/plugins.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';

export function AiImageAccessModule() {
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [drawerError, setDrawerError] = useState('');
    const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
    const query = useQuery<{ imageProviderAdminConfigs: ImageProviderRecord[] }>(IMAGE_PROVIDER_ADMIN_QUERY, {
        fetchPolicy: 'cache-and-network',
    });
    const providers = query.data?.imageProviderAdminConfigs ?? [];
    const activeProvider = providers.find(provider => provider.id === activeProviderId);
    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-none flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <KeyRound className="h-5 w-5 text-blue-600" />
                            AI 服务商接入
                            <FeatureHelpButton topic="plugins.ai-access" title="AI 服务商接入" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            平台超管配置 OpenAI / Gemini 网关、密钥和提示词优化模型；密钥不会回显
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
            <main className="mx-auto w-full max-w-none flex-1 overflow-y-auto p-5 sm:p-8">
                <div className="mx-auto w-full max-w-5xl space-y-4">
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
                    <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-900">
                        <div className="flex items-start gap-2">
                            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                            <p>
                                <strong>密钥安全说明：</strong>
                                密钥只在右侧设置抽屉输入，后端仅返回配置状态及末 4 位；留空会保留原密钥。
                            </p>
                        </div>
                    </section>
                    {query.loading && !query.data ? (
                        <LoadingState />
                    ) : query.error ? (
                        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
                    ) : (
                        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
                                <div>
                                    <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                                        服务商设置
                                        <FeatureHelpButton topic="plugins.ai-access" title="服务商设置" />
                                    </h2>
                                    <p className="mt-1 text-[11px] text-slate-500">
                                        查看接入状态，需要调整时再打开对应服务商设置。
                                    </p>
                                </div>
                                <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                                    {providers.length} 个服务商
                                </span>
                            </div>
                            <div className="divide-y divide-slate-100">
                                {providers.map(provider => (
                                    <ProviderRow
                                        key={provider.id}
                                        value={provider}
                                        onOpen={() => {
                                            setDrawerError('');
                                            setActionError('');
                                            setActiveProviderId(provider.id);
                                        }}
                                    />
                                ))}
                                {!providers.length && (
                                    <div className="p-10 text-center text-xs text-slate-400">
                                        当前没有可配置的 AI 服务商
                                    </div>
                                )}
                            </div>
                        </section>
                    )}
                </div>
            </main>
            {activeProvider && (
                <ProviderDrawer
                    key={`${activeProvider.id}-${activeProvider.apiKeyLast4}-${activeProvider.credentialEnabled}-${activeProvider.baseUrl}-${activeProvider.textModelId}`}
                    value={activeProvider}
                    error={drawerError}
                    onClose={() => {
                        setDrawerError('');
                        setActiveProviderId(null);
                    }}
                    onSaved={async message => {
                        setNotice(message);
                        setActionError('');
                        setDrawerError('');
                        await query.refetch();
                    }}
                    onError={message => {
                        setDrawerError(message);
                        setActionError(message);
                        setNotice('');
                    }}
                />
            )}
        </div>
    );
}

function ProviderRow({ value, onOpen }: { value: ImageProviderRecord; onOpen: () => void }) {
    return (
        <article className="flex flex-col gap-4 px-4 py-4 transition-colors hover:bg-slate-50/70 sm:flex-row sm:items-center sm:px-5">
            <div className="flex min-w-0 flex-1 items-start gap-3">
                <ProviderMark scope={value.scope} />
                <div className="min-w-0">
                    <h3 className="text-xs font-bold text-slate-900">{value.name}</h3>
                    <p className="mt-1 text-[10px] text-slate-500">
                        {providerName(value.scope)} · {providerPurposeLabel(value.purpose)} · 优先级{' '}
                        {value.priority}
                    </p>
                    <p className="mt-1 break-all font-mono text-[10px] leading-5 text-slate-500">
                        {value.baseUrl || 'API Base URL 未设置'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <ProviderStatusPill tone={value.credentialConfigured ? 'success' : 'warning'}>
                            {value.credentialConfigured
                                ? '密钥已配置 · ' + (value.apiKeyLast4 || '末位未知')
                                : '密钥待配置'}
                        </ProviderStatusPill>
                        <ProviderStatusPill tone={value.credentialEnabled ? 'success' : 'neutral'}>
                            {value.credentialEnabled ? '已启用' : '已停用'}
                        </ProviderStatusPill>
                        <HealthBadge status={value.providerHealthStatus} />
                        <span className="max-w-full truncate font-mono text-[10px] text-slate-400">
                            提示词模型：{value.textModelId || '未设置'}
                        </span>
                    </div>
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

function ProviderDrawer({
    value,
    error,
    onSaved,
    onError,
    onClose,
}: {
    value: ImageProviderRecord;
    error: string;
    onSaved: (message: string) => Promise<void>;
    onError: (message: string) => void;
    onClose: () => void;
}) {
    const [baseUrl, setBaseUrl] = useState(value.baseUrl);
    const [textModelId, setTextModelId] = useState(value.textModelId);
    const [apiKey, setApiKey] = useState('');
    const [enabled, setEnabled] = useState(value.credentialEnabled);
    const [testResult, setTestResult] = useState<{
        ok: boolean;
        message: string;
        testedAt: string;
    } | null>(null);
    const [save, saveState] = useMutation<{ saveImageProviderCredential: ImageProviderRecord }>(
        SAVE_IMAGE_PROVIDER_MUTATION,
    );
    const [test, testState] = useMutation<{
        testImageProviderCredential: { ok: boolean; message: string; testedAt: string };
    }>(TEST_IMAGE_PROVIDER_MUTATION);
    const validation = !baseUrl.trim()
        ? '请填写 API Base URL'
        : !validHttpUrl(baseUrl)
          ? 'Base URL 必须是有效的 HTTP(S) 网址'
          : value.purpose !== 'IMAGE' && !textModelId.trim()
            ? '请填写提示词优化模型 ID'
            : !value.credentialConfigured && !apiKey.trim()
              ? '首次配置必须填写 API Key'
              : null;
    const dirty =
        baseUrl !== value.baseUrl ||
        textModelId !== value.textModelId ||
        Boolean(apiKey.trim()) ||
        enabled !== value.credentialEnabled;
    const health = testResult ? (testResult.ok ? 'HEALTHY' : 'UNHEALTHY') : value.providerHealthStatus;
    const healthMessage = testResult?.message ?? value.providerHealthMessage;
    const pending = saveState.loading || testState.loading;

    const saveProvider = async () => {
        if (validation) return;
        try {
            const result = await save({
                variables: {
                    input: {
                        id: value.id,
                        code: value.code,
                        name: value.name,
                        scope: value.scope,
                        purpose: value.purpose,
                        priority: value.priority,
                        weight: value.weight,
                        modelCodes: value.modelCodes,
                        baseUrl: baseUrl.trim(),
                        apiKey: apiKey.trim() || null,
                        textModelId: textModelId.trim(),
                        orchestrationModelId: value.orchestrationModelId,
                        enabled,
                    },
                },
            });
            if (result.data) {
                const saved = result.data.saveImageProviderCredential;
                setBaseUrl(saved.baseUrl);
                setTextModelId(saved.textModelId);
                setEnabled(saved.credentialEnabled);
            }
            setApiKey('');
            setTestResult(null);
            await onSaved(value.name + ' 凭据已加密保存；修改连接信息后需测试通过，再启用凭据');
            onClose();
        } catch (saveError) {
            onError(errorText(saveError));
        }
    };
    const testProvider = async () => {
        try {
            const result = await test({ variables: { id: value.id } });
            if (result.data) setTestResult(result.data.testImageProviderCredential);
            await onSaved(value.name + ' 连通性测试已完成');
        } catch (testError) {
            onError(errorText(testError));
        }
    };

    return (
        <AccessibleDialogSurface
            accessibleName={'设置服务商：' + value.name}
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
                    <div className="flex min-w-0 items-start gap-3">
                        <ProviderMark scope={value.scope} />
                        <div className="min-w-0">
                            <h2 className="text-base font-bold text-slate-900">{value.name}</h2>
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                                设置网关、加密密钥和提示词优化模型。
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={pending}
                        aria-label={'关闭' + value.name + '设置'}
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
                    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                        <div className="flex flex-wrap items-center gap-2">
                            <HealthBadge status={health} />
                            <ProviderStatusPill tone={value.credentialConfigured ? 'success' : 'warning'}>
                                {value.credentialConfigured
                                    ? '密钥已配置 · 末 4 位 ' + (value.apiKeyLast4 || '未知')
                                    : '首次接入，尚未配置密钥'}
                            </ProviderStatusPill>
                            <ProviderStatusPill tone={enabled ? 'success' : 'neutral'}>
                                {enabled ? '凭据已启用' : '凭据已停用'}
                            </ProviderStatusPill>
                        </div>
                        {healthMessage && (
                            <p
                                className={
                                    'mt-3 text-xs leading-5 ' +
                                    (health === 'UNHEALTHY' ? 'text-rose-600' : 'text-slate-500')
                                }
                            >
                                {healthMessage}
                            </p>
                        )}
                    </section>

                    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            网关与模型
                            <FeatureHelpButton topic="plugins.ai-access" title="网关与模型" />
                        </h3>
                        <p className="mt-1 text-[11px] leading-5 text-slate-500">
                            Base URL 和模型 ID 必须与当前服务商网关实际支持的配置一致。
                        </p>
                        <div className="mt-4 space-y-4">
                            <Field label="API Base URL *">
                                <input
                                    value={baseUrl}
                                    onChange={event => setBaseUrl(event.target.value)}
                                    placeholder={
                                        value.scope === 'OPENAI'
                                            ? 'https://api.openai.com/v1'
                                            : 'https://generativelanguage.googleapis.com'
                                    }
                                    className={inputClass + ' font-mono'}
                                />
                            </Field>
                            <Field
                                label={'提示词优化模型 ID ' + (value.purpose === 'IMAGE' ? '（可选）' : '*')}
                            >
                                <input
                                    value={textModelId}
                                    onChange={event => setTextModelId(event.target.value)}
                                    placeholder="由当前网关支持的文本模型 ID"
                                    className={inputClass + ' font-mono'}
                                />
                            </Field>
                        </div>
                    </section>

                    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                            加密凭据
                            <FeatureHelpButton topic="plugins.ai-access" title="加密凭据" />
                        </h3>
                        <p className="mt-1 text-[11px] leading-5 text-slate-500">
                            后端不会回显完整密钥；只有输入新值并保存时才会轮换。
                        </p>
                        <div className="mt-4 space-y-4">
                            <Field
                                label={'API Key ' + (value.credentialConfigured ? '（留空保留原密钥）' : '*')}
                            >
                                <input
                                    type="password"
                                    autoComplete="new-password"
                                    value={apiKey}
                                    onChange={event => setApiKey(event.target.value)}
                                    placeholder={
                                        value.credentialConfigured
                                            ? '已配置 · 末 4 位 ' + value.apiKeyLast4
                                            : '请输入密钥'
                                    }
                                    className={inputClass + ' font-mono'}
                                />
                            </Field>
                            <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
                                <span>
                                    <strong className="block text-xs text-slate-800">启用该服务商凭据</strong>
                                    <small className="mt-1 block text-[10px] leading-4 text-slate-400">
                                        停用后不会删除已保存的加密密钥。
                                    </small>
                                </span>
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={event => setEnabled(event.target.checked)}
                                    className="mt-0.5"
                                />
                            </label>
                        </div>
                    </section>
                </div>

                <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
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
                                onClick={() => void testProvider()}
                                disabled={pending || !value.credentialConfigured || dirty}
                                title={dirty ? '请先保存凭据变更' : undefined}
                                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40"
                            >
                                {testState.loading ? (
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Activity className="h-3.5 w-3.5" />
                                )}
                                {testState.loading ? '测试中…' : '测试连通性'}
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
                                onClick={() => void saveProvider()}
                                disabled={saveState.loading || !dirty || Boolean(validation)}
                                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                            >
                                <Save className="h-3.5 w-3.5" />
                                {saveState.loading ? '正在保存…' : '保存凭据'}
                            </button>
                        </div>
                    </div>
                </footer>
            </div>
        </AccessibleDialogSurface>
    );
}

function ProviderMark({ scope }: { scope: ImageProviderScope }) {
    return (
        <span
            className={
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-bold ' +
                (scope === 'OPENAI' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700')
            }
        >
            {scope === 'OPENAI' ? 'OA' : 'G'}
        </span>
    );
}

function ProviderStatusPill({
    tone,
    children,
}: {
    tone: 'success' | 'warning' | 'neutral';
    children: React.ReactNode;
}) {
    const classes = {
        success: 'bg-emerald-50 text-emerald-700',
        warning: 'bg-amber-50 text-amber-700',
        neutral: 'bg-slate-100 text-slate-600',
    }[tone];
    return <span className={'rounded px-2 py-0.5 text-[9px] font-bold ' + classes}>{children}</span>;
}

function HealthBadge({ status }: { status: string }) {
    const classes =
        status === 'HEALTHY'
            ? 'bg-emerald-50 text-emerald-700'
            : status === 'UNHEALTHY'
              ? 'bg-rose-50 text-rose-700'
              : status === 'UNTESTED'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-slate-100 text-slate-500';
    const label =
        status === 'HEALTHY'
            ? '健康'
            : status === 'UNHEALTHY'
              ? '异常'
              : status === 'UNTESTED'
                ? '待测试'
                : '未配置';
    return <span className={`rounded px-2 py-0.5 text-[9px] font-bold ${classes}`}>{label}</span>;
}
function providerName(scope: ImageProviderScope) {
    return scope === 'OPENAI' ? 'OpenAI 协议网关' : 'Google Gemini 协议网关';
}
function providerPurposeLabel(purpose: ImageProviderRecord['purpose']) {
    return purpose === 'IMAGE' ? '图片生成' : purpose === 'PROMPT' ? '提示词优化' : '图片与提示词';
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
        <div className="flex min-h-80 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在读取服务商凭据状态…
        </div>
    );
}
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
    return (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" />
            <h2 className="mt-3 text-sm font-bold text-slate-800">服务商配置加载失败</h2>
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
function validHttpUrl(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}
function errorText(error: unknown) {
    return toUserFacingError(error, 'AI 服务商操作失败，请稍后重试');
}
const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
