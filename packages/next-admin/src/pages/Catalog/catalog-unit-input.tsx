import { useState } from 'react';

import type { NextAdminCustomFieldInputProps } from '../../extensions/extension-api';
import { CATALOG_UNIT_PRESET_GROUPS, CATALOG_UNIT_PRESETS } from './catalog-unit-presets';

const CUSTOM_UNIT_VALUE = '__custom_unit__';

export function CatalogUnitInput({
    value,
    onChange,
    disabled,
    ariaLabel = '单位',
}: {
    value?: string | null;
    onChange: (value: string) => void;
    disabled?: boolean;
    ariaLabel?: string;
}) {
    const currentValue = value?.trim() ?? '';
    const presetSelected = CATALOG_UNIT_PRESETS.some(unit => unit === currentValue);
    const [customMode, setCustomMode] = useState(Boolean(currentValue && !presetSelected));
    const showCustomInput = !presetSelected && (customMode || Boolean(currentValue));

    return (
        <div className="space-y-2">
            <select
                value={presetSelected ? currentValue : showCustomInput ? CUSTOM_UNIT_VALUE : ''}
                onChange={event => {
                    if (event.target.value === CUSTOM_UNIT_VALUE) {
                        setCustomMode(true);
                        if (presetSelected) onChange('');
                        return;
                    }
                    setCustomMode(false);
                    onChange(event.target.value);
                }}
                disabled={disabled}
                aria-label={`${ariaLabel}常用选项`}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500"
            >
                <option value="">请选择单位</option>
                {CATALOG_UNIT_PRESET_GROUPS.map(group => (
                    <optgroup key={group.label} label={group.label}>
                        {group.units.map(unit => (
                            <option key={unit} value={unit}>
                                {unit}
                            </option>
                        ))}
                    </optgroup>
                ))}
                <option value={CUSTOM_UNIT_VALUE}>自定义单位…</option>
            </select>
            {showCustomInput && (
                <input
                    type="text"
                    value={presetSelected ? '' : currentValue}
                    onChange={event => onChange(event.target.value)}
                    disabled={disabled}
                    maxLength={32}
                    aria-label={`${ariaLabel}自定义值`}
                    placeholder="输入自定义单位，例如：扎"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100 disabled:text-slate-500"
                />
            )}
            <p className="text-[10px] leading-4 text-slate-400">可选择常用单位，也可以使用自定义单位。</p>
        </div>
    );
}

export function CatalogUnitCustomFieldInput({ value, onChange, disabled }: NextAdminCustomFieldInputProps) {
    return (
        <CatalogUnitInput
            value={typeof value === 'string' ? value : ''}
            onChange={onChange}
            disabled={disabled}
        />
    );
}
