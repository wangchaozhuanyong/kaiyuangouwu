import { describe, expect, it } from 'vitest';

import { emailLanguageVariables, localizedEmailSubjects, localizedEmailText } from './email-localization';

describe('email localization', () => {
    it('selects Chinese copy and configured channel branding', () => {
        expect(localizedEmailText(localizedEmailSubjects['order-confirmation'], 'zh_Hans')).toBe(
            '订单确认 #{{ order.code }}',
        );
        expect(
            emailLanguageVariables('zh_Hans', {
                storefrontNameZh: ' 云桥精选 ',
                storefrontNameEn: 'Yunqiao Select',
            }),
        ).toEqual({
            isChinese: true,
            emailLanguage: 'zh-CN',
            emailLocale: 'zh-CN',
            brandName: '云桥精选',
        });
    });

    it('uses English for every non-Chinese request and falls back to the default brand', () => {
        expect(localizedEmailText(localizedEmailSubjects['email-verification'], 'en')).toBe(
            'Please verify your email address',
        );
        expect(emailLanguageVariables('en', { storefrontNameEn: '   ' })).toEqual({
            isChinese: false,
            emailLanguage: 'en',
            emailLocale: 'en-US',
            brandName: 'Yunqiao Ai',
        });
    });
});
