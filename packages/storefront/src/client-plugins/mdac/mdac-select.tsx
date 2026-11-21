// organize-imports-ignore -- Keep ESLint type import grouping.
import type { StorefrontLanguage } from '../../types';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useDesktopLayout } from '../../desktop-layout';
import { Sheet } from '../../storefront-ui/page-shell';

type Option = readonly [value: string, label: string];

interface MdacSelectProps {
    id: string;
    title: string;
    language: StorefrontLanguage;
    options: readonly Option[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    describedBy?: string;
    invalid?: boolean;
    required?: boolean;
    disabled?: boolean;
    customOption?: (query: string) => string | undefined;
    searchPlaceholder?: string;
}

export function MdacSelect({
    id,
    title,
    language,
    options,
    value,
    onChange,
    placeholder,
    describedBy,
    invalid: reportedInvalid,
    required,
    disabled,
    customOption,
    searchPlaceholder,
}: MdacSelectProps) {
    const desktop = useDesktopLayout();
    const [open, setOpen] = useState(false);
    const [invalid, setInvalid] = useState(false);
    const [search, setSearch] = useState('');
    const trigger = useRef<HTMLButtonElement>(null);
    const selected = options.find(option => option[0] === value);
    const label = selected?.[1] ?? placeholder;
    const zh = language === 'zh';
    const searchLabel = searchPlaceholder ?? (zh ? '搜索选项' : 'Search options');
    useEffect(() => {
        if (desktop || disabled) setOpen(false);
    }, [desktop, disabled]);

    function openSheet() {
        trigger.current?.focus();
        setSearch('');
        setOpen(true);
    }
    function choose(next: string) {
        if (next !== value) onChange(next);
        setOpen(false);
    }

    const showSheet = !desktop && open && !disabled;
    const query = search.trim().toLowerCase();
    const matches = showSheet
        ? options.filter(
              ([code, text]) => text.toLowerCase().includes(query) || code.toLowerCase().includes(query),
          )
        : [];
    const customValue = customOption?.(query);
    const canUseCustom = customValue && !options.some(([code]) => code === customValue);

    return (
        <>
            <select
                id={desktop ? id : undefined}
                aria-describedby={desktop ? describedBy : undefined}
                aria-invalid={desktop && reportedInvalid ? true : undefined}
                hidden={!desktop}
                tabIndex={desktop ? undefined : -1}
                value={value}
                required={required}
                disabled={disabled}
                onChange={event => onChange(event.currentTarget.value)}
                onInvalid={event => {
                    if (desktop) return;
                    event.preventDefault();
                    // Let the first invalid field handle focus, including earlier native inputs.
                    const field = event.currentTarget;
                    if (field.form?.querySelector(':is(input, select, textarea):invalid') === field) {
                        setInvalid(true);
                        openSheet();
                    }
                }}
            >
                {placeholder !== undefined && <option value="">{placeholder}</option>}
                {options.map(([code, text], index) => (
                    <option key={`${code}-${index}`} value={code}>
                        {text}
                    </option>
                ))}
            </select>
            {!desktop && (
                <button
                    id={id}
                    ref={trigger}
                    type="button"
                    className="mdac-select-trigger type-input"
                    aria-label={label ? `${title} ${label}` : title}
                    aria-describedby={describedBy}
                    aria-haspopup="dialog"
                    aria-expanded={showSheet}
                    aria-invalid={reportedInvalid || (invalid && !selected) ? true : undefined}
                    disabled={disabled}
                    onClick={openSheet}
                >
                    <span>{label}</span>
                    <ChevronDown size={18} aria-hidden="true" />
                </button>
            )}
            {showSheet && (
                <Sheet
                    title={title}
                    language={language}
                    onClose={() => setOpen(false)}
                    className="mdac-select-sheet"
                    showHandle
                >
                    {(options.length > 24 || customOption) && (
                        <div className="mdac-select-search">
                            <input
                                type="search"
                                className="type-input"
                                aria-label={searchLabel}
                                placeholder={searchLabel}
                                value={search}
                                autoComplete="off"
                                maxLength={80}
                                onChange={event => setSearch(event.currentTarget.value)}
                                onKeyDown={event => {
                                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                        event.preventDefault();
                                    }
                                }}
                            />
                        </div>
                    )}
                    <div className="mdac-select-options">
                        {matches.map((option, index) => (
                            <button
                                key={`${option[0]}-${index}`}
                                type="button"
                                className="type-label"
                                aria-pressed={option === selected}
                                onFocus={event => event.currentTarget.scrollIntoView?.({ block: 'nearest' })}
                                onClick={() => choose(option[0])}
                            >
                                <span>{option[1]}</span>
                                {option === selected && <Check size={18} aria-hidden="true" />}
                            </button>
                        ))}
                        {canUseCustom && (
                            <button
                                type="button"
                                className="type-label"
                                aria-pressed={false}
                                onClick={() => choose(customValue)}
                            >
                                <span>{zh ? `使用 ${customValue}` : `Use ${customValue}`}</span>
                            </button>
                        )}
                        {matches.length === 0 && !canUseCustom && (
                            <p className="mdac-select-empty type-helper" role="status">
                                {zh ? '未找到选项' : 'No options found'}
                            </p>
                        )}
                    </div>
                </Sheet>
            )}
        </>
    );
}
