export type TranslationProviderFailure =
    'RATE_LIMIT' | 'QUOTA' | 'UNAVAILABLE' | 'CONFIGURATION' | 'INVALID_RESPONSE' | 'TEXT_TOO_LONG';

const messages: Record<TranslationProviderFailure, string> = {
    RATE_LIMIT: '自动翻译暂时限流，请稍后重试；持续失败时请管理员检查翻译服务配额',
    QUOTA: '自动翻译配额已用完，请管理员检查翻译服务配额',
    UNAVAILABLE: '自动翻译服务暂时无法连接，请稍后重试',
    CONFIGURATION: '自动翻译服务配置不可用，请联系管理员检查',
    INVALID_RESPONSE: '自动翻译未返回有效英文，请稍后重试',
    TEXT_TOO_LONG: '英文译文超过此字段的长度限制；中文可正常保存，可缩短中文文案或自行调整英文',
};

export class TranslationProviderError extends Error {
    constructor(readonly code: TranslationProviderFailure) {
        super(messages[code]);
        this.name = 'TranslationProviderError';
    }
}
