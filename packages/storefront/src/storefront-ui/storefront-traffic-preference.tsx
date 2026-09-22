// organize-imports-ignore
import type { ShopApi } from '../api';
import type { StorefrontTrafficConsent } from '../storefront-traffic';
import type { StorefrontLanguage } from '../types';
import { useEffect, useState } from 'react';

import {
    setStorefrontTrafficConsent,
    storefrontTrafficConsent,
    storefrontTrafficConsentId,
    TRAFFIC_PREFERENCE_EVENT,
} from '../storefront-traffic';

export function StorefrontTrafficPreference({
    api,
    language,
}: {
    api: ShopApi;
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    const [preference, setPreference] = useState<StorefrontTrafficConsent>(storefrontTrafficConsent);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const refresh = () => setPreference(storefrontTrafficConsent());
        window.addEventListener('storage', refresh);
        window.addEventListener(TRAFFIC_PREFERENCE_EVENT, refresh);
        return () => {
            window.removeEventListener('storage', refresh);
            window.removeEventListener(TRAFFIC_PREFERENCE_EVENT, refresh);
        };
    }, []);

    const choose = async (granted: boolean) => {
        if (busy) return;
        setBusy(true);
        setFailed(false);
        if (!granted) {
            setStorefrontTrafficConsent(false);
            setPreference('denied');
        }
        try {
            await api.recordAnalyticsConsent({
                consentId: storefrontTrafficConsentId(),
                granted,
                locale: language,
            });
            setStorefrontTrafficConsent(granted);
            setPreference(granted ? 'granted' : 'denied');
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    };

    if (preference === 'unknown') {
        return (
            <aside className="traffic-consent-banner" aria-label={isZh ? '访问统计选择' : 'Analytics choice'}>
                <div>
                    <strong>
                        {isZh ? '由你决定是否允许访问统计' : 'You choose whether analytics is allowed'}
                    </strong>
                    <p>
                        {isZh
                            ? '拒绝不会影响购物、登录或售后。允许后仅记录本站的页面访问与去标识化统计，可随时撤回。'
                            : 'Declining does not affect shopping, sign-in or support. Allowing records ' +
                              'first-party page views and pseudonymous metrics, and can be withdrawn anytime.'}{' '}
                        <a href="#/legal?id=privacy">{isZh ? '查看隐私政策' : 'View privacy policy'}</a>
                    </p>
                    {failed && (
                        <span role="alert">
                            {isZh
                                ? '偏好保存失败，统计仍保持关闭。'
                                : 'Saving failed. Analytics remains off.'}
                        </span>
                    )}
                </div>
                <div className="traffic-consent-actions">
                    <button type="button" disabled={busy} onClick={() => void choose(false)}>
                        {isZh ? '仅必要功能' : 'Necessary only'}
                    </button>
                    <button
                        type="button"
                        className="is-primary"
                        disabled={busy}
                        onClick={() => void choose(true)}
                    >
                        {isZh ? '允许访问统计' : 'Allow analytics'}
                    </button>
                </div>
            </aside>
        );
    }

    return (
        <>
            <button
                type="button"
                className="traffic-preference-button"
                disabled={busy}
                onClick={() => void choose(preference !== 'granted')}
            >
                {preference === 'granted'
                    ? isZh
                        ? '访问统计：已允许 · 撤回'
                        : 'Analytics allowed · Withdraw'
                    : isZh
                      ? '访问统计：已关闭 · 允许'
                      : 'Analytics off · Allow'}
            </button>
            {failed && (
                <span className="traffic-preference-error" role="alert">
                    {isZh
                        ? '偏好证据暂未写入，统计保持关闭。'
                        : 'Preference evidence was not saved. Analytics stays off.'}
                </span>
            )}
        </>
    );
}
