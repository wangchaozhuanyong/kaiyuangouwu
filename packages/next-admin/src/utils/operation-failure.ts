export type OperationFailureCode =
    | 'PARTIAL_FAILURE'
    | 'RESOURCE_IN_USE'
    | 'VALIDATION_FAILED'
    | 'PERMISSION_DENIED'
    | 'SESSION_EXPIRED'
    | 'PASSWORD_INVALID'
    | 'CONFLICT'
    | 'NOT_FOUND'
    | 'STALE_DATA'
    | 'RATE_LIMITED'
    | 'TIMEOUT'
    | 'NETWORK_UNAVAILABLE'
    | 'SERVER_ERROR'
    | 'UNKNOWN';

export interface OperationFailure {
    code: OperationFailureCode;
    reason: string;
    details?: string[];
    resolution: string[];
    retryable: boolean;
    fieldErrors?: Record<string, string>;
    traceId?: string;
}

export interface NormalizeOperationFailureOptions {
    fallbackReason?: string;
    fallbackResolution?: string | string[];
    referenceId?: string;
    preferFallbackReason?: boolean;
}

interface ErrorDescriptor {
    message: string;
    code: string;
    extensions?: Record<string, unknown>;
}

const networkPattern =
    /failed to fetch|fetch failed|network(?: request)? (?:failed|error)|load failed|econnrefused|enotfound|socket hang up|connection refused|网络(?:连接)?(?:失败|异常)|无法连接/i;
const timeoutPattern = /timed? ?out|timeout|etimedout|超时/i;
const rateLimitPattern = /too many requests|rate limit|throttl|请求过于频繁|操作过于频繁/i;
const permissionPattern =
    /not(?:\s+\w+){0,2}\s+authorized|permission denied|forbidden|access denied|unauthorized|无权|没有权限|权限不足/i;
const sessionPattern =
    /authentication required|invalid session|session expired|invalid token|jwt expired|登录已过期|会话已过期|登录状态已过期/i;
const passwordPattern =
    /sensitive.action.password.invalid|password (?:is )?(?:invalid|incorrect)|incorrect password|密码不正确|密码错误/i;
const resourceInUsePattern =
    /foreign key constraint|violates foreign key|still (?:in use|referenced)|is (?:used|referenced|assigned)|used (?:in|as)|assigned to|cannot be deleted.+(?:used|default)|被.+(?:使用|引用|占用)|仍被|正在占用|关联记录|无法删除.+因为/i;
const conflictPattern = /conflict|duplicate|already exists|unique constraint|重复|已存在|冲突/i;
const stalePattern =
    /stale|optimistic|expectedupdatedat|concurrent|version mismatch|已发生变化|并发|版本不一致/i;
const notFoundPattern = /not found|does not exist|no .* with (?:the )?id|找不到|不存在|已被删除/i;
const validationPattern =
    /user.input.error|validation|invalid|required|must |cannot be empty|不能为空|必填|格式不正确|不符合要求|超出允许范围/i;
