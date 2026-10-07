import type { SettingsStoreFieldRecord } from '../../graphql/management.graphql';
import { getSystemWorkerHealth } from './system-worker-health';

export const businessSettingsGroups = [
    {
        id: 'login',
        title: '账号与登录',
        description: '管理邮箱登录、注册方式及 Google 登录。全平台 Google 默认配置会影响所有继承它的店铺。',
        path: '/storefront/decoration',
        action: '前往商城装修',
        guide: '商城装修 → 装修设置 → 账号与登录设置；全平台 Google 默认配置由超级管理员维护。',
    },
    {
        id: 'account',
        title: '账户功能与推荐内容',
        description: '管理账户页的推荐内容，以及账户设置是否显示个人数据导出入口。',
        path: '/storefront/decoration',
        action: '前往商城装修',
        guide: '商城装修 → 装修设置 → 账户功能、账户推荐。',
    },
    {
        id: 'reviews',
        title: '商品评价',
        description: '管理客户端的商品评价功能，并审核买家评价。',
        path: '/sales/reviews',
        action: '前往买家评价管理',
        guide: '买家评价管理 → 客户端评价功能。',
    },
] as const;

type SettingsGroup = (typeof businessSettingsGroups)[number]['id'] | 'technical';
interface SettingsPresentation {
    title: string;
    description: string;
    group: SettingsGroup;
}

// Labels describe registered fields; defaults and validation remain owned by their business APIs.
const presentations: Record<string, SettingsPresentation> = {
    'storefrontAuth.emailPasswordEnabled': {
        title: '邮箱密码登录',
        description: '允许客户使用邮箱和密码登录。',
        group: 'login',
    },
    'storefrontAuth.emailAutoRegistrationEnabled': {
        title: '邮箱自动注册',
        description: '邮箱登录失败时，未注册邮箱自动创建待验证账号。',
        group: 'login',
    },
    'storefrontAuth.emailQuickRegistrationEnabled': {
        title: '邮箱快捷注册',
        description: '注册页只填写邮箱，点击验证邮件后再设置密码。',
        group: 'login',
    },
    'storefrontAuth.googleOverrideEnabled': {
        title: '店铺独立 Google 配置',
        description: '决定本店是否单独设置 Google 登录。',
        group: 'login',
    },
    'storefrontAuth.googleEnabled': {
        title: '本店 Google 登录',
        description: '本店单独配置的 Google 登录开关。',
        group: 'login',
    },
    'storefrontAuth.googleClientId': {
        title: '本店 Google 应用编号',
        description: '本店单独配置的 Google 登录应用。',
        group: 'login',
    },
    'storefrontAuth.platformGoogleEnabled': {
        title: '全平台 Google 登录',
        description: '所有继承平台配置的店铺共用此开关。',
        group: 'login',
    },
    'storefrontAuth.platformGoogleClientId': {
        title: '全平台 Google 应用编号',
        description: '所有继承平台配置的店铺共用此应用。',
        group: 'login',
    },
    'storefrontAccount.recommendations': {
        title: '账户页推荐内容',
        description: '设置推荐区域的标题、显示数量及启停。',
        group: 'account',
    },
    'storefrontAccount.personalDataExportEnabled': {
        title: '客户个人数据导出',
        description: '控制账户设置中的个人数据导出入口。',
        group: 'account',
    },
    'storefrontReview.enabled': {
        title: '客户端商品评价',
        description: '控制客户端商品评价功能的启停。',
        group: 'reviews',
    },
    'systemOperations.workerHeartbeat': {
        title: '后台任务运行状态',
        description: '由任务服务自动上报；详细运行情况请查看服务健康。',
        group: 'technical',
    },
    'contentTranslationCache.result': {
        title: '翻译结果缓存',
        description: '系统自动保存的翻译结果；此处只显示当前查询范围，不能代表全部缓存。',
        group: 'technical',
    },
    'vendure.dashboard.userSettings': {
        title: '管理员界面偏好',
        description: '管理界面的内部偏好数据。',
        group: 'technical',
    },
    'vendure.dashboard.globalSavedViews': {
        title: '共享列表视图',
        description: '供管理界面使用的共享列表视图数据。',
        group: 'technical',
    },
    'vendure.dashboard.userSavedViews': {
        title: '个人列表视图',
        description: '当前管理员保存的内部列表视图数据。',
        group: 'technical',
    },
    'ReadonlyTest.buildVersion': {
        title: '开发环境版本记录',
        description: '仅供开发测试的只读版本记录。',
        group: 'technical',
    },
    'ReadonlyTest.buildMeta': {
        title: '开发环境构建记录',
        description: '仅供开发测试的只读构建信息。',
        group: 'technical',
    },
};

export function getSettingsPresentation(key: string): SettingsPresentation {
    return (
        presentations[key] ?? {
            title: '扩展技术配置',
            description: '由已安装扩展注册的高级设置，请由了解该扩展的维护人员处理。',
            group: 'technical',
        }
    );
}

export function getSettingsScopeLabel(scope: SettingsStoreFieldRecord['scopeType']) {
    return {
        GLOBAL: '整个平台',
        CHANNEL: '当前店铺',
        USER: '当前管理员',
        USER_AND_CHANNEL: '当前管理员在本店铺',
        CUSTOM: '自定义范围',
    }[scope];
}

export function getSettingsValueSummary(field: SettingsStoreFieldRecord) {
    const value = field.currentValue;
    if (field.key === 'systemOperations.workerHeartbeat') return getSystemWorkerHealth([field]).label;
    if (value == null) return '未单独设置';
    if (typeof value === 'boolean') return value ? '已开启' : '已关闭';
    if (field.key === 'storefrontAccount.recommendations' && typeof value === 'object') {
        const enabled = (value as { enabled?: unknown }).enabled;
        if (typeof enabled === 'boolean') return enabled ? '已开启' : '已关闭';
    }
    if (typeof value === 'string') return value.trim() ? '已填写' : '未填写';
    return '已保存数据';
}

export function matchesSettingsSearch(field: SettingsStoreFieldRecord, search: string) {
    const presentation = getSettingsPresentation(field.key);
    return `${presentation.title} ${presentation.description} ${field.key} ${getSettingsScopeLabel(field.scopeType)}`
        .toLowerCase()
        .includes(search.trim().toLowerCase());
}

export const settingsEditorValue = (value: unknown) => JSON.stringify(value ?? null, null, 2);
