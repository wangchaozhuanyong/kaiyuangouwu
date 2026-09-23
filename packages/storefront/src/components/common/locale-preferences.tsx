import { Check, ChevronDown, Languages, LoaderCircle, MapPin, WalletCards } from 'lucide-react';
import { useState } from 'react';

import { Sheet } from '../../storefront-ui/page-shell';
import { StorefrontLanguage } from '../../types';

export function LocalePreferencesTrigger({
    language,
    currencyCode,
    expanded,
    onClick,
}: {
    language: StorefrontLanguage;
    currencyCode: string;
    expanded: boolean;
    onClick: () => void;
}) {
    const isZh = language === 'zh';
    const languageLabel = isZh ? '简中' : 'EN';

    return (
        <button
            type="button"
            className="locale-preferences-trigger"
            aria-label={
                isZh
                    ? `语言与货币：简体中文，${currencyCode}`
                    : `Language and currency: English, ${currencyCode}`
            }
            aria-haspopup="dialog"
            aria-expanded={expanded}
            onClick={onClick}
        >
            <Languages className="locale-preferences-trigger-icon" aria-hidden="true" />
            <span>{languageLabel}</span>
            <i aria-hidden="true" />
            <span>{currencyCode}</span>
            <ChevronDown className="locale-preferences-trigger-chevron" aria-hidden="true" />
        </button>
    );
}

export function LocalePreferencesSheet({
    language,
    currencyCodes,
    selectedCurrencyCode,
    currencyLoading,
    marketLabel,
    onToggleLanguage,
    onSelectCurrency,
    onClose,
}: {
    language: StorefrontLanguage;
    currencyCodes: string[];
    selectedCurrencyCode: string;
    currencyLoading: boolean;
    marketLabel: string;
    onToggleLanguage: () => void;
    onSelectCurrency: (currencyCode: string) => void | Promise<void>;
    onClose: () => void;
}) {
    const isZh = language === 'zh';
    const [draftLanguage, setDraftLanguage] = useState<StorefrontLanguage>(language);
    const [draftCurrency, setDraftCurrency] = useState(selectedCurrencyCode);
    const [saving, setSaving] = useState(false);
    const availableCurrencies = currencyCodes.length ? currencyCodes : [selectedCurrencyCode];

    const save = async () => {
        if (saving || currencyLoading) return;
        setSaving(true);
        try {
            if (draftCurrency !== selectedCurrencyCode) {
                await onSelectCurrency(draftCurrency);
            }
            if (draftLanguage !== language) onToggleLanguage();
            onClose();
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet
            title={isZh ? '语言与货币' : 'Language and currency'}
            language={language}
            onClose={onClose}
            className="locale-preferences-sheet"
            initialFocus="dialog"
        >
            <div className="locale-preferences-content" aria-busy={saving || currencyLoading}>
                <div className="locale-preferences-market">
                    <MapPin aria-hidden="true" />
                    <span>
                        <small>{isZh ? '当前店铺' : 'Current storefront'}</small>
                        <strong>{marketLabel}</strong>
                    </span>
                </div>

                <fieldset className="locale-preferences-fieldset">
                    <legend>
                        <Languages aria-hidden="true" />
                        {isZh ? '界面语言' : 'Interface language'}
                    </legend>
                    <div className="locale-preferences-language" role="radiogroup">
                        {(
                            [
                                ['zh', '简体中文'],
                                ['en', 'English'],
                            ] as const
                        ).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                role="radio"
                                aria-checked={draftLanguage === value}
                                className={draftLanguage === value ? 'is-selected' : undefined}
                                onClick={() => setDraftLanguage(value)}
                            >
                                <span>{label}</span>
                                {draftLanguage === value ? <Check aria-hidden="true" /> : null}
                            </button>
                        ))}
                    </div>
                </fieldset>

                <fieldset className="locale-preferences-fieldset">
                    <legend>
                        <WalletCards aria-hidden="true" />
                        {isZh ? '付款货币' : 'Payment currency'}
                    </legend>
                    <div className="locale-preferences-currencies" role="radiogroup">
                        {availableCurrencies.map(currencyCode => (
                            <button
                                key={currencyCode}
                                type="button"
                                role="radio"
                                aria-checked={draftCurrency === currencyCode}
                                className={draftCurrency === currencyCode ? 'is-selected' : undefined}
                                disabled={currencyLoading || saving}
                                onClick={() => setDraftCurrency(currencyCode)}
                            >
                                <span>
                                    <strong>{currencyCode}</strong>
                                    {currencyCode === 'USDT' ? (
                                        <small>{isZh ? 'TRC20 锁价付款' : 'TRC20 locked quote'}</small>
                                    ) : null}
                                </span>
                                {draftCurrency === currencyCode ? <Check aria-hidden="true" /> : null}
                            </button>
                        ))}
                    </div>
                </fieldset>

                <button
                    type="button"
                    className="locale-preferences-save"
                    disabled={saving || currencyLoading}
                    onClick={() => void save()}
                >
                    {saving || currencyLoading ? (
                        <LoaderCircle className="is-spinning" aria-hidden="true" />
                    ) : null}
                    {saving || currencyLoading
                        ? isZh
                            ? '正在保存…'
                            : 'Saving…'
                        : isZh
                          ? '保存设置'
                          : 'Save preferences'}
                </button>
            </div>
        </Sheet>
    );
}
