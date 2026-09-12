/** Shared business checks for both admin forms and all server write entry points. */
export function validateIcloudInput(input: Record<string, unknown>): string | undefined {
    for (const field of ['email', 'aliasEmail']) {
        if (!(field in input)) continue;
        const value = input[field];
        if (typeof value !== 'string') return '邮箱地址不能为空';
        const email = value.trim();
        const parts = email.split('@');
        if (
            email.length > 255 ||
            parts.length !== 2 ||
            !parts[0] ||
            parts[0].length > 64 ||
            !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(parts[0]) ||
            parts[0].startsWith('.') ||
            parts[0].endsWith('.') ||
            parts[0].includes('..') ||
            !parts[1].includes('.') ||
            parts[1].split('.').some(label => !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))
        )
            return '邮箱地址格式无效，请填写完整邮箱地址（最多 255 个字符）';
    }
    if (
        'status' in input &&
        !['ACTIVE', 'DISABLED', 'AUTH_ERROR', 'SYNCING'].includes(String(input.status))
    ) {
        return '邮箱状态无效';
    }
    if ('codeResetIntervalDays' in input) {
        const days = input.codeResetIntervalDays;
        if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > 36500) {
            return '查询码重置周期必须为 0 至 36500 的整数，0 表示不自动重置';
        }
    }
    for (const field of ['buyerQueryCode', 'masterQueryCode']) {
        if (!(field in input)) continue;
        const value = input[field];
        if (typeof value !== 'string' || !value.trim() || value.trim().length > 64) {
            return '查询码不能为空且不能超过 64 个字符';
        }
    }
    if (
        'note' in input &&
        input.note !== null &&
        input.note !== undefined &&
        (typeof input.note !== 'string' || new TextEncoder().encode(input.note).length > 65535)
    ) {
        return '备注内容过长，最多允许 65535 字节';
    }
    if (
        'appPassword' in input &&
        (typeof input.appPassword !== 'string' ||
            !input.appPassword.trim() ||
            input.appPassword.length > 1024)
    ) {
        return 'App 专用密码不能为空且不能超过 1024 个字符';
    }
    if (
        'imapHost' in input &&
        (typeof input.imapHost !== 'string' ||
            !input.imapHost.trim() ||
            input.imapHost.length > 255 ||
            /\s/.test(input.imapHost.trim()))
    ) {
        return 'IMAP 服务器地址无效';
    }
    if (
        'imapPort' in input &&
        (typeof input.imapPort !== 'number' ||
            !Number.isInteger(input.imapPort) ||
            input.imapPort < 1 ||
            input.imapPort > 65535)
    ) {
        return 'IMAP 端口必须为 1 至 65535 的整数';
    }
    return undefined;
}
