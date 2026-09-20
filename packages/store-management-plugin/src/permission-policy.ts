import { Injectable } from '@nestjs/common';
import { Permission } from '@vendure/common/lib/generated-types';
import { ConfigService, UserInputError } from '@vendure/core';

import {
    managePlatformTeamPermission,
    manageStoreLifecyclePermission,
    manageStoreTeamPermission,
    reviewStoreGovernancePermission,
    sensitiveStoreFinancePermission,
} from './constants';

export type PermissionPolicyScope = 'OWNER_ONLY' | 'PLATFORM' | 'STORE';

export interface PermissionPolicyItem {
    code: string;
    name: string;
    description: string;
    group: string;
    scope: PermissionPolicyScope;
    minimumAuthority: 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF';
    sensitive: boolean;
    delegable: boolean;
    dependencies: string[];
}

export interface PermissionTemplate {
    code: string;
    name: string;
    description: string;
    permissions: string[];
}

const operationLabels: Record<string, string> = {
    Create: '新建',
    Read: '查看',
    Update: '修改',
    Delete: '删除',
    Manage: '管理',
    Adjust: '调整',
};

const MANAGE_STORE_TEAM_CODE = String(manageStoreTeamPermission.Permission);
const MANAGE_PLATFORM_TEAM_CODE = String(managePlatformTeamPermission.Permission);
const MANAGE_STORE_LIFECYCLE_CODE = String(manageStoreLifecyclePermission.Permission);
const REVIEW_STORE_GOVERNANCE_CODE = String(reviewStoreGovernancePermission.Permission);
const SENSITIVE_STORE_FINANCE_CODE = String(sensitiveStoreFinancePermission.Permission);

const resourceLabels: Record<string, string> = {
    Administrator: '管理员账号',
    ApiKey: 'API 密钥',
    Asset: '素材',
    Catalog: '商品目录',
    CatalogImport: '商品导入',
    CatalogExport: '商品导出',
    CatalogOperations: '商品批量操作',
    CatalogSupplier: '供应商',
    Channel: '店铺',
    Collection: '分类',
    Country: '国家与地区',
    Customer: '客户',
    CustomerGroup: '客户组',
    Facet: '商品属性',
    Order: '订单',
    PaymentMethod: '支付方式',
    Product: '商品',
    Promotion: '促销',
    Referral: '返佣',
    ReferralBalance: '返佣余额',
    ReferralWithdrawal: '返佣提现',
    Role: '角色',
    Seller: '商家主体',
    Settings: '系统设置',
    ShippingMethod: '配送方式',
    StockLocation: '库存点',
    StoreDomain: '店铺域名',
    StoreProfile: '店铺资料',
    StorefrontContent: '店铺内容',
    System: '系统运维',
    Tag: '标签',
    TaxCategory: '税务分类',
    TaxRate: '税率',
    Zone: '销售区域',
};

const ownerOnlyResources = new Set(['ApiKey', 'System']);
const platformResources = new Set([
    'Administrator',
    'Channel',
    'PaymentMethod',
    'Role',
    'Seller',
    'Settings',
    'TaxCategory',
    'TaxRate',
]);
const sensitiveCodes = new Set<string>([
    'DeleteOrder',
    'DeleteCustomer',
    'ManageReferralWithdrawal',
    'AdjustReferralBalance',
    SENSITIVE_STORE_FINANCE_CODE,
]);

