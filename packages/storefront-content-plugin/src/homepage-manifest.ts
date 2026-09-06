/** Every store configures the same homepage capabilities. Defaults are editor drafts only. */
export const homepageModuleCatalog = [
    { type: 'HERO', name: '首页主视觉', description: '轮播图、标题、卖点和跳转入口', defaultEnabled: true },
    { type: 'NOTICE', name: '首页公告条', description: '多条短公告自动轮播', defaultEnabled: true },
    { type: 'QUICK_LINKS', name: '快捷入口', description: '常用分类和业务入口', defaultEnabled: true },
    {
        type: 'CORE_CATEGORIES',
        name: '核心品类',
        description: '两个重点品类或集合卡片',
        defaultEnabled: false,
    },
    { type: 'CATEGORY_AD', name: '分类专题', description: '分类主视觉与精选商品', defaultEnabled: false },
    {
        type: 'FEATURED_COLLECTION',
        name: '精选集合',
        description: '策展文案与精选商品横排',
        defaultEnabled: false,
    },
    { type: 'COUPONS', name: '优惠券专区', description: '自动同步当前可领取优惠券', defaultEnabled: true },
    { type: 'FLASH_SALE', name: '限时秒杀', description: '自动同步正在进行的秒杀活动', defaultEnabled: true },
    { type: 'BEST_SELLERS', name: '热门商品', description: '按真实销量和置顶商品展示', defaultEnabled: true },
    { type: 'RECOMMENDATIONS', name: '猜你喜欢', description: '按购买和浏览行为推荐', defaultEnabled: true },
    { type: 'STORY', name: '品牌故事', description: '大图、品牌文案和阅读入口', defaultEnabled: false },
    { type: 'TRUST_BAR', name: '服务保障', description: '配送、售后、支付等保障项', defaultEnabled: true },
] as const;

/** These content floors render independently; only HERO combines multiple records into a carousel. */
export const repeatableHomepageModuleTypes = [
    'CATEGORY_AD',
    'FEATURED_COLLECTION',
    'STORY',
    'CUSTOM',
] as const;
