import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    SET_MY_STORE_PAYMENT_OPTION_ENABLED_MUTATION,
    SUBMIT_STORE_GOVERNANCE_CHANGE_MUTATION,
    type MyStoreSettingsResult,
} from '../../graphql/management.graphql';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
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
    useUnsavedChangesWarning(
        Boolean(provider || accountHolder || accountIdentifier),
        '收款账户还有未提交的修改，确定放弃吗？',
    );
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
            setAccountHolder('');
            setProvider('');
            await onCompleted('收款账户已加密提交平台审核，审核前不会替换已批准记录');
        } catch (error) {
            onError(toUserFacingError(error, '提交收款账户审核失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="admin-section-title-line">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    收款账户审核
                    <FeatureHelpButton
                        topic="settings.finance"
                        title="收款账户审核"
                        description={'资料会加密保存；提交后进入平台审批，审核前继续沿用已批准记录。'}
                    />
                </h2>
                <p className="text-xs text-slate-500">提交资料后由平台审核</p>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
                <FieldInput label="收款机构" value={provider} onChange={setProvider} />
                <FieldInput label="账户持有人" value={accountHolder} onChange={setAccountHolder} />
                <FieldInput label="收款账号" value={accountIdentifier} onChange={setAccountIdentifier} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                <span>当前状态：{governanceStatusLabel(latestRequest)}</span>
                <AdminButton
                    type="button"
                    onClick={() => void save()}
                    disabled={state.loading}
                    className={secondaryButton}
                >
                    提交审核
                </AdminButton>
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
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="admin-section-title-line">
                <h2 className="flex items-center gap-2 text-sm font-bold">
                    平台统一 USDT 收款
                    <FeatureHelpButton
                        topic="settings.platform-usdt"
                        title="平台统一 USDT 收款"
                        description={'收款地址由超级管理员在平台管理中心配置，本店通过支付选项开启或关闭。'}
                    />
                </h2>
                <p className="text-xs text-slate-500">仅显示已批准配置</p>
            </div>

            <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-slate-500">配置状态</dt>
                    <dd className="font-medium">{wallet.configured ? '平台已配置' : '平台尚未配置'}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-slate-500">收款地址</dt>
                    <dd className="font-mono">{wallet.activeReceivingAddressMasked ?? '地址未获取'}</dd>
                </div>
            </dl>
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
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="admin-section-title-line">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    本店支付选项
                    <FeatureHelpButton
                        topic="settings.payment-shipping"
                        title="本店支付选项"
                        description={
                            '支付系统由平台统一配置，本店独立开启或关闭。处理器参数与密钥仅在平台管理。'
                        }
                    />
                </h2>
                <p className="text-xs text-slate-500">平台配置，本店独立启停</p>
            </div>

            <div
                className="admin-comparison-scroll mt-4 overflow-x-auto"
                role="region"
                aria-label="本店支付选项"
                tabIndex={0}
            >
                <p className="admin-mobile-table-hint">左右滑动查看完整支付选项</p>
                <table className="admin-compact-table w-full min-w-[760px] text-left text-xs">
                    <thead>
                        <tr>
                            {['支付方式', '平台状态', '本店状态', '有效状态', '本店开关'].map(label => (
                                <th key={label}>{label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {options.map(option => (
                            <tr key={option.id}>
                                <td className="font-semibold text-slate-800">{option.name}</td>
                                <td className="text-slate-500">
                                    {option.platformEnabled ? '平台启用' : '平台已停用'}
                                </td>
                                <td className="text-slate-500">
                                    {option.enabled ? '本店已开启' : '本店未开启'}
                                </td>
                                <td className="text-slate-500">
                                    {option.effectiveEnabled ? '已启用' : '未启用'}
                                </td>
                                <td>
                                    <AdminInput
                                        type="checkbox"
                                        checked={option.enabled}
                                        disabled={
                                            state.loading || (!option.platformEnabled && !option.enabled)
                                        }
                                        onChange={event => void toggle(option.id, event.target.checked)}
                                        aria-label={`${option.name}启用状态`}
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!options.length && (
                <div className="py-8 text-center text-xs text-slate-400">平台尚未配置支付方式</div>
            )}
        </section>
    );
}
