// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientPluginSlot } from './client-plugins/client-plugin-registry';
import { StorefrontContext, type StorefrontContextValue } from './StorefrontContext';
import { type StorefrontContentBlock } from './types';

const runtime = vi.hoisted(() => ({ prepare: vi.fn(), route: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./pages/ai-image-studio-preload', () => ({ prepareImageStudioData: runtime.prepare }));
vi.mock('./route-component-preload', () => ({ preloadStorefrontRouteComponent: runtime.route }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const block = {
    id: 'plugins',
    code: 'storefront-client-plugins',
    type: 'CLIENT_PLUGINS',
    enabled: true,
    items: [
        {
            id: 'studio',
            enabled: true,
            position: 0,
            settings: { pluginCode: 'ai-image-studio-entry', placement: 'BUSINESS_SERVICES_MAIN' },
        },
    ],
} as unknown as StorefrontContentBlock;

describe('configured image-studio warmup intent', () => {
    let host: HTMLDivElement;
    let root: Root | undefined;
    const store = (code: string) =>
        ({
            api: {},
            customer: null,
            market: { code, currencyCode: 'MYR' },
        }) as unknown as StorefrontContextValue;
    const render = async (context: StorefrontContextValue, configured = true) => {
        await act(() =>
            Promise.resolve(
                root?.render(
                    <StorefrontContext.Provider value={context}>
                        <ClientPluginSlot
                            block={configured ? block : undefined}
                            placement="BUSINESS_SERVICES_MAIN"
                            language="zh"
                            onNavigate={() => undefined}
                        />
                    </StorefrontContext.Provider>,
                ),
            ),
        );
    };
    beforeEach(() => {
        vi.useFakeTimers();
        runtime.prepare.mockClear();
        runtime.route.mockClear();
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });
    afterEach(async () => {
        await act(() => Promise.resolve(root?.unmount()));
        host.remove();
        vi.useRealTimers();
    });

    it('does no warmup when unconfigured, retains 300ms and hover/touch/focus intent', async () => {
        const context = store('MY');
        await render(context, false);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });
        expect(runtime.prepare).not.toHaveBeenCalled();
        await render(context);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(299);
        });
        expect(runtime.prepare).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(runtime.prepare).toHaveBeenCalledTimes(1);
        expect(runtime.prepare.mock.calls[0].slice(0, 3)).toEqual([context.api, null, context.market]);
        const button = host.querySelector('button');
        if (!button) throw new Error('Expected the configured image-studio entry button');
        for (const event of [
            new MouseEvent('mouseover', { bubbles: true }),
            new Event('touchstart', { bubbles: true }),
            new FocusEvent('focusin', { bubbles: true }),
        ]) {
            await act(() => {
                button.dispatchEvent(event);
                return Promise.resolve();
            });
        }
        expect(runtime.prepare).toHaveBeenCalledTimes(4);
        expect(runtime.route).toHaveBeenCalledTimes(4);
        expect(runtime.route).toHaveBeenLastCalledWith('image-studio');
    });

    it('invalidates in-flight optional imports when the context changes or plugin unmounts', async () => {
        const initial = store('MY');
        await render(initial);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        const oldScope = runtime.prepare.mock.calls[0][3] as () => boolean;
        expect(oldScope()).toBe(true);
        await render(store('CN'));
        expect(oldScope()).toBe(false);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        const currentScope = runtime.prepare.mock.calls[1][3] as () => boolean;
        expect(currentScope()).toBe(true);
        await render(initial);
        expect(oldScope()).toBe(false);
        expect(currentScope()).toBe(false);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        const finalScope = runtime.prepare.mock.calls[2][3] as () => boolean;
        expect(finalScope()).toBe(true);
        await act(() => Promise.resolve(root?.unmount()));
        root = undefined;
        expect(finalScope()).toBe(false);
    });

    it.each(['zh', 'en'] as const)(
        'keeps the three synchronous %s tool entries and their own routes',
        async language => {
            const onNavigate = vi.fn();
            const tools = {
                ...block,
                items: ['two-factor-code-tool', 'icloud-mail-query-entry', 'gpt-recharge-entry'].map(
                    (pluginCode, position) => ({
                        ...block.items[0],
                        id: pluginCode,
                        position,
                        settings: { pluginCode, placement: 'BUSINESS_SERVICES_MAIN' },
                    }),
                ),
            };
            await act(() => {
                root?.render(
                    <ClientPluginSlot
                        block={tools}
                        placement="BUSINESS_SERVICES_MAIN"
                        language={language}
                        onNavigate={onNavigate}
                    />,
                );
                return Promise.resolve();
            });
            const buttons = [...host.querySelectorAll('button')];
            expect(buttons.map(button => button.querySelector('strong')?.textContent)).toEqual(
                language === 'zh'
                    ? ['2FA 动态码', '邮件验证码查询', 'GPT自助充值']
                    : ['2FA codes', 'Mail verification codes', 'GPT self-service recharge'],
            );
            expect(buttons.map(button => button.className)).toEqual([
                'category-client-plugin category-client-plugin-two-factor',
                'category-client-plugin category-client-plugin-mail-query',
                'category-client-plugin',
            ]);
            expect(
                buttons.map(button => button.querySelector('svg')?.classList.contains('lucide-mail')),
            ).toEqual([false, true, false]);
            await act(() => {
                buttons.forEach(button => button.click());
                return Promise.resolve();
            });
            expect(onNavigate.mock.calls).toEqual([
                [{ name: 'two-factor' }],
                [{ name: 'mail-query' }],
                [{ name: 'gpt-recharge' }],
            ]);
            expect(runtime.route).not.toHaveBeenCalled();
            expect(runtime.prepare).not.toHaveBeenCalled();
        },
    );
});
