import { useCallback, useState } from 'react';
import { DEFAULT_PAGE_SIZE, normalizePageSize } from '../utils/pagination';

// 每个列表独立保存条数；切换时同时重置偏移，避免请求越界的旧页码。
export function usePageSize(resetPage: (page: number) => void) {
    const [pageSize, updatePageSize] = useState(DEFAULT_PAGE_SIZE);
    const setPageSize = useCallback(
        (value: number) => {
            const next = normalizePageSize(value);
            if (next === pageSize) return;
            resetPage(0);
            updatePageSize(next);
        },
        [pageSize, resetPage],
    );
    return [pageSize, setPageSize] as const;
}
