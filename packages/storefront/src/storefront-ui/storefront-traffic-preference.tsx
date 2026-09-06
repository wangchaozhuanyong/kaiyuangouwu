import { useEffect, useState } from 'react';

import {
    setStorefrontTrafficOptOut,
    storefrontTrafficOptedOut,
    TRAFFIC_PREFERENCE_EVENT,
} from '../storefront-traffic';
import { StorefrontLanguage } from '../types';

export function StorefrontTrafficPreference({ language }: { language: StorefrontLanguage }) {
    const isZh = language === 'zh';
    const [excluded, setExcluded] = useState(storefrontTrafficOptedOut);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const refresh = () => setExcluded(storefrontTrafficOptedOut());
        window.addEventListener('storage', refresh);
        window.addEventListener('focus', refresh);
        window.addEventListener(TRAFFIC_PREFERENCE_EVENT, refresh);
        return () => {
            window.removeEventListener('storage', refresh);
            window.removeEventListener('focus', refresh);
            window.removeEventListener(TRAFFIC_PREFERENCE_EVENT, refresh);
        };
    }, []);
    const toggle = () => {
        try {
            setStorefrontTrafficOptOut(!excluded);
            setExcluded(storefrontTrafficOptedOut());
            setFailed(false);
        } catch {
            setFailed(true);
        }
    };
    return (
        <section className="mx-3 my-4 rounded-xl border border-[var(--line)] bg-white p-4 text-sm">
            <h2 className="mb-2 font-semibold">{isZh ? '访问统计' : 'Website analytics'}</h2>
            <button
                type="button"
                aria-pressed={excluded}
                onClick={toggle}
                className="text-[var(--accent)] underline"
            >
                {excluded
                    ? isZh
                        ? '已排除本浏览器访问 · 恢复统计'
                        : 'Visits excluded · Resume analytics'
                    : isZh
                      ? '不统计本浏览器访问'
                      : 'Exclude this browser from analytics'}
            </button>
            <p className="mt-2 text-xs text-[var(--muted)]">
                {isZh
                    ? '仅对当前浏览器、当前店铺网站域名生效，不修改历史访问记录。'
                    : 'Applies to this browser on this shop domain only. Past visits stay unchanged.'}
            </p>
            {failed && (
                <p role="alert">
                    {isZh
                        ? '无法保存设置，请检查浏览器存储权限。'
                        : 'Unable to save. Check browser storage permissions.'}
                </p>
            )}
        </section>
    );
}
