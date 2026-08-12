import { LanguageCode } from '@vendure/common/lib/generated-types';

import { ShippingEligibilityChecker } from './shipping-eligibility-checker';

export const defaultShippingEligibilityChecker = new ShippingEligibilityChecker({
    code: 'default-shipping-eligibility-checker',
    description: [
        { languageCode: LanguageCode.en, value: 'Require a minimum order subtotal' },
        { languageCode: LanguageCode.zh_Hans, value: '订单商品小计达到指定金额' },
    ],
    args: {
        orderMinimum: {
            type: 'int',
            defaultValue: 0,
            ui: { component: 'currency-form-input' },
            label: [
                { languageCode: LanguageCode.en, value: 'Minimum tax-inclusive merchandise subtotal' },
                { languageCode: LanguageCode.zh_Hans, value: '最低含税商品小计' },
            ],
            description: [
                {
                    languageCode: LanguageCode.en,
                    value: 'This shipping method is available when the tax-inclusive merchandise subtotal reaches this amount.',
                },
                {
                    languageCode: LanguageCode.zh_Hans,
                    value: '订单含税商品小计达到此金额后，才可使用该配送方式。',
                },
            ],
        },
    },
    check: (ctx, order, args) => {
        return order.subTotalWithTax >= args.orderMinimum;
    },
});
