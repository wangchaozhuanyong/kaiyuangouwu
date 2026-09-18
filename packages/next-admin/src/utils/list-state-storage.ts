const STORAGE_PREFIX = 'next_admin_list_query:';

function getSessionStorage(): Storage | null {
    try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
            return window.sessionStorage;
        }
    } catch {
        // Fallback for sandboxed iframes or private browsing restrictions
    }
    return null;
}

/**
 * 规范化查询字符串，确保非空时以 '?' 开头，空时返回空字符串
 */
export function normalizeSearchString(search: string | null | undefined): string {
    if (!search) return '';
    const trimmed = search.trim();
    if (!trimmed || trimmed === '?') return '';
    return trimmed.startsWith('?') ? trimmed : `?${trimmed}`;
}

/**
 * 保存指定路由路径的查询参数到会话存储
 */
export function saveListSearch(pathname: string, search: string): void {
    const storage = getSessionStorage();
    if (!storage || !pathname) return;

    const normalized = normalizeSearchString(search);
    const key = `${STORAGE_PREFIX}${pathname}`;
    if (!normalized) {
        storage.removeItem(key);
    } else {
        storage.setItem(key, normalized);
    }
}

/**
 * 获取指定路由路径在会话存储中记忆的查询参数
 */
export function getSavedListSearch(pathname: string): string | null {
    const storage = getSessionStorage();
    if (!storage || !pathname) return null;

    const value = storage.getItem(`${STORAGE_PREFIX}${pathname}`);
    const normalized = normalizeSearchString(value);
    return normalized || null;
}

/**
 * 清除指定路由路径在会话存储中的记忆
 */
export function clearListSearch(pathname: string): void {
    const storage = getSessionStorage();
    if (!storage || !pathname) return;
    storage.removeItem(`${STORAGE_PREFIX}${pathname}`);
}

/**
 * 清除所有列表的查询参数记忆（通常在退出登录或切换店铺时调用）
 */
export function clearAllListSearch(): void {
    const storage = getSessionStorage();
    if (!storage) return;

    try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key?.startsWith(STORAGE_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(k => storage.removeItem(k));
    } catch {
        // Ignore storage errors
    }
}
