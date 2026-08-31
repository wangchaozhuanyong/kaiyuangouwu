import { describe, expect, it } from 'vitest';
import { isStrongAdministratorPassword } from './password';

describe('isStrongAdministratorPassword', () => {
  it.each(['SafePassword9!', '安全管理密码9！'])('accepts a strong administrator password: %s', password => {
    expect(isStrongAdministratorPassword(password)).toBe(true);
  });

  it.each([
    'Short1!',
    'OnlyLetters!',
    'OnlyNumbers123',
    'Letters123',
    'SafePassword9!\n',
  ])('rejects a password that does not meet every requirement: %s', password => {
    expect(isStrongAdministratorPassword(password)).toBe(false);
  });
});
