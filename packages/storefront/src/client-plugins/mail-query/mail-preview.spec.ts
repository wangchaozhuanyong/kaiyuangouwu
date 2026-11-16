// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createMailPreview } from './mail-preview';

const options = { showImages: false, fit: true, isZh: true };
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('isolated email preview', () => {
    it('keeps sender image URLs out of the document before the reader chooses to load them', () => {
        const result = createMailPreview('<img src="https://sender.invalid/image.png">', options);
        expect(result.hasRemoteImages).toBe(true);
        expect(result.html).not.toContain('https://sender.invalid/image.png');
        expect(parse(result.html).querySelectorAll('img')).toHaveLength(0);
        expect(result.html).toContain('img-src data:;');
    });

    it('replaces historical preview policy and preserves the real image URL after the explicit action', () => {
        const result = createMailPreview(
            '<meta http-equiv="Content-Security-Policy" content="img-src data:"><img src="//sender.invalid/image.png" width="900" height="500">',
            { ...options, showImages: true },
        );
        const document = parse(result.html);
        expect(document.querySelectorAll('[http-equiv]')).toHaveLength(1);
        expect(result.html).toContain('img-src data: https:');
        const image = document.querySelector('img');
        expect(image?.getAttribute('src')).toBe('https://sender.invalid/image.png');
        expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
        expect(image?.style.height).toBe('auto');
        expect(image?.style.maxWidth).toBe('100%');
    });

    it('strips sender scripts, handlers and embedded documents before adding the single trusted observer', () => {
        const result = createMailPreview(
            '<script>window.parent.pwned=true</script><img src="https://sender.invalid/a.png" onerror="alert(1)">' +
                '<iframe src="https://sender.invalid/frame"></iframe><svg onload="alert(1)"><script>alert(1)</script></svg>' +
                '<a href="javascript:alert(1)">unsafe</a><form action="https://sender.invalid/submit"><input value="secret"></form>',
            { ...options, showImages: true },
        );
        const document = parse(result.html);
        const scripts = document.querySelectorAll('script');
        expect(scripts).toHaveLength(1);
        expect(scripts[0].getAttribute('src')).toContain('mail-preview-runtime.js');
        expect(scripts[0].textContent).toBe('');
        expect(document.querySelector('iframe, svg, form, input, [onerror], [onload]')).toBeNull();
        expect(document.querySelector('a')?.hasAttribute('href')).toBe(false);
        expect(result.html).not.toContain('pwned');
        expect(result.html).toContain("form-action 'none'");
        expect(result.html).toContain("connect-src 'none'");
    });

    it('allows normal links with an isolated external destination and keeps sender formatting', () => {
        const result = createMailPreview(
            '<style>p{color:green}</style><p style="text-align:center">Message</p>' +
                '<a href="https://example.invalid/confirm">Confirm</a>',
            options,
        );
        const document = parse(result.html);
        expect(document.querySelector('p')?.style.textAlign).toBe('center');
        expect(document.querySelector('a')?.getAttribute('target')).toBe('_blank');
        expect(document.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
        expect(result.html).toContain('p{color:green}');
    });

    it('recognizes background images so they can be explicitly enabled', () => {
        const result = createMailPreview(
            '<div style="background-image:url(https://sender.invalid/bg.png)">Hello</div>',
            options,
        );
        expect(result.hasRemoteImages).toBe(true);
        expect(result.html).toContain('img-src data:;');
    });
});
