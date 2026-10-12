import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { sensitiveActionContext } from '../../apollo';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { SensitiveActionDialog } from '../../components/SensitiveActionDialog';
import type { OrderOperationsData } from '../../graphql/order-operations.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { refreshAfterAdminWrite } from '../../utils/admin-write-readback';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatMoney } from './sales-utils';

const recoveryFields = `sourceOrderId sourceOrderCode draftOrderId draftOrderCode stage quoteHash originalTotal quotedTotal currencyCode changes blockedReason`;
const RECOVERY_QUERY = gql`query NextAdminOfflineOrderRecovery($id: ID!) { offlineOrderRecovery(sourceOrderId: $id) { ${recoveryFields} } }`;
const OFFLINE_METHODS_QUERY = gql`
    query NextAdminOfflinePaymentMethods {
        paymentMethods(options: { take: 100 }) {
            items {
                id
                code
                name
                enabled
                kind
            }
        }
    }
`;
const CONFIRM_OFFLINE = gql`
    mutation NextAdminConfirmOfflinePayment($input: ConfirmOfflinePaymentInput!) {
        confirmOfflinePayment(input: $input) {
            id
            state
            kind
        }
    }
`;
const RETRY_OFFLINE = gql`
    mutation NextAdminRetryOfflinePaymentReview($paymentId: ID!) {
        retryOfflinePaymentReview(paymentId: $paymentId) {
            id
            state
            kind
        }
    }
`;
const PREPARE_REFUND = gql`
    mutation NextAdminPrepareOfflinePaymentRefund($paymentId: ID!) {
        prepareOfflinePaymentRefund(paymentId: $paymentId) {
            id
            state
            kind
        }
    }
`;
const PREPARE_LEGACY = gql`mutation NextAdminPrepareLegacyOfflineOrder($input: PrepareLegacyOfflineOrderInput!) { prepareLegacyOfflineOrder(input: $input) { ${recoveryFields} } }`;
const SUBMIT_LEGACY = gql`mutation NextAdminSubmitLegacyOfflineOrder($input: SubmitLegacyOfflineOrderInput!) { submitLegacyOfflineOrder(input: $input) { ${recoveryFields} } }`;
export interface OfflineRecovery {
    sourceOrderId: string;
    sourceOrderCode: string;
    draftOrderId: string | null;
    draftOrderCode: string | null;
    stage: string;
    quoteHash: string | null;
    originalTotal: number;
    quotedTotal: number | null;
    currencyCode: string;
    changes: string[];
    blockedReason: string | null;
}
type Action = 'confirm' | 'retry' | 'prepare' | 'submit' | 'refund-only';
type OrderRecord = NonNullable<OrderOperationsData['order']>;
const buttonClass = 'rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50';
const fieldClass = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs';

