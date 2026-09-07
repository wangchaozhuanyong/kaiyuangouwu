import { describe, expect, it } from 'vitest';

import {
    configurableArgumentDescription,
    configurableArgumentLabel,
    configurableArgumentOptions,
    configurableListValueForDisplay,
    configurableOperationLabel,
    serializeConfigurableListValue,
    type ConfigurableArgumentDefinitionLike,
} from '../utils/configurable-operation-localization';

const argument = (
    value: Partial<ConfigurableArgumentDefinitionLike> & Pick<ConfigurableArgumentDefinitionLike, 'name'>,
): ConfigurableArgumentDefinitionLike => ({
    type: 'string',
    required: true,
    ...value,
});

describe('ConfigurableOperationFields localization', () => {
    it('replaces raw promotion argument names and placeholders with Chinese business copy', () => {
        const amount = argument({ name: 'amount', type: 'int' });
        const currency = argument({ name: 'currencyCode' });
        const tax = argument({ name: 'taxInclusive', type: 'boolean' });
        const definition = {
            code: 'store_currency_minimum_order_amount',
            description: '订单商品小计满 { amount }',
            args: [amount, currency, tax],
        };

        expect(configurableOperationLabel(definition)).toBe('订单商品小计满「最低商品小计」');
        expect(configurableArgumentLabel(amount, definition.code)).toBe('最低商品小计');
        expect(configurableArgumentLabel(currency, definition.code)).toBe('金额币种');
        expect(configurableArgumentLabel(tax, definition.code)).toBe('按含税商品小计判断');
        expect(configurableArgumentDescription(amount, definition.code)).toContain('100 表示 1.00');
    });

    it('does not expose English-only backend labels as the primary field label', () => {
        expect(
            configurableArgumentLabel(
                argument({ name: 'currencyCode', label: 'Currency code', description: 'Currency used' }),
            ),
        ).toBe('币种');
        expect(configurableArgumentLabel(argument({ name: 'unmappedProviderSetting' }))).toBe('文本参数');
    });

    it('uses Chinese select-option translations and localizes known technical values', () => {
        const options = configurableArgumentOptions(
            argument({
                name: 'includesTax',
                ui: {
                    component: 'select-form-input',
                    options: [
                        {
                            value: 'include',
                            label: [
                                { languageCode: 'en', value: 'Tax included' },
                                { languageCode: 'zh_Hans', value: '金额含税' },
                            ],
                        },
                        { value: 'auto', label: 'Follow channel' },
                    ],
                },
            }),
        );

        expect(options).toEqual([
            { value: 'include', label: '金额含税' },
            { value: 'auto', label: '跟随店铺设置' },
        ]);
    });

    it('converts list parameters between stored arrays and one-item-per-line form values', () => {
        expect(configurableListValueForDisplay('["sku-1","sku-2"]')).toBe('sku-1\nsku-2');
        expect(serializeConfigurableListValue('sku-1\nsku-2', 'ID')).toBe('["sku-1","sku-2"]');
        expect(serializeConfigurableListValue('1\n2', 'int')).toBe('[1,2]');
        expect(() => serializeConfigurableListValue('1.5', 'int')).toThrow('不是有效整数');
    });
});
