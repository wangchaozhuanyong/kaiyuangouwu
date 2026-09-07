import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ComponentPropsWithoutRef } from 'react';
import type { SortDirection } from '../hooks/use-url-sort-state';

interface SortableTableHeaderProps<TSortField extends string> extends Omit<
    ComponentPropsWithoutRef<'th'>,
    'children'
> {
    label: string;
    sortField: TSortField;
    activeSortField: TSortField;
    sortDirection: SortDirection;
    onSort: (field: TSortField, initialDirection?: SortDirection) => void;
    initialDirection?: SortDirection;
    align?: 'left' | 'center' | 'right';
}

const alignmentClasses = {
    left: 'justify-start text-left',
    center: 'justify-center text-center',
    right: 'justify-end text-right',
} as const;

export function SortableTableHeader<TSortField extends string>({
    label,
    sortField,
    activeSortField,
    sortDirection,
    onSort,
    initialDirection = 'ASC',
    align = 'left',
    className = '',
    ...props
}: SortableTableHeaderProps<TSortField>) {
    const active = sortField === activeSortField;
    const currentLabel = sortDirection === 'ASC' ? '升序' : '降序';
    const nextDirection = active
        ? sortDirection === 'ASC'
            ? '降序'
            : '升序'
        : initialDirection === 'ASC'
          ? '升序'
          : '降序';

    return (
        <th
            {...props}
            scope="col"
            aria-sort={active ? (sortDirection === 'ASC' ? 'ascending' : 'descending') : 'none'}
            className={className}
        >
            <button
                type="button"
                onClick={() => onSort(sortField, initialDirection)}
                aria-label={
                    active
                        ? `${label}，当前${currentLabel}，点击切换为${nextDirection}`
                        : `${label}，未排序，点击按${nextDirection}排列`
                }
                title={
                    active
                        ? `当前${currentLabel}，点击切换为${nextDirection}`
                        : `按${label}${nextDirection}排列`
                }
                className={`group flex w-full items-center gap-1.5 rounded-sm outline-none transition-colors hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${alignmentClasses[align]} ${active ? 'text-blue-700' : ''}`}
            >
                <span>{label}</span>
                {active ? (
                    sortDirection === 'ASC' ? (
                        <ArrowUp aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                        <ArrowDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                    )
                ) : (
                    <ArrowUpDown
                        aria-hidden="true"
                        className="h-3.5 w-3.5 shrink-0 opacity-40 transition-opacity group-hover:opacity-80"
                    />
                )}
            </button>
        </th>
    );
}
