import type { RouteModuleKey } from '../route-modules';
import { getAdminDisplayLanguage } from '../utils/admin-language';

export const ADMIN_NAV_SECTIONS = [
    ['dashboard', '网站总览', 'LayoutDashboard'],
    ['catalog', '商品管理', 'Boxes'],
    ['digital-delivery', '数字交付', 'Boxes'],
    ['physical-inventory', '实物库存', 'Boxes'],
    ['sales', '订单管理', 'ShoppingBag'],
    ['after-sales', '售后管理', 'RotateCcw'],
    ['customers', '客户管理', 'Users'],
    ['marketing', '营销中心', 'Percent'],
    ['storefront', '店铺装修', 'Palette'],
    ['plugins', '插件管理', 'Blocks'],
    ['payments', '支付管理', 'CircleDollarSign'],
    ['data', '数据管理', 'Database'],
    ['permissions', '权限设置', 'ShieldCheck'],
    ['settings', '系统设置', 'Settings2'],
] as const;

export type AdminNavSection = (typeof ADMIN_NAV_SECTIONS)[number][0];
export interface StandaloneAdminPage {
    path: `/${string}`;
    sourcePath: string;
    module: RouteModuleKey;
    key: string;
    tabKey: string;
    title: string;
    section: AdminNavSection;
    detail?: string;
    slot?: string;
}

type PageEntry = [key: string, title: string, section: AdminNavSection, tabKey?: string, detail?: string];
function pages(
    sourcePath: `/${string}`,
    module: RouteModuleKey,
    entries: PageEntry[],
): StandaloneAdminPage[] {
    return entries.map(([key, title, section, tabKey = key, detail]) => ({
        path: `${sourcePath}/${key}`,
        sourcePath,
        module,
        key,
        tabKey,
        title,
        section,
        detail,
    }));
}

export const STANDALONE_ADMIN_PAGES: StandaloneAdminPage[] = [
    ...pages('/catalog/categories', 'categories', [
        ['categories', '商品分类', 'catalog'],
        ['options', '规格模板', 'catalog'],
        ['facets', '筛选属性', 'catalog'],
    ]),
    ...pages('/catalog/inventory', 'inventory', [
        ['all', '库存总览', 'physical-inventory'],
        ['skus', '商品库存操作', 'physical-inventory'],
        ['movements', '库存流水', 'physical-inventory'],
        ['lots', '库存批次', 'physical-inventory'],
        ['warehouses', '仓库管理', 'physical-inventory'],
    ]),
    ...pages('/catalog/card-pool', 'cardPool', [
        ['pool', '卡密库存', 'digital-delivery'],
        ['deliveries', '自动交付记录', 'digital-delivery'],
    ]),
    ...pages('/marketing/promotions', 'promotions', [
        ['coupons', '优惠券管理', 'marketing'],
        ['flash-sales', '秒杀活动', 'marketing'],
        ['generic', '促销规则', 'marketing'],
        ['report', '优惠券报表', 'marketing'],
        ['ledger', '优惠券使用流水', 'marketing'],
        ['attribution', '渠道效果报表', 'marketing'],
    ]),
    ...pages('/marketing/referrals', 'referrals', [
        ['settings', '分销设置', 'marketing'],
        ['promoters', '推广员管理', 'marketing'],
        ['relationships', '邀请关系明细', 'marketing'],
        ['rewards', '返利订单', 'marketing'],
        ['ledger', '佣金钱包流水', 'payments'],
        ['withdrawals', '提现审核', 'payments'],
    ]),
    ...pages('/storefront/content', 'storefrontContent', [
        ['pages', '固定内容与页面', 'storefront'],
        ['announcements', '首页公告', 'storefront'],
        ['landing', '推广落地页', 'storefront'],
    ]),
    ...pages('/plugins/ai-settings', 'aiImageSettings', [
        ['config', 'AI 生图配置', 'plugins'],
        ['jobs', 'AI 生图任务', 'plugins'],
        ['usage', 'AI 用量与费用', 'plugins'],
        ['skills', '提示词规则包', 'plugins'],
    ]),
    ...pages('/settings/team', 'roles', [
        ['members', '员工管理', 'permissions'],
        ['roles', '角色与权限', 'permissions'],
    ]),
    ...pages('/settings/system-ops', 'systemOps', [
        ['health', '服务健康', 'settings'],
        ['jobs', '任务队列', 'settings'],
        ['schedules', '定时任务', 'settings'],
        ['telegram', '消息通知', 'settings'],
        ['settings', '高级配置', 'settings'],
        ['api-keys', '接口密钥', 'permissions'],
    ]),
    ...pages('/settings/governance-risk', 'systemOps', [
        ['rules', '风控规则', 'settings', 'governance', 'rules'],
        ['approvals', '配置审批', 'settings', 'governance', 'approvals'],
        ['cases', '风险复核', 'settings', 'governance', 'cases'],
        ['report-schedule', '治理日报计划', 'settings', 'governance', 'report-schedule'],
        ['audit', '治理审计日志', 'data', 'governance', 'audit'],
        ['reports', '治理日报', 'data', 'governance', 'reports'],
    ]),
    ...pages('/settings/store-profile', 'storeSettings', [
        ['stores', '店铺实例／店铺资料', 'settings'],
        ['review', '店铺资料审核', 'settings', 'stores', 'review'],
        ['commerce', '交易模式', 'settings', 'stores', 'commerce'],
        ['domains', '独立域名', 'settings'],
        ['sellers', '商家主体', 'settings'],
        ['shipping', '配送设置', 'settings'],
        ['payment', '支付方式', 'payments'],
        ['payout', '收款账户', 'payments', 'stores', 'payout'],
        ['currency', '币种与汇率', 'payments'],
        ['usdt', 'USDT 收款设置', 'payments'],
        ['audits', '权限变更记录', 'data', 'stores', 'audits'],
        ['usdt-payments', '支付流水', 'payments', 'usdt', 'payments'],
        ['usdt-refunds', '人工退款审计', 'payments', 'usdt', 'refunds'],
        ['usdt-intents', '链上收款意向', 'payments', 'usdt', 'intents'],
        ['business-global', '平台基础设置', 'settings', 'business', 'global'],
        ['business-language', '网站语言', 'settings', 'business', 'language'],
        ['business-taxes', '税类与税率', 'settings', 'business', 'taxes'],
        ['business-regions', '国家与业务区域', 'settings', 'business', 'regions'],
    ]),
    ...pages('/settings/usdt-payments', 'usdtPayments', [
        ['wallets', 'USDT 地址审核', 'payments'],
        ['payments', '支付流水', 'payments'],
        ['intents', '链上收款意向', 'payments'],
        ['refunds', '人工退款审计', 'payments'],
    ]),
    ...pages('/settings/data-management', 'dataManagement', [
        ['retention', '数据恢复与清理', 'data'],
        ['exports', '个人数据导出', 'data'],
        ['account-closures', '账户注销申请', 'data'],
        ['consents', '同意与撤回记录', 'data'],
    ]),
];

