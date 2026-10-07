import { Injector, RequestContext, TransactionalConnection } from '@vendure/core';
import { FileBasedTemplateLoader, HandlebarsMjmlGenerator } from '@vendure/email-plugin';
import { StorefrontMediaManifestService, StoreProfile } from '@vendure/store-management-plugin';
import fs from 'node:fs/promises';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ACCOUNT_TOKEN_EXPIRY_HOURS, buildAccountActionUrl } from './account-auth';
import {
    storefrontEmailFromAddress,
    storefrontEmailLogoForChannel,
    storefrontEmailLogoUrl,
} from './email-branding';
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
    branding: { fromAddress?: string; brandName?: string; brandLogoUrl?: string } = {},
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

    return generator.generate('{{ fromAddress }}', 'Subject', template, {
        ...templateVars,
        fromAddress: 'store@example.com',
        ...branding,
    });
}

describe('store-owned email branding', () => {
    it('resolves the event channel logo against that store public-media policy', async () => {
        const ctx = { channelId: 'event-channel' } as unknown as RequestContext;
        const findOne = vi.fn().mockResolvedValue({ logoAsset: { source: 'source/store-logo.png' } });
        const getRepository = vi.fn().mockReturnValue({ findOne });
        const isPublic = vi.fn().mockResolvedValue(true);
        const injector = {
            get: (token: unknown) => {
                if (token === TransactionalConnection) return { getRepository };
                if (token === StorefrontMediaManifestService) return { isPublic };
                throw new Error('Unexpected email dependency');
            },
        } as unknown as Injector;

        expect(await storefrontEmailLogoForChannel(ctx, injector, 'https://shop.example.invalid')).toBe(
            'https://shop.example.invalid/assets/source/store-logo.png?preset=storefront-thumbnail-fit-320&format=png',
        );
        expect(getRepository).toHaveBeenCalledExactlyOnceWith(ctx, StoreProfile);
        expect(findOne).toHaveBeenCalledExactlyOnceWith({
            where: { channelId: ctx.channelId },
            relations: { logoAsset: true, logoOnLightAsset: true },
        });
        expect(isPublic).toHaveBeenCalledExactlyOnceWith(
            ctx,
            'shop.example.invalid',
            'source/store-logo.png',
        );
    });

    it('does not prevent notification delivery when the optional channel logo read fails', async () => {
        const findOne = vi.fn().mockRejectedValue(new Error('Optional brand read unavailable'));
        const injector = {
            get: () => ({ getRepository: () => ({ findOne }) }),
        } as unknown as Injector;
        const ctx = { channelId: 'event-channel' } as unknown as RequestContext;
        await expect(
            storefrontEmailLogoForChannel(ctx, injector, 'https://shop.example.invalid'),
        ).resolves.toBeUndefined();
    });

    const configuredFrom = '"Platform sender" <verified@example.invalid>';

    it.each([
        ['zh_Hans', { storefrontNameZh: '店铺甲', storefrontNameEn: 'Shop A' }, '店铺甲'],
        ['zh_Hans', { storefrontNameZh: '店铺乙', storefrontNameEn: 'Shop B' }, '店铺乙'],
        ['en', { storefrontNameZh: '店铺丙', storefrontNameEn: 'Shop C' }, 'Shop C'],
    ])(
        'renders the %s event store name in From without changing the sending address',
        async (language, names, name) => {
            const fromAddress = storefrontEmailFromAddress(configuredFrom, language, names);
            const email = await renderTemplate('order-confirmation', language, false, false, {
                fromAddress,
                brandName: name,
                brandLogoUrl: 'https://shop.example.invalid/assets/preview/own-logo.png',
            });
            expect(email.from).toBe(`"${name}" <verified@example.invalid>`);
            expect(email.body).toContain(name);
            expect(email.body).toContain('https://shop.example.invalid/assets/preview/own-logo.png');
            expect(email.body).not.toContain('Platform sender');
        },
    );

    it('does not invent a brand or reuse the platform display name when the store name is unset', () => {
        expect(storefrontEmailFromAddress(configuredFrom, 'en', {})).toBe('verified@example.invalid');
        expect(
            storefrontEmailFromAddress('verified@example.invalid', 'zh_Hans', { storefrontNameZh: '  ' }),
        ).toBe('verified@example.invalid');
    });

    it('escapes display-name punctuation and removes header control characters', () => {
        const sender = storefrontEmailFromAddress(configuredFrom, 'en', {
            storefrontNameEn: 'Shop "A"\\B\r\nextra',
        });
        expect(sender).toBe('"Shop \\"A\\"\\\\B  extra" <verified@example.invalid>');
        expect(sender).not.toMatch(/[\r\n]/u);
    });

    it.each([
        'a@example.invalid, b@example.invalid',
        'not-a-mailbox',
        'a@example.invalid\r\nBcc: b@example.invalid',
    ])('rejects ambiguous or injected configured sending addresses', from => {
        expect(() => storefrontEmailFromAddress(from, 'en', {})).toThrow('one valid sending mailbox');
    });

    it('uses the Admin light logo only when the current store public-media policy allows it', async () => {
        const isPublic = vi.fn().mockResolvedValue(true);
        const url = await storefrontEmailLogoUrl(
            {
                logoOnLightAsset: { source: 'source/light.svg', preview: 'preview/light.png' },
                logoAsset: { source: 'source/icon.png', preview: 'preview/icon.png' },
            },
            'https://shop.example.invalid',
            isPublic,
        );
        expect(isPublic).toHaveBeenCalledExactlyOnceWith('preview/light.png');
        expect(url).toBe(
            'https://shop.example.invalid/assets/preview/light.png?preset=storefront-thumbnail-fit-320&format=png',
        );
    });

    it('can use the same store standard logo if its light variant is not publicly accessible', async () => {
        const isPublic = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const url = await storefrontEmailLogoUrl(
            {
                logoOnLightAsset: { source: 'source/private-light.svg' },
                logoAsset: { source: '/assets/source/public-icon.svg' },
            },
            'https://shop.example.invalid',
            isPublic,
        );
        expect(url).toContain('/assets/source/public-icon.svg?');
        expect(isPublic.mock.calls).toEqual([['source/private-light.svg'], ['source/public-icon.svg']]);
    });

    it.each([
        'https://other-store.example.invalid/assets/preview/logo.png',
        'https://user:pass@shop.example.invalid/assets/preview/logo.png',
        'data:image/png;base64,AAAA',
        '/private/logo.png',
    ])('omits non-public or cross-store logo URLs', async source => {
        const isPublic = vi.fn().mockResolvedValue(true);
        expect(
            await storefrontEmailLogoUrl({ logoAsset: { source } }, 'https://shop.example.invalid', isPublic),
        ).toBeUndefined();
        expect(isPublic).not.toHaveBeenCalled();
    });

    it('keeps notifications usable without a logo or while its public policy lookup is unavailable', async () => {
        const isPublic = vi.fn().mockRejectedValue(new Error('temporary media lookup failure'));
        expect(await storefrontEmailLogoUrl(null, 'https://shop.example.invalid', isPublic)).toBeUndefined();
        expect(
            await storefrontEmailLogoUrl(
                { logoAsset: { source: 'preview/logo.png' } },
                'https://shop.example.invalid',
                isPublic,
            ),
        ).toBeUndefined();
        const email = await renderTemplate('order-confirmation', 'en');
        expect(email.body).toContain('Test Store');
        expect(email.body).not.toContain('<img');
    });
});

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
