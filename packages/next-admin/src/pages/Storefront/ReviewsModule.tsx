import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    Check,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Languages,
    MessageSquare,
    RefreshCw,
    Search,
    Star,
    X,
    XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { GET_STOREFRONT_REVIEWS, MODERATE_STOREFRONT_REVIEW } from '../../graphql/sales.graphql';
import { useUrlTab } from '../../hooks/use-url-tab';
import { toUserFacingError } from '../../utils/user-facing-error';
import { formatDateTime } from '../Sales/sales-utils';

type ReviewState = 'PENDING' | 'APPROVED' | 'REJECTED';
const REVIEW_TABS = { pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED' } as const;

interface StorefrontReviewItem {
    id: string;
    createdAt: string;
    updatedAt: string;
    state: ReviewState;
    rating: number;
    title: string;
    body: string;
    customerName: string;
    productName: string;
    sku: string;
    merchantResponse?: string | null;
    moderatedAt?: string | null;
    orderLineId?: string | null;
    productId?: string | null;
    productVariantId?: string | null;
    verifiedPurchase: boolean;
}

interface ReviewData {
    storefrontReviews: {
        items: StorefrontReviewItem[];
        totalItems: number;
        averageRating: number;
    };
}

const PAGE_SIZE = 20;
const EMPTY_REVIEWS: StorefrontReviewItem[] = [];
const tabs: Array<{ id: ReviewState; label: string }> = [
    { id: 'PENDING', label: '待审核' },
    { id: 'APPROVED', label: '已公开' },
    { id: 'REJECTED', label: '已驳回' },
];
const stateLabels: Record<ReviewState, string> = {
    PENDING: '待审核',
    APPROVED: '已公开',
    REJECTED: '已驳回',
};
const stateClasses: Record<ReviewState, string> = {
    PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
    APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    REJECTED: 'border-rose-200 bg-rose-50 text-rose-700',
};

export function ReviewsModule() {
    const [activeTab, setActiveTab] = useUrlTab<ReviewState>(REVIEW_TABS, 'pending');
    const [page, setPage] = useState(0);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedReview, setSelectedReview] = useState<StorefrontReviewItem | null>(null);
    const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
    const [responseText, setResponseText] = useState('');
    const [notification, setNotification] = useState('');
    const [actionError, setActionError] = useState('');

    const { data, loading, error, refetch } = useQuery<ReviewData>(GET_STOREFRONT_REVIEWS, {
        variables: {
            options: {
                skip: page * PAGE_SIZE,
                take: PAGE_SIZE,
                state: activeTab,
                ...(searchTerm.trim() ? { search: searchTerm.trim() } : {}),
            },
        },
        fetchPolicy: 'cache-and-network',
        notifyOnNetworkStatusChange: true,
    });
    const [moderateReview, { loading: moderating }] = useMutation<{
        moderateStorefrontReview: Pick<
            StorefrontReviewItem,
            'id' | 'state' | 'merchantResponse' | 'moderatedAt'
        >;
    }>(MODERATE_STOREFRONT_REVIEW);

    const reviews = data?.storefrontReviews.items ?? EMPTY_REVIEWS;
    const totalItems = data?.storefrontReviews.totalItems ?? 0;
    const averageRating = data?.storefrontReviews.averageRating ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    const showNotice = (message: string) => {
        setNotification(message);
        window.setTimeout(() => setNotification(''), 4000);
    };
    const openReview = (review: StorefrontReviewItem) => {
        setSelectedReview(review);
        setDecision('APPROVED');
        setResponseText(review.merchantResponse ?? '');
        setActionError('');
    };
    const handleModerate = async () => {
        if (!selectedReview || selectedReview.state !== 'PENDING') return;
        const response = responseText.trim();
        if (decision === 'REJECTED' && response.length < 3) {
            setActionError('驳回评价时请填写至少 3 个字符的原因');
            return;
        }
        try {
            await moderateReview({
                variables: {
                    input: {
                        id: selectedReview.id,
                        state: decision,
                        response: response || null,
                    },
                },
            });
            setSelectedReview(null);
            setActionError('');
            await refetch();
            showNotice(decision === 'APPROVED' ? '评价已审核并公开展示' : '评价已驳回');
        } catch (mutationError) {
            setActionError(toUserFacingError(mutationError, '评价处理失败，请稍后重试'));
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-5 sm:px-8">
                <div className="flex w-full flex-wrap items-center justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-semibold tracking-tight text-slate-950">买家评价</h1>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                            审核真实购买评价，并维护商家公开回复
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => refetch()}
                        disabled={loading}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                        刷新
                    </button>
                </div>
            </header>
            <nav
                aria-label="评价状态筛选"
                className="scrollbar-hidden shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-5 sm:px-8"
            >
                <div className="flex w-full min-w-max gap-6">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            type="button"
                            aria-current={activeTab === tab.id ? 'page' : undefined}
                            onClick={() => {
                                setActiveTab(tab.id);
                                setPage(0);
                                setSelectedReview(null);
                            }}
                            className={`border-b-2 py-3.5 text-xs font-semibold transition ${activeTab === tab.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </nav>

            <div className="flex-1 overflow-y-auto p-5 sm:p-8">
                <div className="w-full max-w-none space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-xl bg-slate-900 p-4 text-white">
                            <div className="text-[11px] text-slate-300">当前筛选</div>
                            <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
                                {totalItems}
                            </div>
                            <div className="mt-1 text-[11px] text-slate-400">条评价</div>
                        </div>
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
                                <Star className="h-3.5 w-3.5 fill-amber-400" />
                                当前筛选平均分
                            </div>
                            <div className="mt-2 font-mono text-2xl font-semibold tabular-nums text-amber-900">
                                {averageRating.toFixed(1)}
                            </div>
                            <div className="mt-1 text-[11px] text-amber-700">满分 5.0</div>
                        </div>
                    </div>
                    {notification && (
                        <div
                            role="status"
                            className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800"
                        >
                            <Check className="h-4 w-4" />
                            {notification}
                        </div>
                    )}
                    {error && (
                        <div
                            role="alert"
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800"
                        >
                            <span className="flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" />
                                {toUserFacingError(error, '评价数据加载失败，请稍后重试')}
                            </span>
                            <button
                                type="button"
                                onClick={() => refetch()}
                                className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white"
                            >
                                重试
                            </button>
                        </div>
                    )}
                    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 p-4">
                            <div className="relative min-w-[17rem] flex-1 sm:max-w-md">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                <input
                                    value={searchTerm}
                                    onChange={event => {
                                        setSearchTerm(event.target.value);
                                        setPage(0);
                                    }}
                                    aria-label="搜索商品评价"
                                    placeholder="搜索标题、内容、买家、商品或 SKU"
                                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearchTerm('');
                                            setPage(0);
                                        }}
                                        className="absolute right-2.5 top-2 text-slate-400"
                                        aria-label="清空搜索"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                            <span className="text-xs text-slate-500">
                                状态：<strong className="text-slate-900">{stateLabels[activeTab]}</strong>
                            </span>
                        </div>
                        {loading && !data ? (
                            <div className="space-y-3 p-6">
                                {[1, 2, 3, 4, 5].map(item => (
                                    <div key={item} className="h-12 animate-pulse rounded-lg bg-slate-100" />
                                ))}
                            </div>
                        ) : !error && reviews.length === 0 ? (
                            <div className="flex min-h-80 flex-col items-center justify-center px-6 text-center">
                                <MessageSquare className="h-9 w-9 text-slate-300" />
                                <h2 className="mt-3 text-sm font-semibold text-slate-800">没有匹配的评价</h2>
                                <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
                                    当前状态或搜索条件下没有数据，不会展示示例评价。
                                </p>
                            </div>
                        ) : (
                            reviews.length > 0 && (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[2020px] border-collapse text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                                                <th
                                                    scope="col"
                                                    className="sticky left-0 z-20 w-44 whitespace-nowrap bg-slate-50 px-3 py-3"
                                                >
                                                    买家
                                                </th>
                                                <th scope="col" className="w-24 whitespace-nowrap px-3 py-3">
                                                    购买验证
                                                </th>
                                                <th scope="col" className="w-60 whitespace-nowrap px-3 py-3">
                                                    商品名称
                                                </th>
                                                <th scope="col" className="w-44 whitespace-nowrap px-3 py-3">
                                                    SKU
                                                </th>
                                                <th scope="col" className="w-32 whitespace-nowrap px-3 py-3">
                                                    评分
                                                </th>
                                                <th scope="col" className="w-52 whitespace-nowrap px-3 py-3">
                                                    评价标题
                                                </th>
                                                <th scope="col" className="w-80 whitespace-nowrap px-3 py-3">
                                                    评价内容
                                                </th>
                                                <th scope="col" className="w-72 whitespace-nowrap px-3 py-3">
                                                    商家回复
                                                </th>
                                                <th scope="col" className="w-28 whitespace-nowrap px-3 py-3">
                                                    状态
                                                </th>
                                                <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                                    提交时间
                                                </th>
                                                <th scope="col" className="w-40 whitespace-nowrap px-3 py-3">
                                                    处理时间
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="sticky right-0 z-20 w-28 whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 py-3 text-right"
                                                >
                                                    操作
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {reviews.map(review => (
                                                <tr
                                                    key={review.id}
                                                    className="group h-[52px] hover:bg-slate-50/80"
                                                >
                                                    <td className="sticky left-0 z-10 h-[52px] max-w-44 bg-white px-3 py-0 group-hover:bg-slate-50">
                                                        <span
                                                            className="block truncate font-semibold text-slate-900"
                                                            title={review.customerName}
                                                        >
                                                            {review.customerName}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 text-[10px] font-semibold">
                                                        <span
                                                            className={
                                                                review.verifiedPurchase
                                                                    ? 'text-emerald-700'
                                                                    : 'text-slate-400'
                                                            }
                                                        >
                                                            {review.verifiedPurchase ? '真实购买' : '未验证'}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] max-w-60 px-3 py-0">
                                                        <span
                                                            className="block truncate font-semibold text-slate-800"
                                                            title={review.productName}
                                                        >
                                                            {review.productName}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] max-w-44 px-3 py-0 font-mono text-[10px] text-slate-500">
                                                        <span className="block truncate" title={review.sku}>
                                                            {review.sku}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                                        <Rating value={review.rating} />
                                                    </td>
                                                    <td className="h-[52px] max-w-52 px-3 py-0">
                                                        <span
                                                            className="block truncate font-semibold text-slate-900"
                                                            title={review.title}
                                                        >
                                                            {review.title}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] max-w-80 px-3 py-0">
                                                        <span
                                                            tabIndex={0}
                                                            className="block truncate text-slate-600 outline-none focus:text-blue-700"
                                                            title={review.body}
                                                            aria-label={review.body}
                                                        >
                                                            {review.body}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] max-w-72 px-3 py-0">
                                                        <span
                                                            tabIndex={0}
                                                            className="block truncate text-slate-600 outline-none focus:text-blue-700"
                                                            title={review.merchantResponse ?? undefined}
                                                            aria-label={review.merchantResponse ?? '暂无回复'}
                                                        >
                                                            {review.merchantResponse || '-'}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0">
                                                        <span
                                                            className={`inline-flex whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-semibold ${stateClasses[review.state]}`}
                                                        >
                                                            {stateLabels[review.state]}
                                                        </span>
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                                        {formatDateTime(review.createdAt)}
                                                    </td>
                                                    <td className="h-[52px] whitespace-nowrap px-3 py-0 font-mono text-[10px] text-slate-500">
                                                        {review.moderatedAt
                                                            ? formatDateTime(review.moderatedAt)
                                                            : '-'}
                                                    </td>
                                                    <td className="sticky right-0 z-10 h-[52px] whitespace-nowrap border-l border-slate-100 bg-white px-3 py-0 text-right group-hover:bg-slate-50">
                                                        <button
                                                            type="button"
                                                            onClick={() => openReview(review)}
                                                            className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[10px] font-semibold transition ${review.state === 'PENDING' ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                                                        >
                                                            {review.state === 'PENDING'
                                                                ? '审核回复'
                                                                : '查看详情'}
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        )}
                        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
                            <span>
                                第 {page + 1} / {totalPages} 页，共 {totalItems} 条
                            </span>
                            <div className="flex gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setPage(current => Math.max(0, current - 1))}
                                    disabled={page === 0}
                                    className="rounded-lg border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                                    aria-label="上一页"
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPage(current => Math.min(totalPages - 1, current + 1))}
                                    disabled={page >= totalPages - 1}
                                    className="rounded-lg border border-slate-300 bg-white p-1.5 disabled:opacity-40"
                                    aria-label="下一页"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    </section>
                </div>
            </div>

            {selectedReview && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
                    onClick={() => !moderating && setSelectedReview(null)}
                >
                    <AccessibleDialogSurface
                        accessibleName={selectedReview.state === 'PENDING' ? '审核买家评价' : '评价详情'}
                        onRequestClose={() => {
                            if (!moderating) {
                                setSelectedReview(null);
                            }
                        }}
                        className="w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"
                        onClick={event => event.stopPropagation()}
                    >
                        <header className="flex items-start justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
                            <div>
                                <h2
                                    id="review-dialog-title"
                                    className="text-base font-semibold text-slate-950"
                                >
                                    {selectedReview.state === 'PENDING' ? '审核买家评价' : '评价详情'}
                                </h2>
                                <p className="mt-1 text-xs text-slate-500">
                                    {selectedReview.productName} · {selectedReview.sku}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedReview(null)}
                                disabled={moderating}
                                className="text-slate-400 hover:text-slate-700"
                                aria-label="关闭"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </header>
                        <div className="space-y-4 p-6">
                            <div className="flex items-center justify-between">
                                <Rating value={selectedReview.rating} />
                                <span
                                    className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${stateClasses[selectedReview.state]}`}
                                >
                                    {stateLabels[selectedReview.state]}
                                </span>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                <div className="font-semibold text-slate-900">{selectedReview.title}</div>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                                    {selectedReview.body}
                                </p>
                                <div className="mt-3 text-[10px] text-slate-400">
                                    {selectedReview.customerName} · {formatDateTime(selectedReview.createdAt)}
                                </div>
                            </div>
                            {selectedReview.state === 'PENDING' ? (
                                <>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setDecision('APPROVED')}
                                            className={`flex items-center justify-center gap-1.5 rounded-lg border p-2.5 text-xs font-semibold ${decision === 'APPROVED' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}
                                        >
                                            <CheckCircle2 className="h-4 w-4" />
                                            审核通过并公开
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDecision('REJECTED')}
                                            className={`flex items-center justify-center gap-1.5 rounded-lg border p-2.5 text-xs font-semibold ${decision === 'REJECTED' ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-500'}`}
                                        >
                                            <XCircle className="h-4 w-4" />
                                            驳回评价
                                        </button>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700">
                                            {decision === 'APPROVED' ? '商家公开回复（可选）' : '驳回原因 *'}
                                        </label>
                                        <textarea
                                            value={responseText}
                                            onChange={event => setResponseText(event.target.value)}
                                            rows={4}
                                            placeholder={
                                                decision === 'APPROVED'
                                                    ? '填写中文回复；留空则只公开评价'
                                                    : '填写驳回原因，至少 3 个字符'
                                            }
                                            className="mt-1.5 w-full rounded-lg border border-slate-300 p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                                        />
                                        {decision === 'APPROVED' && responseText.trim() && (
                                            <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-blue-700">
                                                <Languages className="mt-0.5 h-3 w-3 shrink-0" />
                                                系统会通过内容翻译服务生成英文回复，无需重复填写两套内容。
                                            </p>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div>
                                    <div className="text-xs font-semibold text-slate-700">商家处理内容</div>
                                    <div className="mt-2 min-h-20 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                                        {selectedReview.merchantResponse ||
                                            (selectedReview.state === 'REJECTED'
                                                ? '后端未返回驳回原因'
                                                : '公开评价时未填写商家回复')}
                                    </div>
                                </div>
                            )}
                            {actionError && (
                                <div
                                    role="alert"
                                    className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-700"
                                >
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                    {actionError}
                                </div>
                            )}
                        </div>
                        <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
                            <button
                                type="button"
                                onClick={() => setSelectedReview(null)}
                                disabled={moderating}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                            >
                                关闭
                            </button>
                            {selectedReview.state === 'PENDING' && (
                                <button
                                    type="button"
                                    onClick={handleModerate}
                                    disabled={moderating}
                                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {moderating && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}确认处理
                                </button>
                            )}
                        </footer>
                    </AccessibleDialogSurface>
                </div>
            )}
        </div>
    );
}

function Rating({ value }: { value: number }) {
    return (
        <div className="flex items-center gap-0.5" aria-label={`${value} 星评分`}>
            {Array.from({ length: 5 }, (_, index) => (
                <Star
                    key={index}
                    className={`h-3.5 w-3.5 ${index < value ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`}
                />
            ))}
            <span className="ml-1 font-mono text-[11px] font-semibold text-slate-600">{value}.0</span>
        </div>
    );
}
