// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageRuntimeContext } from '../runtime/page-runtime-context';
import { useVirtualRows } from './use-virtual-rows';

const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
const keys = Array.from({ length: 100 }, (_, index) => `row-${index}`);

describe('shared virtual row presentation', () => {
    it('windows large lists, preserves keyboard focus, scrolls offline and pauses hidden tabs', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
            setTimeout(() => callback(0), 16),
        );
        vi.stubGlobal('cancelAnimationFrame', clearTimeout);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
            this: HTMLElement,
        ) {
            const scroll = document.querySelector<HTMLElement>('[data-scroll]');
            return {
                x: 0,
                y: 0,
                top: this.hasAttribute('data-content') ? -(scroll?.scrollTop ?? 0) : 0,
                left: 0,
                right: 600,
                bottom: 200,
                width: 600,
                height: this.hasAttribute('data-admin-virtual-row') ? 40 : 200,
                toJSON() {},
            };
        });
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        cleanups.push(() => {
            root.unmount();
            container.remove();
        });
        function List({ enabled }: { enabled: boolean }) {
            const scrollRef = useRef<HTMLDivElement>(null);
            const contentRef = useRef<HTMLDivElement>(null);
            const rows = useVirtualRows({
                contentRef,
                keys,
                scrollRef,
                enabled,
                estimateSize: 40,
            });
            return (
                <div
                    data-scroll
                    ref={node => {
                        scrollRef.current = node;
                        if (node)
                            Object.defineProperty(node, 'clientHeight', { configurable: true, value: 200 });
                    }}
                >
                    <div
                        data-content
                        ref={contentRef}
                        style={{ paddingTop: rows.before, paddingBottom: rows.after }}
                    >
                        {keys.slice(rows.start, rows.end).map((key, offset) => (
                            <div key={key} data-admin-virtual-row={rows.start + offset}>
                                <button data-key={key}>{key}</button>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        const render = (active: boolean, enabled = true) =>
            act(async () =>
                root.render(
                    <PageRuntimeContext.Provider value={{ page: '/list', active }}>
                        <List enabled={enabled} />
                    </PageRuntimeContext.Provider>,
                ),
            );
        const mounted = () => [...container.querySelectorAll<HTMLElement>('[data-admin-virtual-row]')];
        const scrollTo = (top: number) =>
            act(async () => {
                const scroll = container.querySelector<HTMLElement>('[data-scroll]')!;
                scroll.scrollTop = top;
                scroll.dispatchEvent(new Event('scroll'));
                vi.advanceTimersByTime(20);
            });
        await render(true);
        expect(mounted().length).toBeLessThan(20);
        const first = container.querySelector<HTMLButtonElement>('[data-key="row-0"]')!;
        first.focus();
        await scrollTo(1000);
        expect(document.activeElement).toBe(first);
        expect(container.querySelector('[data-key="row-25"]')).not.toBeNull();
        first.blur();
        await act(async () => {
            vi.advanceTimersByTime(20);
        });
        expect(container.querySelector('[data-key="row-0"]')).toBeNull();
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        await scrollTo(2000);
        expect(container.querySelector('[data-key="row-50"]')).not.toBeNull();
        await render(false);
        const beforeHiddenScroll = mounted().map(row => row.dataset.adminVirtualRow);
        await scrollTo(3000);
        expect(mounted().map(row => row.dataset.adminVirtualRow)).toEqual(beforeHiddenScroll);
        await render(true);
        expect(container.querySelector('[data-key="row-75"]')).not.toBeNull();
        await render(true, false);
        expect(mounted()).toHaveLength(100);
    });
});