export function OfflineOrderPaymentPanel({
    order,
    onChanged,
}: {
    order: OrderRecord;
    onChanged: () => Promise<unknown>;
}) {
    const { hasAnyPermission } = useAdminPermissions();
    const payment = order.payments.find(
        item => item.kind === 'OFFLINE_MANUAL' && ['PendingManual', 'Error'].includes(item.state),
    );
    const legacy = Boolean(order.processingSummary?.isTestOrder);
    const canFinance =
        Boolean(order.processingSummary?.canManage) &&
        hasAnyPermission(['UpdateOrder']) &&
        hasAnyPermission(['SensitiveStoreFinance']);
    const canRecover = canFinance && hasAnyPermission(['CreateOrder']);
    const canReadMethods = hasAnyPermission(['ReadPaymentMethod', 'ReadSettings']);
    const recovery = useAdminQuery<{ offlineOrderRecovery: OfflineRecovery }>(RECOVERY_QUERY, {
        variables: { id: order.id },
        skip: !legacy,
    });
    const methods = useAdminQuery<{
        paymentMethods: { items: Array<{ code: string; name: string; enabled: boolean; kind: string }> };
    }>(OFFLINE_METHODS_QUERY, { skip: !legacy || !canRecover || !canReadMethods });
    const [confirm, confirmState] = useMutation<{ confirmOfflinePayment: { state: string } }>(
        CONFIRM_OFFLINE,
    );
    const [retry, retryState] = useMutation<{ retryOfflinePaymentReview: { state: string } }>(RETRY_OFFLINE);
    const [prepareRefund, prepareRefundState] = useMutation<{
        prepareOfflinePaymentRefund: { state: string };
    }>(PREPARE_REFUND);
    const [prepare, prepareState] = useMutation<{ prepareLegacyOfflineOrder: OfflineRecovery }>(
        PREPARE_LEGACY,
    );
    const [submit, submitState] = useMutation<{ submitLegacyOfflineOrder: OfflineRecovery }>(SUBMIT_LEGACY);
    const [action, setAction] = useState<Action | null>(null);
    const [transactionId, setTransactionId] = useState('');
    const [evidenceReference, setEvidenceReference] = useState('');
    const [receivedAt, setReceivedAt] = useState('');
    const [note, setNote] = useState('');
    const [method, setMethod] = useState('');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [accepted, setAccepted] = useState(false);
    const keys = useRef(new Map<string, string>());
    const busy =
        confirmState.loading ||
        retryState.loading ||
        prepareRefundState.loading ||
        prepareState.loading ||
        submitState.loading;
    const record = recovery.data?.offlineOrderRecovery;
    const options =
        methods.data?.paymentMethods.items.filter(item => item.enabled && item.kind === 'OFFLINE_MANUAL') ??
        [];
    const selectedMethod = options.find(item => item.code === method)?.code ?? options[0]?.code ?? '';
    if (!legacy && !payment) return null;
    const open = (next: Action) => {
        setError('');
        if (
            next === 'confirm' &&
            (!transactionId.trim() ||
                !evidenceReference.trim() ||
                !receivedAt ||
                !Number.isFinite(Date.parse(receivedAt)) ||
                Date.parse(receivedAt) > Date.now())
        ) {
            setError('请填写实际交易号、到账凭证及不晚于当前时间的实际到账时间');
            return;
        }
        setAction(next);
    };
    const execute = async (password: string) => {
        if (!action || busy || !canFinance) return;
        setError('');
        const identity = `${order.id}:${payment?.id ?? 'legacy'}:${action}`;
        const key = keys.current.get(identity) ?? crypto.randomUUID();
        keys.current.set(identity, key);
        try {
            const context = sensitiveActionContext(password);
            if (action === 'confirm' && payment) {
                const result = await confirm({
                    variables: {
                        input: {
                            paymentId: payment.id,
                            expectedAmount: payment.amount,
                            transactionId: transactionId.trim(),
                            evidenceReference: evidenceReference.trim(),
                            receivedAt: new Date(receivedAt).toISOString(),
                            idempotencyKey: key,
                            note: note.trim(),
                        },
                    },
                    context,
                });
                if (!result.data) throw new Error('未取得核款结果，请刷新原付款记录核对，勿新增付款');
                setNotice(
                    result.data.confirmOfflinePayment.state === 'Error'
                        ? '实际到账证据已保留，业务校验未通过，请处理后重核原付款'
                        : '原付款已核款，订单进入正常履约流程',
                );
                setAccepted(true);
            } else if (action === 'retry' && payment) {
                const result = await retry({ variables: { paymentId: payment.id }, context });
                if (!result.data) throw new Error('未取得重核结果，请刷新原付款记录');
                setNotice(
                    result.data.retryOfflinePaymentReview.state === 'Error'
                        ? '原收款证据保留，仍需业务复核'
                        : '原收款已通过业务复核',
                );
            } else if (action === 'refund-only' && payment) {
                const result = await prepareRefund({ variables: { paymentId: payment.id }, context });
                if (!result.data || result.data.prepareOfflinePaymentRefund.state !== 'Settled')
                    throw new Error('尚未取得退款专用核款结果，请核对原付款');
                setNotice(
                    '原真实收款已转入退款专用处理。请在订单退款区域申请退款，再登记实际退款凭证；此订单不进入履约。',
                );
            } else if (action === 'prepare') {
                const result = await prepare({
                    variables: { input: { sourceOrderId: order.id, idempotencyKey: key } },
                    context,
                });
                if (!result.data) throw new Error('未取得关联草稿，请重试读取恢复记录');
                setNotice('关联草稿已准备，请核对当前报价差异并与客户确认');
            } else if (action === 'submit' && record?.quoteHash && selectedMethod) {
                const result = await submit({
                    variables: {
                        input: {
                            sourceOrderId: order.id,
                            quoteHash: record.quoteHash,
                            method: selectedMethod,
                            idempotencyKey: key,
                        },
                    },
                    context,
                });
                if (!result.data) throw new Error('未取得提交结果，请重试读取关联订单');
                setNotice(
                    result.data.submitLegacyOfflineOrder.stage === 'SUBMITTED'
                        ? '已建立关联正式待核款单；原模拟订单和付款记录完整保留'
                        : '当前报价已变化，请重新核对后确认提交',
                );
            } else throw new Error('正式支付方式或报价缺失，请刷新核对');
            setAction(null);
            await refreshAfterAdminWrite(async () => {
                await onChanged();
                if (legacy) await recovery.refetch();
            }, setError);
        } catch (cause) {
            setError(toUserFacingError(cause, '操作结果未确认，请核对原记录后再处理'));
        }
    };
    return (
        <section
            className="space-y-3 rounded-xl bg-slate-50 p-4"
            aria-label={legacy ? '历史模拟单恢复' : '客服核款'}
        >
            <h3 className="text-sm font-bold">
                {legacy
                    ? '历史模拟单逐笔恢复'
                    : payment?.state === 'Error'
                      ? '已核款，待业务复核'
                      : '待客服确认实际收款'}
            </h3>
            {notice && (
                <p role="status" className="text-xs text-emerald-700">
                    {notice}
                </p>
            )}
            {error && !action && (
                <p role="alert" className="text-xs text-rose-700">
                    {error}
                </p>
            )}
            {payment && payment.state === 'PendingManual' && !accepted && (
                <>
                    <p className="text-xs text-slate-600">
                        核实应收 {formatMoney(payment.amount, order.currencyCode)}
                        。确认会结算此笔原付款；未实际到账时请勿确认。
                    </p>
                    {canFinance ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <AdminField label="实际交易号">
                                <AdminInput
                                    className={fieldClass}
                                    maxLength={180}
                                    value={transactionId}
                                    onChange={e => setTransactionId(e.target.value)}
                                    disabled={busy}
                                />
                            </AdminField>
                            <AdminField label="实际到账时间">
                                <AdminInput
                                    type="datetime-local"
                                    className={fieldClass}
                                    value={receivedAt}
                                    onChange={e => setReceivedAt(e.target.value)}
                                    disabled={busy}
                                />
                            </AdminField>
                            <AdminField label="到账凭证引用" description="填写银行回执编号或已留存凭证的位置">
                                <AdminInput
                                    className={fieldClass}
                                    maxLength={1000}
                                    value={evidenceReference}
                                    onChange={e => setEvidenceReference(e.target.value)}
                                    disabled={busy}
                                />
                            </AdminField>
                            <AdminField label="核款说明" layout="stacked">
                                <AdminTextArea
                                    className={fieldClass}
                                    maxLength={1000}
                                    value={note}
                                    onChange={e => setNote(e.target.value)}
                                    disabled={busy}
                                />
                            </AdminField>
                        </div>
                    ) : (
                        <p className="text-xs text-slate-600">当前岗位没有敏感店铺财务核款权限。</p>
                    )}
                    {canFinance && (
                        <AdminButton
                            className={buttonClass}
                            type="button"
                            disabled={busy}
                            onClick={() => open('confirm')}
                        >
                            核实到账并确认原付款
                        </AdminButton>
                    )}
                </>
            )}
            {payment?.state === 'Error' && canFinance && (
                <div className="flex flex-wrap gap-2">
                    <AdminButton
                        className={buttonClass}
                        type="button"
                        disabled={busy}
                        onClick={() => open('retry')}
                    >
                        按原收款证据重新核验
                    </AdminButton>
                    <AdminButton type="button" disabled={busy} onClick={() => open('refund-only')}>
                        此款仅转入退款处理
                    </AdminButton>
                </div>
            )}
            {legacy && (
                <>
                    <p className="text-xs text-slate-600">
                        保留原模拟证据。关联草稿按当前价格、库存、税费、配送和优惠重新报价；提交后仍需核实真实到账。
                    </p>
                    {recovery.loading && !record && (
                        <p role="status" className="text-xs">
                            正在读取恢复记录…
                        </p>
                    )}
                    {recovery.error && (
                        <div role="alert" className="text-xs text-rose-700">
                            恢复记录读取失败{' '}
                            <AdminButton type="button" onClick={() => void recovery.refetch()}>
                                重试读取
                            </AdminButton>
                        </div>
                    )}
                    {record?.blockedReason && (
                        <p className="text-xs text-amber-800">{record.blockedReason}</p>
                    )}
                    {record?.draftOrderId && (
                        <>
                            <p className="text-xs">
                                原金额 {formatMoney(record.originalTotal, record.currencyCode)} → 当前报价{' '}
                                {formatMoney(record.quotedTotal ?? 0, record.currencyCode)}
                            </p>
                            <Link
                                className="text-xs font-bold text-blue-600 underline"
                                to={`/sales/orders/${record.draftOrderId}`}
                            >
                                查看关联订单 {record.draftOrderCode}
                            </Link>
                            {record.changes.length > 0 && (
                                <ul className="list-disc pl-4 text-xs text-amber-800">
                                    {record.changes.map(change => (
                                        <li key={change}>{change}</li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                    {canRecover && record && !record.blockedReason && record.stage === 'NOT_PREPARED' && (
                        <AdminButton
                            type="button"
                            className={buttonClass}
                            disabled={busy}
                            onClick={() => open('prepare')}
                        >
                            准备关联正式草稿
                        </AdminButton>
                    )}
                    {canRecover && record?.stage === 'DRAFT' && !record.blockedReason && (
                        <>
                            {!canReadMethods ? (
                                <p className="text-xs">需支付方式读取权限才能选择正式核款方式。</p>
                            ) : (
                                <>
                                    {methods.error && (
                                        <p role="alert" className="text-xs">
                                            支付方式读取失败{' '}
                                            <AdminButton type="button" onClick={() => void methods.refetch()}>
                                                重试
                                            </AdminButton>
                                        </p>
                                    )}
                                    <AdminField label="正式核款方式">
                                        <AdminSelect
                                            className={fieldClass}
                                            value={selectedMethod}
                                            disabled={busy || !options.length}
                                            onChange={e => setMethod(e.target.value)}
                                        >
                                            {!options.length && (
                                                <option value="">请先启用本店客服核款方式</option>
                                            )}
                                            {options.map(option => (
                                                <option key={option.code} value={option.code}>
                                                    {option.name}
                                                </option>
                                            ))}
                                        </AdminSelect>
                                    </AdminField>
                                    <AdminButton
                                        type="button"
                                        className={buttonClass}
                                        disabled={busy || !selectedMethod || !record.quoteHash}
                                        onClick={() => open('submit')}
                                    >
                                        已与客户确认报价，提交待核款单
                                    </AdminButton>
                                </>
                            )}
                        </>
                    )}
                    {record?.stage === 'SUBMITTED' && (
                        <p role="status" className="text-xs text-emerald-700">
                            已建立正式待核款关联单，后续请在关联订单登记真实收款。
                        </p>
                    )}
                </>
            )}
            <SensitiveActionDialog
                open={Boolean(action)}
                title={
                    action === 'refund-only'
                        ? '按原核验收款转入退款'
                        : action === 'confirm'
                          ? '确认实际到账'
                          : action === 'retry'
                            ? '重核原付款'
                            : action === 'prepare'
                              ? '准备历史订单关联草稿'
                              : '提交关联正式订单'
                }
                description={
                    action === 'refund-only'
                        ? '仅认定已核实的原收款可退；保留业务复核限制，不发货、不交付、不发返利。还需申请退款并核验实际退款凭证。'
                        : action === 'confirm'
                          ? `仅在实际收到 ${formatMoney(payment?.amount ?? 0, order.currencyCode)} 后确认。`
                          : '原始付款与订单证据保留，操作需验证当前管理员密码。'
                }
                confirmLabel="验证并确认"
                loading={busy}
                error={error}
                onClose={() => {
                    if (!busy) setAction(null);
                }}
                onConfirm={execute}
            />
        </section>
    );
}
