import { describe, expect, it } from 'vitest';
import { toUserFacingError } from './user-facing-error';

describe('toUserFacingError', () => {
  it.each([
    'Forbidden',
    'You are not authorized to perform this action',
    'You are not currently authorized to perform this action',
  ])('turns permission errors into clear Chinese copy: %s', message => {
    expect(toUserFacingError(new Error(message))).toBe('当前账号没有访问该功能的权限');
  });

  it('does not expose technical GraphQL errors', () => {
    expect(toUserFacingError(new Error('CombinedGraphQLErrors: Cannot query field secret'))).toBe(
      '数据加载失败，请稍后重试或联系系统管理员',
    );
  });
});
