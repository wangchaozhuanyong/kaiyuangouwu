import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const legacyGuard = readFileSync(new URL('../public/legacy-browser-guard.js', import.meta.url), 'utf8');
const unsupportedBrowserHtml = readFileSync(
    new URL('../public/unsupported-browser.html', import.meta.url),
    'utf8',
);

function runLegacyGuard(options: { userAgent: string; documentMode?: number }) {
    let redirectTarget: string | undefined;
    const document = { documentMode: options.documentMode };
    const location = {
        pathname: '/checkout',
        search: '?step=payment',
        hash: '#confirm',
        replace: (target: string) => {
            redirectTarget = target;
        },
    };

    runInNewContext(legacyGuard, {
        encodeURIComponent,
        window: {
            document,
            location,
            navigator: { userAgent: options.userAgent },
        },
    });

    return redirectTarget;
}

describe('browser compatibility policy', () => {
    it('keeps storefront fonts independent from Google-hosted resources', () => {
        expect(indexHtml).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/u);
        expect(stylesheet).not.toMatch(/['"]Inter['"]/u);
    });

    it('locks the production build to the documented evergreen baseline', () => {
        expect(viteConfig).toContain(
            "target: ['chrome111', 'edge111', 'firefox128', 'safari16.4']",
        );
    });

    it('keeps section actions large enough for touch input', () => {
        expect(stylesheet).toMatch(
            /\.section-header-action-btn,[\s\S]*?\.section-header > button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*32px;/u,
        );
    });

    it('asks 360 dual-engine browsers to use their WebKit speed mode', () => {
        expect(indexHtml).toContain('<meta name="renderer" content="webkit" />');
        expect(indexHtml).toContain('<meta http-equiv="X-UA-Compatible" content="IE=edge" />');
    });

    it('loads an ES5-only Trident guard without affecting modern browsers', () => {
        expect(indexHtml).toContain('<script nomodule src="/legacy-browser-guard.js"></script>');
        expect(legacyGuard).not.toMatch(/\b(?:const|let|class)\b|=>|\?\./u);
        expect(
            runLegacyGuard({
                userAgent:
                    'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko',
                documentMode: 11,
            }),
        ).toBe('/unsupported-browser.html?from=%2Fcheckout%3Fstep%3Dpayment%23confirm');
        expect(
            runLegacyGuard({
                userAgent:
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36',
            }),
        ).toBeUndefined();
    });

    it('keeps the unsupported-browser page script-free and usable in IE11', () => {
        expect(unsupportedBrowserHtml).toContain('<meta name="renderer" content="webkit" />');
        expect(unsupportedBrowserHtml).toContain('IE11可以查看本提示页');
        expect(unsupportedBrowserHtml).not.toContain('<script');
        expect(unsupportedBrowserHtml).not.toMatch(/var\(--|display:\s*(?:grid|flex)/u);
    });
});
