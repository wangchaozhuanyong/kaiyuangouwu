import { Bell } from 'lucide-react';
import { useState } from 'react';

import { BrandLogo } from '../../storefront-ui/content-ui';
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
}: MobilePageHeaderProps) {
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const isZh = language === 'zh';

    return (
        <>
            <header className={`mobile-page-header${className ? ` ${className}` : ''}`}>
                <span className="mobile-page-heading">
                    <BrandLogo url={logoUrl} name={storefrontName} className="mobile-page-brand" />
                    <strong>{title}</strong>
                </span>
                <span className="mobile-page-actions">
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
                    <button
                        className="mobile-page-notifications"
                        type="button"
                        onClick={onNotifications}
                        aria-label={isZh ? '消息通知' : 'Notifications'}
                    >
                        <Bell aria-hidden="true" />
                    </button>
                </span>
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
