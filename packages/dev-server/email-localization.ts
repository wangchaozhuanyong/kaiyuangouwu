export interface LocalizedEmailText {
    zh: string;
    en: string;
}

export interface StorefrontNameFields {
    storefrontNameZh?: string | null;
    storefrontNameEn?: string | null;
}

export const localizedEmailSubjects: Readonly<Record<string, LocalizedEmailText>> = {
    'order-confirmation': {
        zh: '订单确认 #{{ order.code }}',
        en: 'Order confirmation for #{{ order.code }}',
    },
    'email-verification': {
        zh: '请验证您的电子邮箱',
        en: 'Please verify your email address',
    },
    'password-reset': {
        zh: '重置您的登录密码',
        en: 'Reset your account password',
    },
    'email-address-change': {
        zh: '请验证新的电子邮箱',
        en: 'Please verify your new email address',
    },
};

export function isChineseEmail(languageCode: string): boolean {
    return languageCode === 'zh_Hans';
}

export function localizedEmailText(text: LocalizedEmailText, languageCode: string): string {
    return isChineseEmail(languageCode) ? text.zh : text.en;
}

export function emailLanguageVariables(languageCode: string, names: StorefrontNameFields = {}) {
    const isChinese = isChineseEmail(languageCode);
    const configuredBrandName = isChinese ? names.storefrontNameZh : names.storefrontNameEn;

    return {
        isChinese,
        emailLanguage: isChinese ? 'zh-CN' : 'en',
        emailLocale: isChinese ? 'zh-CN' : 'en-US',
        brandName: configuredBrandName?.trim() || (isChinese ? '云桥Ai' : 'Yunqiao Ai'),
    };
}
