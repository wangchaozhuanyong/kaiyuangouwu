const COMMON_STATUS_LABELS: Readonly<Record<string, string>> = {
    ALL: '全部状态',
    ACTIVE: '已启用',
    INACTIVE: '未启用',
    ENABLED: '已启用',
    DISABLED: '已停用',
    DRAFT: '草稿',
    PENDING: '待处理',
    QUEUED: '排队中',
    RUNNING: '处理中',
    STARTED: '处理中',
    RETRYING: '重试中',
    COMPLETED: '已完成',
    SUCCEEDED: '已成功',
    PARTIAL_SUCCESS: '部分成功',
    FAILED: '失败',
    ERROR: '错误',
    CANCELLED: '已取消',
    UNKNOWN: '结果待确认',
    CREATED: '已创建',
    APPROVED: '已批准',
    REJECTED: '已驳回',
    PAID: '已支付',
    AVAILABLE: '可用',
    SENT: '已发送',
    REFUNDED: '已退款',
    SUPERSEDED: '已停用',
    HEALTHY: '正常',
    UNHEALTHY: '异常',
    UNTESTED: '待测试',
    UNCONFIGURED: '未配置',
    Created: '已创建',
    Pending: '待处理',
    Authorized: '已授权',
    Settled: '已结算',
    Declined: '已拒绝',
    Error: '错误',
    Cancelled: '已取消',
    Shipped: '已发货',
    Delivered: '已交付',
    Failed: '失败',
};

const TRANSLATION_STATUS_LABELS: Readonly<Record<string, string>> = {
    MISSING: '缺少英文翻译',
    PENDING: '等待翻译',
    TRANSLATING: '翻译中',
    AUTO_TRANSLATED: '已自动翻译',
    REVIEWED: '已人工复核',
    MANUAL_LOCKED: '人工翻译已锁定',
    STALE: '英文待复核',
    FAILED: '翻译失败',
    SYNCED: '已同步',
    TRANSLATED: '已翻译',
    CURRENT: '已是最新',
    REVIEW_REQUIRED: '待人工复核',
    LOCKED: '人工锁定',
};

export function getStatusLabel(status?: string | null): string {
    const normalized = status?.trim();
    if (!normalized) return '未知状态';
    return COMMON_STATUS_LABELS[normalized] ?? '未知状态';
}

export function getTranslationStatusLabel(status?: string | null): string {
    const normalized = status?.trim();
    if (!normalized) return '未知状态';
    return TRANSLATION_STATUS_LABELS[normalized] ?? getStatusLabel(normalized);
}