export const storeRoleTemplates: PermissionTemplate[] = [
    {
        code: 'STORE_MANAGER',
        name: '店铺普通管理员',
        description: '本店日常经营管理，不包含账号授权和敏感财务操作',
        permissions: [
            'ReadChannel',
            'CreateProduct',
            'ReadProduct',
            'UpdateProduct',
            'DeleteProduct',
            'CreateCollection',
            'ReadCollection',
            'UpdateCollection',
            'DeleteCollection',
            'CreateFacet',
            'ReadFacet',
            'UpdateFacet',
            'DeleteFacet',
            'CreateAsset',
            'ReadAsset',
            'UpdateAsset',
            'DeleteAsset',
            'ReadOrder',
            'UpdateOrder',
            'ReadCustomer',
            'UpdateCustomer',
            'ReadStockLocation',
            'ReadShippingMethod',
            'ReadPaymentMethod',
            'CreatePromotion',
            'ReadPromotion',
            'UpdatePromotion',
            'DeletePromotion',
            'CreateStorefrontContent',
            'ReadStorefrontContent',
            'UpdateStorefrontContent',
            'ReadStoreDomain',
            'UpdateStoreDomain',
            'ReadStoreProfile',
            'UpdateStoreProfile',
        ],
    },
    {
        code: 'PRODUCT_OPERATIONS',
        name: '商品运营',
        description: '管理本店商品、分类、属性、素材、价格和库存',
        permissions: [
            'CreateProduct',
            'ReadProduct',
            'UpdateProduct',
            'DeleteProduct',
            'CreateCollection',
            'ReadCollection',
            'UpdateCollection',
            'DeleteCollection',
            'CreateFacet',
            'ReadFacet',
            'UpdateFacet',
            'DeleteFacet',
            'CreateAsset',
            'ReadAsset',
            'UpdateAsset',
            'DeleteAsset',
            'ReadStockLocation',
            'CreateTag',
            'ReadTag',
            'UpdateTag',
            'DeleteTag',
        ],
    },
    {
        code: 'ORDER_FULFILLMENT',
        name: '订单履约',
        description: '查看和处理本店订单、发货与售后',
        permissions: ['ReadOrder', 'UpdateOrder', 'ReadCustomer', 'ReadStockLocation', 'ReadShippingMethod'],
    },
    {
        code: 'CUSTOMER_SERVICE',
        name: '客户服务',
        description: '查看本店客户与订单，处理服务记录',
        permissions: ['ReadOrder', 'ReadCustomer', 'UpdateCustomer'],
    },
    {
        code: 'MARKETING_CONTENT',
        name: '营销与内容',
        description: '管理本店促销、内容和公开品牌资料',
        permissions: [
            'CreatePromotion',
            'ReadPromotion',
            'UpdatePromotion',
            'DeletePromotion',
            'CreateStorefrontContent',
            'ReadStorefrontContent',
            'UpdateStorefrontContent',
            'DeleteStorefrontContent',
            'ReadStoreProfile',
            'UpdateStoreProfile',
        ],
    },
    {
        code: 'FINANCE_VIEW',
        name: '财务查看',
        description: '只读查看本店订单、支付和返佣报表',
        permissions: ['ReadOrder', 'ReadPaymentMethod', 'ReadReferral'],
    },
];

@Injectable()
export class PermissionPolicyRegistry {
    constructor(private readonly configService: ConfigService) {}

    catalog(): PermissionPolicyItem[] {
        const defaultCodes = Object.values(Permission).map(String);
        const customCodes = this.configService.authOptions.customPermissions.flatMap(definition =>
            (definition as unknown as { getMetadata(): Array<{ name: string }> })
                .getMetadata()
                .map(item => item.name),
        );
        return [...new Set([...defaultCodes, ...customCodes])]
            .filter(code => !['Authenticated', 'Owner', 'Public'].includes(code))
            .map(code => this.describe(code));
    }

    templates(): PermissionTemplate[] {
        const validCodes = new Set(this.catalog().map(item => item.code));
        return storeRoleTemplates.map(template => ({
            ...template,
            permissions: template.permissions.filter(permission => validCodes.has(permission)),
        }));
    }

    normalizePermissions(permissions: readonly string[]): string[] {
        const policies = new Map(this.catalog().map(item => [item.code, item]));
        const normalized = new Set(permissions);
        for (const permission of [...normalized]) {
            for (const dependency of policies.get(permission)?.dependencies ?? []) {
                if (policies.has(dependency)) normalized.add(dependency);
            }
        }
        return [...normalized];
    }

    assertStoreRolePermissions(permissions: readonly string[]): void {
        const policies = new Map(this.catalog().map(item => [item.code, item]));
        for (const permission of permissions) {
            const policy = policies.get(permission);
            if (!policy || policy.scope !== 'STORE' || !policy.delegable) {
                throw new UserInputError(`权限“${permission}”属于平台专属或不可下放权限`);
            }
        }
    }

    assertPlatformRolePermissions(permissions: readonly string[]): void {
        const policies = new Map(this.catalog().map(item => [item.code, item]));
        for (const permission of permissions) {
            const policy = policies.get(permission);
            if (!policy || policy.scope === 'OWNER_ONLY' || !policy.delegable) {
                throw new UserInputError(`权限“${permission}”仅平台所有者可用`);
            }
        }
    }

