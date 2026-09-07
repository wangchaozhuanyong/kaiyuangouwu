import { describe, expect, it } from 'vitest';
import { toUserFacingError } from './user-facing-error';

describe('toUserFacingError', () => {
    it.each([
        'Forbidden',
        'You are not authorized to perform this action',
        'You are not currently authorized to perform this action',
    ])('turns permission errors into clear Chinese copy: %s', message => {
        expect(toUserFacingError(new Error(message))).toBe(
            '当前账号没有执行此操作所需的权限。处理方法：联系管理员开通相应权限，或切换到有权限的账号。',
        );
    });

    it('does not expose technical GraphQL errors', () => {
        const message = toUserFacingError(
            new Error('CombinedGraphQLErrors: Cannot query field secret'),
            '数据加载失败，请稍后重试或联系系统管理员',
        );
        expect(message).toContain('管理服务没有返回可识别的失败原因');
        expect(message).toContain('处理方法：');
        expect(message).not.toContain('secret');
    });

    it('explains resource conflicts without exposing SQL details', () => {
        const message = toUserFacingError(
            new Error('QueryFailedError: violates foreign key constraint "FK_channel_seller"'),
            '删除失败',
        );
        expect(message).toContain('该数据仍被其他业务记录使用');
        expect(message).toContain('先解除关联');
        expect(message).not.toContain('FK_channel_seller');
    });
});
