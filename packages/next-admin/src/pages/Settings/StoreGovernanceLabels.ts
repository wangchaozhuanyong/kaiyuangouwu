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

export function storeSettingsSubtitle(key?: string) {
    const descriptions: Record<string, string> = {
        payment: '平台支付方式与本店开关',
        payout: '提交账户资料，跟进平台审核',
        currency: '币种、换算规则与报价采集',
        usdt: '平台统一收款地址与本店配置',
        'usdt-payments': '按支付方式查看本店收款明细',
        'usdt-refunds': '本店已登记的人工退款证据',
        'usdt-intents': '报价、到账与链上对账状态',
        commerce: '统一设置实体与数字商品交易模式',
        domains: '绑定、验证并管理店铺域名',
        sellers: '维护经营主体资料',
        shipping: '配送规则、运费与预计送达',
        'business-language': '平台可用语言与店铺默认语言',
        'business-taxes': '税类、业务区域与税率规则',
        'business-regions': '国家目录与店铺业务区域',
    };
    return descriptions[key ?? ''] ?? '当前店铺资料与经营配置';
}
