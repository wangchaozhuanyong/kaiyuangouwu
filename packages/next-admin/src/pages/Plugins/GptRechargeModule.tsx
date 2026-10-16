import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useRef, useState } from 'react';
import { getAdminQueryScope } from '../../apollo';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { DraftUpdateNotice } from '../../components/DraftUpdateNotice';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { useServerDraft } from '../../hooks/use-server-draft';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';

type Configuration = {
    enabled: boolean;
    upstreamOrigin: string;
    credentialConfigured: boolean;
    revision: number;
};
type Draft = Pick<Configuration, 'enabled' | 'upstreamOrigin'> & { expectedRevision: number };
export const GPT_RECHARGE_ADMIN_CONFIG = gql`
    query GptRechargeAdminConfig {
        gptRechargeAdminConfig {
            enabled
            upstreamOrigin
            credentialConfigured
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
    const [secret, setSecret] = useState({ scope, value: '' });
    const serviceKey = secret.scope === scope ? secret.value : '';
    useUnsavedChangesWarning(Boolean(serviceKey), '当前连接凭证尚未保存，确定离开吗？');
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
                await save({ variables: { input: { ...server.draft, serviceKey: serviceKey || undefined } } })
            ).data?.updateGptRechargeConfig;
            if (getAdminQueryScope() !== scope) return;
            if (!saved) throw new Error('No saved configuration');
            server.accept(toDraft(saved), String(saved.revision));
            setSecret({ scope, value: '' });
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
        <section className="space-y-4" data-admin-page="gpt-recharge">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold">GPT自助充值</h1>
                    <p className="mt-1 text-sm text-slate-500">配置当前店铺的充值连接，仅超级管理员可见。</p>
                </div>
                <AdminButton refreshPage disabled={query.loading} onClick={() => void query.refetch()}>
                    重新读取
                </AdminButton>
            </div>
            {query.loading && !source && <p role="status">正在读取充值配置…</p>}
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
                <form
                    className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"
                    onSubmit={event => {
                        event.preventDefault();
                        void submit();
                    }}
                >
                    <AdminField
                        label="开放充值服务"
                        description="仅影响当前店铺的新提交。关闭后，原任务仍可查询。"
                    >
                        <AdminInput
                            type="checkbox"
                            checked={server.draft.enabled}
                            disabled={saveState.loading}
                            onChange={event => update({ enabled: event.target.checked })}
                        />
                    </AdminField>
                    <AdminField
                        label="服务地址"
                        description="使用已加入服务器白名单的 HTTPS 地址；不包含接口路径。已有任务后不可更换。"
                        layout="stacked"
                    >
                        <AdminInput
                            type="url"
                            required
                            value={server.draft.upstreamOrigin}
                            autoComplete="off"
                            disabled={saveState.loading}
                            onChange={event => update({ upstreamOrigin: event.target.value })}
                        />
                    </AdminField>
                    <AdminField
                        label="独立服务凭证"
                        description={
                            source.credentialConfigured
                                ? '已配置。留空保留现有凭证，保存后不会回显。'
                                : '尚未配置。请填写专用于本集成的凭证。'
                        }
                        layout="stacked"
                    >
                        <AdminInput
                            type="password"
                            value={serviceKey}
                            autoComplete="new-password"
                            minLength={32}
                            maxLength={512}
                            required={!source.credentialConfigured}
                            disabled={saveState.loading}
                            onChange={event => setSecret({ scope, value: event.target.value })}
                        />
                    </AdminField>
                    <p className="text-sm text-slate-500">
                        套餐由兑换码绑定。这里不设置价格、银行卡或执行策略。
                    </p>
                    <AdminButton
                        type="submit"
                        className="bg-blue-600 text-white"
                        disabled={saveState.loading || server.sourceChanged || (!server.dirty && !serviceKey)}
                        aria-busy={saveState.loading}
                    >
                        {saveState.loading ? '正在保存…' : '保存当前店铺配置'}
                    </AdminButton>
                </form>
            )}
        </section>
    );
}
