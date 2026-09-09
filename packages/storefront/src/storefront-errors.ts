import type { StorefrontLanguage } from './types';

type Copy = Readonly<Record<StorefrontLanguage, string>>;
const copy = (zh: string, en: string): Copy => ({ zh, en });

/** Only reviewed customer-facing copy crosses the error presentation boundary. Keep raw errors intact. */
export const storefrontErrorCopy = {
    UNKNOWN: copy(
        '操作暂时未能完成，请稍后重试。',
        'The request could not be completed. Please try again later.',
    ),
    NETWORK_ERROR: copy(
        '网络连接失败，请检查网络后重试。',
        'Network connection failed. Check your connection and try again.',
    ),
    REQUEST_TIMEOUT: copy(
        '请求超时，请检查网络后重试。',
        'The request timed out. Check your connection and try again.',
    ),
    UNKNOWN_RESULT: copy(
        '提交结果尚未确认，请保持当前内容并重试核对，勿重复提交。',
        'The result is not confirmed. Keep the same details and retry to check the result; do not submit again.',
    ),
    RATE_LIMITED: copy('操作过于频繁，请稍后重试。', 'Too many requests. Please wait and try again.'),
    SERVICE_UNAVAILABLE: copy(
        '服务暂时不可用，请稍后重试。',
        'The service is temporarily unavailable. Please try again later.',
    ),
    FORBIDDEN: copy(
        '当前无法执行此操作，请确认登录状态后重试。',
        'This action is unavailable. Check your sign-in status and try again.',
    ),
    UNAUTHORIZED: copy('请先登录后继续操作。', 'Please sign in to continue.'),
    USER_INPUT_ERROR: copy(
        '提交的信息有误，请检查后重试。',
        'Some details are invalid. Please check them and try again.',
    ),
    INSUFFICIENT_STOCK_ERROR: copy(
        '商品库存不足，请调整数量或移除缺货商品。',
        'There is not enough stock. Reduce the quantity or remove unavailable items.',
    ),
    CART_LINE_UNAVAILABLE_ERROR: copy(
        '商品已下架或暂时不可购买，请移除后重试。',
        'This item is no longer available. Remove it and try again.',
    ),
    CART_REVISION_CONFLICT_ERROR: copy(
        '购物车已更新，请确认最新内容后重新操作。',
        'Your cart has changed. Review the latest items and try again.',
    ),
    CART_SCOPE_CHANGED: copy(
        '购物车会话已变更，请刷新后重试。',
        'Your cart session has changed. Refresh and try again.',
    ),
    CART_LINE_NOT_FOUND_ERROR: copy(
        '该商品已不在当前购物车中，请刷新后重试。',
        'This item is no longer in your cart. Refresh and try again.',
    ),
    CART_CHECKOUT_LOCKED_ERROR: copy(
        '订单正在等待支付，请先返回修改订单。',
        'This order is awaiting payment. Reopen it before editing.',
    ),
    CART_EMPTY_SELECTION_ERROR: copy(
        '请先选择库存充足的商品再结算。',
        'Select items with enough stock before checking out.',
    ),
    INVALID_CART_QUANTITY_ERROR: copy(
        '商品数量超出允许范围，请调整数量。',
        'The quantity is outside the allowed range. Please adjust it.',
    ),
    ORDER_LIMIT_ERROR: copy(
        '商品数量超过单笔订单上限，请减少数量。',
        'The order quantity limit has been reached. Please reduce the quantity.',
    ),
    CART_PROJECTION_ERROR: copy(
        '所选商品暂时无法同步到结算，请刷新购物车后重试。',
        'The selected items could not be prepared for checkout. Refresh your cart and try again.',
    ),
    CART_COMMAND_CANCELLED: copy(
        '本次购物车操作已取消，已显示确认后的内容。',
        'This cart change was cancelled. The confirmed items are shown.',
    ),
    CART_INPUT_REJECTED: copy(
        '购物车操作未生效，请检查商品和填写的信息。',
        'The cart change was not applied. Check the items and entered details.',
    ),
    CART_BUSY: copy(
        '购物车正在更新，请稍后再操作。',
        'Your cart is updating. Please wait before making another change.',
    ),
    INVALID_CART_COMMAND: copy(
        '购物车操作未能完成，请刷新后重试。',
        'The cart change could not be completed. Refresh and try again.',
    ),
    COMMAND_ID_REUSED: copy(
        '本次操作与之前的请求不一致，请刷新后重试。',
        'This change differs from the previous request. Refresh and try again.',
    ),
    NO_ACTIVE_ORDER_ERROR: copy(
        '当前没有可结算的订单，请重新选择商品。',
        'There is no active order. Please select your items again.',
    ),
    ORDER_NOT_EDITABLE: copy(
        '订单状态已变更，当前无法修改，请刷新查看。',
        'The order status has changed and it cannot be edited. Refresh to view it.',
    ),
    ORDER_STATE_TRANSITION_ERROR: copy(
        '订单状态已变更，请刷新订单后重试。',
        'The order status has changed. Refresh the order and try again.',
    ),
    ORDER_MODIFICATION_ERROR: copy(
        '订单暂时无法修改，请刷新订单后重试。',
        'The order cannot be changed right now. Refresh it and try again.',
    ),
    ORDER_NOT_FOUND: copy('订单不存在或无权查看。', 'This order could not be found or is not accessible.'),
    PRODUCT_NOT_FOUND: copy(
        '商品不存在或已下架。',
        'This product could not be found or is no longer available.',
    ),
    NO_SHIPPING_METHOD: copy(
        '当前地址没有可用配送方式，请更换收货地址。',
        'No delivery is available for this address. Please choose another address.',
    ),
    INELIGIBLE_SHIPPING_METHOD_ERROR: copy(
        '此配送方式不适用于当前订单，请重新选择。',
        'This delivery method is not available for this order. Please choose another one.',
    ),
    INELIGIBLE_PAYMENT_METHOD_ERROR: copy(
        '此支付方式暂时不可用，请选择其他支付方式。',
        'This payment method is unavailable. Please choose another method.',
    ),
    PAYMENT_FAILED_ERROR: copy(
        '支付未完成，请检查订单状态后重试或更换支付方式。',
        'Payment was not completed. Check the order status before retrying or choosing another method.',
    ),
    PAYMENT_DECLINED_ERROR: copy(
        '支付被拒绝，请检查付款信息或更换支付方式。',
        'Payment was declined. Check your payment details or choose another method.',
    ),
    PAYMENT_STATE_TRANSITION_ERROR: copy(
        '支付状态已变更，请刷新订单确认结果。',
        'The payment status has changed. Refresh the order to check the result.',
    ),
    COUPON_CODE_INVALID_ERROR: copy(
        '优惠券无效或不适用于当前订单。',
        'This coupon is invalid or does not apply to the current order.',
    ),
    COUPON_CODE_EXPIRED_ERROR: copy(
        '优惠券已过期，请选择其他优惠券。',
        'This coupon has expired. Please choose another one.',
    ),
    COUPON_CODE_LIMIT_ERROR: copy('优惠券使用次数已达上限。', 'This coupon has reached its usage limit.'),
    INVALID_CREDENTIALS_ERROR: copy(
        '电子邮箱或密码错误，请检查后重试',
        'The email address or password is incorrect',
    ),
    NOT_VERIFIED_ERROR: copy(
        '该电子邮箱尚未验证，请先查收验证邮件',
        'This email address has not been verified. Check your verification email first',
    ),
    EMAIL_ADDRESS_CONFLICT_ERROR: copy(
        '该电子邮箱已注册，请直接登录或使用其他邮箱',
        'This email address is already registered. Sign in or use another email',
    ),
    PASSWORD_VALIDATION_ERROR: copy(
        '密码不符合安全要求，请重新设置',
        'The password does not meet the security requirements',
    ),
    MISSING_PASSWORD_ERROR: copy('请输入密码', 'Enter a password'),
    NATIVE_AUTH_STRATEGY_ERROR: copy(
        '账户服务暂时不可用，请稍后重试。',
        'Account services are temporarily unavailable. Please try again later.',
    ),
    VERIFICATION_TOKEN_EXPIRED_ERROR: copy(
        '验证链接已过期，请重新发送验证邮件',
        'This verification link has expired. Request a new verification email.',
    ),
    VERIFICATION_TOKEN_INVALID_ERROR: copy(
        '验证链接无效或已经使用',
        'This verification link is invalid or has already been used.',
    ),
    PASSWORD_RESET_TOKEN_EXPIRED_ERROR: copy(
        '重置密码链接已过期，请重新申请。',
        'This password reset link has expired. Request a new one.',
    ),
    PASSWORD_RESET_TOKEN_INVALID_ERROR: copy(
        '重置密码链接无效或已经使用，请重新申请。',
        'This password reset link is invalid or has already been used. Request a new one.',
    ),
    IDENTIFIER_CHANGE_TOKEN_EXPIRED_ERROR: copy(
        '更换邮箱链接已过期，请重新申请。',
        'This email change link has expired. Request a new one.',
    ),
    IDENTIFIER_CHANGE_TOKEN_INVALID_ERROR: copy(
        '更换邮箱链接无效或已经使用。',
        'This email change link is invalid or has already been used.',
    ),
    EMAIL_INVALID: copy('请输入有效的交付邮箱。', 'Enter a valid delivery email address.'),
    EMAIL_MISMATCH: copy('两次输入的交付邮箱不一致。', 'The delivery email entries do not match.'),
    EMAIL_NOT_FOUND: copy(
        '交付邮箱不存在，请重新选择。',
        'This delivery email no longer exists. Please choose another one.',
    ),
    EMAIL_LABEL_TOO_LONG: copy(
        '邮箱备注不能超过 80 个字符。',
        'The email label cannot exceed 80 characters.',
    ),
    UPLOAD_FAILED: copy(
        '文件上传失败，请稍后重试。',
        'The file could not be uploaded. Please try again later.',
    ),
    FILE_TOO_LARGE: copy(
        '文件太大，请压缩或选择较小的文件。',
        'This file is too large. Compress it or choose a smaller file.',
    ),
    INVALID_FILE_TYPE: copy(
        '文件格式不支持，请选择支持的图片格式。',
        'This file type is not supported. Please choose a supported image format.',
    ),
    IMAGE_RESOLUTION_MISMATCH: copy(
        '生成图片的尺寸不符合要求，请调整清晰度或画幅后重试。',
        'The generated image dimensions did not match. Adjust the resolution or aspect ratio and retry.',
    ),
    CREDENTIAL_UNAVAILABLE: copy(
        '图片服务暂时不可用，请稍后重试。',
        'The image service is temporarily unavailable. Please try again later.',
    ),
    INSUFFICIENT_BALANCE: copy(
        '可用余额不足，请充值或调整本次用量。',
        'Your available balance is insufficient. Add funds or reduce the requested usage.',
    ),
    QUOTA_EXCEEDED: copy(
        '本次可用额度已用完，请稍后重试或调整用量。',
        'Your available allowance has been used. Try later or reduce the requested usage.',
    ),
    CONTENT_REJECTED: copy(
        '当前内容无法处理，请调整内容后重试。',
        'This content could not be processed. Please revise it and try again.',
    ),
} satisfies Record<string, Copy>;

