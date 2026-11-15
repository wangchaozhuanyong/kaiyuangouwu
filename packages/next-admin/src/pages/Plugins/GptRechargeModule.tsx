import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { ArrowUpRight, RefreshCw, Save } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAdminQueryScope } from '../../apollo';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { useServerDraft } from '../../hooks/use-server-draft';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';

type Configuration = {
    enabled: boolean;
    upstreamOrigin: string;
    credentialConfigured: boolean;
    partnerConfigured: boolean;
    legacyConfigured: boolean;
    revision: number;
};
type Draft = Pick<Configuration, 'enabled' | 'upstreamOrigin'> & { expectedRevision: number };
export const GPT_RECHARGE_ADMIN_CONFIG = gql`
    query GptRechargeAdminConfig {
        gptRechargeAdminConfig {
            enabled
            upstreamOrigin
            credentialConfigured
            partnerConfigured
            legacyConfigured
            revision
        }
    }
`;
export const UPDATE_GPT_RECHARGE_CONFIG = gql`
    mutation UpdateGptRechargeConfig($input: GptRechargeConfigInput!) {
        updateGptRechargeConfig(input: $input) {
            enabled
            upstreamOrigin
            credentialConfigured
            partnerConfigured
            legacyConfigured
            revision
        }
    }
`;
const toDraft = (config: Configuration): Draft => ({
    enabled: config.enabled,
    upstreamOrigin: config.upstreamOrigin,
    expectedRevision: config.revision,
});

