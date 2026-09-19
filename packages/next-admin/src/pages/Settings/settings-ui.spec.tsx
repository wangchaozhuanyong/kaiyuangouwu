import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CheckboxField, Field, SettingsContentSkeleton, SettingsFormGrid, inputClass } from './settings-ui';

describe('settings form layout', () => {
    it('gives every field the same header rhythm and responsive grid boundary', () => {
        const html = renderToStaticMarkup(
            <SettingsFormGrid columns={3} className="mt-4">
                <Field label="普通字段" description="说明文字">
                    <input className={inputClass} />
                </Field>
                <CheckboxField
                    label="开关字段"
                    description="说明文字"
                    checkboxLabel="启用"
                    checked
                    onChange={() => undefined}
                />
            </SettingsFormGrid>,
        );

        expect(html).toContain('data-settings-form-grid="3"');
        expect(html).toContain('items-start');
        expect(html).toContain('md:grid-cols-2');
        expect(html).toContain('xl:grid-cols-3');
        expect(html.match(/data-settings-field=/g)).toHaveLength(2);
        expect(html).toContain('data-settings-checkbox-field="true"');
        expect(html).toContain('min-h-9');
        expect(inputClass).toContain('min-w-0');
        expect(inputClass).toContain('max-w-full');
    });
});

describe('SettingsContentSkeleton', () => {
    it('keeps a full-height content frame while settings data is initializing', () => {
        const html = renderToStaticMarkup(<SettingsContentSkeleton label="正在读取设置" sections={3} />);

        expect(html).toContain('aria-label="正在读取设置"');
        expect(html).toContain('aria-busy="true"');
        expect(html).toContain('min-h-[620px]');
        expect(html.match(/<section/g)).toHaveLength(4);
    });
});
