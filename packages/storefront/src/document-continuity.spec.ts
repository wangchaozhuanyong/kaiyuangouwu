// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';

const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
const source = html.match(/<script id="storefront-document-continuity">([\s\S]*?)<\/script>/)?.[1];
const selector = '[data-scroll-restoration-id="category-results"]';
const observers: MutationObserver[] = [];
function start() {
    expect(source).toBeTruthy();
    const key = history.state.__TSR_key;
    sessionStorage.setItem(
        'tsr-scroll-restoration-v1_3',
        JSON.stringify({ [key]: { [selector]: { scrollY: 320, scrollX: 0 } } }),
    );
    if (!source) throw new Error('Missing early continuity script');
    runInNewContext(source, {
        URLSearchParams,
        getComputedStyle,
        window,
        document,
        localStorage,
        sessionStorage,
        history,
        location,
        MutationObserver: class extends MutationObserver {
            constructor(callback: MutationCallback) {
                super(callback);
                observers.push(this);
            }
        },
    });
}
afterEach(() => {
    document.dispatchEvent(new Event('storefront:page-error'));
    observers.splice(0).forEach(observer => observer.disconnect());
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-storefront-traffic-choice');
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
});
it('restores the actual catalog scroll owner as SSR nodes arrive, before React owns the page', async () => {
    history.replaceState({ __TSR_key: 'entry-a' }, '', '/zh/category');
    start();
    document.body.innerHTML = `<section data-scroll-restoration-id="category-results"></section>`;
    await Promise.resolve();
    expect(document.querySelector(selector)?.scrollTop).toBe(320);
    expect(document.documentElement.hasAttribute('data-storefront-app-owned')).toBe(false);
});
it('a user interaction ends the document handoff instead of fighting their scroll', async () => {
    history.replaceState({ __TSR_key: 'entry-a' }, '', '/zh/category');
    start();
    document.body.innerHTML = `<section data-scroll-restoration-id="category-results"></section>`;
    await Promise.resolve();
    const section = document.querySelector(selector);
    if (!section) throw new Error('Missing catalog');
    document.dispatchEvent(new Event('wheel'));
    section.scrollTop = 40;
    section.appendChild(document.createElement('div'));
    await Promise.resolve();
    expect(section.scrollTop).toBe(40);
    expect(
        [...document.head.querySelectorAll('style')].some(node => node.textContent?.includes('100vh')),
    ).toBe(false);
});
it('keeps other routes and absent history entries at their native positions', async () => {
    history.replaceState({ __TSR_key: 'entry-a' }, '', '/zh/search');
    start();
    document.body.innerHTML = `<section data-scroll-restoration-id="category-results"></section>`;
    await Promise.resolve();
    expect(document.querySelector(selector)?.scrollTop).toBe(0);
});
it('recognizes an existing necessary-only preference before first paint without writing consent', () => {
    history.replaceState({ __TSR_key: 'entry-a' }, '', '/zh/category');
    localStorage.setItem('storefront-analytics-opt-out:v1', '1');
    start();
    expect(document.documentElement.hasAttribute('data-storefront-traffic-choice')).toBe(true);
    expect(localStorage.getItem('storefront-analytics-opt-out:v1')).toBe('1');
});

it('pins the exact prepaint script in the production CSP without allowing arbitrary inline scripts', () => {
    if (!source) throw new Error('Missing continuity script');
    const policy = readFileSync(join(__dirname, '../../../deploy/nginx/damatong.conf'), 'utf8');
    const hash = createHash('sha256').update(source).digest('base64');
    const directives = policy.match(/script-src 'self'[^;]*;/gu) ?? [];
    expect(directives.length).toBeGreaterThan(0);
    for (const directive of directives) {
        expect(directive).toContain("'sha256-" + hash + "'");
        expect(directive).not.toContain("'unsafe-inline'");
    }
});
