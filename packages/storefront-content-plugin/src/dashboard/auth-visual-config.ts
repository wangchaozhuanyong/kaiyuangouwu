import type { ContentBlock, ContentBlockTranslation, ContentItem } from './storefront-content.graphql';

export type AuthVisualBlockType = 'AUTH_LOGIN' | 'AUTH_REGISTER';
export type AuthVisualLanguageCode = 'zh_Hans' | 'en';

interface AuthVisualDefinition {
    type: AuthVisualBlockType;
    code: string;
    internalName: string;
    position: number;
    accentColor: string;
    overlayColor: string;
    textColor: string;
    translations: Record<
        AuthVisualLanguageCode,
        Pick<ContentBlockTranslation, 'title' | 'subtitle' | 'body' | 'ctaLabel'>
    >;
    tags: Record<AuthVisualLanguageCode, string[]>;
}

export const AUTH_VISUAL_DEFINITIONS: Record<AuthVisualBlockType, AuthVisualDefinition> = {
    AUTH_LOGIN: {
        type: 'AUTH_LOGIN',
        code: 'auth-login-visual',
        internalName: '登录页主视觉',
        position: 1000,
        accentColor: '#67e8f9',
        overlayColor: '#020718',
        textColor: '#ffffff',
        translations: {
            zh_Hans: {
                ctaLabel: 'AI 软件精选平台',
                title: '登录你的 AI 新世界',
                subtitle: '创作、编程与办公工具，一站高效管理',
                body: '',
            },
            en: {
                ctaLabel: 'CURATED AI SOFTWARE',
                // i18n-audit-ignore -- paired with the zh_Hans campaign default above
                title: 'Enter your AI universe',
                subtitle: 'Create, code and work with the right tools in one place',
                body: '',
            },
        },
        tags: {
            zh_Hans: ['AI 创作', '开发提效', '智能办公'],
            en: ['AI Creation', 'Development', 'Productivity'],
        },
    },
    AUTH_REGISTER: {
        type: 'AUTH_REGISTER',
        code: 'auth-register-visual',
        internalName: '注册页主视觉',
        position: 1010,
        accentColor: '#fdba74',
        overlayColor: '#16051f',
        textColor: '#ffffff',
        translations: {
            zh_Hans: {
                ctaLabel: '构建你的 AI 工作流',
                title: '创建专属 AI 效率中心',
                subtitle: '发现常用工具，统一管理收藏与订单',
                body: '',
            },
            en: {
                ctaLabel: 'BUILD YOUR AI WORKFLOW',
                // i18n-audit-ignore -- paired with the zh_Hans campaign default above
                title: 'Create your AI productivity hub',
                subtitle: 'Discover tools and manage favorites and orders in one place',
                body: '',
            },
        },
        tags: {
            zh_Hans: ['工具发现', '收藏管理', '订单管理'],
            en: ['Discover', 'Favorites', 'Orders'],
        },
    },
};

function emptyTranslation(
    definition: AuthVisualDefinition,
    languageCode: AuthVisualLanguageCode,
): ContentBlockTranslation {
    return {
        languageCode,
        ...definition.translations[languageCode],
    };
}

function defaultItem(
    definition: AuthVisualDefinition,
    position: number,
    existing?: ContentItem,
): ContentItem {
    return {
        ...existing,
        enabled: true,
        position,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        targetType: 'NONE',
        targetValue: null,
        settings: null,
        translations: (['zh_Hans', 'en'] as const).map(languageCode => ({
            languageCode,
            label:
                existing?.translations.find(translation => translation.languageCode === languageCode)
                    ?.label ?? definition.tags[languageCode][position],
            description: '',
        })),
    };
}

export function createAuthVisualDraft(type: AuthVisualBlockType, existing?: ContentBlock): ContentBlock {
    const definition = AUTH_VISUAL_DEFINITIONS[type];
    return {
        id: existing?.id,
        updatedAt: existing?.updatedAt,
        code: definition.code,
        internalName: definition.internalName,
        type,
        layoutVariant: 'HERO_OVERLAY',
        enabled: existing?.enabled ?? true,
        position: existing?.position ?? definition.position,
        startsAt: null,
        endsAt: null,
        imageAsset: existing?.imageAsset ?? null,
        imageAssetId: existing?.imageAsset?.id ?? existing?.imageAssetId ?? null,
        imageUrl: existing?.imageUrl ?? null,
        backgroundColor: existing?.backgroundColor ?? definition.overlayColor,
        textColor: existing?.textColor ?? definition.textColor,
        targetType: 'NONE',
        targetValue: null,
        settings: {
            ...existing?.settings,
            authVisualVersion: 1,
            accentColor:
                typeof existing?.settings?.accentColor === 'string'
                    ? existing.settings.accentColor
                    : definition.accentColor,
        },
        translations: (['zh_Hans', 'en'] as const).map(languageCode => ({
            ...emptyTranslation(definition, languageCode),
            ...existing?.translations.find(translation => translation.languageCode === languageCode),
            languageCode,
        })),
        items: [0, 1, 2].map(position => defaultItem(definition, position, existing?.items[position])),
    };
}

export function authVisualTranslation(
    block: ContentBlock,
    languageCode: AuthVisualLanguageCode,
): ContentBlockTranslation {
    return (
        block.translations.find(translation => translation.languageCode === languageCode) ??
        emptyTranslation(AUTH_VISUAL_DEFINITIONS[block.type as AuthVisualBlockType], languageCode)
    );
}

export function authVisualAccentColor(block: ContentBlock): string {
    const value = block.settings?.accentColor;
    const fallback = AUTH_VISUAL_DEFINITIONS[block.type as AuthVisualBlockType].accentColor;
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function authVisualInput(block: ContentBlock) {
    return {
        code: block.code,
        internalName: block.internalName,
        type: block.type,
        layoutVariant: 'HERO_OVERLAY' as const,
        enabled: block.enabled,
        position: block.position,
        startsAt: null,
        endsAt: null,
        imageAssetId: block.imageAsset?.id ?? block.imageAssetId ?? null,
        imageUrl: block.imageAsset || block.imageAssetId === null ? null : block.imageUrl,
        backgroundColor: block.backgroundColor,
        textColor: block.textColor,
        targetType: 'NONE' as const,
        targetValue: null,
        settings: block.settings,
        translations: block.translations
            .map(({ languageCode, title, subtitle, body, ctaLabel }) => ({
                languageCode,
                title: title.trim(),
                subtitle: subtitle.trim(),
                body: body.trim(),
                ctaLabel: ctaLabel.trim(),
            }))
            .filter(translation => Boolean(translation.title)),
        items: block.items.map((item, position) => ({
            ...(item.id ? { id: item.id } : {}),
            enabled: true,
            position,
            imageAssetId: null,
            imageUrl: null,
            targetType: 'NONE' as const,
            targetValue: null,
            settings: null,
            translations: item.translations
                .map(({ languageCode, label }) => ({ languageCode, label: label.trim(), description: '' }))
                .filter(translation => Boolean(translation.label)),
        })),
    };
}

export function isAuthVisualValid(block: ContentBlock): boolean {
    const source = authVisualTranslation(block, 'zh_Hans');
    return Boolean(
        source.ctaLabel.trim() &&
        source.title.trim() &&
        source.subtitle.trim() &&
        block.items.length === 3 &&
        block.items.every(item =>
            item.translations.find(translation => translation.languageCode === 'zh_Hans')?.label.trim(),
        ),
    );
}
