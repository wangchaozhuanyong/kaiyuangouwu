// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeNoticeTicker } from './home-notice-ticker';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
let lineWidth: number;
let frameWidth: number;
let resize: () => void;
const animations: Array<{
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    onfinish: (() => void) | null;
    playState: string;
    currentTime: number;
    pause: ReturnType<typeof vi.fn>;
    play: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
}> = [];
const items = ['first', 'second', 'third'].map(id => ({
    id,
    title: `Notice ${id}`,
    content: `Complete content ${id}`,
    summary: '',
    ctaLabel: '',
    targetType: 'NONE' as const,
    targetValue: null,
    linkUrl: null,
}));
const onOpen = vi.fn();
const onAll = vi.fn();
const props = {
    items,
    language: 'en' as const,
    order: 0,
    holdSeconds: 5,
    paused: false,
    reducedMotion: false,
    onOpen,
    onAll,
};
function render(overrides: Partial<typeof props> = {}) {
    act(() => root.render(<HomeNoticeTicker {...props} {...overrides} />));
}
function required<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Expected ticker fixture element or playback');
    return value;
}
function click(selector: string) {
    act(() => required(host.querySelector<HTMLButtonElement>(selector)).click());
}
beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    lineWidth = 400;
    frameWidth = 120;
    animations.length = 0;
    vi.stubGlobal(
        'ResizeObserver',
        class {
            constructor(callback: () => void) {
                resize = callback;
            }
            observe = vi.fn();
            disconnect = vi.fn();
        },
    );
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => lineWidth);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => frameWidth);
    vi.stubGlobal('Animation', class {});
    Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        value: vi.fn((keyframes, options) => {
            const playback = {
                keyframes,
                options,
                onfinish: null,
                playState: 'running',
                currentTime: 0,
                pause: vi.fn(() => {
                    playback.playState = 'paused';
                }),
                play: vi.fn(() => {
                    playback.playState = 'running';
                }),
                cancel: vi.fn(),
            };
            animations.push(playback);
            return playback;
        }),
    });
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe('home announcement playback', () => {
    it('only pauses for keyboard focus, allowing pointer detail-close focus restoration to resume', () => {
        render();
        const playback = required(animations.at(-1));
        const button = required(host.querySelector<HTMLButtonElement>('.notice-strip-open'));
        act(() => {
            button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        });
        act(() => button.focus());
        expect(playback.playState).toBe('running');
        act(() => {
            button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        expect(playback.playState).toBe('paused');
        act(() => {
            button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        });
        expect(playback.playState).toBe('running');
        render({ paused: true });
        expect(playback.playState).toBe('paused');
        render();
        expect(playback.playState).toBe('running');
        act(() => {
            button.blur();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            button.focus();
        });
        expect(playback.playState).toBe('paused');
    });

    it('measures a complete long pass instead of cutting it at the fixed interval', () => {
        render();
        const playback = required(animations.at(-1));
        expect(playback.options.duration).toBe(13500);
        expect(playback.keyframes[1].offset).toBe(1500 / 13500);
        expect(playback.keyframes[2]).toEqual({ transform: 'translateX(-280px)', offset: 1 - 2000 / 13500 });
        expect(required(host.querySelector('.notice-strip-title')).textContent).toBe('Notice first');
        act(() => required(playback.onfinish)());
        expect(required(host.querySelector('.notice-strip-title')).textContent).toBe('Notice second');
        act(() => required(required(animations.at(-1)).onfinish)());
        act(() => required(required(animations.at(-1)).onfinish)());
        expect(required(host.querySelector('.notice-strip-title')).textContent).toBe('Notice first');
    });

    it('preserves the timeline when manually paused or a detail/background pauses playback', () => {
        render();
        const playback = required(animations.at(-1));
        playback.currentTime = 4200;
        click('.notice-strip-control');
        expect(playback.playState).toBe('paused');
        expect(required(host.querySelector('.notice-strip-control')).getAttribute('aria-pressed')).toBe(
            'true',
        );
        click('.notice-strip-control');
        expect(playback.playState).toBe('running');
        render({ paused: true });
        expect(playback.playState).toBe('paused');
        render();
        expect(animations.at(-1)).toBe(playback);
        expect(playback.currentTime).toBe(4200);
        expect(playback.playState).toBe('running');
    });

    it('uses the configured hold for short text and leaves a single short notice static', () => {
        lineWidth = 80;
        render({ holdSeconds: 8 });
        expect(required(animations.at(-1)).options.duration).toBe(8000);
        expect(
            required(animations.at(-1)).keyframes.every(frame => frame.transform === 'translateX(0)'),
        ).toBe(true);
        const previous = required(animations.at(-1));
        render({ items: items.slice(0, 1) });
        expect(previous.cancel).toHaveBeenCalled();
        expect(host.querySelector('.notice-strip-control')).toBeNull();
    });

    it('recomputes travel on resize and repeats a single long notice after the end hold', () => {
        render({ items: items.slice(0, 1) });
        frameWidth = 260;
        act(() => resize());
        expect(required(animations.at(-1)).options.duration).toBe(8500);
        const previous = required(animations.at(-1));
        act(() => required(previous.onfinish)());
        expect(animations.at(-1)).not.toBe(previous);
        expect(required(host.querySelector('.notice-strip-title')).textContent).toBe('Notice first');
    });

    it('keeps detail and all-announcement actions usable with reduced motion', () => {
        render({ reducedMotion: true });
        expect(animations).toHaveLength(0);
        expect(host.querySelector('.notice-strip-control')).toBeNull();
        click('.notice-strip-open');
        expect(onOpen).toHaveBeenCalledWith('first');
        click('.notice-strip-all');
        expect(onAll).toHaveBeenCalledOnce();
    });

    it('cancels obsolete playback and removes the region when the feed becomes empty', () => {
        render();
        const previous = required(animations.at(-1));
        render({ items: [] });
        expect(previous.cancel).toHaveBeenCalled();
        expect(previous.onfinish).toBeNull();
        expect(host.querySelector('.notice-strip')).toBeNull();
    });
});
