// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { standaloneToolNavigation } from './standalone-tool-navigation';

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
});