export function GptRechargeModule() {
    const query = useAdminQuery<{ gptRechargeAdminConfig: Configuration }>(GPT_RECHARGE_ADMIN_CONFIG, {
        fetchPolicy: 'no-cache',
    });
    const source = query.data?.gptRechargeAdminConfig;
    const scope = getAdminQueryScope();
    const server = useServerDraft<Draft>(
        `gpt-recharge:${scope}`,
        source ? String(source.revision) : '',
        source ? toDraft(source) : null,
    );
    const [secret, setSecret] = useState({ scope, value: '', partner: '' });
    const serviceKey = secret.scope === scope ? secret.value : '';
    const partnerApiKey = secret.scope === scope ? secret.partner : '';
    useUnsavedChangesWarning(Boolean(serviceKey || partnerApiKey), '当前连接凭证尚未保存，确定离开吗？');
    const [feedback, setFeedback] = useState({ scope, message: '', failed: false });
    const message = feedback.scope === scope ? feedback.message : '';
    const pending = useRef(false);
    const [save, saveState] = useMutation<{ updateGptRechargeConfig: Configuration }>(
        UPDATE_GPT_RECHARGE_CONFIG,
        { fetchPolicy: 'no-cache' },
    );
    const update = (patch: Partial<Draft>) =>
        server.setDraft(value => (value ? { ...value, ...patch } : value));
    const submit = async () => {
        if (!server.draft || server.sourceChanged || pending.current) return;
        pending.current = true;
        setFeedback({ scope, message: '', failed: false });
        try {
            const saved = (
                await save({
                    variables: {
                        input: {
                            ...server.draft,
                            serviceKey: serviceKey || undefined,
                            partnerApiKey: partnerApiKey || undefined,
                        },
                    },
                })
            ).data?.updateGptRechargeConfig;
            if (getAdminQueryScope() !== scope) return;
            if (!saved) throw new Error('No saved configuration');
            server.accept(toDraft(saved), String(saved.revision));
            setSecret({ scope, value: '', partner: '' });
            setFeedback({
                scope,
                message: '当前店铺的充值连接已保存。前台入口还需在客户端插件中启用并发布。',
                failed: false,
            });
            try {
                await query.refetch();
            } catch {
                setFeedback({
                    scope,
                    message: '配置已保存，但最新状态读取失败。请点击重新读取核对，勿重复保存。',
                    failed: true,
                });
            }
        } catch {
            if (getAdminQueryScope() === scope)
                setFeedback({
                    scope,
                    message: '配置未保存或结果无法确认。请重新读取，核对服务地址白名单、独立凭证和配置版本。',
                    failed: true,
                });
        } finally {
            pending.current = false;
        }
    };
    return (
        <section className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6" data-admin-page="gpt-recharge">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
                <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
                    GPT自助充值
                    <FeatureHelpButton
                        title="GPT自助充值"
                        content={{
                            purpose: '配置当前店铺的 GPT 自助充值服务。',
                            requirements: [
                                '仅超级管理员可维护连接，使用已加入服务器白名单的 ID 系统地址和合作方 API 密钥',
                                '保存连接后，在客户端插件中心启用并发布前台入口',
                            ],
                            example: '例如：为自营店开放兑换码充值，其他店铺保留原配置。',
                            impact: '关闭只阻止当前店铺的新提交；原任务仍可查询。套餐由兑换码决定。',
                        }}
                    />
                </h1>
                <AdminButton
                    refreshPage
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                    disabled={query.loading}
                    onClick={() => void query.refetch()}
                >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    重新读取
                </AdminButton>
                <p className="col-span-2 text-sm text-slate-500">
                    配置当前店铺的充值连接，仅超级管理员可见。
                </p>
            </div>
            {query.loading && !source && (
                <p role="status" className="rounded-xl bg-white p-6 text-sm text-slate-500">
                    正在读取充值配置…
                </p>
            )}
            {query.error && (
                <p role="alert" className="admin-page-status" data-failed>
                    充值配置读取失败，可点击重新读取。已填写的内容会保留。
                </p>
            )}
            {message && (
                <p
                    role={feedback.failed ? 'alert' : 'status'}
                    className="admin-page-status"
                    data-failed={feedback.failed || undefined}
                >
                    {message}
                </p>
            )}
            {server.sourceChanged && <DraftUpdateNotice onReload={server.reload} />}
            {server.draft && source && (
                <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
                    <form
                        aria-label="GPT 充值连接配置"
                        className="min-w-0 overflow-hidden rounded-xl bg-white"
                        onSubmit={event => {
                            event.preventDefault();
                            void submit();
                        }}
                    >
                        <section aria-labelledby="recharge-service-title" className="space-y-5 p-5 sm:p-6">
                            <div className="space-y-1">
                                <h2
                                    id="recharge-service-title"
                                    className="text-base font-semibold text-slate-900"
                                >
                                    充值服务
                                </h2>
                                <p className="text-sm text-slate-500">设置当前店铺的服务开关与上游连接。</p>
                            </div>
                            <AdminField
                                label="开放充值服务"
                                className="text-sm"
                                description="仅影响当前店铺的新提交。关闭后，原任务仍可查询。"
                            >
                                <AdminInput
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-slate-300 accent-blue-600"
                                    checked={server.draft.enabled}
                                    disabled={saveState.loading}
                                    onChange={event => update({ enabled: event.target.checked })}
                                />
                            </AdminField>
                            <AdminField
                                label="服务地址"
                                className="text-sm"
                                description="填写 ID 系统提供的 HTTPS API 地址。已有任务后不可改用其他站点。"
                            >
                                <AdminInput
                                    type="url"
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                    placeholder="https://recharge.example.com"
                                    required
                                    value={server.draft.upstreamOrigin}
                                    autoComplete="off"
                                    disabled={saveState.loading}
                                    onChange={event => update({ upstreamOrigin: event.target.value })}
                                />
                            </AdminField>
                        </section>
                        <section
                            aria-labelledby="recharge-credentials-title"
                            className="space-y-5 border-t border-slate-100 p-5 sm:p-6"
                        >
                            <div className="space-y-1">
                                <h2
                                    id="recharge-credentials-title"
                                    className="text-base font-semibold text-slate-900"
                                >
                                    连接凭证
                                </h2>
                                <p className="text-sm text-slate-500">
                                    按使用的充值通道填写，已保存的凭证不会回显。
                                </p>
                            </div>
                            <AdminField
                                label="原商城服务凭证"
                                className="text-sm"
                                description={
                                    source.legacyConfigured
                                        ? '已配置。留空保留现有凭证，保存后不会回显。'
                                        : '适用于先前通过商城专用通道发放的兑换码。'
                                }
                            >
                                <AdminInput
                                    type="password"
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                    placeholder={
                                        source.legacyConfigured ? '留空保留现有凭证' : '输入原商城服务凭证'
                                    }
                                    value={serviceKey}
                                    autoComplete="new-password"
                                    minLength={32}
                                    maxLength={512}
                                    disabled={saveState.loading}
                                    onChange={event =>
                                        setSecret({
                                            scope,
                                            value: event.target.value,
                                            partner: partnerApiKey,
                                        })
                                    }
                                />
                            </AdminField>
                            <AdminField
                                label="合作方 API 密钥"
                                className="text-sm"
                                description={
                                    source.partnerConfigured
                                        ? '已配置。留空保留现有密钥，保存后不会回显。'
                                        : '填写在 ID 系统「充值 API 接入」为当前店铺发放的密钥。'
                                }
                            >
                                <AdminInput
                                    type="password"
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                    placeholder={
                                        source.partnerConfigured ? '留空保留现有密钥' : '输入合作方 API 密钥'
                                    }
                                    value={partnerApiKey}
                                    name="partnerApiKey"
                                    autoComplete="new-password"
                                    maxLength={71}
                                    disabled={saveState.loading}
                                    onChange={event =>
                                        setSecret({ scope, partner: event.target.value, value: serviceKey })
                                    }
                                />
                            </AdminField>
                        </section>
                        <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                            <p role="status" className="text-sm text-slate-500">
                                {server.dirty || serviceKey || partnerApiKey
                                    ? '有未保存的更改'
                                    : '当前没有未保存的更改'}
                            </p>
                            <AdminButton
                                type="submit"
                                className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                                disabled={
                                    saveState.loading ||
                                    server.sourceChanged ||
                                    (!server.dirty && !serviceKey && !partnerApiKey) ||
                                    (!source.credentialConfigured && !serviceKey && !partnerApiKey)
                                }
                                aria-busy={saveState.loading}
                            >
                                <Save className="h-4 w-4" aria-hidden="true" />
                                {saveState.loading ? '正在保存…' : '保存当前店铺配置'}
                            </AdminButton>
                        </div>
                    </form>
                    <aside aria-label="配置状态与使用指引" className="min-w-0 space-y-6">
                        <section aria-labelledby="recharge-status-title" className="space-y-4 p-1">
                            <h2 id="recharge-status-title" className="text-sm font-semibold text-slate-900">
                                已保存的状态
                            </h2>
                            <dl className="space-y-3 text-sm">
                                {[
                                    ['充值服务', source.enabled ? '已开放' : '已关闭'],
                                    ['原商城服务凭证', source.legacyConfigured ? '已配置' : '未配置'],
                                    ['合作方 API 密钥', source.partnerConfigured ? '已配置' : '未配置'],
                                ].map(([label, value]) => (
                                    <div key={label} className="flex items-start justify-between gap-3">
                                        <dt className="text-slate-500">{label}</dt>
                                        <dd className="shrink-0 font-medium text-slate-700">{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                        <section
                            aria-labelledby="recharge-entry-title"
                            className="space-y-3 rounded-xl bg-slate-100 p-5"
                        >
                            <h2 id="recharge-entry-title" className="text-sm font-semibold text-slate-900">
                                前台入口
                            </h2>
                            <p className="text-sm leading-6 text-slate-500">
                                保存连接后，还需在客户端插件中心启用并发布前台入口。
                            </p>
                            <Link
                                to="/plugins/client-plugins"
                                className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-blue-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
                            >
                                管理前台入口
                                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                            </Link>
                        </section>
                        <section aria-labelledby="recharge-rules-title" className="space-y-2 p-1">
                            <h2 id="recharge-rules-title" className="text-sm font-semibold text-slate-900">
                                充值规则
                            </h2>
                            <p className="text-sm leading-6 text-slate-500">
                                套餐由兑换码绑定。这里不设置价格、银行卡或执行策略。
                            </p>
                        </section>
                    </aside>
                </div>
            )}
        </section>
    );
}
