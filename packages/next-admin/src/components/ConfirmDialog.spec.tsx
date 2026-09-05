// @vitest-environment jsdom

import { ApolloClient, ApolloLink, InMemoryCache, Observable, gql } from '@apollo/client';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    SENSITIVE_ACTION_PASSWORD_HEADER,
    SENSITIVE_ACTION_PASSWORD_REQUIRED,
    sensitiveActionPasswordLink,
} from '../apollo-sensitive-action';
import { ConfirmDialogProvider } from './ConfirmDialog';

const DELETE_MUTATION = gql`
    mutation DeleteSeller($id: ID!) {
        deleteSeller(id: $id) {
            result
        }
    }
`;

const reactTestEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('ConfirmDialogProvider sensitive action bridge', () => {
    it('renders a password field and resumes the challenged mutation', async () => {
        const requestHeaders: Array<Record<string, string> | undefined> = [];
        const client = new ApolloClient({
            link: sensitiveActionPasswordLink.concat(
                new ApolloLink(
                    operation =>
                        new Observable(observer => {
                            requestHeaders.push(
                                operation.getContext().headers as Record<string, string> | undefined,
                            );
                            observer.next(
                                requestHeaders.length === 1
                                    ? {
                                          errors: [
                                              {
                                                  message: '请输入当前账号密码后继续',
                                                  extensions: {
                                                      code: SENSITIVE_ACTION_PASSWORD_REQUIRED,
                                                  },
                                              },
                                          ],
                                      }
                                    : { data: { deleteSeller: { result: 'DELETED' } } },
                            );
                            observer.complete();
                        }),
                ),
            ),
            cache: new InMemoryCache(),
        });
        let mutationPromise: ReturnType<typeof client.mutate> | undefined;

        await act(async () => {
            root.render(
                <ConfirmDialogProvider>
                    <button
                        type="button"
                        onClick={() => {
                            mutationPromise = client.mutate({
                                mutation: DELETE_MUTATION,
                                variables: { id: 'seller-1' },
                            });
                        }}
                    >
                        删除
                    </button>
                </ConfirmDialogProvider>,
            );
        });

        await act(async () => {
            container.querySelector<HTMLButtonElement>('button')?.click();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('验证当前管理员密码');
        const passwordInput = container.querySelector<HTMLInputElement>('input[type="password"]');
        expect(passwordInput).not.toBeNull();
        expect(passwordInput?.placeholder).toBe('仅用于本次操作校验，不会保存');

        await act(async () => {
            setNativeInputValue(passwordInput!, 'Current123!');
            passwordInput!.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => {
            Array.from(container.querySelectorAll('button'))
                .find(button => button.textContent === '验证并继续')
                ?.click();
            await mutationPromise;
        });

        expect(requestHeaders).toHaveLength(2);
        expect(requestHeaders[1]?.[SENSITIVE_ACTION_PASSWORD_HEADER]).toBe('Current123!');
        expect(container.querySelector('input[type="password"]')).toBeNull();
    });
});

function setNativeInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
}
