import { useId } from 'react';

import { businessChoiceLabel, type BusinessChoice } from './business-settings-choice-data';
import { inputClass } from './settings-ui';

export function MultiValueChoiceField({
    label,
    description,
    values,
    choices,
    addLabel,
    onChange,
    disabled = false,
    minimum = 1,
}: {
    label: string;
    description: string;
    values: string[];
    choices: readonly BusinessChoice[];
    addLabel: string;
    onChange: (values: string[]) => void;
    disabled?: boolean;
    minimum?: number;
}) {
    const selectId = useId();
    const normalizedValues = [...new Set(values.filter(Boolean))];
    const allChoices = [
        ...choices,
        ...normalizedValues
            .filter(value => !choices.some(choice => choice.value === value))
            .map(value => ({ value, label: `已有配置 ${value}` })),
    ];
    const availableChoices = allChoices.filter(choice => !normalizedValues.includes(choice.value));

    return (
        <div className="space-y-2">
            <div>
                <label htmlFor={selectId} className="block text-xs font-bold text-slate-700">
                    {label}
                </label>
                <p className="mt-1 text-[11px] leading-4 text-slate-400">{description}</p>
            </div>
            <div className="flex min-h-9 flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                {normalizedValues.map(value => (
                    <span
                        key={value}
                        className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700"
                    >
                        {businessChoiceLabel(value, allChoices)}
                        <button
                            type="button"
                            onClick={() => onChange(normalizedValues.filter(item => item !== value))}
                            disabled={disabled || normalizedValues.length <= minimum}
                            aria-label={`移除${businessChoiceLabel(value, allChoices)}`}
                            className="rounded px-1 text-blue-500 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                            ×
                        </button>
                    </span>
                ))}
            </div>
            <select
                id={selectId}
                value=""
                onChange={event => {
                    if (event.target.value) onChange([...normalizedValues, event.target.value]);
                }}
                disabled={disabled || availableChoices.length === 0}
                className={inputClass}
            >
                <option value="">{availableChoices.length ? addLabel : '可选项已全部添加'}</option>
                {availableChoices.map(choice => (
                    <option key={choice.value} value={choice.value}>
                        {choice.label}（{choice.value}）
                    </option>
                ))}
            </select>
        </div>
    );
}
