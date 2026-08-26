import type { ContentBlock, ContentBlockType } from './storefront-content.graphql';

export const fixedHomepageModuleTypes = [
    'HERO',
    'NOTICE',
    'QUICK_LINKS',
    'CORE_CATEGORIES',
    'CATEGORY_AD',
    'FEATURED_COLLECTION',
    'COUPONS',
    'FLASH_SALE',
    'BEST_SELLERS',
    'RECOMMENDATIONS',
    'STORY',
    'TRUST_BAR',
] as const satisfies readonly ContentBlockType[];

export type FixedHomepageModuleType = (typeof fixedHomepageModuleTypes)[number];

export interface HomepageModuleDescriptor {
    type: FixedHomepageModuleType;
    labelZh: string;
    labelEn: string;
    descriptionZh: string;
    descriptionEn: string;
    defaultPosition: number;
    defaultEnabled: boolean;
    settingsPath?: string;
    settingsLabelZh?: string;
    settingsLabelEn?: string;
    allowsMultipleRecords?: boolean;
}

export const homepageModuleRegistry: readonly HomepageModuleDescriptor[] = [
    {
        type: 'HERO',
        labelZh: '首页主视觉',
        labelEn: 'Homepage hero',
        descriptionZh: '固定轮播版式，单独管理图片、文案、跳转和播放速度。',
        descriptionEn: 'Fixed carousel layout with dedicated slide and autoplay settings.',
        defaultPosition: 10,
        defaultEnabled: true,
        settingsPath: '/storefront-carousel',
        settingsLabelZh: '管理轮播',
        settingsLabelEn: 'Manage carousel',
        allowsMultipleRecords: true,
    },
    {
        type: 'NOTICE',
        labelZh: '公告',
        labelEn: 'Notice',
        descriptionZh: '固定公告条样式，可设置多条公告和滚动间隔。',
        descriptionEn: 'Fixed notice strip with multiple messages and rotation timing.',
        defaultPosition: 20,
        defaultEnabled: true,
    },
    {
        type: 'QUICK_LINKS',
        labelZh: '快捷入口',
        labelEn: 'Quick links',
        descriptionZh: '固定快捷入口样式，可设置入口名称、图标和跳转。',
        descriptionEn: 'Fixed shortcut layout with configurable labels, icons and targets.',
        defaultPosition: 30,
        defaultEnabled: true,
    },
    {
        type: 'CORE_CATEGORIES',
        labelZh: '核心品类双卡片',
        labelEn: 'Core category cards',
        descriptionZh: '固定双卡片版式，选择两个核心分类或集合。',
        descriptionEn: 'Fixed two-card layout for key categories or collections.',
        defaultPosition: 40,
        defaultEnabled: false,
    },
    {
        type: 'CATEGORY_AD',
        labelZh: '分类广告',
        labelEn: 'Category promotion',
        descriptionZh: '固定“分类主视觉 + 商品卡”版式，配置图片、分类跳转并选择最多 4 个商品。',
        descriptionEn:
            'Fixed category visual plus product-card layout with an image, category destination and up to four products.',
        defaultPosition: 50,
        defaultEnabled: false,
    },
    {
        type: 'FEATURED_COLLECTION',
        labelZh: '推荐集合',
        labelEn: 'Featured collection',
        descriptionZh: '独立策展版式：左侧展示集合主题与入口，右侧横向陈列管理员精选的商品。',
        descriptionEn:
            'Editorial collection layout with a themed introduction and a horizontal rail of selected products.',
        defaultPosition: 60,
        defaultEnabled: false,
    },
    {
        type: 'COUPONS',
        labelZh: '优惠券专区',
        labelEn: 'Coupon area',
        descriptionZh: '固定优惠券票面，自动同步当前可领取的优惠券活动。',
        descriptionEn: 'Fixed coupon cards synchronized with currently claimable campaigns.',
        defaultPosition: 70,
        defaultEnabled: true,
        settingsPath: '/store-coupons',
        settingsLabelZh: '管理优惠券',
        settingsLabelEn: 'Manage coupons',
    },
    {
        type: 'FLASH_SALE',
        labelZh: '限时秒杀',
        labelEn: 'Flash sale',
        descriptionZh: '固定秒杀版式，自动同步当前进行中的秒杀活动。',
        descriptionEn: 'Fixed flash-sale layout synchronized with active sale campaigns.',
        defaultPosition: 80,
        defaultEnabled: true,
        settingsPath: '/store-flash-sales',
        settingsLabelZh: '管理秒杀',
        settingsLabelEn: 'Manage flash sales',
    },
    {
        type: 'BEST_SELLERS',
        labelZh: '热门商品',
        labelEn: 'Best sellers',
        descriptionZh:
            '点击右侧铅笔设置数量和置顶商品：置顶商品优先，其余按当前店铺已下单且未取消订单的累计销量补齐；无销量时每日固定随机，售罄商品也可能展示。',
        descriptionEn: [
            'Use the pencil to set the count and pinned products.',
            'Pinned items come first; remaining slots use cumulative sales from placed, non-cancelled orders in this store.',
            'If all sales are zero, order is randomized daily; out-of-stock items can appear.',
        ].join(' '),
        defaultPosition: 90,
        defaultEnabled: true,
    },
    {
        type: 'RECOMMENDATIONS',
        labelZh: '猜你喜欢',
        labelEn: 'Recommendations',
        descriptionZh:
            '点击右侧铅笔设置数量。系统按登录用户最近 5 个订单和当前店铺最近 20 个浏览商品的分类推荐，购买同类优先于浏览同类，并优先未看过的商品；无记录时每日固定随机，暂不支持人工指定商品。',
        descriptionEn: [
            'Use the pencil to set the count.',
            "Recommendations use categories from the signed-in customer's five most recent orders",
            'and up to 20 products recently viewed in this store.',
            'Purchased categories outrank viewed categories, unseen products come first,',
            'and no-history results are randomized daily. Manual product selection is not currently supported.',
        ].join(' '),
        defaultPosition: 100,
        defaultEnabled: true,
    },
    {
        type: 'STORY',
        labelZh: '内容故事',
        labelEn: 'Content story',
        descriptionZh: '独立图文叙事版式：大幅场景图搭配标题、正文和阅读入口，用于品牌与服务介绍。',
        descriptionEn:
            'Editorial split layout pairing a large visual with story copy and a reading destination.',
        defaultPosition: 110,
        defaultEnabled: false,
    },
    {
        type: 'TRUST_BAR',
        labelZh: '服务保障栏',
        labelEn: 'Service guarantees',
        descriptionZh: '固定服务保障样式，可设置保障项目文案。',
        descriptionEn: 'Fixed service guarantee strip with configurable messages.',
        defaultPosition: 120,
        defaultEnabled: true,
    },
];

