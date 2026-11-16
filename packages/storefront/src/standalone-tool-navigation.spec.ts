// @vitest-environment jsdom
import { preconnect } from 'react-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { standaloneToolNavigation, warmStandaloneTool } from './standalone-tool-navigation';

vi.mock('react-dom', () => ({ preconnect: vi.fn() }));

describe('standalone tool return navigation', () => {
    beforeEach(() => history.replaceState(null, '', '/'));
    it('does not infer a storefront return action from unrelated browser history or query parameters', () => {
        history.pushState(null, '', '/?lang=en&returnTo=https://example.test');
        expect(standaloneToolNavigation(vi.fn())).toEqual({ language: 'en', onBack: undefined });
    });
    it('consumes the click marker, survives reload in this entry, and keeps shared URLs clean', () => {
        history.pushState(null, '', '/?lang=en#back');
        const back = vi.spyOn(history, 'back').mockImplementation(() => undefined);
        const navigation = standaloneToolNavigation(() => history.back());
        expect(location.hash).toBe('');
        expect(history.state).toEqual({ fromPreviousPage: true });
        navigation.onBack?.();
        expect(back).toHaveBeenCalledOnce();
        expect(standaloneToolNavigation(() => history.back()).onBack).toBeTypeOf('function');
        history.replaceState(null, '', location.href);
        expect(standaloneToolNavigation(() => history.back()).onBack).toBeUndefined();
        back.mockRestore();
    });
    it('warms only the tool origin and skips offline, hidden and data-saving visits', () => {
        const anchor = document.createElement('a');
        anchor.href = 'https://tool.example.test/?lang=en#back';
        const event = { currentTarget: anchor } as Parameters<typeof warmStandaloneTool>[0];
        const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        const original = Object.getOwnPropertyDescriptor(navigator, 'connection');
        try {
            vi.mocked(preconnect).mockClear();
            warmStandaloneTool(event);
            expect(preconnect).toHaveBeenCalledExactlyOnceWith('https://tool.example.test');
            hidden.mockReturnValue(true);
            warmStandaloneTool(event);
            hidden.mockReturnValue(false);
            online.mockReturnValue(false);
            warmStandaloneTool(event);
            online.mockReturnValue(true);
            Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } });
            warmStandaloneTool(event);
            Object.defineProperty(navigator, 'connection', {
                configurable: true,
                value: { effectiveType: '2g' },
            });
            warmStandaloneTool(event);
            expect(preconnect).toHaveBeenCalledTimes(1);
        } finally {
            hidden.mockRestore();
            online.mockRestore();
            if (original) Object.defineProperty(navigator, 'connection', original);
            else Reflect.deleteProperty(navigator, 'connection');
        }
    });
});
