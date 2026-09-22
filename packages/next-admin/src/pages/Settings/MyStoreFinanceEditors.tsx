import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { sensitiveActionContext } from '../../apollo';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    SET_MY_STORE_PAYMENT_OPTION_ENABLED_MUTATION,
    SUBMIT_MY_STORE_USDT_WALLET_MUTATION,
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
    onCompleted,
    onError,
}: {
    wallet: MyStoreSettingsResult['myStoreUsdtWallet'];
    onCompleted: (message: string) => Promise<void>;
    onError: (message: string) => void;
}) {
    const requestConfirmation = useConfirmDialog();
    const [address, setAddress] = useState(wallet.pendingReceivingAddress ?? '');
    const [submitWallet, state] = useMutation(SUBMIT_MY_STORE_USDT_WALLET_MUTATION);
    const submit = async () => {
        if (!address.trim()) return onError('请输入 TRON 主网收款地址');
        const confirmation = await requestConfirmation({
            title: '提交本店 USDT 收款地址？',
            description: '地址将加密保存并等待平台审核，通过前不会影响当前线上收款地址。',
            confirmLabel: '验证并提交',
            tone: 'warning',
            requireCurrentPassword: true,
        });
        if (!confirmation) return;
        try {
            await submitWallet({
                variables: { receivingAddress: address.trim() },
                context: sensitiveActionContext(confirmation.currentPassword ?? ''),
            });
            await onCompleted('USDT 收款地址已提交平台审核');
        } catch (error) {
            onError(toUserFacingError(error, '提交 USDT 收款地址失败'));
        }
    };
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                USDT 收款钱包
                <FeatureHelpButton topic="settings.usdt" title="USDT 收款钱包" />
            </h2>
            <p className="mt-1 text-xs text-slate-500">
                只提交公开收款地址，禁止填写私钥或助记词；平台审核通过后仅影响新订单。
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <FieldInput label={`${wallet.network} 收款地址`} value={address} onChange={setAddress} />
                <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={state.loading}
                    className={secondaryButton}
                >
                    提交审核
                </button>
            </div>
            <div className="mt-3 text-xs text-slate-500">
                状态：
                {wallet.reviewStatus === 'PENDING'
                    ? '待平台审核'
                    : wallet.reviewStatus === 'ACTIVE'
                      ? '已审核启用'
                      : wallet.reviewStatus === 'REJECTED'
                        ? `已驳回：${wallet.rejectionReason ?? '未填写原因'}`
                        : '未配置'}
                {wallet.activeReceivingAddressMasked
                    ? ` · 当前地址 ${wallet.activeReceivingAddressMasked}`
                    : ''}
            </div>
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
                只能启停平台已经分配给本店的支付方式；处理器参数与密钥不会返回。
            </p>
            <div className="mt-4 divide-y divide-slate-100">
                {options.map(option => (
                    <label key={option.id} className="flex items-center justify-between gap-4 py-3 text-xs">
                        <span>
                            <strong className="block text-slate-800">{option.name}</strong>
                            <span className="mt-1 block text-slate-400">平台批准的支付方式</span>
                        </span>
                        <input
                            type="checkbox"
                            checked={option.enabled}
                            disabled={state.loading}
                            onChange={event => void toggle(option.id, event.target.checked)}
                            aria-label={`${option.name}启用状态`}
                        />
                    </label>
                ))}
                {!options.length && (
                    <div className="py-8 text-center text-xs text-slate-400">平台尚未给本店分配支付方式</div>
                )}
            </div>
        </section>
    );
}
