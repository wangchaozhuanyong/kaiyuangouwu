import type { DocumentNode } from 'graphql';
import { getOperationAST } from 'graphql';

export interface AdminMutationFeedbackOptions {
    pending?: string;
    success?: string;
    failure?: string;
    skipPending?: boolean;
    skipSuccess?: boolean;
}

export type AdminMutationFeedbackContext = false | AdminMutationFeedbackOptions;

export interface MutationFeedbackCopy {
    action: string;
    pending: string;
    success: string;
    failure: string;
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
    [/^(Review|Verify|Approve|Reject|Moderate)/u, '审核'],
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
    [/^(Transfer|Rotate|Rollback|Reveal|Preview|Touch)/u, '操作'],
];

export function isMutationDocument(document: DocumentNode, operationName?: string) {
    return getOperationAST(document, operationName)?.operation === 'mutation';
}

export function getMutationFeedbackCopy(
    operationName: string | undefined,
    options: AdminMutationFeedbackOptions = {},
): MutationFeedbackCopy {
    const normalizedName = (operationName || '').replace(/^(?:NextAdmin|Admin)/u, '');
    const action = actionRules.find(([pattern]) => pattern.test(normalizedName))?.[1] ?? '操作';

    return {
        action,
        pending: options.pending ?? `${action}中…`,
        success: options.success ?? `${action}成功`,
        failure: options.failure ?? `${action}失败，请检查填写内容和账号权限后重试`,
    };
}

export function extractMutationFailure(data: unknown): string | null {
    if (!isRecord(data)) return null;

    for (const value of Object.values(data)) {
        const failure = extractRootResultFailure(value);
        if (failure) return failure;
    }

    return null;
}

function extractRootResultFailure(value: unknown): string | null {
    if (value == null) return '管理服务未返回操作结果';
    if (value === false) return '服务端未接受此次操作';
    if (Array.isArray(value)) {
        for (const item of value) {
            const failure = extractRootResultFailure(item);
            if (failure) return failure;
        }
        return null;
    }
    if (!isRecord(value)) return null;

    const typename = readString(value.__typename);
    const message = readString(value.message);
    const errorCode = readString(value.errorCode);
    const result = readString(value.result)?.toUpperCase();
    const directError = readString(value.error);
    const isErrorUnion = Boolean(typename && /(?:Error|ErrorResult)$/u.test(typename));

    if (isErrorUnion) return message || '服务端拒绝了此次操作';
    if (value.success === false) return message || directError || '服务端未接受此次操作';
    if (result && failureResults.has(result)) return message || directError || '服务端未完成此次操作';
    if (errorCode && message) return message;

    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readString(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
