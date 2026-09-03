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

const SYSTEM_ROLE_LABELS: Readonly<Record<string, string>> = {
    __super_admin_role__: '超级管理员',
    __customer_role__: '普通客户',
    SuperAdmin: '超级管理员',
    'Super Administrator': '超级管理员',
    Customer: '普通客户',
    Administrator: '系统管理员',
    Admin: '系统管理员',
    Operator: '运营专员',
    Support: '客服专员',
    'Customer Support': '客服专员',
    Finance: '财务专员',
};

export function getRoleLabel(role?: { code?: string; description?: string } | string | null): string {
    if (!role) return '未分配角色';
    if (typeof role === 'string') {
        const key = role.trim();
        return SYSTEM_ROLE_LABELS[key] ?? key;
    }
    const code = role.code?.trim() || '';
    const desc = role.description?.trim() || '';
    if (code && SYSTEM_ROLE_LABELS[code]) return SYSTEM_ROLE_LABELS[code];
    if (desc && SYSTEM_ROLE_LABELS[desc]) return SYSTEM_ROLE_LABELS[desc];
    return desc || code || '未命名角色';
}

export function getRoleCodeLabel(code?: string | null): string {
    const normalized = code?.trim();
    if (!normalized) return '';
    if (normalized === '__super_admin_role__') return '系统内置 · __super_admin_role__';
    if (normalized === '__customer_role__') return '系统内置 · __customer_role__';
    return normalized;
}
