import { describe, expect, it } from 'vitest';

import { formatOperationFailure, normalizeOperationFailure } from './operation-failure';

describe('normalizeOperationFailure', () => {
    it('keeps a safe business reason and extracts structured blockers and recovery steps', () => {
        const failure = normalizeOperationFailure({
            message: '商家主体仍被店铺使用',
            extensions: {
                code: 'RESOURCE_IN_USE',
                blockingResources: [{ id: 'channel-1', name: '美宜佳店铺', code: 'my-malaysia' }],
                resolution: ['先将 Channel 改绑到其他商家主体'],
                retryable: false,
            },
        });

        expect(failure).toEqual({
            code: 'RESOURCE_IN_USE',
            reason: '商家主体仍被店铺使用',
            details: ['美宜佳店铺（my-malaysia）'],
            resolution: ['先将 Channel 改绑到其他商家主体'],
            retryable: false,
        });
        expect(formatOperationFailure(failure)).toContain('相关对象：美宜佳店铺（my-malaysia）');
    });

    it.each([
        ['FORBIDDEN', '当前账号没有执行此操作所需的权限', 'PERMISSION_DENIED'],
        ['UNAUTHORIZED', '当前登录状态已过期或无效', 'SESSION_EXPIRED'],
        ['SENSITIVE_ACTION_PASSWORD_INVALID', '当前管理员密码不正确', 'PASSWORD_INVALID'],
        ['TOO_MANY_REQUESTS', '短时间内请求次数过多', 'RATE_LIMITED'],
    ])('maps %s to an actionable reason', (code, reason, expectedCode) => {
        const failure = normalizeOperationFailure({ message: code, extensions: { code } });
        expect(failure.code).toBe(expectedCode);
        expect(failure.reason).toContain(reason);
        expect(failure.resolution.length).toBeGreaterThan(0);
    });

    it('recognizes a foreign-key failure without exposing database details', () => {
        const failure = normalizeOperationFailure(
            new Error(
                'QueryFailedError: update or delete violates foreign key constraint "FK_channel_seller"',
            ),
        );

        expect(failure).toMatchObject({
            code: 'RESOURCE_IN_USE',
            reason: '该数据仍被其他业务记录使用，当前不能直接删除',
            retryable: false,
        });
        expect(formatOperationFailure(failure)).not.toContain('FK_channel_seller');
    });

    it('turns a legacy English zone blocker into a Chinese reason with the exact channel', () => {
        const failure = normalizeOperationFailure(
            new Error(
                'The selected Zone cannot be deleted as it used as a default in the following Channels: 美宜佳',
            ),
        );

        expect(failure).toMatchObject({
            code: 'RESOURCE_IN_USE',
            reason: '该数据仍被其他业务记录使用，当前不能直接删除',
            details: ['店铺 Channel：美宜佳'],
        });
    });

    it('keeps exact seller channel codes even when the API locale returns English', () => {
        const failure = normalizeOperationFailure(
            new Error(
                'Seller "MY Seller" cannot be deleted because it is still used by these Channels: MYR, retail. Reassign those Channels first',
            ),
        );

        expect(failure).toMatchObject({
            code: 'RESOURCE_IN_USE',
            details: ['店铺 Channel：MYR', '店铺 Channel：retail'],
        });
        expect(failure.reason).not.toContain('Seller "MY Seller"');
    });

    it('does not fall back to an unhelpful generic failure sentence', () => {
        const failure = normalizeOperationFailure(undefined, {
            fallbackReason: '删除失败，请检查填写内容和账号权限后重试',
            referenceId: 'delete-seller-1234',
        });

        expect(failure).toMatchObject({
            code: 'UNKNOWN',
            reason: '管理服务没有返回可识别的失败原因',
            traceId: 'delete-seller-1234',
        });
        expect(formatOperationFailure(failure)).toContain('处理方法：');
    });

    it('uses GraphQL field errors for validation feedback', () => {
        const failure = normalizeOperationFailure({
            message: '店铺资料未通过校验',
            extensions: {
                code: 'USER_INPUT_ERROR',
                fieldErrors: { storefrontNameZh: '店铺中文名称不能为空' },
            },
        });

        expect(failure).toMatchObject({
            code: 'VALIDATION_FAILED',
            fieldErrors: { storefrontNameZh: '店铺中文名称不能为空' },
        });
    });
});
