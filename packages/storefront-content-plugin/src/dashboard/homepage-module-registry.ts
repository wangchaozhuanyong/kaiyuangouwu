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
        descriptionZh: '固定分类广告版式，配置图片、分类和跳转。',
        descriptionEn: 'Fixed category promotion layout with image and destination settings.',
        defaultPosition: 50,
        defaultEnabled: false,
    },
    {
        type: 'FEATURED_COLLECTION',
        labelZh: '推荐集合',
        labelEn: 'Featured collection',
        descriptionZh: '固定商品集合版式，选择集合或指定商品。',
        descriptionEn: 'Fixed collection layout driven by a collection or selected products.',
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
        descriptionZh: '固定商品列表，按销量自动排序并支持置顶商品。',
        descriptionEn: 'Fixed product list ranked by sales with optional pinned products.',
        defaultPosition: 90,
        defaultEnabled: true,
    },
    {
        type: 'RECOMMENDATIONS',
        labelZh: '猜你喜欢',
        labelEn: 'Recommendations',
        descriptionZh: '固定推荐商品版式，可设置展示数量和指定商品。',
        descriptionEn: 'Fixed recommendation layout with display count and selected products.',
        defaultPosition: 100,
        defaultEnabled: true,
    },
    {
        type: 'STORY',
        labelZh: '内容故事',
        labelEn: 'Content story',
        descriptionZh: '固定图文故事版式，可配置图片、内容和跳转。',
        descriptionEn: 'Fixed editorial story layout with image, copy and destination.',
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
