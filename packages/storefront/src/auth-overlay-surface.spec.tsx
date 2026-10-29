// organize-imports-ignore -- Preserve ESLint type groups.
import type { StorefrontAuthSettings } from './types';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AuthOverlayLoading } from './auth-overlay-loading';

const settings: StorefrontAuthSettings = {
    emailPasswordEnabled: true,
    emailAutoRegistrationEnabled: false,
    emailQuickRegistrationEnabled: false,
    googleEnabled: false,
    googleClientId: null,
};

describe('shared authentication loading surface', () => {
    it.each([
        { mode: 'login' as const, expected: 2, overrides: {} },
        { mode: 'register' as const, expected: 2, overrides: {} },
        { mode: 'register' as const, expected: 1, overrides: { emailQuickRegistrationEnabled: true } },
        { mode: 'login' as const, expected: 0, overrides: { emailPasswordEnabled: false } },
        { mode: 'forgot-password' as const, expected: 1, overrides: { emailPasswordEnabled: false } },
    ])(
        'reserves the configured $mode fields without accepting credentials',
        ({ mode, expected, overrides }) => {
            const html = renderToStaticMarkup(
                <AuthOverlayLoading mode={mode} language="zh" settings={{ ...settings, ...overrides }} />,
            );
            expect(html).toContain('auth-page auth-page-overlay');
            expect(html).toContain('aria-busy="true"');
            expect(html.match(/class="auth-field field-wide"/g) ?? []).toHaveLength(expected);
            expect(html).not.toContain('type="password"');
            expect(html).not.toContain('type="email"');
            expect(html).not.toContain('href=');
            expect((html.match(/<button\b[^>]*>/g) ?? []).every(button => button.includes('disabled'))).toBe(
                true,
            );
        },
    );
    it('reserves Google only when enabled and configured', () => {
        const render = (overrides: Partial<StorefrontAuthSettings>) =>
            renderToStaticMarkup(
                <AuthOverlayLoading mode="login" language="en" settings={{ ...settings, ...overrides }} />,
            );
        expect(render({ googleEnabled: true, googleClientId: 'local-fixture-client' })).toContain(
            'google-auth-button',
        );
        expect(render({ googleEnabled: true, googleClientId: null })).not.toContain('google-auth-button');
        expect(render({ googleEnabled: false, googleClientId: 'local-fixture-client' })).not.toContain(
            'google-auth-button',
        );
    });
});
