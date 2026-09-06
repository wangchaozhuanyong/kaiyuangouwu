import { LoaderCircle } from 'lucide-react';
import { Ref } from 'react';

import { StorefrontLanguage } from '../../types';

export function CategoryPaginationStatus({
    state,
    language,
    sentinelRef,
    onContinue,
}: {
    state: 'idle' | 'loading' | 'updating' | 'offline' | 'error' | 'done' | 'manual';
    language: StorefrontLanguage;
    sentinelRef: Ref<HTMLDivElement>;
    onContinue: () => void;
}) {
    const isZh = language === 'zh';
    return (
        <div className="category-pagination-status" ref={sentinelRef} role="status" aria-live="polite">
            {state === 'loading' || state === 'updating' ? (
                <>
                    <LoaderCircle
                        className="size-4 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                    />
                    <span>
                        {state === 'loading'
                            ? isZh
                                ? '正在加载更多商品…'
                                : 'Loading more products…'
                            : isZh
                              ? '正在更新商品…'
                              : 'Updating products…'}
                    </span>
                </>
            ) : state === 'offline' ? (
                <span>{isZh ? '网络已断开，连接后继续' : 'You are offline. Reconnect to continue.'}</span>
            ) : state === 'error' || state === 'manual' ? (
                <button type="button" onClick={onContinue}>
                    {state === 'error'
                        ? isZh
                            ? '加载失败，点击重试'
                            : 'Loading failed. Retry'
                        : isZh
                          ? '加载更多'
                          : 'Load more'}
                </button>
            ) : state === 'done' ? (
                <span>{isZh ? '已显示全部商品' : 'All products displayed'}</span>
            ) : null}
        </div>
    );
}
