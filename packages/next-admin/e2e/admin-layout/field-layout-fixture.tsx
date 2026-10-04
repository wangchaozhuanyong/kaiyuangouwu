import { useState } from 'react';
import { AdminInput, AdminSelect, AdminTextArea } from '../../src/components/AdminControls';
import { AdminField } from '../../src/components/AdminField';
import { SearchInput } from '../../src/components/SearchInput';
import { DynamicCustomFieldsForm } from '../../src/custom-fields/DynamicCustomFieldsForm';
import { Field, FieldGroup, SettingsFormGrid, inputClass } from '../../src/pages/Settings/settings-ui';

/** Local layout/keyboard fixtures only; no business writes or real customer data. */
export function FieldLayoutFixture() {
    const [name, setName] = useState('布局示例');
    const [search, setSearch] = useState('');
    const [scope, setScope] = useState('all');
    const [custom, setCustom] = useState({ short: '', long: '' });
    return (
        <main className="space-y-5 overflow-auto p-5">
            <SettingsFormGrid>
                <Field label="店铺名称" description="说明放在输入框下方，不占标题高度。">
                    <AdminInput
                        value={name}
                        onChange={event => setName(event.target.value)}
                        className={inputClass}
                    />
                </Field>
                <Field label="销售状态">
                    <AdminSelect
                        value={scope}
                        onChange={event => setScope(event.target.value)}
                        className={inputClass}
                    >
                        <option value="all">全部状态</option>
                        <option value="enabled">已启用</option>
                    </AdminSelect>
                </Field>
                <FieldGroup
                    label="语言设置"
                    htmlFor="fixture-language"
                    description="分组保留明确的标签关联。"
                >
                    <AdminSelect id="fixture-language" className={inputClass} defaultValue="zh">
                        <option value="zh">中文</option>
                        <option value="en">English</option>
                    </AdminSelect>
                </FieldGroup>
                <Field label="详细说明">
                    <AdminTextArea
                        rows={3}
                        className={inputClass}
                        defaultValue="长文本继续使用完整编辑宽度。"
                    />
                </Field>
            </SettingsFormGrid>
            <output data-field-values className="block text-xs text-slate-500">
                {name} / {scope} / {search}
            </output>
            {[500, 320, 280].map(width => (
                <section
                    key={width}
                    style={{ width, maxWidth: '100%' }}
                    className="space-y-3"
                    data-field-width={width}
                >
                    <AdminField label="查找 SKU" className="text-xs font-bold text-slate-700">
                        <SearchInput
                            value={search}
                            onValueChange={setSearch}
                            className={inputClass}
                            placeholder="输入商品或 SKU"
                        />
                    </AdminField>
                    <AdminField
                        label="A longer international field caption"
                        description="长标题可以换行，控件保留可用宽度。"
                        className="text-xs font-bold text-slate-700"
                    >
                        <AdminInput aria-label={`长标题 ${width}`} className={inputClass} />
                    </AdminField>
                    <AdminField
                        label="金额"
                        error="请输入有效金额"
                        className="text-xs font-bold text-slate-700"
                    >
                        <AdminInput type="number" aria-invalid="true" className={inputClass} />
                    </AdminField>
                    <AdminField label="附件" className="text-xs font-bold text-slate-700">
                        <AdminInput type="file" className="block max-w-full text-xs" />
                    </AdminField>
                    <AdminField
                        label="复杂编辑区"
                        layout="stacked"
                        className="text-xs font-bold text-slate-700"
                    >
                        <div className="grid gap-2 sm:grid-cols-2">
                            <AdminInput aria-label="复合项一" className={inputClass} />
                            <AdminInput aria-label="复合项二" className={inputClass} disabled />
                        </div>
                    </AdminField>
                </section>
            ))}
            <DynamicCustomFieldsForm
                fields={[
                    {
                        name: 'short',
                        type: 'string',
                        list: false,
                        label: [{ languageCode: 'zh_Hans', value: '扩展短字段' }],
                    },
                    {
                        name: 'long',
                        type: 'text',
                        list: false,
                        label: [{ languageCode: 'zh_Hans', value: '扩展长文本' }],
                    },
                ]}
                values={custom}
                onChange={value => setCustom(value as typeof custom)}
            />
        </main>
    );
}
