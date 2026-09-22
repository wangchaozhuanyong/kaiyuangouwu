export function governanceRequestTypeLabel(requestType: string): string {
    const labels: Record<string, string> = {
        LEGAL_IDENTITY: '法律主体资料',
        PAYOUT_ACCOUNT: '收款账户',
        PAYMENT_CONFIGURATION: '支付配置',
        USDT_WALLET: 'USDT 收款钱包',
    };
    return labels[requestType] ?? '店铺治理申请';
}

export function governancePayloadRows(payload: Record<string, unknown>): Array<[string, string]> {
    const labels: Record<string, string> = {
        legalEntityName: '主体名称',
        legalRegistrationCountry: '注册国家或地区',
        provider: '收款机构',
        accountHolder: '账户持有人',
        accountIdentifier: '收款账号',
    };
    return Object.entries(payload).map(([key, value]) => [
        labels[key] ?? '申请内容',
        typeof value === 'string' ? value : String(value ?? '—'),
    ]);
}
import type { MyStoreSettingsResult } from '../../graphql/management.graphql';

export function governanceStatusLabel(
    request: MyStoreSettingsResult['myStoreGovernanceChanges'][number] | undefined,
): string {
    if (!request) return '尚未提交';
    if (request.status === 'PENDING') return '待平台审核';
    if (request.status === 'APPROVED') return '已批准';
    if (request.status === 'REJECTED') return `已驳回：${request.reviewReason ?? '未填写原因'}`;
    return '已取消';
}
