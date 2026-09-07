import type { DocumentNode } from 'graphql';
import { getOperationAST } from 'graphql';

export interface AdminMutationFeedbackOptions {
    action?: string;
    target?: string;
    pending?: string;
    success?: string;
    failure?: string;
    details?: string[];
    resolution?: string[];
    skipPending?: boolean;
    skipSuccess?: boolean;
    skipError?: boolean;
}

export type AdminMutationFeedbackContext = false | AdminMutationFeedbackOptions;

export interface MutationFeedbackCopy {
    action: string;
    target?: string;
    pending: string;
    success: string;
    failure: string;
    details?: string[];
    resolution?: string[];
}

export interface MutationFailureDescriptor {
    message: string;
    errorCode?: string;
    extensions?: Record<string, unknown>;
}

const failureResults = new Set([
    'ERROR',
    'FAILED',
    'FAILURE',
    'NOT_DELETED',
    'NOT_UPDATED',
    'NOT_CREATED',
    'REJECTED',
]);

const actionRules: Array<[RegExp, string]> = [
    [/^(Update|Save|Set|Configure|Reorder|Adjust|Assign|Modify)/u, '保存'],
    [/^(Create|Add|Append|Provision)/u, '创建'],
    [/^(Delete|Remove|Deprovision)/u, '删除'],
    [/^Publish/u, '发布'],
    [/^Submit/u, '提交'],
    [/^(Review|Verify|Approve|Reject|Moderate|Confirm)/u, '审核'],
    [/^(Import|Execute|Finalize|Resolve|Run|Test|Send|Retry|Refresh|Backfill|Begin)/u, '执行'],
    [/^(Enable|Disable|Toggle|Suspend|Transition|Activate)/u, '更新状态'],
    [/^(Refund|Settle|Record|Process)/u, '处理'],
    [/^Apply/u, '应用'],
    [/^Grant/u, '发放'],
    [/^Revoke/u, '撤销'],
    [/^Cancel/u, '取消'],
    [/^Stop/u, '停止'],
    [/^Clear/u, '清除'],
    [/^Complete/u, '完成'],
    [/^Reset/u, '重置'],
    [/^Archive/u, '归档'],
    [/^Regenerate/u, '重新生成'],
    [/^Logout/u, '退出登录'],
    [/^(Transfer|Rotate|Rollback|Reveal|Preview|Touch)/u, '操作'],
];

const targetRules: Array<[RegExp, string]> = [
    [/StoreProvisioningTemplate/u, '开店模板'],
    [/StorefrontPromotionPage/u, '店铺促销页'],
    [/Storefront(?:Content|Block|Branding|VisualPreset)/u, '店铺内容'],
    [/StoreProfile/u, '店铺档案'],
    [/StoreDomain/u, '店铺域名'],
    [/StockLocation/u, '库存点'],
    [/CatalogImport/u, '商品导入任务'],
    [/CatalogOrderProfitExpense|OrderProfitExpense/u, '订单成本'],
    [/CatalogInventoryLot/u, '库存批次'],
    [/CatalogVariantOperations/u, '商品 SKU 运营信息'],
    [/CatalogSupplier|Supplier/u, '供货商'],
    [/ProductOptionGroup/u, '商品规格组'],
    [/ProductVariant/u, '商品 SKU'],
    [/Product/u, '商品'],
    [/TaxCategory/u, '税务分类'],
    [/TaxRate/u, '税率'],
    [/PaymentMethod/u, '支付方式'],
    [/Payment/u, '支付记录'],
    [/ShippingMethod/u, '配送方式'],
    [/CustomerGroup/u, '客户分组'],
    [/Customer/u, '客户'],
    [/Administrator/u, '管理员'],
    [/ApiKey/u, 'API 凭据'],
    [/Seller/u, '商家主体'],
    [/Channel/u, '店铺 Channel'],
    [/Zone/u, '业务区域'],
    [/Country/u, '国家或地区'],
    [/Collection/u, '商品分类'],
    [/FacetValue/u, '筛选属性值'],
    [/Facet/u, '筛选属性'],
    [/Asset/u, '素材'],
    [/Promotion/u, '促销活动'],
    [/Coupon/u, '优惠券'],
    [/ReferralPoster/u, '邀请海报'],
    [/Referral/u, '分销业务'],
    [/Withdrawal/u, '提款申请'],
    [/Refund/u, '退款'],
    [/Fulfillment/u, '履约'],
    [/Order/u, '订单'],
    [/Translation/u, '翻译内容'],
    [/Review/u, '评价'],
    [/Announcement/u, '系统公告'],
    [/Role/u, '角色'],
    [/Telegram/u, 'Telegram 通知'],
    [/TwoFactor|2FA/u, '2FA 账号'],
    [/Image(?:Skill|Output|GenerationConfig|Model|Provider)/u, 'AI 图片配置'],
    [/AutoCard|Card/u, '卡密'],
    [/ScheduledTask|Job/u, '后台任务'],
    [/InitialPassword/u, '初始密码'],
    [/ActiveAdministrator/u, '当前管理员资料'],
    [/GlobalSettings|SettingsStoreValue|SaveSettings/u, '系统设置'],
    [/StoreCommerceMode/u, '店铺经营模式'],
    [/StoreUsdt|MyStoreUsdt/u, '店铺 USDT 配置'],
    [/MyStoreCurrency/u, '店铺币种'],
    [/ProvisionStore|DeprovisionStore|SuspendStore/u, '店铺'],
];

export function isMutationDocument(document: DocumentNode, operationName?: string) {
    return getOperationAST(document, operationName)?.operation === 'mutation';
}

