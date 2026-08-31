import { describe, expect, it } from 'vitest';
import { isAuthenticationRequiredError } from './authentication-error';

describe('isAuthenticationRequiredError', () => {
  it.each([
    'You are not currently authorized to perform this action',
    'Authentication required',
    'Invalid authentication token',
  ])('识别需要重新登录的错误：%s', message => {
    expect(isAuthenticationRequiredError(new Error(message))).toBe(true);
  });

  it('不把已登录账号的功能权限错误当成会话失效', () => {
    expect(isAuthenticationRequiredError(new Error('Permission denied for this operation'))).toBe(false);
  });
});
