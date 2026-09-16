// @vitest-environment jsdom
import { act, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PageReadinessBoundary } from './page-readiness';
import { SafeImage } from './safe-image';

vi.mock('./route-loading', () => ({ RouteTransitionLoader: () => <div role="status">LOADING</div> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function requiredImage(host: ParentNode): HTMLImageElement {
    const image = host.querySelector('img');
    if (!image) throw new Error('Expected an image');
    return image;
}

describe('whole-page readiness', () => {
    let host: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            const top = this.getAttribute('data-offscreen') === 'true' ? 2000 : 0;
            return {
                x: 0,
                y: top,
                top,
                left: 0,
                right: 300,
                bottom: top + 200,
                width: 300,
                height: 200,
                toJSON: () => ({}),
            };
        });
        Object.defineProperty(HTMLImageElement.prototype, 'decode', {
            configurable: true,
            writable: true,
            value: vi.fn().mockResolvedValue(undefined),
        });
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });
    function render(children: ReactNode, pending = false, key = 'first', online = true, requestKey = key) {
        act(() =>
            root.render(
                <PageReadinessBoundary
                    navigationKey={key}
                    requestKey={requestKey}
                    pending={pending}
                    online={online}
                    language="zh"
                    storefrontName="Store"
                    onBack={vi.fn()}
                    onRetry={vi.fn()}
                >
                    {children}
                </PageReadinessBoundary>,
            ),
        );
    }
    async function advance(ms = 64) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(ms);
        });
    }
    function phase() {
        return host.querySelector('[data-page-readiness]')?.getAttribute('data-page-readiness');
    }
    async function complete(image: HTMLImageElement) {
        Object.defineProperties(image, {
            complete: { configurable: true, value: true },
            naturalWidth: { configurable: true, value: 640 },
        });
        await act(async () => {
            image.dispatchEvent(new Event('load'));
            await Promise.resolve();
        });
    }

    it('waits through data, a route module, and the visible image before revealing once', async () => {
        render(<span data-page-pending="module" />, true);
        await advance(240);
        expect(host.querySelectorAll('[role=status]')).toHaveLength(1);
        render(<span data-page-pending="module" />);
        await advance();
        expect(phase()).toBe('preparing');
        render(<SafeImage src="/hero.webp" alt="Hero" loading="lazy" />);
        await advance();
        const image = requiredImage(host);
        expect(image.getAttribute('loading')).toBe('eager');
        expect(phase()).toBe('preparing');
        await complete(image);
        await advance();
        expect(phase()).toBe('ready');
        expect(host.querySelector('[role=status]')).toBeNull();
        expect(host.querySelector('.page-readiness-stage')?.hasAttribute('inert')).toBe(false);
    });

    it('does not wait for images or query placeholders outside the first viewport', async () => {
        render(
            <>
                <h1>Ready</h1>
                <div data-offscreen="true">
                    <SafeImage src="/later.webp" alt="Later" loading="lazy" />
                </div>
                <div data-page-pending="data" data-offscreen="true" />
            </>,
        );
        // The image rectangle is independently positioned in this fixture.
        const frame = host.querySelector('[data-safe-image]');
        if (!frame) throw new Error('Expected an image frame');
        frame.setAttribute('data-offscreen', 'true');
        await advance();
        expect(phase()).toBe('ready');
        expect(host.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    });

    it('ignores hidden carousel slides', async () => {
        render(
            <>
                <h1>Ready</h1>
                <div aria-hidden="true">
                    <SafeImage src="/slide-two.webp" alt="" />
                </div>
            </>,
        );
        await advance();
        expect(phase()).toBe('ready');
    });

    it('waits for the declared route query even when its skeleton is below a large header', async () => {
        render(<div data-page-pending="query" data-offscreen="true" />);
        await advance(300);
        expect(phase()).toBe('preparing');
        render(<h1>Current query result</h1>);
        await advance();
        expect(phase()).toBe('ready');
    });

    it('uses the media budget after data settles, then allows a late image to replace its fallback', async () => {
        render(<SafeImage src="/slow.webp" alt="Slow" />, true);
        await advance(4000);
        expect(phase()).toBe('preparing');
        render(<SafeImage src="/slow.webp" alt="Slow" />);
        await advance(3100);
        expect(phase()).toBe('degraded');
        expect(host.querySelector('[data-safe-image=timeout]')).not.toBeNull();
        expect(host.querySelector('.safe-image-fallback')).not.toBeNull();
        await complete(requiredImage(host));
        await advance();
        expect(host.querySelector('[data-safe-image=ready]')).not.toBeNull();
        expect(phase()).toBe('degraded');
    });

    it('shows retry on data timeout or an offline pending query instead of revealing an empty form', async () => {
        render(<h1>Form</h1>, true);
        await advance(10100);
        expect(phase()).toBe('error');
        expect(host.querySelector('[role=alert]')?.textContent).toContain('加载超时');
        render(<h1>Form</h1>, true, 'offline', false);
        await advance();
        expect(host.querySelector('[role=alert]')?.textContent).toContain('网络不可用');
    });

    it('preserves one loading indicator while bootstrap resolves the store scope', async () => {
        render(<span data-page-pending="module" />, true, 'unresolved', true, 'login');
        await advance(250);
        expect(host.querySelector('[role=status]')).not.toBeNull();
        render(<span data-page-pending="module" />, true, 'resolved-store', true, 'login');
        expect(host.querySelector('[role=status]')).not.toBeNull();
        await advance(16);
        expect(host.querySelector('[role=status]')).not.toBeNull();
    });

    it('does not cover a released page when a background refresh begins', async () => {
        render(<h1>Existing content</h1>);
        await advance();
        render(<h1>Existing content</h1>, true);
        await advance(400);
        expect(phase()).toBe('ready');
    });

    it('keeps one deadline and a stable timeout across late member resolution until retry', async () => {
        render(<span data-page-pending="query" />, true, 'guest', true, 'account');
        await advance(9000);
        render(<span data-page-pending="query" />, true, 'member', true, 'account');
        await advance(1100);
        expect(phase()).toBe('error');
        render(<h1>Member content</h1>, false, 'resolved-member', true, 'account');
        await advance(500);
        expect(phase()).toBe('error');
        expect(host.querySelector('[role=status]')).toBeNull();
        act(() => host.querySelector<HTMLButtonElement>('.page-readiness-error button')?.click());
        await advance();
        expect(phase()).toBe('ready');
    });

    it('gives a new navigation its own deadline while retaining an already visible indicator', async () => {
        render(<span data-page-pending="module" />, true, 'first');
        await advance(9000);
        render(<span data-page-pending="module" />, true, 'second');
        expect(host.querySelector('[role=status]')).not.toBeNull();
        await advance(2000);
        expect(phase()).toBe('preparing');
        await advance(8100);
        expect(phase()).toBe('error');
    });

    it('cancels old navigation completions and does not impose the progress delay on cached content', async () => {
        render(<SafeImage src="/old.webp" alt="" />);
        const old = requiredImage(host);
        await advance(250);
        render(<h1>New destination</h1>, false, 'new');
        await complete(old);
        await advance();
        expect(phase()).toBe('ready');
        expect(host.querySelector('[role=status]')).toBeNull();
        expect(host.textContent).toContain('New destination');
    });

    it('does not set aria-hidden on stage and blurs descendant focus when stage is unreleased', () => {
        render(
            <div>
                <button type="button" id="test-btn">
                    Action
                </button>
            </div>,
            true,
        );
        const stageElement = host.querySelector('.page-readiness-stage');
        expect(stageElement?.getAttribute('aria-hidden')).toBeNull();
        expect(stageElement?.hasAttribute('inert')).toBe(true);

        const button = host.querySelector<HTMLButtonElement>('#test-btn');
        expect(button).not.toBeNull();
        button?.focus();
        expect(document.activeElement).toBe(button);

        render(
            <div>
                <button type="button" id="test-btn">
                    Action
                </button>
            </div>,
            true,
            'second',
        );
        expect(document.activeElement).not.toBe(button);
    });
});