export function getMutationFeedbackCopy(
    operationName: string | undefined,
    options: AdminMutationFeedbackOptions = {},
    variables?: unknown,
): MutationFeedbackCopy {
    const normalizedName = (operationName || '').replace(/^(?:NextAdmin|Admin)/u, '');
    const action =
        options.action ?? actionRules.find(([pattern]) => pattern.test(normalizedName))?.[1] ?? '操作';
    const target = options.target ?? inferMutationTarget(normalizedName, variables);

    return {
        action,
        ...(target ? { target } : {}),
        pending: options.pending ?? `${action}中…`,
        success: options.success ?? `${action}成功`,
        failure: options.failure ?? '管理服务没有返回可识别的失败原因',
        ...(options.details?.length ? { details: options.details } : {}),
        ...(options.resolution?.length ? { resolution: options.resolution } : {}),
    };
}

export function extractMutationFailure(data: unknown): string | null {
    return extractMutationFailureDetails(data)?.message ?? null;
}

export function extractMutationFailureDetails(data: unknown): MutationFailureDescriptor | null {
    if (!isRecord(data)) return null;

    for (const value of Object.values(data)) {
        const failure = extractRootResultFailureDetails(value);
        if (failure) return failure;
    }

    return null;
}

function extractRootResultFailureDetails(value: unknown): MutationFailureDescriptor | null {
    if (value == null) return { message: '管理服务未返回操作结果' };
    if (value === false) return { message: '服务端未接受此次操作' };
    if (Array.isArray(value)) {
        const failures = value
            .map(item => extractRootResultFailureDetails(item))
            .filter((failure): failure is MutationFailureDescriptor => Boolean(failure));
        if (!failures.length) return null;
        const successCount = value.length - failures.length;
        return {
            message:
                successCount > 0
                    ? `批量操作部分完成：${successCount} 项成功，${failures.length} 项失败`
                    : `批量操作未完成：${failures.length} 项失败`,
            errorCode: 'PARTIAL_FAILURE',
            extensions: {
                code: 'PARTIAL_FAILURE',
                details: failures.map(failure => failure.message),
                resolution: ['根据失败明细逐项处理，并且只重试失败项'],
                retryable: false,
            },
        };
    }
    if (!isRecord(value)) return null;

    const typename = readString(value.__typename);
    const message = readString(value.message);
    const errorCode = readString(value.errorCode);
    const result = readString(value.result)?.toUpperCase();
    const directError = readString(value.error);
    const isErrorUnion = Boolean(typename && /(?:Error|ErrorResult)$/u.test(typename));
    const extensions = mutationFailureExtensions(value, errorCode);

    if (isErrorUnion)
        return {
            message: message || '服务端拒绝了此次操作',
            ...(errorCode ? { errorCode } : {}),
            ...(extensions ? { extensions } : {}),
        };
    if (value.success === false)
        return {
            message: message || directError || '服务端未接受此次操作',
            ...(errorCode ? { errorCode } : {}),
            ...(extensions ? { extensions } : {}),
        };
    if (result && failureResults.has(result))
        return {
            message: message || directError || '服务端未完成此次操作',
            ...(errorCode ? { errorCode } : {}),
            ...(extensions ? { extensions } : {}),
        };
    if (errorCode && message) return { message, errorCode, ...(extensions ? { extensions } : {}) };

    return null;
}

function mutationFailureExtensions(value: Record<string, unknown>, errorCode: string | null) {
    const extensions = isRecord(value.extensions) ? { ...value.extensions } : {};
    for (const field of [
        'reason',
        'userMessage',
        'details',
        'blockers',
        'blockingResources',
        'resolution',
        'retryable',
        'fieldErrors',
        'traceId',
        'requestId',
    ]) {
        if (value[field] !== undefined && extensions[field] === undefined) extensions[field] = value[field];
    }
    if (errorCode && extensions.code === undefined) extensions.code = errorCode;
    return Object.keys(extensions).length ? extensions : undefined;
}

function inferMutationTarget(operationName: string, variables: unknown) {
    const subject = targetRules.find(([pattern]) => pattern.test(operationName))?.[1];
    if (!subject) return undefined;
    const reference = readVariableReference(variables);
    return reference ? `${subject}${reference}` : subject;
}

function readVariableReference(variables: unknown) {
    if (!isRecord(variables)) return '';
    const input = isRecord(variables.input) ? variables.input : undefined;
    const ids = Array.isArray(variables.ids)
        ? variables.ids
        : input && Array.isArray(input.ids)
          ? input.ids
          : undefined;
    if (ids?.length) return `（共 ${ids.length} 项）`;
    const id = readString(variables.id) || readString(input?.id);
    if (!id) return '';
    const safeId = id.length > 40 ? `${id.slice(0, 16)}…${id.slice(-8)}` : id;
    return `（ID：${safeId}）`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Chinese authoring mutations share the same save/translation contract across modules. */
export function hasChineseSaveInput(operationName: string | undefined, variables: unknown): boolean {
    if (
        !/^(?:NextAdmin|Admin)?(?:Create|Update|Save|Apply|Provision|Reply|Resolve)/u.test(
            operationName ?? '',
        )
    )
        return false;
    const visit = (value: unknown): boolean => {
        if (Array.isArray(value)) return value.some(visit);
        if (!isRecord(value)) return false;
        if (value.languageCode === 'zh_Hans') return true;
        return Object.entries(value).some(
            ([key, item]) => (key.endsWith('Zh') && typeof item === 'string' && !!item.trim()) || visit(item),
        );
    };
    return visit(variables);
}
