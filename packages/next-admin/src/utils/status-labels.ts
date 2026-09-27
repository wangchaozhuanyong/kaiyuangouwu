import { getSystemLabel } from '../../../common/src/display-localization';
import { systemStatusDisplayLabel } from '../../../common/src/system-display-labels';

const TRANSLATION_STATUS_LABELS: Readonly<Record<string, string>> = {
    MISSING: '缺少英文翻译',
    PENDING: '等待翻译',
    TRANSLATING: '翻译中',
    NOTIFY_PENDING: '英文已保存，等待同步',
    CANCELLED: '翻译任务已取消',
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
    return systemStatusDisplayLabel(status);
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
        return getSystemLabel(key, SYSTEM_ROLE_LABELS, 'zh', 'role');
    }
    const code = role.code?.trim() || '';
    const desc = role.description?.trim() || '';
    if (code && SYSTEM_ROLE_LABELS[code]) return SYSTEM_ROLE_LABELS[code];
    if (desc && SYSTEM_ROLE_LABELS[desc]) return SYSTEM_ROLE_LABELS[desc];
    const storeAdministrator = desc.match(/^Administrator of\s+(.+)$/i)?.[1]?.trim();
    if (storeAdministrator) return `${storeAdministrator}管理员`;
    return desc || getSystemLabel(code, SYSTEM_ROLE_LABELS, 'zh', 'role');
}

export function getRoleCodeLabel(code?: string | null): string {
    const normalized = code?.trim();
    if (!normalized) return '';
    if (normalized === '__super_admin_role__') return '系统内置角色';
    if (normalized === '__customer_role__') return '系统内置角色';
    return normalized;
}
