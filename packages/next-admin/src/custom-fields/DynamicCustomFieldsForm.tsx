import { Plus, Trash2 } from 'lucide-react';
import { createElement, useMemo, useState } from 'react';
import { FeatureHelpButton } from '../components/FeatureHelp';
import type { FeatureHelpTopic } from '../components/feature-help-content';
import type { CustomFieldDefinition, CustomFieldValueMap, StructFieldDefinition } from './custom-field-types';

import { getNextAdminCustomFieldComponent } from '../extensions/extension-api';
import { useAdminPermissions } from '../hooks/use-admin-permissions';

import {
    isDashboardVisibleCustomField,
    localizedText,
    validateCustomFieldValues,
} from './custom-field-utils';
import { useCustomFieldLanguages } from './custom-fields-context';

interface DynamicCustomFieldsFormProps {
    fields: readonly CustomFieldDefinition[];
    values: CustomFieldValueMap;
    onChange: (values: CustomFieldValueMap) => void;
    disabled?: boolean;
    excludedFieldNames?: readonly string[];
    languageCode?: string;
    title?: string;
    helpTopic?: FeatureHelpTopic;
    languageCodes?: readonly string[];
}

export function DynamicCustomFieldsForm({
    fields,
    values,
    onChange,
    disabled,
    excludedFieldNames = [],
    languageCode = 'zh_Hans',
    title = '扩展字段',
    helpTopic,
    languageCodes,
}: DynamicCustomFieldsFormProps) {
    const { hasAnyPermission } = useAdminPermissions();
    const [showErrors, setShowErrors] = useState(false);
    const excluded = useMemo(() => new Set(excludedFieldNames), [excludedFieldNames]);
    const visibleFields = fields.filter(
        field =>
            isDashboardVisibleCustomField(field) &&
            !excluded.has(field.name) &&
            hasAnyPermission(field.requiresPermission ?? []),
    );
    const errors = showErrors ? validateCustomFieldValues(visibleFields, values, languageCode) : {};

    if (visibleFields.length === 0) return null;
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
            <div className="mb-4">
                <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    {title}
                    {helpTopic && <FeatureHelpButton topic={helpTopic} title={title} />}
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                    字段由后端配置动态生成，新增扩展字段无需重写本页。
                </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                {visibleFields.map(field => (
                    <CustomFieldControl
                        key={field.name}
                        field={field}
                        value={values[field.name]}
                        onChange={value => {
                            onChange({ ...values, [field.name]: value });
                            if (!showErrors) setShowErrors(true);
                        }}
                        disabled={disabled || Boolean(field.readonly)}
                        languageCode={languageCode}
                        languageCodes={languageCodes}
                        error={errors[field.name]}
                    />
                ))}
            </div>
        </section>
    );
}

