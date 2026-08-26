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
            eyebrow: 'AI 软件严选 · 即刻启程',
            title: '一次登录，连接你的 AI 效率宇宙',
            description: '创作、编程与智能办公工具，统一收藏、购买与管理',
            tags: ['灵感创作', '开发提速', '智能办公'],
        },
        en: {
            eyebrow: 'CURATED AI SOFTWARE · READY WHEN YOU ARE',
            title: 'One sign-in. Every AI advantage.',
            description: 'Create, code and work with the right tools in one intelligent hub.',
            tags: ['Create Faster', 'Code Smarter', 'Work Better'],
        },
    },
    register: {
        zh: {
            eyebrow: '开启专属 AI 工作流',
            title: '从今天起，让 AI 成为你的增长引擎',
            description: '汇聚前沿工具与高效服务，打造属于你的智能生产力中心',
            tags: ['精选工具', '专属收藏', '高效管理'],
        },
        en: {
            eyebrow: 'BUILD YOUR AI WORKFLOW',
            title: 'Turn AI into your growth engine',
            description: 'Discover leading tools and build a smarter productivity hub made for you.',
            tags: ['Discover', 'Personalize', 'Grow Faster'],
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
