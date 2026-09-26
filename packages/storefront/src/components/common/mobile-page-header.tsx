import { useState } from 'react';

import { BrandLogo } from '../../storefront-ui/content-ui';
import { NoticeButton } from '../../storefront-ui/page-shell';
import { StorefrontLanguage } from '../../types';

import { LocalePreferencesSheet, LocalePreferencesTrigger } from './locale-preferences';

export interface MobilePageHeaderProps {
    className?: string;
    title: string;
    storefrontName: string;
    logoUrl: string | null;
    language: StorefrontLanguage;
    displayCurrencyCode: string;
    availableCurrencyCodes: string[];
    currencyLoading: boolean;
    onToggleLanguage?: () => void;
    onCurrencyChange?: (currencyCode: string) => void | Promise<void>;
    onNotifications: () => void;
    onBrandClick?: () => void;
}

export function MobilePageHeader({
    className,
    title,
    storefrontName,
    logoUrl,
    language,
    displayCurrencyCode,
    availableCurrencyCodes,
    currencyLoading,
    onToggleLanguage,
    onCurrencyChange,
    onNotifications,
    onBrandClick,
}: MobilePageHeaderProps) {
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const isZh = language === 'zh';
    const brand = (
        <>
            <BrandLogo url={logoUrl} name={storefrontName} className="brand-mark" />
            <strong>{title}</strong>
        </>
    );

    return (
        <>
            <header className={`topbar home-topbar mobile-page-header${className ? ` ${className}` : ''}`}>
                {onBrandClick ? (
                    <button
                        className="brand"
                        type="button"
                        onClick={onBrandClick}
                        aria-label={
                            isZh ? `返回 ${storefrontName} 首页顶部` : `Back to the top of ${storefrontName}`
                        }
                    >
                        {brand}
                    </button>
                ) : (
                    <span className="brand">{brand}</span>
                )}
                <div className="topbar-actions">
                    {onToggleLanguage && onCurrencyChange ? (
                        <LocalePreferencesTrigger
                            language={language}
                            currencyCode={displayCurrencyCode}
                            expanded={preferencesOpen}
                            onClick={() => setPreferencesOpen(true)}
                        />
                    ) : (
                        <span className="mobile-page-locale-fallback">
                            {isZh ? '简中' : 'EN'} | {displayCurrencyCode}
                        </span>
                    )}
                    <NoticeButton language={language} onClick={onNotifications} />
                </div>
            </header>
            {preferencesOpen && onToggleLanguage && onCurrencyChange ? (
                <LocalePreferencesSheet
                    language={language}
                    currencyCodes={
                        availableCurrencyCodes.length ? availableCurrencyCodes : [displayCurrencyCode]
                    }
                    selectedCurrencyCode={displayCurrencyCode}
                    currencyLoading={currencyLoading}
                    onToggleLanguage={onToggleLanguage}
                    onSelectCurrency={onCurrencyChange}
                    onClose={() => setPreferencesOpen(false)}
                />
            ) : null}
        </>
    );
}
