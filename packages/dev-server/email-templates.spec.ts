import { FileBasedTemplateLoader, HandlebarsMjmlGenerator } from '@vendure/email-plugin';
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { ACCOUNT_TOKEN_EXPIRY_HOURS, buildAccountActionUrl } from './account-auth';
import { emailLanguageVariables } from './email-localization';

const templatePath = path.join(__dirname, 'email-templates');
const templateLoader = new FileBasedTemplateLoader(templatePath);
const generator = new HandlebarsMjmlGenerator();

beforeAll(async () => {
    await generator.onInit({ templateLoader } as never);
});

async function renderTemplate(
    type: string,
    languageCode: string,
    digitalOrder = false,
    containsDigitalProducts = digitalOrder,
) {
    const template = await fs.readFile(path.join(templatePath, type, 'body.hbs'), 'utf8');
    const templateVars = {
        ...emailLanguageVariables(languageCode, {
            storefrontNameZh: '测试店铺',
            storefrontNameEn: 'Test Store',
        }),
        accountTokenExpiryHours: ACCOUNT_TOKEN_EXPIRY_HOURS,
        verifyEmailAddressActionUrl: buildAccountActionUrl(
            'https://shop.example.com/#/verify-account',
            'verify+token',
        ),
        passwordResetActionUrl: buildAccountActionUrl(
            'https://shop.example.com/#/reset-password',
            'reset+token',
        ),
        changeEmailAddressActionUrl: buildAccountActionUrl(
            'https://shop.example.com/#/change-email-address',
            'change+token',
        ),
        isDigitalOrder: digitalOrder,
        containsDigitalProducts,
        digitalDeliveryActionUrl: containsDigitalProducts
            ? 'https://shop.example.com/#/order-confirmation?id=ORDER-1001&token=signed%2Btoken'
            : undefined,
        order: {
            code: 'ORDER-1001',
            currencyCode: 'USD',
            totalWithTax: 2599,
            subTotalWithTax: 1999,
            customer: { firstName: 'Alex', lastName: 'Chen' },
            shippingAddress: digitalOrder
                ? {}
                : {
                      fullName: 'Alex Chen',
                      streetLine1: '1 Market Street',
                      city: 'San Francisco',
                      province: 'California',
                      postalCode: '94105',
                      country: 'United States',
                      phoneNumber: '555-0100',
                  },
            lines: [
                {
                    quantity: 1,
                    discountedLinePriceWithTax: 1999,
                    productVariant: { name: 'Travel mug' },
                },
            ],
        },
        shippingLines: digitalOrder
            ? []
            : [
                  {
                      priceWithTax: 600,
                      shippingMethod: {
                          name: languageCode === 'zh_Hans' ? '标准配送' : 'Standard shipping',
                      },
                  },
              ],
    };

    return generator.generate('store@example.com', 'Subject', template, templateVars);
}

describe('localized email templates', () => {
    it.each([
        ['auto-card-delivery', 'zh_Hans', '您的数字商品可以领取了', '打开订单领取'],
        ['auto-card-delivery', 'en', 'Your digital item is ready', 'Open order to claim'],
        ['manual-digital-delivery', 'zh_Hans', '您的数字商品可以领取了', '打开订单领取'],
        ['manual-digital-delivery', 'en', 'Your digital item is ready', 'Open order to claim'],
    ])(
        'renders only a safe receipt notification for %s in %s',
        async (type, languageCode, heading, action) => {
            const template = await fs.readFile(path.join(templatePath, type, 'body.hbs'), 'utf8');
            const result = await generator.generate('store@example.invalid', 'Subject', template, {
                ...emailLanguageVariables(languageCode, {
                    storefrontNameZh: '测试店铺',
                    storefrontNameEn: 'Test Store',
                }),
                orderCode: 'SYNTHETIC-2002',
                productName: 'Synthetic digital product',
                receiptUrl:
                    'https://shop.example.invalid/order-confirmation?id=SYNTHETIC-2002&token=dummy-proof',
                // A stale queue might still contain these. Rendering must never include them.
                credentials: [{ rawPayload: 'dummy-private-content' }],
                packages: [
                    {
                        note: 'dummy-private-note',
                        fields: [{ label: 'dummy', value: 'dummy-private-value' }],
                    },
                ],
                attachments: [{ filename: 'dummy-private-file.txt' }],
            });
            expect(result.body).toContain(heading);
            expect(result.body).toContain(action);
            expect(result.body).toContain('/order-confirmation?id&#x3D;SYNTHETIC-2002');
            expect(result.body).not.toContain('dummy-private');
        },
    );

    it.each([
        ['email-verification', '感谢您注册', '验证电子邮箱'],
        ['password-reset', '重置您账户密码', '重置密码'],
        ['email-address-change', '更改为当前地址', '验证新的电子邮箱'],
        ['order-confirmation', '订单已经确认', '订单明细'],
    ])('renders the %s template in Chinese', async (type, bodyCopy, actionCopy) => {
        const result = await renderTemplate(type, 'zh_Hans');

        expect(result.body).toContain('lang="zh-CN"');
        expect(result.body).toContain('测试店铺');
        expect(result.body).toContain(bodyCopy);
        expect(result.body).toContain(actionCopy);
    });

    it.each([
        ['email-verification', 'Thank you for creating', 'Verify email address'],
        ['password-reset', 'reset your account password', 'Reset password'],
        ['email-address-change', 'change your account email address', 'Verify new email address'],
        ['order-confirmation', 'Your order is confirmed', 'Order summary'],
    ])('renders the %s template in English', async (type, bodyCopy, actionCopy) => {
        const result = await renderTemplate(type, 'en');

        expect(result.body).toContain('lang="en"');
        expect(result.body).toContain('Test Store');
        expect(result.body).toContain(bodyCopy);
        expect(result.body).toContain(actionCopy);
        expect(result.body).not.toContain('明集市');
    });

    it('renders encoded account action tokens and their expiry', async () => {
        const verification = await renderTemplate('email-verification', 'en');
        const passwordReset = await renderTemplate('password-reset', 'zh_Hans');

        expect(verification.body).toContain('token&#x3D;verify%2Btoken');
        expect(verification.body).toContain(`${ACCOUNT_TOKEN_EXPIRY_HOURS} hours`);
        expect(passwordReset.body).toContain('token&#x3D;reset%2Btoken');
        expect(passwordReset.body).toContain(`${ACCOUNT_TOKEN_EXPIRY_HOURS} 小时`);
    });

    it('includes secure digital delivery and a shipping address for a mixed order', async () => {
        const result = await renderTemplate('order-confirmation', 'zh_Hans', false, true);

        expect(result.body).toContain('数字订单已进入处理流程');
        expect(result.body).toContain('查看订单与交付进度');
        expect(result.body).toContain('收货地址');
        expect(result.body).toContain('1 Market Street');
    });

    it.each([
        ['zh_Hans', '数字订单已进入处理流程', '查看订单与交付进度'],
        ['en', 'Your digital order is being processed', 'View order and delivery status'],
    ])('renders the secure digital delivery entry in %s', async (languageCode, heading, action) => {
        const result = await renderTemplate('order-confirmation', languageCode, true);

        expect(result.body).toContain(heading);
        expect(result.body).toContain(action);
        expect(result.body).toContain('token&#x3D;signed%2Btoken');
        expect(result.body).not.toContain('1 Market Street');
        expect(result.body).not.toContain('Alex Chen');
    });
});
