import { useContext, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { TabPageContext } from '../layouts/tab-page-context';
import { PageRuntimeContext } from '../runtime/page-runtime-context';

interface RowWindow {
    keys: readonly string[];
    start: number;
    end: number;
    before: number;
    after: number;
}

/** Window presentation only; data, pagination, selection and drafts remain with their owner. */
export function useVirtualRows({
    keys,
    scrollRef,
    contentRef,
    estimateSize,
    enabled,
    overscan = 3,
    gap = 0,
}: {
    keys: readonly string[];
    scrollRef: RefObject<HTMLElement | null>;
    contentRef: RefObject<HTMLElement | null>;
    estimateSize: number | ((width: number) => number);
    enabled: boolean;
    overscan?: number;
    gap?: number;
}) {
    const tab = useContext(TabPageContext);
    const page = useContext(PageRuntimeContext);
    const active = (tab?.active ?? true) && (page?.active ?? true);
    const measured = useRef(new Map<string, number>());
    const widthRef = useRef(0);
    const [windowState, setWindowState] = useState<RowWindow>();
    const initialEnd = enabled ? Math.min(keys.length, 20) : keys.length;
    const current =
        enabled && windowState?.keys === keys
            ? windowState
            : {
                  keys,
                  start: 0,
                  end: initialEnd,
                  before: 0,
                  after: 0,
              };
    useLayoutEffect(() => {
        const content = contentRef.current;
        const scroll = scrollRef.current;
        if (!enabled || !active || !content || !scroll) return;
        let frame: number | undefined;
        const update = () => {
            frame = undefined;
            // Hidden/zero-sized tables must not replace a valid retained window.
            const width = content.getBoundingClientRect().width;
            if (document.visibilityState === 'hidden' || !width || !scroll.clientHeight) return;
            if (width !== widthRef.current) {
                measured.current.clear();
                widthRef.current = width;
            }
            const validKeys = new Set(keys);
            for (const key of measured.current.keys()) if (!validKeys.has(key)) measured.current.delete(key);
            for (const row of content.querySelectorAll<HTMLElement>('[data-admin-virtual-row]')) {
                const index = Number(row.dataset.adminVirtualRow);
                const height = row.getBoundingClientRect().height;
                if (keys[index] && height) measured.current.set(keys[index], height);
            }
            const estimate = typeof estimateSize === 'number' ? estimateSize : estimateSize(width);
            const offsets = [0];
            keys.forEach((key, index) =>
                offsets.push(
                    offsets.at(-1)! +
                        (measured.current.get(key) ?? estimate) +
                        (index < keys.length - 1 ? gap : 0),
                ),
            );
            const top = Math.max(0, scroll.getBoundingClientRect().top - content.getBoundingClientRect().top);
            const bottom = top + scroll.clientHeight;
            let start = 0;
            while (start < keys.length && offsets[start + 1] <= top) start++;
            let end = start;
            while (end < keys.length && offsets[end] < bottom) end++;
            start = Math.max(0, start - overscan);
            end = Math.min(keys.length, end + overscan);
            // Keep the focused row and its neighbours mounted, including Tab's next destination.
            const focused = document.activeElement?.closest<HTMLElement>('[data-admin-virtual-row]');
            if (focused && content.contains(focused)) {
                const index = Number(focused.dataset.adminVirtualRow);
                start = Math.min(start, Math.max(0, index - overscan));
                end = Math.max(end, Math.min(keys.length, index + overscan + 1));
            }
            const next = {
                keys,
                start,
                end,
                before: offsets[start],
                after: offsets[keys.length] - offsets[end],
            };
            setWindowState(previous =>
                previous?.keys === keys &&
                previous.start === next.start &&
                previous.end === next.end &&
                previous.before === next.before &&
                previous.after === next.after
                    ? previous
                    : next,
            );
        };
        const schedule = () => {
            if (frame === undefined) frame = requestAnimationFrame(update);
        };
        update();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        observer?.observe(scroll);
        observer?.observe(content);
        content.querySelectorAll('[data-admin-virtual-row]').forEach(row => observer?.observe(row));
        scroll.addEventListener('scroll', schedule, { passive: true });
        content.addEventListener('focusin', schedule);
        content.addEventListener('focusout', schedule);
        window.addEventListener('resize', schedule);
        document.addEventListener('visibilitychange', schedule);
        return () => {
            if (frame !== undefined) cancelAnimationFrame(frame);
            observer?.disconnect();
            scroll.removeEventListener('scroll', schedule);
            content.removeEventListener('focusin', schedule);
            content.removeEventListener('focusout', schedule);
            window.removeEventListener('resize', schedule);
            document.removeEventListener('visibilitychange', schedule);
        };
    }, [
        keys,
        enabled,
        active,
        estimateSize,
        overscan,
        gap,
        scrollRef,
        contentRef,
        current.start,
        current.end,
    ]);
    return current;
}
