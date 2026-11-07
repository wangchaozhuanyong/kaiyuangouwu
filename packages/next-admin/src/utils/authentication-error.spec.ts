import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { GraphQLError } from 'graphql';
import { describe, expect, it } from 'vitest';
import { isAuthenticationRequiredError, isMissingAdminSession } from './authentication-error';

describe('isAuthenticationRequiredError', () => {
    it.each([
        'You are not currently authorized to perform this action',
        'Authentication required',
        'Invalid authentication token',
        '你当前无权执行此操作',
    ])('识别需要重新登录的错误：%s', message => {
        expect(isAuthenticationRequiredError(new Error(message))).toBe(true);
    });

    it('不把已登录账号的功能权限错误当成会话失效', () => {
        expect(isAuthenticationRequiredError(new Error('Permission denied for this operation'))).toBe(false);
    });

    it.each(['errors', 'graphQLErrors'])('识别 %s 中不依赖显示语言的会话检查错误', key => {
        expect(
            isAuthenticationRequiredError({
                [key]: [
                    {
                        message: 'Localized session error',
                        path: ['merchantInitialPasswordStatus'],
                        extensions: { code: 'FORBIDDEN' },
                    },
                ],
            }),
        ).toBe(true);
    });

    it('识别当前用户检查失败以及明确的未登录错误', () => {
        expect(
            isAuthenticationRequiredError({ errors: [{ path: ['me'], extensions: { code: 'FORBIDDEN' } }] }),
        ).toBe(true);
        expect(isAuthenticationRequiredError({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] })).toBe(
            true,
        );
    });

    it('保留业务权限错误，不把所有 FORBIDDEN 都跳转为登录', () => {
        for (const path of [undefined, ['products'], ['activeAdministrator'], ['me', 'channels']]) {
            expect(
                isAuthenticationRequiredError({
                    errors: [{ message: '你当前无权执行此操作', path, extensions: { code: 'FORBIDDEN' } }],
                }),
            ).toBe(false);
        }
        expect(
            isAuthenticationRequiredError({
                errors: [{ path: ['me'], extensions: { code: 'INTERNAL_SERVER_ERROR' } }],
            }),
        ).toBe(false);
    });

    it('只将 HTTP 401 识别为会话失效', () => {
        expect(isAuthenticationRequiredError({ statusCode: 401 })).toBe(true);
        expect(isAuthenticationRequiredError({ networkError: { statusCode: 401 } })).toBe(true);
        expect(isAuthenticationRequiredError({ statusCode: 403 })).toBe(false);
        expect(isAuthenticationRequiredError(new Error('Failed to fetch'))).toBe(false);
        expect(isAuthenticationRequiredError(undefined)).toBe(false);
    });
});

it('recognizes denied authenticated-only configuration without treating business fields as session proof', () => {
    expect(
        isAuthenticationRequiredError({
            errors: [{ path: ['globalSettings'], extensions: { code: 'FORBIDDEN' } }],
        }),
    ).toBe(true);
    expect(
        isAuthenticationRequiredError({
            errors: [{ path: ['globalSettings', 'serverConfig'], extensions: { code: 'FORBIDDEN' } }],
        }),
    ).toBe(false);
    expect(isMissingAdminSession(undefined, { statusCode: 401 })).toBe(true);
    expect(isMissingAdminSession(undefined, { statusCode: 403 })).toBe(false);
    const error = new CombinedGraphQLErrors({
        errors: [new GraphQLError('denied', { path: ['globalSettings'], extensions: { code: 'FORBIDDEN' } })],
    });
    expect(isMissingAdminSession(undefined, error)).toBe(false);
    expect(isMissingAdminSession({ me: { id: 'valid' } }, { statusCode: 401 })).toBe(false);
});
