import { GripVertical } from 'lucide-react';
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { StorefrontHomepageRow } from './storefront-homepage-order';

type Placement = 'before' | 'after';

export function StorefrontFloorList({
    rows,
    disabled,
    onReorder,
    renderRow,
}: {
    rows: StorefrontHomepageRow[];
    disabled: boolean;
    onReorder: (sourceKey: string, targetKey: string, placement: Placement) => void;
    renderRow: (row: StorefrontHomepageRow, index: number, handle: ReactNode) => ReactNode;
}) {
    const instructionsId = useId();
    const sourceKey = useRef<string | null>(null);
    const keyboardHandle = useRef<HTMLButtonElement | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    const [target, setTarget] = useState<{ key: string; placement: Placement } | null>(null);
    const locked = disabled || rows.length < 2;
    useEffect(() => {
        if (disabled || !keyboardHandle.current) return;
        const handle = keyboardHandle.current;
        keyboardHandle.current = null;
        if (handle.isConnected && document.activeElement === document.body) handle.focus();
    }, [disabled, rows]);
    const clearDrag = () => {
        sourceKey.current = null;
        setDragging(null);
        setTarget(null);
    };
    const placementAt = (event: DragEvent<HTMLDivElement>): Placement => {
        const rect = event.currentTarget.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    };

    return (
        <div className="divide-y divide-slate-100" aria-busy={disabled}>
            <p id={instructionsId} className="sr-only">
                拖动手柄到目标楼层上方或下方，松开后自动保存。也可聚焦手柄使用上下方向键排序。
            </p>
            {rows.map((row, index) => {
                const name =
                    row.key === 'carousel' ? '首页轮播' : row.blocks[0].internalName || row.blocks[0].code;
                return (
                    <div
                        key={row.key}
                        data-floor-key={row.key}
                        className={`relative ${dragging === row.key && !locked ? 'opacity-40' : ''}`}
                        onDragOver={event => {
                            if (locked || !sourceKey.current) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            if (sourceKey.current === row.key) {
                                setTarget(null);
                                return;
                            }
                            const placement = placementAt(event);
                            setTarget(current =>
                                current?.key === row.key && current.placement === placement
                                    ? current
                                    : { key: row.key, placement },
                            );
                        }}
                        onDragLeave={event => {
                            if (
                                event.relatedTarget instanceof Node &&
                                event.currentTarget.contains(event.relatedTarget)
                            )
                                return;
                            setTarget(current => (current?.key === row.key ? null : current));
                        }}
                        onDrop={event => {
                            if (locked || !sourceKey.current) return;
                            event.preventDefault();
                            const source = sourceKey.current;
                            const placement = placementAt(event);
                            clearDrag();
                            onReorder(source, row.key, placement);
                        }}
                    >
                        {target?.key === row.key && !locked && (
                            <div
                                aria-hidden="true"
                                data-drop-position={target.placement}
                                className={`pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded bg-blue-500 ${target.placement === 'before' ? 'top-0' : 'bottom-0'}`}
                            />
                        )}
                        {renderRow(
                            row,
                            index,
                            <button
                                type="button"
                                draggable={!locked}
                                disabled={locked}
                                aria-label={`拖动${name}排序`}
                                aria-describedby={instructionsId}
                                aria-keyshortcuts="ArrowUp ArrowDown"
                                title="拖拽排序，也可使用上下方向键"
                                className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-blue-500 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                                onDragStart={event => {
                                    if (locked) {
                                        event.preventDefault();
                                        return;
                                    }
                                    sourceKey.current = row.key;
                                    event.dataTransfer.effectAllowed = 'move';
                                    event.dataTransfer.setData('text/plain', row.key);
                                    const element =
                                        event.currentTarget.closest<HTMLElement>('[data-floor-key]');
                                    if (element)
                                        event.dataTransfer.setDragImage(
                                            element,
                                            24,
                                            element.clientHeight / 2,
                                        );
                                    setDragging(row.key);
                                }}
                                onDragEnd={clearDrag}
                                onKeyDown={event => {
                                    if (locked || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                                    event.preventDefault();
                                    const direction = event.key === 'ArrowUp' ? -1 : 1;
                                    const adjacent = rows[index + direction];
                                    if (adjacent) {
                                        keyboardHandle.current = event.currentTarget;
                                        onReorder(
                                            row.key,
                                            adjacent.key,
                                            direction === -1 ? 'before' : 'after',
                                        );
                                    }
                                }}
                            >
                                <GripVertical className="h-4 w-4" />
                            </button>,
                        )}
                    </div>
                );
            })}
        </div>
    );
}