type ErrorCode = keyof typeof storefrontErrorCopy;
const aliases: Record<string, ErrorCode> = {
    BAD_USER_INPUT: 'USER_INPUT_ERROR',
    INTERNAL_SERVER_ERROR: 'SERVICE_UNAVAILABLE',
    ORDER_MISSING: 'NO_ACTIVE_ORDER_ERROR',
    ORDER_LINE_MISSING: 'CART_PROJECTION_ERROR',
    STOREFRONT_INVALID_CREDENTIALS: 'INVALID_CREDENTIALS_ERROR',
    STOREFRONT_ACCOUNT_NOT_FOUND: 'INVALID_CREDENTIALS_ERROR',
    STOREFRONT_INVALID_PASSWORD: 'INVALID_CREDENTIALS_ERROR',
    'Cart session changed.': 'CART_SCOPE_CHANGED',
    'Checkout session is no longer available.': 'NO_ACTIVE_ORDER_ERROR',
    'Checkout session is missing.': 'NO_ACTIVE_ORDER_ERROR',
    'Checkout changed. Please review again.': 'NO_ACTIVE_ORDER_ERROR',
    '结算会话已变更，请重新确认': 'NO_ACTIVE_ORDER_ERROR',
    'Product not found': 'PRODUCT_NOT_FOUND',
    商品不存在或已下架: 'PRODUCT_NOT_FOUND',
    'Order not found': 'ORDER_NOT_FOUND',
    订单不存在或无权查看: 'ORDER_NOT_FOUND',
    当前地址没有可用配送方式: 'NO_SHIPPING_METHOD',
    'No delivery is available for this address': 'NO_SHIPPING_METHOD',
    两次输入的交付邮箱不一致: 'EMAIL_MISMATCH',
    'The delivery email entries do not match': 'EMAIL_MISMATCH',
    请输入有效的交付邮箱: 'EMAIL_INVALID',
    请填写有效的交付邮箱: 'EMAIL_INVALID',
    'Enter a valid delivery email address': 'EMAIL_INVALID',
    交付邮箱不存在: 'EMAIL_NOT_FOUND',
    '邮箱备注不能超过 80 个字符': 'EMAIL_LABEL_TOO_LONG',
    当前没有可结账的订单: 'NO_ACTIVE_ORDER_ERROR',
    请登录后管理交付邮箱: 'UNAUTHORIZED',
    请先登录: 'UNAUTHORIZED',
    找不到当前客户: 'UNAUTHORIZED',
    '上次操作正在核对，请稍后再修改购物车。': 'UNKNOWN_RESULT',
    '上次操作结果尚未确认，请先重试核对。': 'UNKNOWN_RESULT',
    '购物车操作结果尚未确认。': 'UNKNOWN_RESULT',
    '保存结果尚未确认，请重试核对后再结算。': 'UNKNOWN_RESULT',
    '尚未找到操作回执，请继续核对或取消待确认操作。': 'UNKNOWN_RESULT',
    '正在切换币种或确认结算，请稍后再修改商品。': 'CART_BUSY',
    'Cart acknowledgement is missing.': 'UNKNOWN_RESULT',
    '购物车更新未生效，请检查后重试。': 'CART_INPUT_REJECTED',
};