const pageByPath = new Map(STANDALONE_ADMIN_PAGES.map(page => [page.path as string, page]));
export function getStandaloneAdminPage(path: string) {
    return pageByPath.get(path.split(/[?#]/, 1)[0].replace(/\/+$/u, ''));
}
export function getAdminSectionLabel(section?: string) {
    return localizeAdminNavigationTitle(ADMIN_NAV_SECTIONS.find(([id]) => id === section)?.[1] ?? '扩展功能');
}

const DEFAULT_PAGE_KEYS: Record<string, string> = {
    '/catalog/categories': 'categories',
    '/catalog/inventory': 'all',
    '/catalog/card-pool': 'pool',
    '/marketing/promotions': 'coupons',
    '/marketing/referrals': 'settings',
    '/storefront/content': 'pages',
    '/plugins/ai-settings': 'config',
    '/settings/team': 'members',
    '/settings/system-ops': 'health',
    '/settings/governance-risk': 'rules',
    '/settings/store-profile': 'stores',
    '/settings/usdt-payments': 'wallets',
    '/settings/data-management': 'retention',
};

export function getStandaloneAdminRedirect(path: string, search = ''): string | null {
    path = path.replace(/\/+$/u, '');
    const alias = LEGACY_BUSINESS_PAGE_TARGETS[path];
    if (alias) return resolveAdminRedirectTarget(alias, search);
    const defaultKey = DEFAULT_PAGE_KEYS[path];
    if (!defaultKey) return null;
    const params = new URLSearchParams(search);
    let key = params.get('tab') ?? defaultKey;
    if (path === '/settings/system-ops' && key === 'governance') {
        params.delete('tab');
        return `/settings/governance-risk/rules${params.size ? `?${params}` : ''}`;
    }
    if (path === '/marketing/referrals' && key === 'posters') {
        params.delete('tab');
        return `/marketing/sharing${params.size ? `?${params}` : ''}`;
    }
    if (path === '/catalog/inventory' && ['low-stock', 'out-of-stock'].includes(key)) {
        params.set('status', key);
        key = 'all';
    }
    if (path === '/settings/store-profile' && key === 'payment-shipping') key = 'payment';
    if (!pageByPath.has(`${path}/${key}`)) key = defaultKey;
    params.delete('tab');
    return `${path}/${key}${params.size ? `?${params}` : ''}`;
}

const englishNavigationTitles: Record<string, string> = {
    数字交付: 'Digital delivery',
    实物库存: 'Physical inventory',
    邀请关系明细: 'Invitation relationships',
    网站总览: 'Website overview',
    商品管理: 'Product management',
    订单管理: 'Order management',
    售后管理: 'After-sales management',
    客户管理: 'Customer management',
    营销中心: 'Marketing center',
    店铺装修: 'Store design',
    插件管理: 'Plugin management',
    支付管理: 'Payment management',
    数据管理: 'Data management',
    权限设置: 'Permission settings',
    系统设置: 'System settings',
    商品分类: 'Product categories',
    规格模板: 'Option templates',
    筛选属性: 'Filter attributes',
    库存总览: 'Inventory overview',
    商品库存操作: 'Stock operations',
    库存流水: 'Stock movements',
    库存批次: 'Stock batches',
    仓库管理: 'Warehouses',
    卡密库存: 'Code inventory',
    自动交付记录: 'Automatic deliveries',
    优惠券管理: 'Coupons',
    秒杀活动: 'Flash sales',
    促销规则: 'Promotion rules',
    优惠券报表: 'Coupon reports',
    优惠券使用流水: 'Coupon usage ledger',
    渠道效果报表: 'Channel performance',
    分销设置: 'Referral settings',
    推广员管理: 'Promoters',
    返利订单: 'Referral rewards',
    佣金钱包流水: 'Commission ledger',
    提现审核: 'Withdrawal review',
    固定内容与页面: 'Content and pages',
    首页公告: 'Homepage announcements',
    推广落地页: 'Landing pages',
    'AI 生图配置': 'AI image configuration',
    'AI 生图任务': 'AI image jobs',
    'AI 用量与费用': 'AI usage and costs',
    提示词规则包: 'Prompt rule packs',
    员工管理: 'Staff',
    角色与权限: 'Roles and permissions',
    服务健康: 'Service health',
    任务队列: 'Task queues',
    定时任务: 'Scheduled tasks',
    消息通知: 'Notifications',
    高级配置: 'Advanced configuration',
    接口密钥: 'API keys',
    风控规则: 'Risk rules',
    配置审批: 'Configuration approvals',
    风险复核: 'Risk review',
    治理日报计划: 'Governance report schedule',
    治理审计日志: 'Governance audit log',
    治理日报: 'Governance reports',
    '店铺实例／店铺资料': 'Store instances / profile',
    店铺资料审核: 'Store profile review',
    交易模式: 'Commerce mode',
    独立域名: 'Domains',
    商家主体: 'Merchant entities',
    配送设置: 'Shipping settings',
    支付方式: 'Payment methods',
    收款账户: 'Payout accounts',
    币种与汇率: 'Currencies and rates',
    'USDT 收款设置': 'USDT receiving settings',
    权限变更记录: 'Permission change log',
    支付流水: 'Payment ledger',
    人工退款审计: 'Manual refund audit',
    链上收款意向: 'On-chain payment intents',
    平台基础设置: 'Platform defaults',
    网站语言: 'Website languages',
    税类与税率: 'Tax categories and rates',
    国家与业务区域: 'Countries and business zones',
    'USDT 地址审核': 'USDT address review',
    数据恢复与清理: 'Data recovery and cleanup',
    个人数据导出: 'Personal data exports',
    账户注销申请: 'Account closure requests',
    同意与撤回记录: 'Consent and withdrawal records',
    平台商品分配: 'Platform product allocation',
    商品列表: 'Products',
    素材媒体库: 'Media library',
    订单列表: 'Orders',
    利润统计: 'Profit report',
    售后与退款: 'After-sales and refunds',
    买家评价管理: 'Buyer reviews',
    客服服务评价: 'Customer service reviews',
    商城装修: 'Store decoration',
    商业服务页文案: 'Business services copy',
};
export function localizeAdminNavigationTitle(title: string, language = getAdminDisplayLanguage()) {
    return language === 'en'
        ? (englishNavigationTitles[title] ?? (/\p{Script=Han}/u.test(title) ? 'Administration' : title))
        : title;
}

/** Frontend visibility follows existing server capabilities; no permission is created here. */
export function standalonePagePermissions(page: StandaloneAdminPage): string[] | undefined {
    if (page.sourcePath === '/storefront/content' && page.key === 'announcements') return ['SuperAdmin'];
    if (page.sourcePath === '/settings/governance-risk') return ['SuperAdmin'];
    if (page.sourcePath === '/settings/system-ops')
        return page.key === 'api-keys'
            ? ['ReadApiKey']
            : page.key === 'telegram'
              ? ['SuperAdmin']
              : ['ReadSystem'];
    if (page.sourcePath === '/settings/store-profile') {
        if (page.key === 'review') return ['ReviewStoreGovernance', 'ManageStoreLifecycle'];
        if (page.key === 'audits') return ['ManagePlatformTeam', 'SuperAdmin'];
        if (page.key === 'sellers') return ['ReadSeller', 'ReadStoreProfile'];
        if (page.key === 'payment') return ['ReadPaymentMethod', 'ReadStoreProfile'];
        if (page.key === 'shipping') return ['ReadShippingMethod', 'ReadStoreProfile'];
        if (page.key === 'domains') return ['ReadStoreDomain', 'ReadStoreProfile', 'ManageStoreLifecycle'];
        if (page.key === 'business-global') return ['ReadSettings'];
        if (page.key === 'business-language') return ['ReadChannel'];
        if (page.key === 'business-taxes') return ['ReadTaxCategory', 'ReadTaxRate', 'ReadStoreProfile'];
        if (page.key === 'business-regions') return ['ReadCountry', 'ReadZone', 'ReadStoreProfile'];
        if (page.key === 'payout')
            return ['ReadStoreProfile', 'ReviewStoreGovernance', 'ManageStoreLifecycle'];
        return ['ReadStoreProfile', 'ManageStoreLifecycle'];
    }
    if (page.sourcePath === '/catalog/categories')
        return page.key === 'facets'
            ? ['ReadFacet']
            : page.key === 'options'
              ? ['ReadCatalog', 'ReadProduct']
              : ['ReadCollection'];
    return undefined;
}
export function standalonePageScopeAllows(path: string, platformContext: boolean) {
    const page = getStandaloneAdminPage(path);
    if (!page) return true;
    if (
        page.sourcePath === '/settings/store-profile' &&
        ['review', 'audits', 'business-global'].includes(page.key)
    )
        return platformContext;
    if (
        page.sourcePath === '/settings/usdt-payments' ||
        page.sourcePath === '/settings/governance-risk' ||
        page.sourcePath === '/settings/data-management'
    )
        return platformContext;
    return true;
}

const LEGACY_BUSINESS_PAGE_TARGETS: Record<string, string> = {
    '/catalog/collections': '/catalog/categories/categories',
    '/catalog/option-groups': '/catalog/categories/options',
    '/catalog/facets': '/catalog/categories/facets',
    '/catalog/stock-locations': '/catalog/inventory/warehouses',
    '/marketing/coupons': '/marketing/promotions/coupons',
    '/marketing/flash-sales': '/marketing/promotions/flash-sales',
    '/marketing/withdrawals': '/marketing/referrals/withdrawals',
    '/storefront/announcements': '/storefront/content/announcements',
    '/storefront/promotion-page': '/storefront/content/landing',
};
export function resolveAdminRedirectTarget(target: string, search = '') {
    const [path, targetSearch = ''] = target.split('?', 2);
    const params = new URLSearchParams(search);
    new URLSearchParams(targetSearch).forEach((value, key) => params.set(key, value));
    return (
        getStandaloneAdminRedirect(path, params.toString()) ??
        path + (params.size ? '?' + params.toString() : '')
    );
}

export const CORE_ADMIN_NAV_ITEMS: Array<{
    path: string;
    title: string;
    section: AdminNavSection;
    order: number;
}> = [
    { path: '/dashboard', title: '网站总览', section: 'dashboard', order: 0 },
    { path: '/platform/catalog', title: '平台商品分配', section: 'catalog', order: 0 },
    { path: '/catalog/list', title: '商品列表', section: 'catalog', order: 10 },
    { path: '/catalog/assets', title: '素材媒体库', section: 'catalog', order: 900 },
    { path: '/sales/orders', title: '订单列表', section: 'sales', order: 10 },
    { path: '/sales/profit', title: '利润统计', section: 'sales', order: 20 },
    { path: '/sales/after-sales', title: '售后与退款', section: 'after-sales', order: 10 },
    { path: '/sales/reviews', title: '买家评价管理', section: 'after-sales', order: 20 },
    { path: '/sales/customer-service-feedback', title: '客服服务评价', section: 'after-sales', order: 30 },
    { path: '/customers/list', title: '客户管理', section: 'customers', order: 0 },
    { path: '/storefront/decoration', title: '商城装修', section: 'storefront', order: 10 },
];
