import { useId } from 'react';

import {
    configurableArgumentDescription,
    configurableArgumentLabel,
    configurableArgumentOptions,
    configurableListValueForDisplay,
    configurableUiRecord,
    type ConfigurableArgumentDefinitionLike,
    type ConfigurableOperationDefinitionLike,
} from '../utils/configurable-operation-localization';

export function ConfigurableOperationField({
    definition,
    operationCode,
    value,
    onChange,
}: {
    definition: ConfigurableArgumentDefinitionLike;
    operationCode?: string;
    value: string;
    onChange: (value: string) => void;
}) {
    const descriptionId = useId();
    const label = configurableArgumentLabel(definition, operationCode);
    const description = configurableArgumentDescription(definition, operationCode);
    const options = configurableArgumentOptions(definition);
    const type = definition.type.toLowerCase();
    const ui = configurableUiRecord(definition.ui);
    const describedBy = description ? descriptionId : undefined;
    const commonProps = {
        'aria-describedby': describedBy,
        required: Boolean(definition.required),
        className:
            'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100',
    };

    return (
        <label className="text-xs font-bold text-slate-600">
            <span>
                {label}
                {definition.required ? ' *' : ''}
            </span>
            {type.includes('boolean') && !definition.list ? (
                <select
                    {...commonProps}
                    value={value || 'false'}
                    onChange={event => onChange(event.target.value)}
                >
                    <option value="true">是</option>
                    <option value="false">否</option>
                </select>
            ) : options.length && !definition.list ? (
                <select {...commonProps} value={value} onChange={event => onChange(event.target.value)}>
                    <option value="">请选择</option>
                    {options.map(option => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            ) : definition.list ? (
                <textarea
                    {...commonProps}
                    rows={3}
                    value={configurableListValueForDisplay(value)}
                    onChange={event => onChange(event.target.value)}
                    placeholder="每行填写一项"
                />
            ) : (
                <div className="relative">
                    <input
                        {...commonProps}
                        type={
                            type.includes('password')
                                ? 'password'
                                : ['int', 'float', 'money', 'number'].some(item => type.includes(item))
                                  ? 'number'
                                  : type.includes('date')
                                    ? 'datetime-local'
                                    : 'text'
                        }
                        inputMode={
                            ['int', 'float', 'money', 'number'].some(item => type.includes(item))
                                ? 'decimal'
                                : undefined
                        }
                        min={typeof ui?.min === 'number' ? ui.min : undefined}
                        max={typeof ui?.max === 'number' ? ui.max : undefined}
                        step={type.includes('int') ? 1 : type.includes('float') ? 'any' : undefined}
                        value={value}
                        onChange={event => onChange(event.target.value)}
                        placeholder={type === 'id' ? '请输入关联对象 ID' : '请输入'}
                    />
                    {typeof ui?.suffix === 'string' && ui.suffix && (
                        <span className="pointer-events-none absolute bottom-2 right-3 text-xs text-slate-400">
                            {ui.suffix}
                        </span>
                    )}
                </div>
            )}
            {ui?.component === 'currency-form-input' && value !== '' && !isNaN(Number(value)) && (
                <div
                    className={`mt-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${
                        Number(value) > 0 && Number(value) < 1000
                            ? 'border border-amber-200 bg-amber-50 text-amber-800'
                            : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                    }`}
                >
                    <span>💡 当前金额折合：{(Number(value) / 100).toFixed(2)} 元/单位（系统以分为单位）</span>
                    {Number(value) > 0 && Number(value) < 1000 && (
                        <p className="mt-0.5 font-normal text-amber-700">
                            注意：若您想设置 {value} 元整，请在后面加两个0，输入 {Number(value) * 100}。
                        </p>
                    )}
                </div>
            )}
            {definition.name === 'allowedCountryCodes' && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                    <span>快捷选择：</span>
                    {[
                        { code: 'MY', label: '马来西亚 (MY)' },
                        { code: 'SG', label: '新加坡 (SG)' },
                        { code: 'CN', label: '中国 (CN)' },
                    ].map(c => (
                        <button
                            key={c.code}
                            type="button"
                            onClick={() => {
                                const current = value
                                    ? value
                                          .split(',')
                                          .map(s => s.trim())
                                          .filter(Boolean)
                                    : [];
                                if (!current.includes(c.code)) {
                                    onChange([...current, c.code].join(','));
                                }
                            }}
                            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                        >
                            + {c.label}
                        </button>
                    ))}
                </div>
            )}
            {description && (
                <small id={descriptionId} className="mt-1 block font-normal leading-4 text-slate-400">
                    {description}
                </small>
            )}
        </label>
    );
}

export function ConfigurableOperationTechnicalDetails({
    definition,
}: {
    definition: ConfigurableOperationDefinitionLike;
}) {
    return (
        <details className="mt-1 text-[10px] font-normal text-slate-400">
            <summary className="w-fit cursor-pointer select-none hover:text-slate-600">查看技术信息</summary>
            <div className="mt-1 space-y-1 rounded-md bg-slate-100 px-2 py-1.5 font-mono">
                <div>规则标识：{definition.code}</div>
                {definition.args.length > 0 && (
                    <div>参数标识：{definition.args.map(argument => argument.name).join('、')}</div>
                )}
            </div>
        </details>
    );
}
