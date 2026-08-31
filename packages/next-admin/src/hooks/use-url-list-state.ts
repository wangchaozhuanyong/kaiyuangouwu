import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

function readPage(searchParams: URLSearchParams, parameter: string) {
    const parsedPage = Number.parseInt(searchParams.get(parameter) ?? '1', 10);
    return Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage - 1 : 0;
}

export function useUrlListState(searchParameter = 'search', pageParameter = 'page') {
    const [searchParams, setSearchParams] = useSearchParams();
    const searchTerm = searchParams.get(searchParameter) ?? '';
    const page = readPage(searchParams, pageParameter);

    const setSearchTerm = useCallback(
        (value: string) => {
            setSearchParams(
                current => {
                    const next = new URLSearchParams(current);
                    if (value) next.set(searchParameter, value);
                    else next.delete(searchParameter);
                    next.delete(pageParameter);
                    return next;
                },
                { replace: true },
            );
        },
        [pageParameter, searchParameter, setSearchParams],
    );

    const setPage = useCallback(
        (value: number) => {
            setSearchParams(
                current => {
                    const next = new URLSearchParams(current);
                    if (value > 0) next.set(pageParameter, String(value + 1));
                    else next.delete(pageParameter);
                    return next;
                },
                { replace: true },
            );
        },
        [pageParameter, setSearchParams],
    );

    const setFilter = useCallback(
        (parameter: string, value: string, defaultValue = '') => {
            setSearchParams(
                current => {
                    const next = new URLSearchParams(current);
                    if (!value || value === defaultValue) next.delete(parameter);
                    else next.set(parameter, value);
                    next.delete(pageParameter);
                    return next;
                },
                { replace: true },
            );
        },
        [pageParameter, setSearchParams],
    );

    return { page, searchParams, searchTerm, setFilter, setPage, setSearchTerm };
}