    private describe(code: string): PermissionPolicyItem {
        if (code === 'SuperAdmin') {
            return {
                code,
                name: '平台所有者',
                description: '拥有全平台不受限制的权限，只能通过所有权转移变更',
                group: '平台治理',
                scope: 'OWNER_ONLY',
                minimumAuthority: 'OWNER',
                sensitive: true,
                delegable: false,
                dependencies: [],
            };
        }
        const { operation, resource } = splitPermissionCode(code);
        const ownerOnly = ownerOnlyResources.has(resource) || code === 'UpdateGlobalSettings';
        const storeSafePlatformResourceReads = new Set(['ReadChannel', 'ReadPaymentMethod']);
        const platform =
            ownerOnly ||
            (platformResources.has(resource) && !storeSafePlatformResourceReads.has(code)) ||
            [MANAGE_PLATFORM_TEAM_CODE, REVIEW_STORE_GOVERNANCE_CODE].includes(code) ||
            code === MANAGE_STORE_LIFECYCLE_CODE;
        const fixedStoreManagement =
            resource === 'Administrator' || resource === 'Role' || code === MANAGE_STORE_TEAM_CODE;
        const sensitive = sensitiveCodes.has(code);
        return {
            code,
            name: permissionName(code, operation, resource),
            description: permissionDescription(code, operation, resource),
            group: permissionGroup(resource, code),
            scope: ownerOnly ? 'OWNER_ONLY' : platform ? 'PLATFORM' : 'STORE',
            minimumAuthority: ownerOnly
                ? 'OWNER'
                : code === REVIEW_STORE_GOVERNANCE_CODE
                  ? 'STAFF'
                  : platform || fixedStoreManagement
                    ? 'ADMIN'
                    : 'STAFF',
            sensitive,
            delegable: !ownerOnly && !fixedStoreManagement,
            dependencies: dependencyCodes(code, operation, resource),
        };
    }
}

function splitPermissionCode(code: string): { operation: string; resource: string } {
    const operation = Object.keys(operationLabels).find(prefix => code.startsWith(prefix)) ?? '';
    return { operation, resource: operation ? code.slice(operation.length) : code };
}

function permissionName(code: string, operation: string, resource: string): string {
    const fixedNames: Record<string, string> = {
        AdjustReferralBalance: '调整返佣余额',
        ManageReferralWithdrawal: '处理返佣提现',
        SyncInventory: '同步库存',
        SyncWishlists: '同步愿望清单',
        Transactions: '管理交易',
    };
    if (fixedNames[code]) return fixedNames[code];
    if (code === MANAGE_STORE_TEAM_CODE) return '管理本店团队';
    if (code === MANAGE_PLATFORM_TEAM_CODE) return '管理平台团队';
    if (code === MANAGE_STORE_LIFECYCLE_CODE) return '管理店铺生命周期';
    if (code === REVIEW_STORE_GOVERNANCE_CODE) return '审批店铺治理变更';
    if (code === SENSITIVE_STORE_FINANCE_CODE) return '执行敏感店铺财务操作';
    return `${operationLabels[operation] ?? '使用'}${resourceLabels[resource] ?? resource}`;
}

function permissionDescription(code: string, operation: string, resource: string): string {
    if (sensitiveCodes.has(code))
        return `${permissionName(code, operation, resource)}，操作时需再次验证密码并记录审计`;
    return `允许${permissionName(code, operation, resource)}`;
}

function permissionGroup(resource: string, code: string): string {
    if (code.includes('Administrator') || code.includes('Team') || code === 'SuperAdmin') return '账号与权限';
    if (['Product', 'Catalog', 'Collection', 'Facet', 'Asset', 'Tag'].some(value => resource.includes(value)))
        return '商品与素材';
    if (['Order', 'Customer', 'Shipping', 'Stock'].some(value => resource.includes(value)))
        return '订单与履约';
    if (['Payment', 'Referral', 'Finance'].some(value => resource.includes(value))) return '支付与财务';
    if (['Promotion', 'Content', 'Domain', 'Profile'].some(value => resource.includes(value)))
        return '营销与店铺';
    return '平台治理';
}

function dependencyCodes(code: string, operation: string, resource: string): string[] {
    if (!['Create', 'Update', 'Delete', 'Manage', 'Adjust'].includes(operation)) return [];
    const readCode = `Read${resource}`;
    return readCode === code ? [] : [readCode];
}
