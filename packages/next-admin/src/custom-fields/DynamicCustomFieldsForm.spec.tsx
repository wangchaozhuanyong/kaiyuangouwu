// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeatureHelpProvider } from '../components/FeatureHelp';
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
            <FeatureHelpProvider>
                <DynamicCustomFieldsForm
                    fields={fields}
                    values={{
                        merchantNote: '已配置',
                        priority: 3,
                        internalCode: 'INTERNAL_VALUE_NOT_VISIBLE',
                    }}
                    onChange={() => undefined}
                    title="商品扩展属性"
                />
            </FeatureHelpProvider>,
        );

        expect(html).toContain('商品扩展属性');
        expect(html).toContain('查看“商品扩展属性”功能说明');
        expect(html).toContain('商家备注');
        expect(html).toContain('查看“商家备注”功能说明');
        expect(html).toContain('已配置');
        expect(html).toContain('type="number"');
        expect(html).toContain('value="3"');
        expect(html).not.toContain('internalCode');
        expect(html).not.toContain('INTERNAL_VALUE_NOT_VISIBLE');
    });

    it('opens the configured field description through its help button', async () => {
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        try {
            await act(async () =>
                root.render(
                    <FeatureHelpProvider>
                        <DynamicCustomFieldsForm
                            fields={[
                                {
                                    name: 'merchantNote',
                                    type: 'text',
                                    list: false,
                                    label: [{ languageCode: 'zh_Hans', value: '商家备注' }],
                                    description: [{ languageCode: 'zh_Hans', value: '由测试插件动态提供' }],
                                },
                            ]}
                            values={{}}
                            onChange={() => undefined}
                        />
                    </FeatureHelpProvider>,
                ),
            );
            const trigger = container.querySelector<HTMLButtonElement>(
                '[aria-label="查看“商家备注”功能说明"]',
            )!;
            expect(trigger).not.toBeNull();
            await act(async () => trigger.click());
            expect(document.querySelector('[data-feature-help-card="true"]')?.textContent).toContain(
                '由测试插件动态提供',
            );
        } finally {
            await act(async () => root.unmount());
            container.remove();
        }
    });

    it('does not render an empty section when no visible field is configured', () => {
        expect(
            renderToStaticMarkup(
                <FeatureHelpProvider>
                    <DynamicCustomFieldsForm fields={[]} values={{}} onChange={() => undefined} />
                </FeatureHelpProvider>,
            ),
        ).toBe('');
    });
});
