import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CustomFieldDefinition } from './custom-field-types';

import { DynamicCustomFieldsForm } from './DynamicCustomFieldsForm';

describe('DynamicCustomFieldsForm', () => {
    it('renders dashboard-visible fields supplied by the backend configuration', () => {
        const fields: CustomFieldDefinition[] = [
            {
                name: 'merchantNote',
                type: 'text',
                list: false,
                label: [{ languageCode: 'zh_Hans', value: '商家备注' }],
                description: [{ languageCode: 'zh_Hans', value: '由测试插件动态提供' }],
            },
            {
                name: 'priority',
                type: 'int',
                list: false,
                intMin: 1,
                intMax: 5,
            },
            {
                name: 'internalCode',
                type: 'string',
                list: false,
                internal: true,
            },
        ];

        const html = renderToStaticMarkup(
            <DynamicCustomFieldsForm
                fields={fields}
                values={{ merchantNote: '已配置', priority: 3, internalCode: 'hidden' }}
                onChange={() => undefined}
                title="商品扩展属性"
            />,
        );

        expect(html).toContain('商品扩展属性');
        expect(html).toContain('字段由后端配置动态生成');
        expect(html).toContain('商家备注');
        expect(html).toContain('由测试插件动态提供');
        expect(html).toContain('已配置');
        expect(html).toContain('type="number"');
        expect(html).toContain('value="3"');
        expect(html).not.toContain('internalCode');
        expect(html).not.toContain('hidden');
    });

    it('does not render an empty section when no visible field is configured', () => {
        expect(
            renderToStaticMarkup(
                <DynamicCustomFieldsForm fields={[]} values={{}} onChange={() => undefined} />,
            ),
        ).toBe('');
    });
});
