const ACTION_LABELS: Readonly<Record<string, string>> = {
    Read: '查看',
    Create: '新增',
    Update: '修改',
    Write: '编辑',
    Delete: '删除',
};

const ACTION_ORDER = ['Read', 'Create', 'Update', 'Write', 'Delete'] as const;

const SUBJECT_LABELS: Readonly<Record<string, string>> = {
    Administrator: '员工账号',
    ApiKey: 'API 密钥',
    Asset: '素材',
    Catalog: '商品目录',
    CatalogExport: '商品批量导出',
    CatalogImport: '商品批量导入',
    CatalogOperations: '商品运营',
    CatalogSupplier: '商品供应商',
    Channel: '店铺渠道',
    Collection: '商品集合',
    Country: '国家地区',
    Customer: '客户',
    CustomerGroup: '客户分组',
    DashboardGlobalViews: '全局数据视图',
    Facet: '筛选属性',
    GlobalSettings: '全局设置',
    IcloudRelay: 'iCloud 邮箱中继',
    ImageGeneration: 'AI 图片生成',
    Order: '订单',
    PaymentMethod: '支付方式',
    Product: '商品',
    Promotion: '促销',
    Referral: '推荐返佣',
    ReferralBalance: '推荐余额',
    ReferralWithdrawal: '推荐返佣提现',
    Seller: '商家主体',
    Settings: '业务设置',
    ShippingMethod: '配送方式',
    StockLocation: '库存点',
    StoreDomain: '店铺域名',
    StorefrontContent: '店铺前台内容',
    StoreProfile: '店铺资料',
    System: '系统运维',
    Tag: '标签',
    TaxCategory: '税种',
    TaxRate: '税率',
    Zone: '区域',
};

const CUSTOM_PERMISSIONS: Readonly<Record<string, { group: string; label: string; description: string }>> = {
    AdjustReferralBalance: {
        group: 'ReferralBalance',
        label: '调整推荐余额',
        description: '允许通过审计记录手动调整客户的推荐余额',
    },
    ManageReferralWithdrawal: {
        group: 'ReferralWithdrawal',
        label: '管理推荐返佣提现',
        description: '允许创建、审核、拒绝、取消和完成推荐返佣提现',
    },
};

const permissionParts = (name: string) => {
    const action = ACTION_ORDER.find(prefix => name.startsWith(prefix));
    return action ? { action, subject: name.slice(action.length) } : { action: undefined, subject: '' };
};

export interface PermissionDisplay {
    group: string;
    groupLabel: string;
    label: string;
    description: string;
    order: number;
}

export function getPermissionDisplay(name: string): PermissionDisplay {
    const custom = CUSTOM_PERMISSIONS[name];
    if (custom) {
        return {
            group: custom.group,
            groupLabel: SUBJECT_LABELS[custom.group] ?? '其他权限',
            label: custom.label,
            description: custom.description,
            order: ACTION_ORDER.length,
        };
    }

    const { action, subject } = permissionParts(name);
    const actionLabel = action ? ACTION_LABELS[action] : undefined;
    const subjectLabel = subject ? SUBJECT_LABELS[subject] : undefined;
    if (action && actionLabel && subjectLabel) {
        return {
            group: subject,
            groupLabel: subjectLabel,
            label: `${actionLabel}${subjectLabel}`,
            description: `允许${actionLabel}${subjectLabel}相关数据`,
            order: ACTION_ORDER.indexOf(action),
        };
    }

    return {
        group: 'Other',
        groupLabel: '其他权限',
        label: '自定义操作权限',
        description: '由服务端插件注册的自定义权限',
        order: ACTION_ORDER.length + 1,
    };
}
