// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
    listeners: new Map<string, (event: { toLocation: object }) => void>(),
    router: { state: { location: {} }, subscribe: vi.fn() },
}));
vi.mock('./router', () => ({ router: runtime.router }));
vi.mock('./storefront-performance', () => ({
    performancePageType: (path: string) => (path === '/services' ? 'services' : 'home'),
}));

import { type ExperienceReport, observeStorefrontExperience } from './storefront-experience-performance';

describe('bounded anonymous experience observation', () => {
    let report: ReturnType<typeof vi.fn<ExperienceReport>>;
    let dispose: () => void;
    let mutation: (records: MutationRecord[]) => void;
    let intersection: (entries: IntersectionObserverEntry[]) => void;
    let mutationDisconnect: ReturnType<typeof vi.fn>;
    let intersectionDisconnect: ReturnType<typeof vi.fn>;
    let observe: ReturnType<typeof vi.fn>;
    let frames: Map<number, FrameRequestCallback>;
    let now = 100;
    beforeEach(() => {
        runtime.listeners.clear();
        runtime.router.subscribe.mockImplementation(
            (name: string, listener: (event: { toLocation: object }) => void) => {
                runtime.listeners.set(name, listener);
                return () => runtime.listeners.delete(name);
            },
        );
        runtime.router.state.location = {};
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        now = 100;
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.body.innerHTML =
            '<div id="root"><div data-route="services"><div data-page-readiness="preparing"></div></div></div>';
        frames = new Map();
        let nextFrame = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            frames.set(++nextFrame, callback);
            return nextFrame;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
        mutationDisconnect = vi.fn();
        intersectionDisconnect = vi.fn();
        observe = vi.fn();
        vi.stubGlobal(
            'MutationObserver',
            class {
                constructor(callback: typeof mutation) {
                    mutation = callback;
                }
                observe = vi.fn();
                disconnect = mutationDisconnect;
            },
        );
        vi.stubGlobal(
            'IntersectionObserver',
            class {
                constructor(callback: typeof intersection) {
                    intersection = callback;
                }
                observe = observe;
                unobserve = vi.fn();
                disconnect = intersectionDisconnect;
            },
        );
        report = vi.fn<ExperienceReport>();
    });
    afterEach(() => {
        dispose?.();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });
    const begin = (pathname = '/services') => {
        const target = { pathname, search: {} };
        runtime.listeners.get('onBeforeNavigate')?.({ toLocation: target });
        return target;
    };
    const render = (target: object) => {
        runtime.router.state.location = target;
        runtime.listeners.get('onRendered')?.({ toLocation: target });
    };
    const settle = () => {
        const pending = [...frames.values()];
        frames.clear();
        for (const callback of pending) callback(now);
    };
    const visible = (frame: Element, yes = true) =>
        intersection([
            {
                target: frame,
                isIntersecting: yes,
                intersectionRatio: yes ? 1 : 0,
            } as IntersectionObserverEntry,
        ]);
    const changed = (frame: Element) =>
        mutation([{ type: 'attributes', target: frame } as unknown as MutationRecord]);

    it('binds render and readiness to the actual target commit, ignores old page-ready and canceled routes', () => {
        dispose = observeStorefrontExperience(report);
        const canceled = begin();
        document.dispatchEvent(new Event('storefront:page-ready'));
        now = 120;
        const target = begin();
        render(canceled);
        expect(report).not.toHaveBeenCalled();
        now = 150;
        render(target);
        settle();
        expect(report.mock.calls.map(call => call.slice(1))).toEqual([['services', 'NAV_RENDER', 30]]);
        now = 175;
        document.querySelector('[data-page-readiness]')?.setAttribute('data-page-readiness', 'ready');
        document.dispatchEvent(new Event('storefront:page-ready'));
        document.dispatchEvent(new Event('storefront:page-ready'));
        expect(report.mock.calls.map(call => call.slice(1))).toEqual([
            ['services', 'NAV_RENDER', 30],
            ['services', 'NAV_READY', 55],
        ]);
        expect(report.mock.calls[0][0]).toBe(report.mock.calls[1][0]);
        expect(JSON.stringify(report.mock.calls)).not.toContain('/services');
    });

    it('does not restart a matching before-load clock and recognizes a ready target at commit', () => {
        dispose = observeStorefrontExperience(report);
        const target = begin();
        now = 120;
        runtime.listeners.get('onBeforeLoad')?.({ toLocation: target });
        document.querySelector('[data-page-readiness]')?.setAttribute('data-page-readiness', 'ready');
        now = 150;
        render(target);
        settle();
        expect(report.mock.calls.map(call => call.slice(2))).toEqual([
            ['NAV_RENDER', 50],
            ['NAV_READY', 50],
        ]);
    });

    it('reports committed route failures separately and rejects over-deadline navigations', () => {
        dispose = observeStorefrontExperience(report);
        let target = begin();
        render(target);
        settle();
        document.querySelector('[data-page-readiness]')?.setAttribute('data-page-readiness', 'error');
        document.dispatchEvent(new Event('storefront:page-error'));
        expect(report.mock.calls.at(-1)?.slice(2)).toEqual(['NAV_ERROR', 1]);
        report.mockClear();
        target = begin();
        now += 120001;
        render(target);
        expect(report).not.toHaveBeenCalled();
    });

    it('records a target navigation failure before commit without reporting the retained page failure', () => {
        dispose = observeStorefrontExperience(report);
        const target = begin();
        runtime.router.state.location = target;
        document.querySelector('[data-route]')?.setAttribute('data-route', 'home');
        const boundary = document.querySelector('[data-page-readiness]');
        boundary?.setAttribute('data-page-readiness', 'error');
        document.dispatchEvent(new Event('storefront:page-error'));
        expect(report).not.toHaveBeenCalled();
        boundary?.setAttribute('data-navigation-readiness', 'error');
        now += 10_000;
        document.dispatchEvent(new Event('storefront:page-error'));
        document.dispatchEvent(new Event('storefront:page-error'));
        expect(report.mock.calls.map(call => call.slice(1))).toEqual([['services', 'NAV_ERROR', 1]]);
        expect(JSON.stringify(report.mock.calls)).not.toContain('/services');
    });

    it('ignores precommit failures for canceled, hidden and over-deadline navigation', () => {
        dispose = observeStorefrontExperience(report);
        document.querySelector('[data-page-readiness]')?.setAttribute('data-navigation-readiness', 'error');
        const canceled = begin();
        begin('/home');
        runtime.router.state.location = canceled;
        document.dispatchEvent(new Event('storefront:page-error'));
        expect(report).not.toHaveBeenCalled();
        runtime.router.state.location = begin();
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('storefront:page-error'));
        expect(report).not.toHaveBeenCalled();
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        now += 120_001;
        document.dispatchEvent(new Event('storefront:page-error'));
        expect(report).not.toHaveBeenCalled();
    });

    it('measures only pending viewport-intersecting images, never treats already painted or offscreen waits as zeros', () => {
        const root = document.getElementById('root');
        if (!root) throw new Error('Expected the experience observation fixture root');
        root.innerHTML =
            '<span data-safe-image="loading"></span><span data-safe-image="ready" class="is-painted"></span>';
        dispose = observeStorefrontExperience(report);
        const [pending, painted] = document.querySelectorAll<HTMLElement>('[data-safe-image]');
        visible(painted);
        changed(pending);
        expect(report).not.toHaveBeenCalled();
        visible(pending);
        now = 160;
        pending.classList.add('is-painted');
        pending.dataset.safeImage = 'ready';
        changed(pending);
        expect(report.mock.calls.map(call => call.slice(2))).toEqual([['IMAGE_PRESENT', 60]]);
        expect(JSON.stringify(report.mock.calls)).not.toMatch(/src|selector|id=/u);
    });

    it('excludes time spent outside viewport and bounds observed nodes to 32', () => {
        const root = document.getElementById('root');
        if (!root) throw new Error('Expected the experience observation fixture root');
        root.innerHTML = '<span data-safe-image="loading"></span>'.repeat(40);
        dispose = observeStorefrontExperience(report);
        expect(observe).toHaveBeenCalledTimes(32);
        const frame = document.querySelector<HTMLElement>('[data-safe-image]');
        if (!frame) throw new Error('Expected the observed pending image fixture');
        visible(frame);
        now = 120;
        visible(frame, false);
        now = 1000;
        visible(frame);
        now = 1010;
        frame.dataset.safeImage = 'error';
        changed(frame);
        expect(report.mock.calls.map(call => call.slice(2))).toEqual([['IMAGE_ERROR', 1]]);
    });

    it('disconnects on hidden and disposal and does not attribute late events to an old navigation', () => {
        dispose = observeStorefrontExperience(report);
        const target = begin();
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        render(target);
        expect(report).not.toHaveBeenCalled();
        expect(mutationDisconnect).toHaveBeenCalled();
        expect(intersectionDisconnect).toHaveBeenCalled();
        dispose();
        expect(runtime.listeners.size).toBe(0);
    });

    it('waits for layout-effect readiness after onRendered and checks the committed route frame', () => {
        dispose = observeStorefrontExperience(report);
        document.querySelector('[data-page-readiness]')?.setAttribute('data-page-readiness', 'ready');
        const target = begin();
        now = 110;
        render(target);
        document.dispatchEvent(new Event('storefront:page-ready'));
        // The target ref has fired, but its layout effects now register a required read.
        document.querySelector('[data-page-readiness]')?.setAttribute('data-page-readiness', 'preparing');
        now = 120;
        settle();
        expect(report.mock.calls.map(call => call[2])).toEqual(['NAV_RENDER']);
        document.querySelector('[data-route]')?.setAttribute('data-route', 'home');
        document.querySelector('[data-page-readiness]')?.setAttribute('data-page-readiness', 'ready');
        document.dispatchEvent(new Event('storefront:page-ready'));
        expect(report.mock.calls.map(call => call[2])).toEqual(['NAV_RENDER']);
        document.querySelector('[data-route]')?.setAttribute('data-route', 'services');
        now = 180;
        document.dispatchEvent(new Event('storefront:page-ready'));
        expect(report.mock.calls.map(call => call.slice(2))).toEqual([
            ['NAV_RENDER', 10],
            ['NAV_READY', 80],
        ]);
    });

    it('ends the image observation window after 30 seconds', async () => {
        vi.useFakeTimers();
        dispose = observeStorefrontExperience(report);
        await vi.advanceTimersByTimeAsync(30000);
        expect(mutationDisconnect).toHaveBeenCalledTimes(1);
        expect(intersectionDisconnect).toHaveBeenCalledTimes(1);
    });
});
