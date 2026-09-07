import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type SortDirection = 'ASC' | 'DESC';

interface UrlSortStateOptions<TSortField extends string> {
    fields: readonly TSortField[];
    defaultField: TSortField;
    defaultDirection?: SortDirection;
    fieldParameter?: string;
    directionParameter?: string;
    pageParameter?: string;
}

export function useUrlSortState<TSortField extends string>({
    fields,
    defaultField,
    defaultDirection = 'DESC',
    fieldParameter = 'sort',
    directionParameter = 'direction',
    pageParameter = 'page',
}: UrlSortStateOptions<TSortField>) {
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedField = searchParams.get(fieldParameter);
    const sortField = fields.includes(requestedField as TSortField)
        ? (requestedField as TSortField)
        : defaultField;
    const requestedDirection = searchParams.get(directionParameter);
    const sortDirection: SortDirection =
        requestedDirection === 'ASC' || requestedDirection === 'DESC' ? requestedDirection : defaultDirection;

    const toggleSort = useCallback(
        (field: TSortField, initialDirection: SortDirection = 'ASC') => {
            const nextDirection: SortDirection =
                field === sortField ? (sortDirection === 'ASC' ? 'DESC' : 'ASC') : initialDirection;

            setSearchParams(
                current => {
                    const next = new URLSearchParams(current);
                    if (field === defaultField && nextDirection === defaultDirection) {
                        next.delete(fieldParameter);
                        next.delete(directionParameter);
                    } else {
                        next.set(fieldParameter, field);
                        next.set(directionParameter, nextDirection);
                    }
                    next.delete(pageParameter);
                    return next;
                },
                { replace: true },
            );
        },
        [
            defaultDirection,
            defaultField,
            directionParameter,
            fieldParameter,
            pageParameter,
            setSearchParams,
            sortDirection,
            sortField,
        ],
    );

    return { sortDirection, sortField, toggleSort };
}