function CustomFieldControl({
    field,
    value,
    onChange,
    disabled,
    languageCode,
    error,
    languageCodes,
}: {
    field: CustomFieldDefinition | StructFieldDefinition;
    value: unknown;
    onChange: (value: unknown) => void;
    disabled?: boolean;
    languageCode: string;
    error?: string;
    languageCodes?: readonly string[];
}) {
    const availableLanguages = useCustomFieldLanguages();
    const [locale, setLocale] = useState(languageCode);
    const label = localizedText(field.label, languageCode, field.name);
    const description = localizedText(field.description, languageCode);
    const uiComponent = typeof field.ui?.component === 'string' ? field.ui.component : undefined;
    const pluginInput = uiComponent ? getNextAdminCustomFieldComponent(uiComponent) : undefined;
    const fullWidth = field.ui?.fullWidth === true || field.type === 'text' || field.type === 'struct';

    if (pluginInput) {
        return (
            <FieldShell label={label} description={description} error={error} fullWidth={fullWidth}>
                {createElement(pluginInput, {
                    field: field as unknown as Record<string, unknown>,
                    value,
                    onChange,
                    disabled,
                })}
            </FieldShell>
        );
    }

    if (field.list) {
        const items = Array.isArray(value) ? value : [];
        return (
            <FieldShell label={label} description={description} error={error} fullWidth>
                <div className="space-y-2">
                    {items.map((item, index) => (
                        <div key={`${field.name}-${index}`} className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                                <ScalarInput
                                    field={{ ...field, list: false }}
                                    value={item}
                                    onChange={next =>
                                        onChange(
                                            items.map((current, itemIndex) =>
                                                itemIndex === index ? next : current,
                                            ),
                                        )
                                    }
                                    disabled={disabled}
                                    languageCode={languageCode}
                                    languageCodes={languageCodes}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}
                                disabled={disabled}
                                className="rounded-lg border border-slate-200 p-2 text-slate-400 hover:border-rose-200 hover:text-rose-600 disabled:opacity-40"
                                aria-label={`删除${label}第 ${index + 1} 项`}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                    <button
                        type="button"
                        onClick={() => onChange([...items, defaultValueForField(field)])}
                        disabled={disabled}
                        className={[
                            'flex w-full items-center justify-center gap-1.5 rounded-lg border',
                            'border-dashed border-slate-300 px-3 py-2 text-xs font-semibold',
                            'text-slate-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-40',
                        ].join(' ')}
                    >
                        <Plus className="h-3.5 w-3.5" /> 添加一项
                    </button>
                </div>
            </FieldShell>
        );
    }

    if (field.type === 'localeString' || field.type === 'localeText') {
        const localized = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        const languages =
            languageCodes && languageCodes.length > 0
                ? [...languageCodes]
                : availableLanguages.length > 0
                  ? availableLanguages
                  : [languageCode];
        return (
            <FieldShell label={label} description={description} error={error} fullWidth={fullWidth}>
                <select
                    value={locale}
                    onChange={event => setLocale(event.target.value)}
                    className="mb-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    aria-label={`${label}语言`}
                >
                    {languages.map(code => (
                        <option key={code} value={code}>
                            {code}
                        </option>
                    ))}
                </select>
                <ScalarInput
                    field={{ ...field, type: field.type === 'localeText' ? 'text' : 'string' }}
                    value={localized[locale] ?? ''}
                    onChange={next => onChange({ ...localized, [locale]: next })}
                    disabled={disabled}
                    languageCode={locale}
                    languageCodes={languageCodes}
                />
            </FieldShell>
        );
    }

    return (
        <FieldShell label={label} description={description} error={error} fullWidth={fullWidth}>
            <ScalarInput
                field={field}
                value={value}
                onChange={onChange}
                disabled={disabled}
                languageCode={languageCode}
                languageCodes={languageCodes}
            />
        </FieldShell>
    );
}

function ScalarInput({
    field,
    value,
    onChange,
    disabled,
    languageCode,
    languageCodes,
}: {
    field: CustomFieldDefinition | StructFieldDefinition;
    value: unknown;
    onChange: (value: unknown) => void;
    disabled?: boolean;
    languageCode: string;
    languageCodes?: readonly string[];
}) {
    const inputClass = [
        'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs outline-none',
        'focus:border-blue-500 focus:ring-2 focus:ring-blue-100',
        'disabled:bg-slate-100 disabled:text-slate-500',
    ].join(' ');
    if (field.type === 'boolean') {
        return (
            <label className="flex min-h-9 items-center gap-2 text-xs text-slate-700">
                <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={event => onChange(event.target.checked)}
                    disabled={disabled}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                {value ? '已开启' : '已关闭'}
            </label>
        );
    }
    if (field.type === 'struct') {
        const structValue = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
        return (
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                {(field as CustomFieldDefinition).fields?.map(child => (
                    <CustomFieldControl
                        key={child.name}
                        field={child}
                        value={structValue[child.name]}
                        onChange={next => onChange({ ...structValue, [child.name]: next })}
                        disabled={disabled}
                        languageCode={languageCode}
                        languageCodes={languageCodes}
                    />
                ))}
            </div>
        );
    }
    if (field.options?.length) {
        return (
            <select
                value={stringValue(value)}
                onChange={event => onChange(event.target.value || null)}
                disabled={disabled}
                className={inputClass}
            >
                <option value="">请选择</option>
                {field.options.map(option => (
                    <option key={option.value} value={option.value}>
                        {localizedText(option.label, languageCode, option.value)}
                    </option>
                ))}
            </select>
        );
    }
    if (field.type === 'text') {
        return (
            <textarea
                value={stringValue(value)}
                onChange={event => onChange(event.target.value)}
                disabled={disabled}
                rows={4}
                className={inputClass}
            />
        );
    }
    const isNumber = field.type === 'int' || field.type === 'float';
    const isDateTime = field.type === 'datetime';
    const numberField = field as CustomFieldDefinition;
    return (
        <input
            type={isNumber ? 'number' : isDateTime ? 'datetime-local' : 'text'}
            value={dateTimeLocalValue(value, isDateTime)}
            onChange={event => {
                if (isNumber) {
                    onChange(event.target.value === '' ? null : Number(event.target.value));
                } else if (isDateTime) {
                    onChange(event.target.value ? new Date(event.target.value).toISOString() : null);
                } else {
                    onChange(event.target.value);
                }
            }}
            disabled={disabled}
            pattern={field.pattern ?? undefined}
            min={
                isNumber
                    ? (numberField.intMin ?? numberField.floatMin ?? undefined)
                    : (numberField.datetimeMin ?? undefined)
            }
            max={
                isNumber
                    ? (numberField.intMax ?? numberField.floatMax ?? undefined)
                    : (numberField.datetimeMax ?? undefined)
            }
            step={numberField.intStep ?? numberField.floatStep ?? numberField.datetimeStep ?? undefined}
            className={inputClass}
        />
    );
}

function FieldShell({
    label,
    description,
    error,
    fullWidth,
    children,
}: {
    label: string;
    description?: string;
    error?: string;
    fullWidth?: boolean;
    children: React.ReactNode;
}) {
    return (
        <label className={`block min-w-0 ${fullWidth ? 'md:col-span-2' : ''}`}>
            <span className="text-xs font-semibold text-slate-700">{label}</span>
            {description && (
                <span className="mt-0.5 block text-[10px] leading-4 text-slate-400">{description}</span>
            )}
            <div className="mt-1.5">{children}</div>
            {error && <span className="mt-1 block text-[10px] text-rose-600">{error}</span>}
        </label>
    );
}

function defaultValueForField(field: CustomFieldDefinition | StructFieldDefinition) {
    if (field.type === 'boolean') return false;
    if (field.type === 'struct') return {};
    if (field.type === 'int' || field.type === 'float') return null;
    return '';
}

function dateTimeLocalValue(value: unknown, isDateTime: boolean) {
    if (!isDateTime || !value) return stringValue(value);
    const serialized = stringValue(value);
    if (!serialized) return '';
    const date = new Date(serialized);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
}

function stringValue(value: unknown) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
        return String(value);
    }
    if (value instanceof Date) return value.toISOString();
    return '';
}
