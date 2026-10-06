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
import { AccessibleDialogSurface } from './AccessibleDialogSurface';
import { AdminOverlayHost, AdminOverlayPortal } from './AdminOverlayHost';
import { useConfirmDialog } from './confirm-dialog-context';
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
    it('returns focus to the visible page trigger after an auto-focused nested global confirmation closes', async () => {
        function PageDialog() {
            const confirm = useConfirmDialog();
            return (
                <AdminOverlayPortal>
                    <AccessibleDialogSurface accessibleName="页面编辑" onRequestClose={() => {}}>
                        <button
                            data-open-confirm
                            onClick={() => void confirm({ title: '全局确认', description: '本地模拟' })}
                        >
                            打开全局确认
                        </button>
                    </AccessibleDialogSurface>
                </AdminOverlayPortal>
            );
        }
        await act(async () =>
            root.render(
                <AdminOverlayHost owner="@global">
                    <ConfirmDialogProvider>
                        <AdminOverlayHost owner="/editor">
                            <PageDialog />
                        </AdminOverlayHost>
                    </ConfirmDialogProvider>
                </AdminOverlayHost>,
            ),
        );
        const trigger = document.querySelector<HTMLButtonElement>('[data-open-confirm]')!;
        await act(async () => {
            trigger.focus();
            trigger.click();
        });
        const globalDialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
        expect(globalDialog).not.toBeNull();
        expect(document.activeElement).toBe(
            [...globalDialog.querySelectorAll('button')].find(button => button.textContent === '取消'),
        );
        // Browser keyboard helpers may focus the dialog before sending Escape; this must not replace its trigger.
        globalDialog.focus();
        await act(async () =>
            globalDialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
        );
        expect(document.querySelector('[role="alertdialog"]')).toBeNull();
        expect(document.querySelector('[aria-label="页面编辑"]')).not.toBeNull();
        expect(document.activeElement).toBe(trigger);
        expect(document.body.style.overflow).toBe('hidden');
    });
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

        expect(document.body.textContent).toContain('验证当前管理员密码');
        const dialogForm = document.querySelector<HTMLFormElement>('section[role="alertdialog"] form');
        expect(dialogForm).not.toBeNull();
        const usernameInput = dialogForm?.querySelector<HTMLInputElement>('input[autoComplete="username"]');
        expect(usernameInput).not.toBeNull();
        expect(usernameInput?.readOnly).toBe(true);

        const passwordInput = document.querySelector<HTMLInputElement>('input[type="password"]');
        expect(passwordInput).not.toBeNull();
        expect(passwordInput?.form).toBe(dialogForm);
        expect(passwordInput?.placeholder).toBe('仅用于本次操作校验，不会保存');

        await act(async () => {
            setNativeInputValue(passwordInput!, 'Current123!');
            passwordInput!.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => {
            Array.from(document.querySelectorAll('button'))
                .find(button => button.textContent === '验证并继续')
                ?.click();
            await mutationPromise;
        });

        expect(requestHeaders).toHaveLength(2);
        expect(requestHeaders[1]?.[SENSITIVE_ACTION_PASSWORD_HEADER]).toBe('Current123!');
        expect(document.querySelector('input[type="password"]')).toBeNull();
    });

    it('isolates password prompt inside form and keeps external search input outside the dialog scope', async () => {
        const client = new ApolloClient({
            link: sensitiveActionPasswordLink.concat(
                new ApolloLink(
                    () =>
                        new Observable(observer => {
                            observer.next({
                                errors: [
                                    {
                                        message: '请输入当前账号密码后继续',
                                        extensions: {
                                            code: SENSITIVE_ACTION_PASSWORD_REQUIRED,
                                        },
                                    },
                                ],
                            });
                            observer.complete();
                        }),
                ),
            ),
            cache: new InMemoryCache(),
        });

        await act(async () => {
            root.render(
                <ConfirmDialogProvider>
                    <div>
                        <input
                            type="search"
                            name="option-group-search"
                            autoComplete="off"
                            aria-label="搜索规格模板"
                            defaultValue=""
                        />
                        <button
                            type="button"
                            onClick={() => {
                                client.mutate({
                                    mutation: DELETE_MUTATION,
                                    variables: { id: 'seller-2' },
                                });
                            }}
                        >
                            删除
                        </button>
                    </div>
                </ConfirmDialogProvider>,
            );
        });

        const externalSearch = container.querySelector<HTMLInputElement>('input[aria-label="搜索规格模板"]')!;
        expect(externalSearch).not.toBeNull();
        expect(externalSearch.form).toBeNull();

        await act(async () => {
            container.querySelector<HTMLButtonElement>('button')?.click();
            await Promise.resolve();
        });

        const dialogForm = document.querySelector<HTMLFormElement>('section[role="alertdialog"] form')!;
        expect(dialogForm).not.toBeNull();
        const passwordInput = document.querySelector<HTMLInputElement>('input[type="password"]')!;
        expect(passwordInput.form).toBe(dialogForm);
        expect(externalSearch.form).toBeNull();
        expect(externalSearch.value).toBe('');
    });
});

function setNativeInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
}
