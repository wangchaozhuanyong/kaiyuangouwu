import { getSystemLabel } from '../../common/src/display-localization';

export function providerPurposeZh(purpose: 'BOTH' | 'PROMPT' | 'IMAGE'): string {
    return (
        {
            BOTH: '提示词和生图',
            PROMPT: '仅提示词',
            IMAGE: '仅生图',
        } as const
    )[purpose];
}

export function skillUseCaseZh(useCase: string): string {
    return getSystemLabel(
        useCase,
        {
            'product-photo': '商品摄影',
            'ecommerce-poster': '电商海报',
            portrait: '成人商业人像',
            'interior-design': '室内设计',
            illustration: '插画',
            'reference-edit': '参考图编辑',
        },
        'zh',
        'status',
    );
}

export function routingStrategyZh(strategy: string): string {
    return getSystemLabel(
        strategy,
        {
            BALANCED: '质量、速度与成本均衡',
            QUALITY: '质量优先',
            SPEED: '速度优先',
            COST: '成本优先',
            UNKNOWN: '未记录',
        },
        'zh',
        'status',
    );
}

export function statusZh(status: string): string {
    return getSystemLabel(
        status,
        {
            HEALTHY: '正常',
            UNHEALTHY: '异常',
            UNTESTED: '未测试',
            UNCONFIGURED: '未配置',
            COOLDOWN: '冷却中',
            ACTIVE: '当前使用',
            INACTIVE: '未启用',
            PENDING: '待处理',
            UNKNOWN: '结果待确认',
            QUEUED: '排队中',
            RUNNING: '生成中',
            PARTIAL_SUCCESS: '部分成功',
            SUCCEEDED: '成功',
            FAILED: '失败',
            CANCELLED: '已取消',
        },
        'zh',
        'status',
    );
}

export function billingModeZh(mode: string): string {
    return getSystemLabel(
        mode,
        {
            FREE: '免费',
            PAID: '付费',
            MIXED: '免费+付费',
            PENDING: '待结算',
            RELEASED: '已释放',
            REFUNDED: '已退款',
        },
        'zh',
        'status',
    );
}

export function skillReleaseName(release: { createdAt: string; sourceHash: string }): string {
    const date = release.createdAt.slice(0, 10) || '日期未知';
    return `${date} · ${release.sourceHash.slice(0, 8)}`;
}
