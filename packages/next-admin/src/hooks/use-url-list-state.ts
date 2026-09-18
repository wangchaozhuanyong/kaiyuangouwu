import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { clearListSearch, getSavedListSearch, saveListSearch } from '../utils/list-state-storage';
import { DEFAULT_PAGE_SIZE, normalizePageSize } from '../utils/pagination';

function readPage(searchParams: URLSearchParams, parameter: string) {
    const parsedPage = Number.parseInt(searchParams.get(parameter) ?? '1', 10);
    return Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage - 1 : 0;
}

export interface UrlListStateOptions {
    autoRestore?: boolean;
    searchParameter?: string;
    pageParameter?: string;
    pageSizeParameter?: string;
}

/**
 * 列表状态管理 Hook（与 URL 查询参数与会话存储双向联动）
 * 1. 负责管理 URL 中的 search, page, pageSize 及自定义筛选字段；
 * 2. 具备会话级状态记忆（离开详情/编辑或侧栏重返时，自动无感恢复上次筛选和分页）；
 * 3. 提供一键重置筛选 (resetFilters) 与是否处于筛选态标识 (isFiltered)。
 */
export function useUrlListState(
    searchParameterOrOptions: string | UrlListStateOptions = 'search',
    pageParameter = 'page',
    pageSizeParameter = 'pageSize',
) {
    const options: UrlListStateOptions =
        typeof searchParameterOrOptions === 'object'
            ? searchParameterOrOptions
            : {
                  autoRestore: true,
                  pageParameter,
                  pageSizeParameter,
                  searchParameter: searchParameterOrOptions,
              };

    const searchParam = options.searchParameter ?? 'search';
    const pageParam = options.pageParameter ?? 'page';
    const pageSizeParam = options.pageSizeParameter ?? 'pageSize';
    const autoRestore = options.autoRestore ?? true;

    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const searchTerm = searchParams.get(searchParam) ?? '';
    const page = readPage(searchParams, pageParam);
    const pageSize = normalizePageSize(searchParams.get(pageSizeParam));

    const hasAttemptedRestoreRef = useRef(false);

    // 1. 初次挂载时，若当前 URL 无任何查询参数，自动检查会话存储中是否有该路由上次活跃的过滤记忆
    useEffect(() => {
        if (!autoRestore || hasAttemptedRestoreRef.current) return;
        hasAttemptedRestoreRef.current = true;

        if (!location.search) {
            const savedSearch = getSavedListSearch(location.pathname);
            if (savedSearch) {
                navigate({ pathname: location.pathname, search: savedSearch }, { replace: true });
            }
        }
    }, [autoRestore, location.pathname, location.search, navigate]);

    // 2. 查询参数变更时，实时同步到会话级存储
    useEffect(() => {
        if (!autoRestore || !hasAttemptedRestoreRef.current) return;
        saveListSearch(location.pathname, location.search);
    }, [autoRestore, location.pathname, location.search]);

    const setPageSize = useCallback(
        (value: number) => {
            setSearchParams(
                current => {
                    const next = new URLSearchParams(current);
                    const size = normalizePageSize(value);
                    if (size === DEFAULT_PAGE_SIZE) next.delete(pageSizeParam);
                    else next.set(pageSizeParam, String(size));
                    next.delete(pageParam);
                    return next;
                },
                { replace: true },
            );
        },
        [pageParam, pageSizeParam, setSearchParams],
    );

    const setSearchTerm = useCallback(
        (value: string) => {
            setSearchParams(
                current => {
                    const next = new URLSearchParams(current);
                    if (value) next.set(searchParam, value);
                    else next.delete(searchParam);
                    next.delete(pageParam);
                    return next;
                },
                { replace: true },
            );
        },
        [pageParam, searchParam, setSearchParams],
    );

    const setPage = useCallback(
        (value: number) => {
            setSearchParams(
                current => {
                    const next = new URLSearchParams(current);
                    if (value > 0) next.set(pageParam, String(value + 1));
                    else next.delete(pageParam);
                    return next;
                },
                { replace: true },
            );
        },
        [pageParam, setSearchParams],
    );

    const setFilter = useCallback(
        (parameter: string, value: string, defaultValue = '') => {
            setSearchParams(
                current => {
                    const next = new URLSearchParams(current);
                    if (!value || value === defaultValue) next.delete(parameter);
                    else next.set(parameter, value);
                    next.delete(pageParam);
                    return next;
                },
                { replace: true },
            );
        },
        [pageParam, setSearchParams],
    );

    const resetFilters = useCallback(() => {
        clearListSearch(location.pathname);
        setSearchParams(new URLSearchParams(), { replace: true });
    }, [location.pathname, setSearchParams]);

    const isFiltered = useMemo(() => {
        if (searchTerm || page > 0) return true;
        for (const [key] of searchParams.entries()) {
            if (key !== pageSizeParam) return true;
        }
        return false;
    }, [page, pageSizeParam, searchParams, searchTerm]);

    return {
        isFiltered,
        page,
        pageSize,
        resetFilters,
        searchParams,
        searchTerm,
        setFilter,
        setPage,
        setPageSize,
        setSearchTerm,
    };
}
