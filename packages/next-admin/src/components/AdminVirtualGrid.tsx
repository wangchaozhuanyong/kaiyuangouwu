import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useVirtualRows } from '../hooks/use-virtual-rows';

const columnsForViewport = () =>
    window.innerWidth >= 1280 ? 10 : window.innerWidth >= 768 ? 8 : window.innerWidth >= 640 ? 4 : 2;

/** Asset cards retain their existing responsive columns; small pages render normally. */
export function AdminVirtualGrid<T>({
    items,
    itemKey,
    renderItem,
    scrollRef,
}: {
    items: readonly T[];
    itemKey: (item: T) => string;
    renderItem: (item: T) => ReactNode;
    scrollRef: RefObject<HTMLElement | null>;
}) {
    const [columns, setColumns] = useState(columnsForViewport);
    useEffect(() => {
        const resize = () => setColumns(columnsForViewport());
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, []);
    const rows = useMemo(
        () =>
            Array.from({ length: Math.ceil(items.length / columns) }, (_, index) =>
                items.slice(index * columns, (index + 1) * columns),
            ),
        [items, columns],
    );
    const keys = useMemo(() => rows.map(row => itemKey(row[0])), [rows, itemKey]);
    const gap = columns === 2 ? 12 : 16;
    const estimateSize = useMemo(
        () => (width: number) => (width - gap * (columns - 1)) / columns + 66,
        [columns, gap],
    );
    const contentRef = useRef<HTMLDivElement>(null);
    const virtualRows = useVirtualRows({
        contentRef,
        keys,
        scrollRef,
        estimateSize,
        enabled: items.length > 40,
        gap,
    });
    return (
        <div className="p-3 sm:p-6">
            <div
                ref={contentRef}
                style={{ paddingTop: virtualRows.before, paddingBottom: virtualRows.after }}
            >
                {rows.slice(virtualRows.start, virtualRows.end).map((row, offset) => {
                    const index = virtualRows.start + offset;
                    return (
                        <div
                            key={keys[index]}
                            data-admin-virtual-row={index}
                            className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-4 md:grid-cols-8 xl:grid-cols-10"
                            style={{ marginBottom: index < rows.length - 1 ? gap : 0 }}
                        >
                            {row.map(item => (
                                <div key={itemKey(item)} className="min-w-0">
                                    {renderItem(item)}
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
