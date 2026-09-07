import { formatOperationFailure, normalizeOperationFailure } from './operation-failure';

export function toUserFacingError(error: unknown, fallback = '数据加载失败，请稍后重试或联系系统管理员') {
    return formatOperationFailure(
        normalizeOperationFailure(error, {
            fallbackReason: fallback,
        }),
    );
}
