import { StorefrontContentBlock, StorefrontLanguage } from './types';

export type AuthVisualVariant = 'login' | 'register';

export interface AuthVisualMessage {
    eyebrow: string;
    title: string;
    description: string;
    tags: string[];
}

const managedType: Record<AuthVisualVariant, StorefrontContentBlock['type']> = {
    login: 'AUTH_LOGIN',
    register: 'AUTH_REGISTER',
};

const defaults: Record<AuthVisualVariant, Record<StorefrontLanguage, AuthVisualMessage>> = {
    login: {
        zh: {
            eyebrow: 'AI 软件精选平台',
            title: '登录你的 AI 新世界',
            description: '创作、编程与办公工具，一站高效管理',
            tags: ['AI 创作', '开发提效', '智能办公'],
        },
        en: {
            eyebrow: 'CURATED AI SOFTWARE',
            title: 'Enter your AI universe',
            description: 'Create, code and work with the right tools in one place',
            tags: ['AI Creation', 'Development', 'Productivity'],
        },
    },
    register: {
        zh: {
            eyebrow: '构建你的 AI 工作流',
            title: '创建专属 AI 效率中心',
            description: '发现常用工具，统一管理收藏与订单',
            tags: ['工具发现', '收藏管理', '订单管理'],
        },
        en: {
            eyebrow: 'BUILD YOUR AI WORKFLOW',
            title: 'Create your AI productivity hub',
            description: 'Discover tools and manage favorites and orders in one place',
            tags: ['Discover', 'Favorites', 'Orders'],
        },
    },
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
    const fallback = defaults[variant][language];
    const tags =
        content?.items
            .map(item => item.label.trim())
            .filter(Boolean)
            .slice(0, 3) ?? [];
    return {
        eyebrow: content?.ctaLabel.trim() || fallback.eyebrow,
        title: content?.title.trim() || fallback.title,
        description: content?.subtitle.trim() || fallback.description,
        tags: tags.length === 3 ? tags : fallback.tags,
    };
}

export function authVisualAccentColor(
    content: StorefrontContentBlock | undefined,
    variant: AuthVisualVariant,
): string {
    const accent = content?.settings?.accentColor;
    if (typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent)) return accent;
    return variant === 'login' ? '#67e8f9' : '#fdba74';
}

export function authVisualOverlayColor(content: StorefrontContentBlock | undefined): string {
    const background = content?.backgroundColor;
    return typeof background === 'string' && /^#[0-9a-f]{6}$/i.test(background) ? background : '#0B1E2D';
}
