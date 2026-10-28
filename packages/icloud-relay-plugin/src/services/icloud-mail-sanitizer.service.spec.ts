import { describe, expect, it } from 'vitest';

import { IcloudMailSanitizerService, mailPreviewHtml, mailTextHtml } from './icloud-mail-sanitizer.service';

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

describe('managed mail plain-text links', () => {
    const address =
        'https://shop.example.invalid/promo/account-entry?route=verify-account' +
        '&token=synthetic%2Btoken%2Fvalue&proof=synthetic_payload.synthetic-signature';

    it.each([
        ['bracketed', `Verify email\n[${address}]`],
        ['bare', `Verify email\n${address}`],
        ['parenthesized', `Verify email (${address})`],
        ['sentence', `Verify email [${address}].`],
    ])('keeps complete signed parameters from a %s URL', (_label, text) => {
        const html = new IcloudMailSanitizerService().sanitize(mailTextHtml(text));
        expect(html).toContain(`href="${address.replace(/&/g, '&amp;')}"`);
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer nofollow"');
        expect(mailPreviewHtml(html)).toContain("default-src 'none'");
    });

    it('keeps balanced brackets in IPv6 addresses and URL paths', () => {
        const ipv6Address = 'https://[::1]/manual_(v2)?token=synthetic';
        expect(mailTextHtml(`[${ipv6Address}]`)).toContain(`href="${ipv6Address}"`);
    });

    it('escapes markup and leaves script schemes as plain text', () => {
        const html = new IcloudMailSanitizerService().sanitize(
            mailTextHtml(`<script>alert(1)</script> javascript:alert(1) [${address}]`),
        );
        expect(html).not.toMatch(/<script\b|href="javascript:/i);
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html.match(/<a\b/g)).toHaveLength(1);
        expect(html).toContain(`href="${address.replace(/&/g, '&amp;')}"`);
    });
});
