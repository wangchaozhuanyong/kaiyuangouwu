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

const defaults: Record<AuthVisualVariant, Record<StorefrontLanguage, AuthVisualMessage>> = {
    login: {
        zh: {
            eyebrow: 'AI 软件服务平台',
            title: '你的 AI 工具，一处购买与管理',
            description: '汇集全球优质 AI 软件与服务，让 AI 洞察个人的工作与生活效率',
            tags: ['主流工具精选', '订单统一管理', '售后服务可查'],
            benefits: [
                { title: '主流工具精选', description: '覆盖常用 AI 软件与服务' },
                { title: '订单统一管理', description: '购买记录与状态清晰可查' },
                { title: '售后服务可查', description: '售后入口与处理进度可查' },
            ],
            serviceTypes: ['AI 软件', '数字商品', '人工服务', '售后支持'],
        },
        en: {
            eyebrow: 'AI SOFTWARE SERVICES',
            title: 'All your AI tools, managed in one place',
            description: 'Discover trusted AI software and manage purchases, subscriptions and support',
            tags: ['Curated tools', 'Order management', 'Dedicated support'],
            benefits: [
                { title: 'Curated tools', description: 'Explore useful AI software and services' },
                { title: 'Order management', description: 'Keep purchases and statuses in one place' },
                { title: 'After-sales support', description: 'Track support entry points and progress' },
            ],
            serviceTypes: ['AI software', 'Digital products', 'Human services', 'After-sales'],
        },
    },
    register: {
        zh: {
            eyebrow: 'AI 软件服务平台',
            title: '创建达码通账号',
            description: '一个账号，统一管理 AI 软件、订阅服务、订单与售后',
            tags: ['安全可靠', '快速上手', '服务可查'],
            benefits: [
                { title: '安全可靠', description: '保护账户与订单信息' },
                { title: '快速上手', description: '验证邮箱即可开始使用' },
                { title: '服务可查', description: '订单与售后状态清晰可查' },
            ],
            serviceTypes: [],
        },
        en: {
            eyebrow: 'AI SOFTWARE SERVICES',
            title: 'Create your Damatong account',
            description: 'Manage AI software, subscriptions, orders and support with one account',
            tags: ['Secure', 'Get started fast', 'Track service'],
            benefits: [
                { title: 'Secure', description: 'Protect your account and order information' },
                { title: 'Get started fast', description: 'Verify your email and get started' },
                { title: 'Track service', description: 'Keep order and after-sales status visible' },
            ],
            serviceTypes: [],
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
    const benefits = fallback.benefits.map((fallbackBenefit, index) => {
        const item = content?.items[index];
        return {
            title: item?.label.trim() || fallbackBenefit.title,
            description: item?.description.trim() || fallbackBenefit.description,
        };
    });
    return {
        eyebrow: content?.ctaLabel.trim() || fallback.eyebrow,
        title: content?.title.trim() || fallback.title,
        description: content?.subtitle.trim() || fallback.description,
        tags: benefits.map(benefit => benefit.title),
        benefits,
        serviceTypes: fallback.serviceTypes,
    };
}

export function authVisualAccentColor(
    content: StorefrontContentBlock | undefined,
    variant: AuthVisualVariant,
): string {
    const accent = content?.settings?.accentColor;
    if (typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent)) return accent;
    return variant === 'login' ? '#4fdcff' : '#60a5fa';
}

export function authVisualOverlayColor(content: StorefrontContentBlock | undefined): string {
    const background = content?.backgroundColor;
    return typeof background === 'string' && /^#[0-9a-f]{6}$/i.test(background) ? background : '#0B1E2D';
}
