import { StorefrontContentBlock, StorefrontLanguage } from './types';

export type AuthVisualVariant = 'login' | 'register';

export interface AuthVisualBenefit {
    title: string;
    description: string;
}

export interface AuthVisualMessage {
    eyebrow: string;
    title: string;
    description: string;
    tags: string[];
    benefits: AuthVisualBenefit[];
    serviceTypes: string[];
}

const managedType: Record<AuthVisualVariant, StorefrontContentBlock['type']> = {
    login: 'AUTH_LOGIN',
    register: 'AUTH_REGISTER',
};

export function findAuthVisualContent(
    blocks: StorefrontContentBlock[],
    variant: AuthVisualVariant,
): StorefrontContentBlock | undefined {
    return blocks.find(block => block.type === managedType[variant]);
}

export function resolveAuthVisualMessage(
    content: StorefrontContentBlock | undefined,
    variant: AuthVisualVariant,
    language: StorefrontLanguage,
): AuthVisualMessage {
    const benefits = (content?.items ?? []).map(item => ({
        title: item.label.trim(),
        description: item.description.trim(),
    }));
    return {
        eyebrow: content ? content.ctaLabel.trim() : '',
        title: content
            ? content.title.trim()
            : language === 'zh'
              ? variant === 'login'
                  ? '登录账号'
                  : '创建账号'
              : variant === 'login'
                ? 'Sign in'
                : 'Create an account',
        description: content ? content.subtitle.trim() : '',
        tags: benefits.map(benefit => benefit.title),
        benefits,
        serviceTypes: [],
    };
}

export function authVisualAccentColor(
    content: StorefrontContentBlock | undefined,
    variant: AuthVisualVariant,
): string {
    const accent = content?.settings?.accentColor;
    if (typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent)) return accent;
    return variant === 'login' ? '#22D3EE' : '#8B5CF6';
}

export function authVisualOverlayColor(content: StorefrontContentBlock | undefined): string {
    const background = content?.backgroundColor;
    return typeof background === 'string' && /^#[0-9a-f]{6}$/i.test(background) ? background : '#070B14';
}
