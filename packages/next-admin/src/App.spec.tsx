// @vitest-environment jsdom
import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ error: undefined as unknown, clearAuthSession: vi.fn() }));
vi.mock('@apollo/client/react', () => ({
    useQuery: () => ({ loading: false, error: state.error, data: undefined, refetch: vi.fn() }),
    useApolloClient: () => ({ mutate: vi.fn() }),
}));
vi.mock('./apollo', () => ({
    clearAuthSession: state.clearAuthSession,
    hasActiveChannelSelection: () => false,
    setInitialActiveChannel: vi.fn(),
    prepareAuthSession: vi.fn(),
}));
vi.mock('./extensions/installed-extensions', () => ({}));
vi.mock('./components/ThemeToggleButton', () => ({ ThemeToggleButton: () => null }));

import App from './App';

afterEach(() => {
    state.clearAuthSession.mockClear();
    window.history.replaceState({}, '', '/');
});

describe('administrator session recovery', () => {
    it.each(['你当前无权执行此操作', 'You are not currently authorized to perform this action'])(
        'opens the login form after a localized expired-session response: %s',
        async message => {
            state.error = new CombinedGraphQLErrors({
                data: null,
                errors: [
                    { message, path: ['merchantInitialPasswordStatus'], extensions: { code: 'FORBIDDEN' } },
                ],
            });
            (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
            const container = document.createElement('div');
            document.body.append(container);
            const root = createRoot(container);
            try {
                await act(async () => root.render(<App />));
                expect(window.location.pathname).toBe('/login');
                expect(container.textContent).toContain('管理员登录');
                expect(container.querySelector('input[type="password"]')).not.toBeNull();
                expect(container.textContent).not.toContain('管理员会话验证失败');
                expect(state.clearAuthSession).toHaveBeenCalledOnce();
            } finally {
                await act(async () => root.unmount());
                container.remove();
            }
        },
    );
});
