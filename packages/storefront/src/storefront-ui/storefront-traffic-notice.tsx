import type { StorefrontLanguage } from '../types';

import { routeHref } from '../storefront-router';

export function StorefrontTrafficNotice({
    language,
    busy = false,
    onChoose,
}: {
    language: StorefrontLanguage;
    busy?: boolean;
    onChoose?: (granted: boolean) => void;
}) {
    const isZh = language === 'zh';
    return (
        <aside className="traffic-consent-banner" aria-label={isZh ? '访问统计选择' : 'Analytics choice'}>
            <div>
                <strong>
                    {isZh ? '由你决定是否允许访问统计' : 'You choose whether analytics is allowed'}
                </strong>
                <p>
                    {isZh
                        ? '拒绝不会影响购物、登录或售后。允许后仅记录本站的页面访问与去标识化统计。'
                        : 'Declining does not affect shopping, sign-in or support. Allowing records ' +
                          'first-party page views and pseudonymous metrics.'}{' '}
                    <a href={routeHref({ name: 'legal', id: 'privacy', publicLanguage: language })}>
                        {isZh ? '查看隐私政策' : 'View privacy policy'}
                    </a>
                </p>
            </div>
            <div className="traffic-consent-actions">
                <button type="button" disabled={busy} onClick={() => onChoose?.(false)}>
                    {isZh ? '仅必要功能' : 'Necessary only'}
                </button>
                <button type="button" className="is-primary" disabled={busy} onClick={() => onChoose?.(true)}>
                    {isZh ? '允许访问统计' : 'Allow analytics'}
                </button>
            </div>
        </aside>
    );
}
