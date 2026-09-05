import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    SENSITIVE_ACTION_PASSWORD_HEADER,
    SENSITIVE_ACTION_PASSWORD_REQUIRED,
    registerSensitiveActionPasswordPrompt,
    sensitiveActionPasswordLink,
} from './apollo-sensitive-action';

const DELETE_SELLER_MUTATION = gql`
    mutation DeleteSeller($id: ID!) {
        deleteSeller(id: $id) {
            result
        }
    }
`;

const unregisterPrompts: Array<() => void> = [];

afterEach(() => {
    unregisterPrompts.splice(0).forEach(unregister => unregister());
});

describe('sensitiveActionPasswordLink', () => {
    it('prompts once and retries the protected mutation with the password header', async () => {
        const prompt = vi.fn().mockResolvedValue('Current123!');
        unregisterPrompts.push(registerSensitiveActionPasswordPrompt(prompt));
        const requests: Array<Record<string, string> | undefined> = [];
        const client = createClient(operation => {
            requests.push(operation.getContext().headers as Record<string, string> | undefined);
            if (requests.length === 1) return passwordRequiredResult();
            return { data: { deleteSeller: { result: 'DELETED' } } };
        });

        const result = await client.mutate<{ deleteSeller: { result: string } }>({
            mutation: DELETE_SELLER_MUTATION,
            variables: { id: 'seller-1' },
            context: { headers: { 'x-request-id': 'request-1' } },
        });

        expect(result.data?.deleteSeller.result).toBe('DELETED');
        expect(prompt).toHaveBeenCalledOnce();
        expect(prompt).toHaveBeenCalledWith({ operationName: 'DeleteSeller' });
        expect(requests).toHaveLength(2);
        expect(requests[1]).toEqual({
            'x-request-id': 'request-1',
            [SENSITIVE_ACTION_PASSWORD_HEADER]: 'Current123!',
        });
    });

    it('does not retry or prompt again when the supplied password is rejected', async () => {
        const prompt = vi.fn().mockResolvedValue('wrong');
        unregisterPrompts.push(registerSensitiveActionPasswordPrompt(prompt));
        let requestCount = 0;
        const client = createClient(() => {
            requestCount += 1;
            if (requestCount === 1) return passwordRequiredResult();
            return {
                errors: [
                    {
                        message: '当前账号密码不正确',
                        extensions: { code: 'SENSITIVE_ACTION_PASSWORD_INVALID' },
                    },
                ],
            };
        });

        await expect(
            client.mutate({ mutation: DELETE_SELLER_MUTATION, variables: { id: 'seller-1' } }),
        ).rejects.toThrow('当前账号密码不正确');
        expect(requestCount).toBe(2);
        expect(prompt).toHaveBeenCalledOnce();
    });

    it('stops without retrying when the administrator cancels the password prompt', async () => {
        const prompt = vi.fn().mockResolvedValue(null);
        unregisterPrompts.push(registerSensitiveActionPasswordPrompt(prompt));
        let requestCount = 0;
        const client = createClient(() => {
            requestCount += 1;
            return passwordRequiredResult();
        });

        await expect(
            client.mutate({ mutation: DELETE_SELLER_MUTATION, variables: { id: 'seller-1' } }),
        ).rejects.toMatchObject({ sensitiveActionCancelled: true });
        expect(requestCount).toBe(1);
    });

    it('passes unrelated GraphQL errors through without opening a password prompt', async () => {
        const prompt = vi.fn().mockResolvedValue('Current123!');
        unregisterPrompts.push(registerSensitiveActionPasswordPrompt(prompt));
        const client = createClient(() => ({
            errors: [{ message: '仍被 Channel 使用，不能删除', extensions: { code: 'USER_INPUT_ERROR' } }],
        }));

        await expect(
            client.mutate({ mutation: DELETE_SELLER_MUTATION, variables: { id: 'seller-1' } }),
        ).rejects.toThrow('仍被 Channel 使用，不能删除');
        expect(prompt).not.toHaveBeenCalled();
    });
});

function passwordRequiredResult() {
    return {
        errors: [
            {
                message: '请输入当前账号密码后继续',
                extensions: { code: SENSITIVE_ACTION_PASSWORD_REQUIRED },
            },
        ],
    };
}

function createClient(resolve: (operation: ApolloLink.Operation) => ApolloLink.Result) {
    const terminalLink = new ApolloLink(
        operation =>
            new Observable(observer => {
                observer.next(resolve(operation));
                observer.complete();
            }),
    );
    return new ApolloClient({
        link: sensitiveActionPasswordLink.concat(terminalLink),
        cache: new InMemoryCache(),
    });
}
