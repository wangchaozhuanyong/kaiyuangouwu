import { ContentBlock, ContentBlockTranslation, ContentItem } from './storefront-content.graphql';

export const MAX_NAVIGATION_ITEMS = 5;

export const navigationTargetOptions = [
    { value: '/', zh: '首页', en: 'Home' },
    { value: '/category', zh: '商品分类', en: 'Categories' },
    { value: '/services', zh: '商业服务', en: 'Business services' },
    { value: '/search', zh: '搜索', en: 'Search' },
    { value: '/cart', zh: '购物车', en: 'Cart' },
    { value: '/account', zh: '个人中心', en: 'Account' },
    { value: '/orders', zh: '我的订单', en: 'Orders' },
    { value: '/coupons', zh: '优惠券中心', en: 'Coupons' },
    { value: '/favorites', zh: '我的收藏', en: 'Favorites' },
    { value: '/history', zh: '浏览足迹', en: 'History' },
    { value: '/notifications', zh: '消息中心', en: 'Notifications' },
    { value: '/announcements', zh: '系统公告', en: 'Announcements' },
    { value: '/support', zh: '客服中心', en: 'Support' },
    { value: '/reviews', zh: '评价中心', en: 'Reviews' },
] as const;

function translation(languageCode: 'zh_Hans' | 'en', label = ''): ContentItem['translations'][number] {
    return { languageCode, label, description: '' };
}

function navigationItem(
    position: number,
    targetValue: string,
    labelZh: string,
    labelEn: string,
): ContentItem {
    return {
        enabled: true,
        position,
        imageAsset: null,
        imageAssetId: null,
        imageUrl: null,
        targetType: 'PAGE',
        targetValue,
        settings: null,
        translations: [translation('zh_Hans', labelZh), translation('en', labelEn)],
    };
}

export function createDefaultNavigationItems(): ContentItem[] {
    return [
        navigationItem(0, '/', '首页', 'Home'),
        navigationItem(1, '/category', '商品', 'Shop'),
        navigationItem(2, '/services', '商业服务', 'Services'),
        navigationItem(3, '/cart', '购物车', 'Cart'),
        navigationItem(4, '/account', '我的', 'Account'),
    ];
}

export function createEmptyNavigationItem(position: number): ContentItem {
    return navigationItem(position, '/', '', '');
}

function blockTranslation(languageCode: 'zh_Hans' | 'en', title: string): ContentBlockTranslation {
    return { languageCode, title, subtitle: '', body: '', ctaLabel: '' };
}

function normalizedTranslations<T extends { languageCode: 'zh_Hans' | 'en' }>(
    values: T[],
    empty: (languageCode: 'zh_Hans' | 'en') => T,
): T[] {
    return (['zh_Hans', 'en'] as const).map(languageCode => ({
        ...empty(languageCode),
        ...values.find(value => value.languageCode === languageCode),
        languageCode,
    }));
}

export function createNavigationDraft(block?: ContentBlock): ContentBlock {
    if (!block) {
        return {
            code: 'storefront-navigation',
            internalName: '客户端导航',
            type: 'NAVIGATION',
            layoutVariant: 'ICON_GRID',
            enabled: true,
            position: 10_000,
            startsAt: null,
            endsAt: null,
            imageAsset: null,
            imageAssetId: null,
            imageUrl: null,
            backgroundColor: null,
            textColor: null,
            targetType: 'NONE',
            targetValue: null,
            settings: { version: 1 },
            translations: [
                blockTranslation('zh_Hans', '客户端导航'),
                blockTranslation('en', 'Storefront navigation'),
            ],
            items: createDefaultNavigationItems(),
        };
    }
    return {
        ...block,
        code: 'storefront-navigation',
        type: 'NAVIGATION',
        layoutVariant: 'ICON_GRID',
        enabled: true,
        translations: normalizedTranslations(block.translations, languageCode =>
            blockTranslation(
                languageCode,
                languageCode === 'zh_Hans' ? '客户端导航' : 'Storefront navigation',
            ),
        ),
        items: block.items
            .slice(0, MAX_NAVIGATION_ITEMS)
            .sort((left, right) => left.position - right.position)
            .map((item, index) => ({
                ...item,
                enabled: true,
                position: index,
                targetType: 'PAGE',
                translations: normalizedTranslations(item.translations, languageCode =>
                    translation(languageCode),
                ),
            })),
    };
}

export function moveNavigationItem(items: ContentItem[], fromIndex: number, toIndex: number): ContentItem[] {
    if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= items.length ||
        toIndex >= items.length ||
        fromIndex === toIndex
    ) {
        return items;
    }
    const next = [...items];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next.map((item, index) => ({ ...item, position: index }));
}

export function navigationDraftIsValid(block: ContentBlock): boolean {
    return (
        block.items.length >= 1 &&
        block.items.length <= MAX_NAVIGATION_ITEMS &&
        block.items.every(item => {
            const chineseLabel = item.translations
                .find(value => value.languageCode === 'zh_Hans')
                ?.label.trim();
            return (
                Boolean(chineseLabel) &&
                item.targetType === 'PAGE' &&
                navigationTargetOptions.some(option => option.value === item.targetValue)
            );
        })
    );
}

export function navigationBlockInput(block: ContentBlock) {
    return {
        code: 'storefront-navigation',
        internalName: '客户端导航',
        type: 'NAVIGATION' as const,
        layoutVariant: 'ICON_GRID' as const,
        enabled: true,
        position: block.position,
        startsAt: null,
        endsAt: null,
        imageAssetId: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE' as const,
        targetValue: null,
        settings: { ...(block.settings ?? {}), version: 1 },
        translations: block.translations
            .map(({ languageCode, title, subtitle, body, ctaLabel }) => ({
                languageCode,
                title: title.trim(),
                subtitle: subtitle.trim(),
                body: body.trim(),
                ctaLabel: ctaLabel.trim(),
            }))
            .filter(value => Boolean(value.title)),
        items: block.items.map((item, index) => ({
            ...(item.id ? { id: item.id } : {}),
            enabled: true,
            position: index,
            imageAssetId: item.imageAsset?.id ?? item.imageAssetId ?? null,
            ...(item.imageAsset?.id || item.imageAssetId ? { imageUrl: item.imageUrl?.trim() || null } : {}),
            targetType: 'PAGE' as const,
            targetValue: item.targetValue,
            settings: item.settings,
            translations: item.translations
                .map(({ languageCode, label, description }) => ({
                    languageCode,
                    label: label.trim(),
                    description: description.trim(),
                }))
                .filter(value => Boolean(value.label)),
        })),
    };
}
