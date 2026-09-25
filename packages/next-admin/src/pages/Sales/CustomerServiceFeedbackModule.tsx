import { useQuery } from '@apollo/client/react';
import { gql } from 'graphql-tag';
import { RefreshCw, Star } from 'lucide-react';
import { useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';

interface FeedbackRecord {
    id: string;
    customerId: string;
    orderCode: string | null;
    rating: number;
    tags: string[];
    comment: string | null;
    updatedAt: string;
}

interface FeedbackQueryResult {
    customerServiceFeedbacks: { items: FeedbackRecord[]; totalItems: number };
}

const PAGE_SIZE = 30;
const FEEDBACK_QUERY = gql`
    query CustomerServiceFeedbacks($skip: Int!, $take: Int!) {
        customerServiceFeedbacks(skip: $skip, take: $take) {
            totalItems
            items {
                id
                customerId
                orderCode
                rating
                tags
                comment
                updatedAt
            }
        }
    }
`;

const tagLabels: Record<string, string> = {
    FAST_RESPONSE: '响应迅速',
    FRIENDLY: '态度热情',
    PROFESSIONAL: '耐心专业',
    RESOLVED: '问题已解决',
    EFFICIENT: '处理高效',
};

export function CustomerServiceFeedbackModule() {
    const [page, setPage] = useState(0);
    const { data, loading, error, refetch } = useQuery<FeedbackQueryResult>(FEEDBACK_QUERY, {
        variables: { skip: page * PAGE_SIZE, take: PAGE_SIZE },
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const result = data?.customerServiceFeedbacks;

    return (
        <div className="min-h-full bg-slate-50">
            <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-5 sm:px-8">
                <div>
                    <h1 className="text-xl font-semibold text-slate-950">
                        客服服务评价{' '}
                        <FeatureHelpButton topic="sales.customer-service-feedback" title="客服服务评价" />
                    </h1>
                    <p className="mt-1 text-xs text-slate-500">客户提交后同步到这里；按当前店铺隔离。</p>
                </div>
                <button
                    type="button"
                    onClick={() => void refetch()}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                    <RefreshCw size={15} aria-hidden="true" /> 刷新
                </button>
            </header>
            <main className="space-y-4 px-5 py-6 sm:px-8">
                {error && (
                    <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
                        客服评价读取失败，请稍后重试。
                    </p>
                )}
                {!error && loading && !data && <p role="status">正在读取客服评价…</p>}
                {!error && !loading && result?.items.length === 0 && (
                    <p className="rounded-xl bg-white p-6 text-sm text-slate-500">暂无客服评价</p>
                )}
                {result?.items.map(item => (
                    <article
                        key={item.id}
                        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <span className="font-semibold text-slate-900">客户 #{item.customerId}</span>
                                {item.orderCode && (
                                    <span className="text-xs text-slate-500">订单 {item.orderCode}</span>
                                )}
                            </div>
                            <time className="text-xs text-slate-500" dateTime={item.updatedAt}>
                                {new Date(item.updatedAt).toLocaleString('zh-CN')}
                            </time>
                        </div>
                        <div
                            className="mt-3 flex items-center gap-1 text-amber-500"
                            aria-label={`${item.rating} 星`}
                        >
                            {Array.from({ length: 5 }, (_, index) => (
                                <Star
                                    key={index}
                                    size={17}
                                    fill={index < item.rating ? 'currentColor' : 'none'}
                                    aria-hidden="true"
                                />
                            ))}
                        </div>
                        {item.tags.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {item.tags.map(tag => (
                                    <span
                                        key={tag}
                                        className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
                                    >
                                        {tagLabels[tag] ?? tag}
                                    </span>
                                ))}
                            </div>
                        )}
                        {item.comment && (
                            <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{item.comment}</p>
                        )}
                    </article>
                ))}
                {(result?.totalItems ?? 0) > PAGE_SIZE && (
                    <nav className="flex items-center justify-between" aria-label="客服评价分页">
                        <span className="text-xs text-slate-500">共 {result?.totalItems} 条</span>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                disabled={page === 0}
                                onClick={() => setPage(page - 1)}
                                className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40"
                            >
                                上一页
                            </button>
                            <button
                                type="button"
                                disabled={(page + 1) * PAGE_SIZE >= (result?.totalItems ?? 0)}
                                onClick={() => setPage(page + 1)}
                                className="rounded-lg border px-3 py-2 text-xs disabled:opacity-40"
                            >
                                下一页
                            </button>
                        </div>
                    </nav>
                )}
            </main>
        </div>
    );
}
