// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeNoticeTicker } from './home-notice-ticker';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
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
    animations.length = 0;
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

    it('keeps long previews stationary and rotates whole notices at the configured interval', () => {
        render();
        const playback = required(animations.at(-1));
        expect(playback.options.duration).toBe(5000);
        expect(playback.keyframes.every(frame => frame.transform === 'translateX(0)')).toBe(true);
        expect(required(host.querySelector('.notice-strip-title')).textContent).toBe('Notice first');
        act(() => required(playback.onfinish)());
        expect(required(host.querySelector('.notice-strip-title')).textContent).toBe('Notice second');
        act(() => required(required(animations.at(-1)).onfinish)());
        act(() => required(required(animations.at(-1)).onfinish)());
        expect(required(host.querySelector('.notice-strip-title')).textContent).toBe('Notice first');
    });

    it('preserves the timeline when a detail or background pauses playback', () => {
        render();
        const playback = required(animations.at(-1));
        playback.currentTime = 4200;
        expect(host.querySelector('.notice-strip-control')).toBeNull();
        render({ paused: true });
        expect(playback.playState).toBe('paused');
        render();
        expect(animations.at(-1)).toBe(playback);
        expect(playback.currentTime).toBe(4200);
        expect(playback.playState).toBe('running');
    });

    it('keeps title and content in one preview with full-notice and all-notice actions', () => {
        render();
        const track = required(host.querySelector('.notice-strip-track'));
        expect(track.textContent).toBe('Notice first · Complete content first');
        expect(track.querySelector('.notice-strip-title')).not.toBeNull();
        expect(host.querySelectorAll('.notice-strip button')).toHaveLength(2);
        expect(host.querySelector('.notice-strip-control')).toBeNull();
        click('.notice-strip-open');
        expect(onOpen).toHaveBeenCalledWith('first');
        click('.notice-strip-all');
        expect(onAll).toHaveBeenCalledOnce();
    });

    it('leaves a single long title stationary and keeps its full-detail action', () => {
        render({ items: [{ ...items[0], content: '' }] });
        expect(required(host.querySelector('.notice-strip-track')).textContent).toBe('Notice first');
        expect(animations).toHaveLength(0);
        click('.notice-strip-open');
        expect(onOpen).toHaveBeenCalledWith('first');
    });

    it('uses the configured hold and stops rotation when only one notice remains', () => {
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
