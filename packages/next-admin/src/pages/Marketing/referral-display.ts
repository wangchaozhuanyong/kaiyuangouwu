import type { WithdrawalAction } from './referrals-types';

export function withdrawalActionLabel(status: WithdrawalAction['status']) {
    return (
        { APPROVED: '批准申请', PAID: '登记已打款', REJECTED: '驳回申请', CANCELLED: '取消申请' } as Record<
            string,
            string
        >
    )[status];
}
export function withdrawalSuccess(status: WithdrawalAction['status']) {
    return (
        {
            APPROVED: '提款申请已批准，等待线下打款',
            PAID: '外部打款已登记，冻结余额已扣除',
            REJECTED: '提款申请已驳回，冻结金额已退回可用余额',
            CANCELLED: '提款申请已取消，冻结金额已退回可用余额',
        } as Record<string, string>
    )[status];
}
