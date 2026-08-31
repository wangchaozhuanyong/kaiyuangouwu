export const PASSWORD_REQUIREMENT = '至少 8 位，并同时包含字母、数字和符号';

export function isStrongAdministratorPassword(password: string) {
  return password.length >= 8
    && /\p{L}/u.test(password)
    && /\p{N}/u.test(password)
    && /[\p{P}\p{S}]/u.test(password)
    && !/[\r\n]/.test(password);
}
