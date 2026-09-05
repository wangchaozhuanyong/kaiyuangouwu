import type { AutoCardConfigRecord } from '../../graphql/fulfillment.graphql';

export type AutoCardFormatPreset = 'account_password' | 'single_code' | 'custom';

export function inferAutoCardFormatPreset(
    fields: ReadonlyArray<Pick<AutoCardConfigRecord['fields'][number], 'key'>>,
): AutoCardFormatPreset {
    const keys = fields.map(field => field.key).join(',');
    if (keys === 'account,password') return 'account_password';
    if (keys === 'code') return 'single_code';
    return 'custom';
}

export function autoCardReadiness(config: AutoCardConfigRecord | null) {
    if (!config) {
        return {
            tone: 'amber' as const,
            label: '待配置',
            detail: '选择卡密格式并导入库存',
        };
    }
    if (!config.enabled) {
        return {
            tone: 'slate' as const,
            label: '已停用',
            detail: '开启自动发卡后才会处理新订单',
        };
    }
    if (config.waitingDeliveryCount > 0) {
        return {
            tone: 'rose' as const,
            label: '需要处理',
            detail: `有 ${config.waitingDeliveryCount} 笔订单正在等待卡密库存`,
        };
    }
    if (config.availableCount === 0) {
        return {
            tone: 'amber' as const,
            label: '缺少库存',
            detail: '还差一步：请导入至少一条卡密',
        };
    }
    if (config.availableCount <= config.lowStockThreshold) {
        return {
            tone: 'amber' as const,
            label: '可以销售',
            detail: `当前 ${config.availableCount} 条可用，库存偏低`,
        };
    }
    return {
        tone: 'green' as const,
        label: '可以销售',
        detail: `自动发卡已就绪，当前 ${config.availableCount} 条可用`,
    };
}
