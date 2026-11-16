import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useState } from 'react';

import { CustomerAvatar } from './components/common/customer-avatar';
import { offlineLoadError, storefrontQueryPresentation } from './loading-state';
import { PageSkeleton } from './route-loading';
import { storefrontErrorMessage } from './storefront-errors';
import { InlineError, Sheet } from './storefront-ui/page-shell';
import { ActiveCustomer, CustomerAvatarHistoryEntry, StorefrontLanguage } from './types';

export interface AvatarHistoryActions {
    queryKey: QueryKey;
    load: (signal?: AbortSignal) => Promise<CustomerAvatarHistoryEntry[]>;
    restore: (id: string) => Promise<void>;
}

export function AvatarHistorySheet({
    customer,
    language,
    actions,
    busy,
    onClose,
}: {
    customer: ActiveCustomer;
    language: StorefrontLanguage;
    actions: AvatarHistoryActions;
    busy: boolean;
    onClose: () => void;
}) {
    const isZh = language === 'zh';
    const history = useQuery({
        queryKey: actions.queryKey,
        queryFn: ({ signal }) => actions.load(signal),
        staleTime: 0,
        refetchOnMount: 'always',
    });
    const { initialLoading } = storefrontQueryPresentation(history);
    const loadError = history.isPaused
        ? offlineLoadError(language)
        : history.error
          ? storefrontErrorMessage(history.error, language)
          : '';
    const [restoringId, setRestoringId] = useState<string | null>(null);
    const [restoreError, setRestoreError] = useState('');
    const writing = busy || Boolean(restoringId);
    const restore = async (id: string) => {
        setRestoringId(id);
        setRestoreError('');
        try {
            await actions.restore(id);
            onClose();
        } catch (error) {
            setRestoreError(storefrontErrorMessage(error, language));
        } finally {
            setRestoringId(null);
        }
    };
    return (
        <Sheet
            title={isZh ? '历史头像' : 'Photo history'}
            language={language}
            onClose={() => {
                if (!writing) onClose();
            }}
        >
            <div className="security-avatar-history">
                {initialLoading && (
                    <PageSkeleton label={isZh ? '正在读取历史头像' : 'Loading photo history'} />
                )}
                {loadError && (
                    <InlineError
                        message={loadError}
                        action={isZh ? '重试' : 'Retry'}
                        onAction={() => void history.refetch({ cancelRefetch: false })}
                    />
                )}
                {restoreError && (
                    <InlineError
                        message={restoreError}
                        action={isZh ? '刷新列表' : 'Refresh photos'}
                        onAction={() => void history.refetch({ cancelRefetch: false })}
                    />
                )}
                {history.data?.length === 0 && <p>{isZh ? '暂无历史头像' : 'No previous photos.'}</p>}
                {!!history.data?.length && (
                    <ul>
                        {history.data.map(entry => (
                            <li key={entry.id}>
                                {entry.asset?.preview && (
                                    <CustomerAvatar
                                        customer={customer}
                                        source={entry.asset.preview}
                                        size={40}
                                    />
                                )}
                                <time dateTime={entry.quarantinedAt}>
                                    {new Date(entry.quarantinedAt).toLocaleString(isZh ? 'zh-CN' : 'en')}
                                </time>
                                {entry.asset ? (
                                    <button
                                        type="button"
                                        className="secondary-action"
                                        disabled={
                                            writing ||
                                            history.isFetching ||
                                            history.isPaused ||
                                            history.isError
                                        }
                                        aria-busy={restoringId === entry.id}
                                        onClick={() => void restore(entry.id)}
                                    >
                                        {restoringId === entry.id
                                            ? isZh
                                                ? '正在恢复…'
                                                : 'Restoring…'
                                            : isZh
                                              ? '恢复头像'
                                              : 'Restore photo'}
                                    </button>
                                ) : (
                                    <span>{isZh ? '文件已不可用' : 'File unavailable'}</span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </Sheet>
    );
}
