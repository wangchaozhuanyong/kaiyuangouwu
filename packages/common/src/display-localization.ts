/** Browser-safe display contract shared by the admin, storefront and plugin dashboards.
 * Machine keys are lookup inputs, never the fallback text shown to a person.
 * Business values (order references, SKUs, email, URLs and customer-entered text) stay unchanged.
 */
export type DisplayLanguage = 'zh' | 'zh_Hans' | 'en';

const translationMetadataFields = new Set([
    'id',
    'base',
    'baseId',
    'createdAt',
    'updatedAt',
    'languageCode',
    'customFields',
    'slug',
    'code',
    'url',
    'path',
]);

/** Translation records contain localized text plus routing/ORM metadata.
 * New localized text fields inherit the policy without adding a field-name allowlist.
 */
export function translatedDisplayFieldNames(translation: object): string[] {
    return Object.entries(translation)
        .filter(
            ([field, value]) =>
                !translationMetadataFields.has(field) &&
                !/(?:Id|Code|Url|Path)$/u.test(field) &&
                (typeof value === 'string' || value == null),
        )
        .map(([field]) => field);
}

/** Slugs, identifiers and the original translation records are intentionally outside this projection. */
export function localizedDisplayFields(
    translations: ReadonlyArray<{ languageCode: string; [field: string]: unknown }>,
    requestedLanguage: string,
    fields: readonly string[],
): Record<string, string> {
    const language = requestedLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    const exact = translations.find(translation => translation.languageCode === requestedLanguage);
    return Object.fromEntries(
        fields.map(field => {
            const value = exact?.[field];
            return [
                field,
                typeof value === 'string' && value.trim()
                    ? value
                    : field === 'name'
                      ? missingDisplayLabel('name', language)
                      : '',
            ];
        }),
    );
}

const missingLabels = {
    status: ['未知状态', 'Unknown status'],
    type: ['未识别类型', 'Unknown type'],
    event: ['未识别事件', 'Unknown event'],
    reason: ['未识别原因', 'Unknown reason'],
    plugin: ['未登记插件', 'Unregistered plugin'],
    role: ['自定义角色', 'Custom role'],
    name: ['未填写中文名称', 'English name not set'],
    resource: ['未识别资源', 'Unknown resource'],
    scope: ['未识别范围', 'Unknown scope'],
    source: ['未识别来源', 'Unknown source'],
    tag: ['其他评价', 'Other feedback'],
    severity: ['未识别级别', 'Unknown severity'],
    department: ['未登记部门', 'Unregistered department'],
    template: ['未登记模板', 'Unregistered template'],
    payment: ['未标注支付方式', 'Payment method not set'],
    extension: ['扩展功能', 'Extension'],
    description: ['暂无中文说明', 'English description not set'],
} as const;
export type DisplayLabelKind = keyof typeof missingLabels;

export function missingDisplayLabel(kind: DisplayLabelKind, language: DisplayLanguage = 'zh'): string {
    return missingLabels[kind][language === 'en' ? 1 : 0];
}

export function getSystemLabel(
    value: string | null | undefined,
    labels: Readonly<Record<string, string>>,
    language: DisplayLanguage = 'zh',
    kind: DisplayLabelKind = 'status',
): string {
    const key = value?.trim() ?? '';
    const label = Object.prototype.hasOwnProperty.call(labels, key) ? labels[key]?.trim() : undefined;
    const matchesLanguage =
        label && (language === 'en' ? !/\p{Script=Han}/u.test(label) : /\p{Script=Han}/u.test(label));
    return matchesLanguage ? label : missingDisplayLabel(kind, language);
}

/** Interface copy has a stricter contract than merchant-entered business names or brands. */
export function getLocalizedInterfaceCopy(
    metadata: { zh?: string | null; en?: string | null } | null | undefined,
    language: DisplayLanguage,
    kind: DisplayLabelKind = 'extension',
): string {
    const value = metadata?.[language === 'en' ? 'en' : 'zh']?.trim();
    const matches =
        value && (language === 'en' ? !/\p{Script=Han}/u.test(value) : /\p{Script=Han}/u.test(value));
    return matches ? value : missingDisplayLabel(kind, language);
}

export function getLocalizedMetadata(
    metadata: { zh?: string | null; en?: string | null } | null | undefined,
    language: DisplayLanguage,
    kind: DisplayLabelKind = 'name',
): string {
    return metadata?.[language === 'en' ? 'en' : 'zh']?.trim() || missingDisplayLabel(kind, language);
}

/** Backend diagnostics may be English even when a request specifies Chinese. */
export function serviceMessageDisplay(value: string, language?: DisplayLanguage): string;
export function serviceMessageDisplay(
    value: string | null | undefined,
    language?: DisplayLanguage,
): string | null | undefined;
export function serviceMessageDisplay(
    value: string | null | undefined,
    language: DisplayLanguage = 'zh',
): string | null | undefined {
    if (!value?.trim()) return value;
    const message = value?.trim() ?? '';
    const technical =
        /(?:https?:\/\/|<\/?[a-z]|\b(?:Bearer|password|secret|token)\s*[:=]|\bat\s+\S+\s*\(|\b(?:SELECT|INSERT|UPDATE)\s+\S+)/iu;
    if (message && message.length <= 240 && !technical.test(message)) {
        if (language === 'en' && !/\p{Script=Han}/u.test(message)) return message;
        if (
            language !== 'en' &&
            /\p{Script=Han}/u.test(message) &&
            !/[A-Za-z][A-Za-z'’-]*\s+[A-Za-z][A-Za-z'’-]*/u.test(message)
        )
            return message;
    }
    return language === 'en'
        ? 'The service is temporarily unavailable. Please try again later.'
        : '服务暂时不可用，请稍后重试';
}

const orderStates = {
    AddingItems: ['待付款', 'Payment pending'],
    ArrangingPayment: ['待付款', 'Payment pending'],
    PaymentAuthorized: ['待发货', 'Preparing shipment'],
    PaymentSettled: ['待发货', 'Preparing shipment'],
    TestPaymentSettled: ['测试已付款', 'Test payment complete'],
    Shipped: ['待收货', 'In transit'],
    PartiallyShipped: ['部分发货', 'Partially shipped'],
    Delivered: ['交易完成', 'Completed'],
    Cancelled: ['已取消', 'Cancelled'],
} as const;
const fulfillmentStates = {
    Created: ['已创建', 'Created'],
    Pending: ['待发货', 'Pending shipment'],
    Shipped: ['运输中', 'In transit'],
    Delivered: ['已送达', 'Delivered'],
    Cancelled: ['已取消', 'Cancelled'],
} as const;

function lifecycleLabel(
    state: string,
    language: DisplayLanguage,
    labels: Readonly<Record<string, readonly [string, string]>>,
): string {
    const pair = Object.prototype.hasOwnProperty.call(labels, state) ? labels[state] : undefined;
    return getLocalizedMetadata(pair ? { zh: pair[0], en: pair[1] } : undefined, language, 'status');
}

export const orderStateDisplayLabel = (state: string, language: DisplayLanguage) =>
    lifecycleLabel(state, language, orderStates);
export const fulfillmentStateDisplayLabel = (state: string, language: DisplayLanguage) =>
    lifecycleLabel(state, language, fulfillmentStates);
