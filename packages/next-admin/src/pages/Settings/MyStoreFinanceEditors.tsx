import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    SET_MY_STORE_PAYMENT_OPTION_ENABLED_MUTATION,
    SUBMIT_STORE_GOVERNANCE_CHANGE_MUTATION,
    type MyStoreSettingsResult,
} from '../../graphql/management.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import { FieldInput } from './MyStoreFields';
import { secondaryButton } from './settings-ui';
import { governanceStatusLabel } from './StoreGovernanceLabels';
export function MyStorePayoutAccount({
    latestRequest,
    approvedRequest,
    onCompleted,
    onError,
}: {
    latestRequest: MyStoreSettingsResult['myStoreGovernanceChanges'][number] | undefined;
    approvedRequest: MyStoreSettingsResult['myStoreGovernanceChanges'][number] | undefined;
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [provider, setProvider] = useState('');
    const [accountHolder, setAccountHolder] = useState('');
    const [accountIdentifier, setAccountIdentifier] = useState('');
    const [submit, state] = useMutation(SUBMIT_STORE_GOVERNANCE_CHANGE_MUTATION);
    const save = async () => {
        if (!provider.trim() || !accountHolder.trim() || !accountIdentifier.trim()) {
            onError('请完整填写收款机构、账户持有人和收款账号');
            return;
        }
        try {
            await submit({
                variables: {
                    input: {
                        requestType: 'PAYOUT_ACCOUNT',
                        payload: {
                            provider: provider.trim(),
                            accountHolder: accountHolder.trim(),
                            accountIdentifier: accountIdentifier.trim(),
                        },
                    },
                },
            });
            setAccountIdentifier('');
            await onCompleted('收款账户已加密提交平台审核，审核前不会替换已批准记录');
        } catch (error) {
            onError(toUserFacingError(error, '提交收款账户审核失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                收款账户审核
                <FeatureHelpButton topic="settings.finance" title="收款账户审核" />
            </h2>
            <p className="mt-1 text-xs text-slate-500">
                资料会加密保存；提交后进入平台审批，审核前继续沿用已批准记录。
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
                <FieldInput label="收款机构" value={provider} onChange={setProvider} />
                <FieldInput label="账户持有人" value={accountHolder} onChange={setAccountHolder} />
                <FieldInput label="收款账号" value={accountIdentifier} onChange={setAccountIdentifier} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                <span>当前状态：{governanceStatusLabel(latestRequest)}</span>
                <button
                    type="button"
                    onClick={() => void save()}
                    disabled={state.loading}
                    className={secondaryButton}
                >
                    提交审核
                </button>
            </div>
            {approvedRequest && (
                <p className="mt-2 text-xs text-slate-600">
                    已批准资料：{String(approvedRequest.maskedSummary.provider ?? '收款机构未显示')} ·{' '}
                    {String(approvedRequest.maskedSummary.accountIdentifier ?? '账号未显示')}
                    {latestRequest?.status === 'PENDING' && '（新申请待审，已批准资料保持不变）'}
                </p>
            )}
        </section>
    );
}

export function MyStoreUsdtWallet({
    wallet,
}: {
    wallet: MyStoreSettingsResult['myStoreUsdtWallet'];
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold">平台统一 USDT 收款</h2>
            <p className="mt-2 text-xs text-slate-500">
                收款地址由超级管理员在平台管理中心配置，本店通过支付选项开启或关闭。
            </p>
            <p className="mt-3 text-xs">
                {wallet.configured ? '平台已配置' : '平台尚未配置'} ·{' '}
                {wallet.activeReceivingAddressMasked ?? '地址未获取'}
            </p>
        </section>
    );
}

export function MyStorePaymentOptions({
    options,
    onCompleted,
    onError,
}: {
    options: MyStoreSettingsResult['myStorePaymentOptions'];
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const [setEnabled, state] = useMutation(SET_MY_STORE_PAYMENT_OPTION_ENABLED_MUTATION);
    const toggle = async (id: string, enabled: boolean) => {
        try {
            await setEnabled({ variables: { id, enabled } });
            await onCompleted(enabled ? '本店支付方式已启用' : '本店支付方式已停用');
        } catch (error) {
            onError(toUserFacingError(error, '更新本店支付方式失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                本店支付选项
                <FeatureHelpButton topic="settings.payment-shipping" title="本店支付选项" />
            </h2>
            <p className="mt-1 text-xs text-slate-500">
                支付系统由平台统一配置，本店独立开启或关闭。处理器参数与密钥仅在平台管理。
            </p>
            <div className="mt-4 divide-y divide-slate-100">
                {options.map(option => (
                    <label key={option.id} className="flex items-center justify-between gap-4 py-3 text-xs">
                        <span>
                            <strong className="block text-slate-800">{option.name}</strong>
                            <span className="mt-1 block text-slate-400">
                                {!option.platformEnabled
                                    ? '平台已停用'
                                    : option.effectiveEnabled
                                      ? '本店已开启'
                                      : '本店未开启'}
                            </span>
                        </span>
                        <input
                            type="checkbox"
                            checked={option.enabled}
                            disabled={state.loading || (!option.platformEnabled && !option.enabled)}
                            onChange={event => void toggle(option.id, event.target.checked)}
                            aria-label={`${option.name}启用状态`}
                        />
                    </label>
                ))}
                {!options.length && (
                    <div className="py-8 text-center text-xs text-slate-400">平台尚未配置支付方式</div>
                )}
            </div>
        </section>
    );
}
