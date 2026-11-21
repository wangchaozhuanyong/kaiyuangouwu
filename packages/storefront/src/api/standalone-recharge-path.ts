/**
 * The independent site issues optional scoped links for partners. Always retain
 * the visited scope; Nginx maps the path to a previously verified channel.
 */
export function standaloneRechargeApiPath(operation: string, pathname = window.location.pathname): string {
    const portal = /^\/p\/[a-z0-9][a-z0-9-]{0,47}(?=\/?$)/u.exec(pathname)?.[0] ?? '';
    return `${portal}/api/recharge/${operation}`;
}