const serverPattern = /internal.server.error|status code 5\d\d|server error|服务器(?:内部|处理)?异常/i;
const technicalPattern =
    /combinedgraphqlerrors|cannot query field|graphql|sql(?:state)?|query failed|database|column |table |stack trace|syntax error|internal server error|status code 5\d\d|https?:\/\/|bearer\s|api[_ -]?key|token=|constraint ["'`]|typeorm/i;
const genericFallbackPattern =
    /^(?:操作|保存|创建|删除|上传|下载|提交|执行|处理|更新|加载|读取|配置|审核|发布|切换|刷新|导入|导出|登录|验证|请求|数据|服务)?.{0,14}失败(?:，|。|$).*(?:稍后重试|检查填写内容|检查.*权限|联系系统管理员|请重试)?[。！]?$/u;

const codeAliases: Record<string, OperationFailureCode> = {
    PARTIAL_FAILURE: 'PARTIAL_FAILURE',
    FORBIDDEN: 'PERMISSION_DENIED',
    UNAUTHORIZED: 'SESSION_EXPIRED',
    AUTHENTICATION_REQUIRED: 'SESSION_EXPIRED',
    SENSITIVE_ACTION_PASSWORD_INVALID: 'PASSWORD_INVALID',
    SENSITIVE_ACTION_PASSWORD_REQUIRED: 'PASSWORD_INVALID',
    USER_INPUT_ERROR: 'VALIDATION_FAILED',
    BAD_USER_INPUT: 'VALIDATION_FAILED',
    ENTITY_NOT_FOUND: 'NOT_FOUND',
    NOT_FOUND: 'NOT_FOUND',
    INTERNAL_SERVER_ERROR: 'SERVER_ERROR',
    TOO_MANY_REQUESTS: 'RATE_LIMITED',
    RATE_LIMITED: 'RATE_LIMITED',
};

export function normalizeOperationFailure(
    error: unknown,
    options: NormalizeOperationFailureOptions = {},
): OperationFailure {
    const descriptor = readErrorDescriptor(error);
    const extensions = descriptor.extensions ?? {};
    const explicitUserMessage = readString(extensions.userMessage) || readString(extensions.reason);
    const rawMessage = explicitUserMessage || descriptor.message;
    const code = classifyFailure(descriptor.code, rawMessage);
    const safeMessage = isSafeUserMessage(rawMessage) ? rawMessage : '';
    const fallbackReason = shouldUseFallbackReason(code)
        ? normalizeFallbackReason(options.fallbackReason)
        : '';
    const defaults = defaultFailureCopy(code);
    const details =
        readDetails(extensions) ??
        (code === 'RESOURCE_IN_USE' ? readLegacyResourceInUseDetails(descriptor.message) : undefined);
    const resolution =
        readStringList(extensions.resolution) ??
        normalizeResolution(options.fallbackResolution) ??
        defaults.resolution;
    const retryable = typeof extensions.retryable === 'boolean' ? extensions.retryable : defaults.retryable;
    const fieldErrors = readFieldErrors(extensions.fieldErrors);
    const traceId =
        readTraceId(extensions.traceId) ||
        readTraceId(extensions.requestId) ||
        (code === 'SERVER_ERROR' || code === 'UNKNOWN' ? readTraceId(options.referenceId) : undefined);

    return {
        code,
        reason:
            (options.preferFallbackReason ? fallbackReason : '') ||
            (explicitUserMessage || shouldKeepDetectedReason(code, safeMessage) ? safeMessage : '') ||
            fallbackReason ||
            defaults.reason,
        ...(details?.length ? { details } : {}),
        resolution,
        retryable,
        ...(fieldErrors ? { fieldErrors } : {}),
        ...(traceId ? { traceId } : {}),
    };
}

function shouldKeepDetectedReason(code: OperationFailureCode, message: string) {
    return (
        code === 'PARTIAL_FAILURE' ||
        (code === 'RESOURCE_IN_USE' && /^\s*\p{Script=Han}/u.test(message)) ||
        code === 'VALIDATION_FAILED' ||
        code === 'CONFLICT' ||
        code === 'NOT_FOUND' ||
        code === 'STALE_DATA' ||
        (code === 'UNKNOWN' && !isGenericUnknownMessage(message))
    );
}

function shouldUseFallbackReason(code: OperationFailureCode) {
    return (
        code === 'PARTIAL_FAILURE' ||
        code === 'RESOURCE_IN_USE' ||
        code === 'VALIDATION_FAILED' ||
        code === 'CONFLICT' ||
        code === 'NOT_FOUND' ||
        code === 'STALE_DATA' ||
        code === 'UNKNOWN'
    );
}

function readLegacyResourceInUseDetails(message: string) {
    const english = message.match(/(?:following|these)\s+(Channels|TaxRates)\s*:\s*([^.]+)(?:\.|$)/iu);
    const chinese = message.match(/以下(店铺|税率).*?[：:]\s*([^。]+)(?:。|$)/u);
    const kind = english?.[1] || chinese?.[1];
    const values = english?.[2] || chinese?.[2];
    if (!kind || !values) return undefined;
    const label = /channel|店铺/iu.test(kind) ? '店铺 Channel' : '税率';
    const details = values
        .split(/[,，]/u)
        .map(value => safeDetail(`${label}：${value.trim()}`))
        .filter((value): value is string => Boolean(value));
    return details.length ? details : undefined;
}

export function formatOperationFailure(failure: OperationFailure) {
    const parts = [failure.reason.replace(/[。；;\s]+$/u, '')];
    if (failure.details?.length) parts.push(`相关对象：${failure.details.join('、')}`);
    if (failure.resolution.length && !failure.reason.includes('处理方法：')) {
        parts.push(`处理方法：${failure.resolution.join('；')}`);
    }
    if (failure.traceId) parts.push(`本次操作编号：${failure.traceId}`);
    return `${parts.join('。')}。`;
}

function isGenericUnknownMessage(message: string) {
    if (!message) return true;
    return /^(?:failed|error|unknown error|unexpected error|operation failed|request failed|something went wrong)[.!]?$/iu.test(
        message,
    );
}

function classifyFailure(code: string, message: string): OperationFailureCode {
    const normalizedCode = code.trim().toUpperCase();
    const direct = codeAliases[normalizedCode];
    if (direct) return direct;
    if (/PASSWORD_(?:INVALID|INCORRECT)|INVALID_CREDENTIALS/u.test(normalizedCode)) return 'PASSWORD_INVALID';
    if (/(?:IN_USE|REFERENCED|ASSIGNED)/u.test(normalizedCode)) return 'RESOURCE_IN_USE';
    if (/(?:CONFLICT|DUPLICATE|ALREADY_EXISTS)/u.test(normalizedCode)) return 'CONFLICT';
    if (/(?:STALE|CONCURRENT|VERSION_MISMATCH)/u.test(normalizedCode)) return 'STALE_DATA';
    if (/(?:VALIDATION|INVALID|REQUIRED|MISSING)/u.test(normalizedCode)) return 'VALIDATION_FAILED';
    if (/(?:NOT_FOUND|DOES_NOT_EXIST)/u.test(normalizedCode)) return 'NOT_FOUND';
    if (/(?:RATE_LIMIT|TOO_MANY_REQUESTS|THROTTL)/u.test(normalizedCode)) return 'RATE_LIMITED';
    if (/(?:TIMEOUT|TIMED_OUT)/u.test(normalizedCode)) return 'TIMEOUT';
    if (/(?:NETWORK|OFFLINE|CONNECTION)/u.test(normalizedCode)) return 'NETWORK_UNAVAILABLE';
    if (/(?:INTERNAL|SERVER|DATABASE)/u.test(normalizedCode)) return 'SERVER_ERROR';

    if (passwordPattern.test(message)) return 'PASSWORD_INVALID';
    if (sessionPattern.test(message)) return 'SESSION_EXPIRED';
    if (permissionPattern.test(message)) return 'PERMISSION_DENIED';
    if (networkPattern.test(message)) return 'NETWORK_UNAVAILABLE';
    if (timeoutPattern.test(message)) return 'TIMEOUT';
    if (rateLimitPattern.test(message)) return 'RATE_LIMITED';
    if (resourceInUsePattern.test(message)) return 'RESOURCE_IN_USE';
    if (stalePattern.test(message)) return 'STALE_DATA';
    if (conflictPattern.test(message)) return 'CONFLICT';
    if (notFoundPattern.test(message)) return 'NOT_FOUND';
    if (validationPattern.test(message)) return 'VALIDATION_FAILED';
    if (serverPattern.test(message)) return 'SERVER_ERROR';
    return 'UNKNOWN';
}

function defaultFailureCopy(
    code: OperationFailureCode,
): Pick<OperationFailure, 'reason' | 'resolution' | 'retryable'> {
    switch (code) {
        case 'PARTIAL_FAILURE':
            return {
                reason: '批量操作仅完成了一部分',
                resolution: ['根据失败明细逐项处理，并且只重试失败项'],
                retryable: false,
            };
        case 'RESOURCE_IN_USE':
            return {
                reason: '该数据仍被其他业务记录使用，当前不能直接删除',
                resolution: ['先解除关联或将占用记录改绑到其他对象，再重新删除'],
                retryable: false,
            };
        case 'VALIDATION_FAILED':
            return {
                reason: '提交的数据未通过校验',
                resolution: ['按页面提示修正对应字段后重新提交'],
                retryable: false,
            };
        case 'PERMISSION_DENIED':
            return {
                reason: '当前账号没有执行此操作所需的权限',
                resolution: ['联系管理员开通相应权限，或切换到有权限的账号'],
                retryable: false,
            };
        case 'SESSION_EXPIRED':
            return {
                reason: '当前登录状态已过期或无效',
                resolution: ['重新登录后再次执行该操作'],
                retryable: false,
            };
        case 'PASSWORD_INVALID':
            return {
                reason: '当前管理员密码不正确',
                resolution: ['重新输入当前登录管理员账号的正确密码'],
                retryable: true,
            };
        case 'CONFLICT':
            return {
                reason: '提交的数据与现有记录发生冲突',
                resolution: ['检查重复名称、编码或唯一字段，修改后重新提交'],
                retryable: false,
            };
        case 'NOT_FOUND':
            return {
                reason: '目标记录不存在，可能已被删除或移动',
                resolution: ['刷新页面确认最新状态后再操作'],
                retryable: false,
            };
        case 'STALE_DATA':
            return {
                reason: '页面中的数据已经过期，服务器拒绝覆盖较新的修改',
                resolution: ['刷新页面获取最新数据，确认后重新操作'],
                retryable: false,
            };
        case 'RATE_LIMITED':
            return {
                reason: '短时间内请求次数过多，服务暂时拒绝处理',
                resolution: ['稍后再试，并避免连续重复点击'],
                retryable: true,
            };
        case 'TIMEOUT':
            return {
                reason: '管理服务未在规定时间内返回结果',
                resolution: ['先刷新当前数据确认操作是否已经生效，再决定是否重试'],
                retryable: true,
            };
        case 'NETWORK_UNAVAILABLE':
            return {
                reason: '浏览器当前无法连接管理服务',
                resolution: ['检查网络和管理服务状态后重试'],
                retryable: true,
            };
        case 'SERVER_ERROR':
            return {
                reason: '管理服务处理请求时发生内部异常',
                resolution: ['稍后重试；如果持续发生，请提供本次操作编号给系统管理员'],
                retryable: true,
            };
        default:
            return {
                reason: '管理服务没有返回可识别的失败原因',
                resolution: ['刷新当前数据后重试；如果持续发生，请提供本次操作编号给系统管理员'],
                retryable: true,
            };
    }
}

function readErrorDescriptor(error: unknown): ErrorDescriptor {
    if (typeof error === 'string') return { message: error.trim(), code: '' };
    if (error instanceof Error) {
        const record = error as Error & Record<string, unknown>;
        const nested = readNestedGraphqlError(record.errors) ?? readNestedGraphqlError(record.graphQLErrors);
        if (nested) return nested;
        return {
            message: error.message.trim(),
            code: readString(record.code) || '',
            extensions: isRecord(record.extensions) ? record.extensions : undefined,
        };
    }
    if (!isRecord(error)) return { message: '', code: '' };
    const nested = readNestedGraphqlError(error.errors) ?? readNestedGraphqlError(error.graphQLErrors);
    if (nested) return nested;
    const extensions = isRecord(error.extensions) ? error.extensions : undefined;
    return {
        message: readString(error.message) || '',
        code: readString(extensions?.code) || readString(error.errorCode) || readString(error.code) || '',
        extensions,
    };
}

function readNestedGraphqlError(value: unknown) {
    if (!Array.isArray(value)) return undefined;
    const first = value.find(isRecord);
    return first ? readErrorDescriptor(first) : undefined;
}

function readDetails(extensions: Record<string, unknown>) {
    const direct = readStringList(extensions.blockers) ?? readStringList(extensions.details);
    if (direct) return direct;
    const resources = Array.isArray(extensions.blockingResources)
        ? extensions.blockingResources
        : isRecord(extensions.details) && Array.isArray(extensions.details.items)
          ? extensions.details.items
          : undefined;
    if (!resources) return undefined;
    const formatted = resources.map(formatResource).filter((value): value is string => Boolean(value));
    return formatted.length ? formatted : undefined;
}

function formatResource(value: unknown) {
    if (typeof value === 'string') return safeDetail(value);
    if (!isRecord(value)) return undefined;
    const name = readString(value.name) || readString(value.label) || readString(value.title);
    const code = readString(value.code);
    const id = readString(value.id);
    if (name && code) return safeDetail(`${name}（${code}）`);
    if (name) return safeDetail(name);
    if (code) return safeDetail(`编码：${code}`);
    if (id) return safeDetail(`ID：${id}`);
    return undefined;
}

function safeDetail(value: string) {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    return normalized && normalized.length <= 160 && !technicalPattern.test(normalized)
        ? normalized
        : undefined;
}

function readStringList(value: unknown) {
    if (typeof value === 'string') {
        const normalized = safeDetail(value);
        return normalized ? [normalized] : undefined;
    }
    if (!Array.isArray(value)) return undefined;
    const values = value
        .map(item => (typeof item === 'string' ? safeDetail(item) : undefined))
        .filter(Boolean);
    return values.length ? (values as string[]) : undefined;
}

function readFieldErrors(value: unknown) {
    if (!isRecord(value)) return undefined;
    const entries = Object.entries(value)
        .map(([field, message]) => [field, readString(message)] as const)
        .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
    return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeResolution(value: string | string[] | undefined) {
    return readStringList(value);
}

function normalizeFallbackReason(value: string | undefined) {
    const normalized = value?.replace(/\s+/gu, ' ').trim() ?? '';
    if (
        !normalized ||
        normalized === '管理服务没有返回可识别的失败原因' ||
        genericFallbackPattern.test(normalized) ||
        technicalPattern.test(normalized)
    )
        return '';
    return normalized;
}

function isSafeUserMessage(message: string) {
    const normalized = message.replace(/\s+/gu, ' ').trim();
    if (!normalized || normalized.length > 240) return false;
    if (technicalPattern.test(normalized)) return false;
    if (/^[A-Z][A-Z0-9_]+$/u.test(normalized)) return false;
    return true;
}

function readTraceId(value: unknown) {
    const id = readString(value);
    return id && /^[A-Za-z0-9._:-]{4,120}$/u.test(id) ? id : undefined;
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
