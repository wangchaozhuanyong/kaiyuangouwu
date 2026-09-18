import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSavedListSearch } from '../utils/list-state-storage';

export interface AdminReturnLocationState {
    returnTo?: string;
}

export function useAdminReturn(fallbackPath: string) {
    const location = useLocation();
    const navigate = useNavigate();

    const resolveReturnTarget = useCallback(() => {
        // 1. 优先使用进入编辑/详情页时显式携带的路由状态 (精准原路返回)
        const state = location.state as AdminReturnLocationState | null;
        if (state?.returnTo && typeof state.returnTo === 'string') {
            return state.returnTo;
        }

        // 2. 其次使用当前会话中为 fallbackPath 记录的查询参数
        const savedSearch = getSavedListSearch(fallbackPath);
        if (savedSearch) {
            return `${fallbackPath}${savedSearch}`;
        }

        // 3. 兜底返回静态路径
        return fallbackPath;
    }, [fallbackPath, location.state]);

    const returnToList = useCallback(() => {
        const target = resolveReturnTarget();
        navigate(target);
    }, [navigate, resolveReturnTarget]);

    return {
        returnToList,
        resolveReturnTarget,
        returnPath: resolveReturnTarget(),
    };
}
