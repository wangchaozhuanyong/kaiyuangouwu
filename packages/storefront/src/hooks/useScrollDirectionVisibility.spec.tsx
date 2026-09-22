// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useScrollDirectionVisibility } from './useScrollDirectionVisibility';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useScrollDirectionVisibility', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;
    let scrollY = 0;
    let viewportWidth = 390;
    let animationFrames: FrameRequestCallback[];

    function Harness() {
        const ref = useRef<HTMLElement>(null);
        const hidden = useScrollDirectionVisibility(ref, { minimumTopBoundary: 100 });
        return <nav ref={ref} data-hidden={hidden ? 'true' : 'false'} />;
    }

    const scrollTo = (nextY: number) => {
        scrollY = nextY;
        act(() => {
            window.dispatchEvent(new Event('scroll'));
            animationFrames.splice(0).forEach(callback => callback(0));
        });
    };

    beforeEach(() => {
        scrollY = 0;
        viewportWidth = 390;
        animationFrames = [];
        vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
        vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => viewportWidth);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            animationFrames.push(callback);
            return animationFrames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        act(() => root.render(<Harness />));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
    });

    it('hides after upward content travel and reveals sooner when the direction reverses', () => {
        scrollTo(90);
        scrollTo(110);
        expect(container.querySelector('nav')?.dataset.hidden).toBe('false');

        scrollTo(140);
        expect(container.querySelector('nav')?.dataset.hidden).toBe('true');

        scrollTo(134);
        expect(container.querySelector('nav')?.dataset.hidden).toBe('true');

        scrollTo(122);
        expect(container.querySelector('nav')?.dataset.hidden).toBe('false');
    });

    it('stays visible near the page top and on desktop', () => {
        scrollTo(70);
        expect(container.querySelector('nav')?.dataset.hidden).toBe('false');

        viewportWidth = 1200;
        scrollTo(180);
        expect(container.querySelector('nav')?.dataset.hidden).toBe('false');
    });
});