export interface HomepageLayoutEntry {
    key: string;
    type: FixedHomepageModuleType | 'CUSTOM';
    descriptor?: HomepageModuleDescriptor;
    blocks: ContentBlock[];
    block?: ContentBlock;
    fixed: boolean;
    enabled: boolean;
    position: number;
    duplicateCount: number;
}

const fixedTypeSet = new Set<ContentBlockType>(fixedHomepageModuleTypes);

export function isFixedHomepageModuleType(type: ContentBlockType): type is FixedHomepageModuleType {
    return fixedTypeSet.has(type);
}

export function homepageLayoutEntries(blocks: ContentBlock[]): HomepageLayoutEntry[] {
    const fixedEntries = homepageModuleRegistry.map(descriptor => {
        const matchingBlocks = blocks
            .filter(candidateBlock => candidateBlock.type === descriptor.type)
            .sort((a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id)));
        const block = matchingBlocks[0];
        return {
            key: `fixed:${descriptor.type}`,
            type: descriptor.type,
            descriptor,
            blocks: matchingBlocks,
            block,
            fixed: true,
            enabled: matchingBlocks.length
                ? matchingBlocks.some(candidate => candidate.enabled)
                : descriptor.defaultEnabled,
            position: block?.position ?? descriptor.defaultPosition,
            duplicateCount: descriptor.allowsMultipleRecords ? 0 : Math.max(0, matchingBlocks.length - 1),
        } satisfies HomepageLayoutEntry;
    });
    const customEntries = blocks
        .filter(block => block.type === 'CUSTOM')
        .map(
            block =>
                ({
                    key: `custom:${block.id ?? block.code}`,
                    type: 'CUSTOM',
                    blocks: [block],
                    block,
                    fixed: false,
                    enabled: block.enabled,
                    position: block.position,
                    duplicateCount: 0,
                }) satisfies HomepageLayoutEntry,
        );

    return [...fixedEntries, ...customEntries].sort(
        (a, b) => a.position - b.position || defaultOrder(a) - defaultOrder(b) || a.key.localeCompare(b.key),
    );
}

export function reorderedHomepageBlockIds(
    entries: HomepageLayoutEntry[],
    entryKey: string,
    direction: -1 | 1,
    allBlocks: ContentBlock[] = entries.flatMap(entry => entry.blocks),
): string[] {
    const index = entries.findIndex(entry => entry.key === entryKey);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= entries.length) {
        return completeHomepageBlockOrder(entries, allBlocks);
    }
    const reordered = [...entries];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    return completeHomepageBlockOrder(reordered, allBlocks);
}

export function movedHomepageBlockIds(
    entries: HomepageLayoutEntry[],
    entryKey: string,
    targetKey: string,
    allBlocks: ContentBlock[] = entries.flatMap(entry => entry.blocks),
): string[] {
    const fromIndex = entries.findIndex(entry => entry.key === entryKey);
    const targetIndex = entries.findIndex(entry => entry.key === targetKey);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
        return completeHomepageBlockOrder(entries, allBlocks);
    }
    const reordered = [...entries];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    return completeHomepageBlockOrder(reordered, allBlocks);
}

export function persistedHomepageBlockIds(entries: HomepageLayoutEntry[]): string[] {
    return entries.flatMap(entry => entry.blocks.flatMap(block => (block.id ? [block.id] : [])));
}

export function completeHomepageBlockOrder(
    entries: HomepageLayoutEntry[],
    allBlocks: ContentBlock[],
): string[] {
    const homepageIds = persistedHomepageBlockIds(entries);
    const homepageIdSet = new Set(homepageIds);
    let homepageIndex = 0;
    return allBlocks.flatMap(block => {
        if (!block.id) return [];
        if (!homepageIdSet.has(block.id)) return [block.id];
        const nextId = homepageIds[homepageIndex];
        homepageIndex += 1;
        return nextId ? [nextId] : [];
    });
}

function defaultOrder(entry: HomepageLayoutEntry): number {
    if (!entry.fixed) return Number.MAX_SAFE_INTEGER;
    return homepageModuleRegistry.findIndex(module => module.type === entry.type);
}