interface ErrorDetails {
    errorCode?: string;
    causeCode?: string;
    authenticationError?: string;
    message?: string;
    name?: string;
    status?: number;
    resultUnknown?: boolean;
    selectionRejected?: boolean;
}

function knownCode(value?: string): ErrorCode | undefined {
    if (!value) return;
    if (Object.hasOwn(storefrontErrorCopy, value)) return value as ErrorCode;
    return Object.hasOwn(aliases, value) ? aliases[value] : undefined;
}

export function storefrontErrorCode(error: unknown): ErrorCode | undefined {
    const details: ErrorDetails = typeof error === 'object' && error !== null ? error : {};
    const message = typeof error === 'string' ? error : (details.message ?? '');
    if (details.resultUnknown) return 'UNKNOWN_RESULT';
    if (details.name === 'ShopApiTimeoutError') return 'REQUEST_TIMEOUT';
    const code =
        knownCode(details.authenticationError) ??
        knownCode(details.causeCode) ??
        knownCode(details.errorCode);
    // Legacy projection/input envelopes can carry a more specific cause in their message.
    if (code && !['CART_PROJECTION_ERROR', 'CART_INPUT_REJECTED', 'USER_INPUT_ERROR'].includes(code))
        return code;
    const known = knownCode(message);
    if (known) return known;
    if (/failed to fetch|network(?:error| request)?|load failed/i.test(message)) return 'NETWORK_ERROR';
    if (/timeout|timed out|请求超时/i.test(message)) return 'REQUEST_TIMEOUT';
    if (details.status === 429 || /too many requests|rate.limit|操作过于频繁/i.test(message))
        return 'RATE_LIMITED';
    if (details.status === 401) return 'UNAUTHORIZED';
    if (details.status === 403) return 'FORBIDDEN';
    if (details.status === 413) return 'FILE_TOO_LARGE';
    if (details.status && details.status >= 500) return 'SERVICE_UNAVAILABLE';
    if (/insufficient.stock|out of stock|库存不足|库存已不足|已售罄/i.test(message))
        return 'INSUFFICIENT_STOCK_ERROR';
    if (/余额不足|insufficient.balance/i.test(message)) return 'INSUFFICIENT_BALANCE';
    if (/额度.*(?:不足|用完)|quota.exceeded/i.test(message)) return 'QUOTA_EXCEEDED';
    if (/content.policy|content.rejected|内容.*(?:违规|无法处理)/i.test(message)) return 'CONTENT_REJECTED';
    if (/^UPSTREAM_/.test(details.errorCode ?? '')) return 'SERVICE_UNAVAILABLE';
    return code;
}

export function storefrontErrorMessage(
    error: unknown,
    language: StorefrontLanguage,
    fallback?: string,
): string {
    const code = storefrontErrorCode(error);
    const message = code
        ? storefrontErrorCopy[code][language]
        : (fallback ?? storefrontErrorCopy.UNKNOWN[language]);
    if (typeof error === 'object' && error !== null && (error as ErrorDetails).selectionRejected) {
        return language === 'zh'
            ? `本次选择未生效，已恢复原来的选择。${message}`
            : `This selection was not applied. Your previous selection has been restored. ${message}`;
    }
    return message;
}
