import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { Activity, AlertCircle, CheckCircle2, KeyRound, LoaderCircle, RefreshCw, Save, X } from 'lucide-react';
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
  const query = useQuery<{ imageProviderAdminConfigs: ImageProviderRecord[] }>(IMAGE_PROVIDER_ADMIN_QUERY, {
    fetchPolicy: 'cache-and-network',
  });
  return <div className="flex h-full flex-col bg-slate-50">
    <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8"><div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><KeyRound className="h-5 w-5 text-blue-600" />AI 服务商接入</h1><p className="mt-1 text-xs text-slate-500">平台超管配置 OpenAI / Gemini 网关、密钥和提示词优化模型；密钥不会回显</p></div><button type="button" onClick={() => void query.refetch()} disabled={query.loading} className="flex items-center gap-1.5 self-start rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700"><RefreshCw className={`h-3.5 w-3.5 ${query.loading ? 'animate-spin' : ''}`} />刷新</button></div></header>
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
      {notice && <Message kind="success" onClose={() => setNotice('')}>{notice}</Message>}
      {actionError && <Message kind="error" onClose={() => setActionError('')}>{actionError}</Message>}
      <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-900"><strong>密钥安全说明：</strong>后端只返回是否已配置及末 4 位。留空 API Key 会保留原密钥；输入新值才会轮换。</section>
      {query.loading && !query.data ? <LoadingState /> : query.error ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : <div className="space-y-4">{query.data?.imageProviderAdminConfigs.map(provider => <ProviderCard key={`${provider.scope}-${provider.apiKeyLast4}-${provider.providerHealthStatus}-${provider.baseUrl}`} value={provider} onSaved={async message => { setNotice(message); setActionError(''); await query.refetch(); }} onError={message => { setActionError(message); setNotice(''); }} />)}</div>}
    </main>
  </div>;
}

function ProviderCard({ value, onSaved, onError }: { value: ImageProviderRecord; onSaved: (message: string) => Promise<void>; onError: (message: string) => void }) {
  const [baseUrl, setBaseUrl] = useState(value.baseUrl);
  const [textModelId, setTextModelId] = useState(value.textModelId);
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(value.credentialEnabled);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; testedAt: string } | null>(null);
  const [save, saveState] = useMutation(SAVE_IMAGE_PROVIDER_MUTATION);
  const [test, testState] = useMutation<{ testImageProviderConnection: { ok: boolean; message: string; testedAt: string } }>(TEST_IMAGE_PROVIDER_MUTATION);
  const validation = !baseUrl.trim() ? '请填写 API Base URL' : !validHttpUrl(baseUrl) ? 'Base URL 必须是有效的 HTTP(S) 网址' : !textModelId.trim() ? '请填写提示词优化模型 ID' : !value.credentialConfigured && !apiKey.trim() ? '首次配置必须填写 API Key' : null;
  const dirty = baseUrl !== value.baseUrl || textModelId !== value.textModelId || Boolean(apiKey.trim()) || enabled !== value.credentialEnabled;
  const saveProvider = async () => { if (validation) return; try { await save({ variables: { input: { scope: value.scope, baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || null, textModelId: textModelId.trim(), enabled } } }); setApiKey(''); setTestResult(null); await onSaved(`${providerName(value.scope)}凭据已加密保存，连接状态需要重新测试`); } catch (error) { onError(errorText(error)); } };
  const testProvider = async () => { try { const result = await test({ variables: { scope: value.scope } }); if (result.data) setTestResult(result.data.testImageProviderConnection); await onSaved(`${providerName(value.scope)} 连通性测试已完成`); } catch (error) { onError(errorText(error)); } };
  const health = testResult ? (testResult.ok ? 'HEALTHY' : 'UNHEALTHY') : value.providerHealthStatus;
  const healthMessage = testResult?.message ?? value.providerHealthMessage;
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"><div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ${value.scope === 'OPENAI' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{value.scope === 'OPENAI' ? 'OA' : 'G'}</div><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-bold text-slate-900">{providerName(value.scope)}</h2><HealthBadge status={health} /></div><p className="mt-1 text-[11px] text-slate-400">{value.credentialConfigured ? `已配置密钥 · 末 4 位 ${value.apiKeyLast4 || '未知'}` : '还未配置密钥'}</p>{healthMessage && <p className={`mt-2 text-[11px] ${health === 'UNHEALTHY' ? 'text-rose-600' : 'text-slate-500'}`}>{healthMessage}</p>}</div></div><button type="button" onClick={() => void testProvider()} disabled={testState.loading || !value.credentialConfigured || dirty} title={dirty ? '请先保存凭据变更' : undefined} className="flex items-center gap-1.5 self-start rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40">{testState.loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}测试连通性</button></div><div className="mt-4 grid gap-4 sm:grid-cols-2"><div className="sm:col-span-2"><Field label="API Base URL *"><input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder={value.scope === 'OPENAI' ? 'https://api.openai.com/v1' : 'https://generativelanguage.googleapis.com'} className={`${inputClass} font-mono`} /></Field></div><Field label={`API Key ${value.credentialConfigured ? '（留空保留原密钥）' : '*'}`}><input type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={value.credentialConfigured ? `已配置 · 末 4 位 ${value.apiKeyLast4}` : '请输入密钥'} className={`${inputClass} font-mono`} /></Field><Field label="提示词优化模型 ID *"><input value={textModelId} onChange={event => setTextModelId(event.target.value)} placeholder="由当前网关支持的文本模型 ID" className={`${inputClass} font-mono`} /></Field></div><div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />启用该服务商凭据</label><div className="flex flex-col items-end gap-1">{validation && <p className="text-[10px] text-rose-600">{validation}</p>}<button type="button" onClick={() => void saveProvider()} disabled={saveState.loading || !dirty || Boolean(validation)} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-3.5 w-3.5" />{saveState.loading ? '正在保存…' : '保存凭据'}</button></div></div></section>;
}

function HealthBadge({ status }: { status: string }) { const classes = status === 'HEALTHY' ? 'bg-emerald-50 text-emerald-700' : status === 'UNHEALTHY' ? 'bg-rose-50 text-rose-700' : status === 'UNTESTED' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'; const label = status === 'HEALTHY' ? '健康' : status === 'UNHEALTHY' ? '异常' : status === 'UNTESTED' ? '待测试' : '未配置'; return <span className={`rounded px-2 py-0.5 text-[9px] font-bold ${classes}`}>{label}</span>; }
function providerName(scope: ImageProviderScope) { return scope === 'OPENAI' ? 'OpenAI 协议网关' : 'Google Gemini 协议网关'; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs font-bold text-slate-700"><span className="mb-1.5 block">{label}</span>{children}</label>; }
function LoadingState() { return <div className="flex min-h-80 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取服务商凭据状态…</div>; }
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) { return <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center"><AlertCircle className="h-8 w-8 text-rose-500" /><h2 className="mt-3 text-sm font-bold text-slate-800">服务商配置加载失败</h2><p className="mt-1 max-w-lg text-xs text-rose-600">{toUserFacingError(message)}</p><button type="button" onClick={onRetry} className="mt-4 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">重试</button></div>; }
function Message({ kind, onClose, children }: { kind: 'success' | 'error'; onClose: () => void; children: React.ReactNode }) { const success = kind === 'success'; return <div className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}<span className="flex-1">{children}</span><button type="button" onClick={onClose} aria-label="关闭"><X className="h-4 w-4" /></button></div>; }
function validHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; } }
function errorText(error: unknown) { return toUserFacingError(error, 'AI 服务商操作失败，请稍后重试'); }
const inputClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
