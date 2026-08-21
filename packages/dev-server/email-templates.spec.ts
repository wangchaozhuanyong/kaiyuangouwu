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

async function renderTemplate(type: string, languageCode: string, digitalOrder = false) {
    const template = await fs.readFile(path.join(templatePath, type, 'body.hbs'), 'utf8');
    const templateVars = {
        ...emailLanguageVariables(languageCode),
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
        digitalDeliveryActionUrl: digitalOrder
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
        ['email-verification', '感谢您注册', '验证电子邮箱'],
        ['password-reset', '重置您账户密码', '重置密码'],
        ['email-address-change', '更改为当前地址', '验证新的电子邮箱'],
        ['order-confirmation', '订单已经确认', '订单明细'],
    ])('renders the %s template in Chinese', async (type, bodyCopy, actionCopy) => {
        const result = await renderTemplate(type, 'zh_Hans');

        expect(result.body).toContain('lang="zh-CN"');
        expect(result.body).toContain('云桥Ai');
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
        expect(result.body).toContain('Yunqiao Ai');
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

    it.each([
        ['zh_Hans', '数字内容已准备', '查看订单并领取'],
        ['en', 'Your digital content is ready', 'View order and collect'],
    ])('renders the secure digital delivery entry in %s', async (languageCode, heading, action) => {
        const result = await renderTemplate('order-confirmation', languageCode, true);

        expect(result.body).toContain(heading);
        expect(result.body).toContain(action);
        expect(result.body).toContain('token&#x3D;signed%2Btoken');
        expect(result.body).not.toContain('1 Market Street');
        expect(result.body).not.toContain('Alex Chen');
    });
});
