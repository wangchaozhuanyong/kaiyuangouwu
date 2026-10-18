import { describe, expect, it } from 'vitest';

import { IcloudMailSanitizerService, mailPreviewHtml } from './icloud-mail-sanitizer.service';

describe('network-isolated mail preview', () => {
    it('restricts historical HTML before any sender-controlled markup while preserving content', () => {
        const historical =
            '<style>@import "https://sender.invalid/probe"</style><p style="color:red">Mail text</p>';
        const preview = mailPreviewHtml(historical) ?? '';
        expect(preview.indexOf('Content-Security-Policy')).toBeLessThan(preview.indexOf('<style>'));
        expect(preview).toContain("default-src 'none'");
        expect(preview).toContain("style-src 'unsafe-inline'");
        expect(preview).toContain('img-src data:;');
        expect(preview).toContain(historical);
    });

    it('keeps absent HTML on the existing plain-text fallback path', () => {
        expect(mailPreviewHtml(null)).toBeNull();
        expect(mailPreviewHtml(undefined)).toBeNull();
        expect(mailPreviewHtml('')).toBe('');
    });

    it('retains sanitization of executable markup and safe mail formatting', () => {
        const sanitized = new IcloudMailSanitizerService().sanitize(
            '<p style="color:red">Hello</p><script>alert(1)</script><img src="https://sender.invalid/probe" onerror="alert(2)">',
        );
        expect(sanitized).toContain('Hello');
        expect(sanitized).not.toContain('<script');
        expect(sanitized).not.toContain('onerror');
        expect(mailPreviewHtml(sanitized)).toContain("default-src 'none'");
    });
});
