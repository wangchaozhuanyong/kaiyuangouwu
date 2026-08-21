import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ChevronRight, MessageSquare, Package, RefreshCw, Star } from 'lucide-react';
import { FormEvent, useState } from 'react';

import { ShopApi } from './api';
import { languageCodeFor } from './i18n';
import { offlineLoadError } from './loading-state';
import {
    PUBLIC_QUERY_GC_TIME,
    ROUTE_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
} from './query-client';
import {
    ActiveCustomer,
    MarketConfig,
    StorefrontLanguage,
    StorefrontReview,
    StorefrontReviewCandidate,
    SubmitStorefrontReviewInput,
} from './types';

export function ReviewCenterPage({
    api,
    customer,
    market,
    language,
    onBack,
    onProduct,
    onShop,
    onSignIn,
    onNotify,
}: {
    api: ShopApi;
    customer: ActiveCustomer | null;
    market: MarketConfig;
    language: StorefrontLanguage;
    onBack: () => void;
    onProduct: (productId: string) => void;
    onShop: () => void;
    onSignIn: () => void;
    onNotify: (message: string) => void;
}) {
    const isZh = language === 'zh';
    const queryClient = useQueryClient();
    const reviewsQuery = useQuery({
        queryKey: storefrontQueryKeys.customerReviews(
            market.code,
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.myReviews(signal),
        enabled: Boolean(customer),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const candidatesQuery = useQuery({
        queryKey: storefrontQueryKeys.reviewCandidates(
            market.code,
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ signal }) => api.reviewCandidates(signal),
        enabled: Boolean(customer),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const reviews = reviewsQuery.data ?? [];
    const candidates = candidatesQuery.data ?? [];
    const [selected, setSelected] = useState<StorefrontReviewCandidate | null>(null);
    const submit = async (input: SubmitStorefrontReviewInput) => {
        await api.submitReview(input);
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: storefrontQueryKeys.customerReviews(
                    market.code,
                    languageCodeFor(language),
                    customer?.id ?? '',
                ),
            }),
            queryClient.invalidateQueries({
                queryKey: storefrontQueryKeys.reviewCandidates(
                    market.code,
                    languageCodeFor(language),
                    customer?.id ?? '',
                ),
            }),
        ]);
        setSelected(null);
        onNotify(isZh ? '评价已提交，审核通过后将公开展示' : 'Review submitted for moderation');
    };

    return (
        <main className="page subpage review-center-page">
            <header className="subpage-header">
                <button type="button" onClick={onBack} aria-label={isZh ? '返回' : 'Back'}>
                    <ArrowLeft aria-hidden="true" />
                </button>
                <strong>{isZh ? '评价中心' : 'Reviews'}</strong>
                <span />
            </header>
            {!customer ? (
                <ReviewEmptyState
                    icon={<MessageSquare />}
                    title={isZh ? '登录后管理评价' : 'Sign in to manage reviews'}
                    detail={isZh ? '已购买商品的评价资格会显示在这里' : 'Eligible purchases appear here'}
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={onSignIn}
                />
            ) : reviewsQuery.isLoading || candidatesQuery.isLoading ? (
                <div className="review-center-loading" aria-busy="true">
                    <span />
                    <span />
                    <span />
                </div>
            ) : (reviewsQuery.isPaused && reviewsQuery.data === undefined) ||
              (candidatesQuery.isPaused && candidatesQuery.data === undefined) ||
              reviewsQuery.isError ||
              candidatesQuery.isError ? (
                <ReviewEmptyState
                    icon={<RefreshCw />}
                    title={isZh ? '评价记录加载失败' : 'Could not load reviews'}
                    detail={
                        reviewsQuery.isPaused || candidatesQuery.isPaused
                            ? offlineLoadError(language)
                            : reviewsQuery.error instanceof Error
                              ? reviewsQuery.error.message
                              : candidatesQuery.error instanceof Error
                                ? candidatesQuery.error.message
                                : ''
                    }
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void Promise.all([reviewsQuery.refetch(), candidatesQuery.refetch()])}
                />
            ) : (
                <>
                    {selected && (
                        <ReviewComposer
                            candidate={selected}
                            language={language}
                            onCancel={() => setSelected(null)}
                            onSubmit={submit}
                        />
                    )}
                    <section className="review-center-section">
                        <header>
                            <strong>{isZh ? '待评价' : 'Ready to review'}</strong>
                            <span>{candidates.length}</span>
                        </header>
                        {candidates.length ? (
                            <div className="review-candidate-list">
                                {candidates.map(candidate => (
                                    <button
                                        type="button"
                                        key={candidate.orderLineId}
                                        onClick={() => setSelected(candidate)}
                                    >
                                        <Package aria-hidden="true" />
                                        <span>
                                            <strong>{candidate.productName}</strong>
                                            <small>
                                                {candidate.variantName} · {candidate.sku}
                                            </small>
                                        </span>
                                        <span>
                                            {isZh ? '去评价' : 'Review'}
                                            <ChevronRight aria-hidden="true" />
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <p className="review-center-hint">
                                {isZh
                                    ? '完成实物订单或付款后的数字商品会出现在这里'
                                    : 'Delivered physical items and paid digital items appear here'}
                            </p>
                        )}
                    </section>
                    <section className="review-center-section">
                        <header>
                            <strong>{isZh ? '我的评价' : 'My reviews'}</strong>
                            <span>{reviews.length}</span>
                        </header>
                        {reviews.length ? (
                            <div className="my-review-list">
                                {reviews.map(review => (
                                    <article key={review.id}>
                                        <header>
                                            <button
                                                type="button"
                                                disabled={!review.productId}
                                                onClick={() =>
                                                    review.productId && onProduct(review.productId)
                                                }
                                            >
                                                {review.productName}
                                            </button>
                                            <ReviewStateBadge state={review.state} language={language} />
                                        </header>
                                        <ReviewStars rating={review.rating} />
                                        <strong>{review.title}</strong>
                                        <p>{review.body}</p>
                                        {review.merchantResponse && (
                                            <blockquote>
                                                <strong>{isZh ? '商家回复' : 'Store response'}</strong>
                                                {review.merchantResponse}
                                            </blockquote>
                                        )}
                                        <small>{formatReviewDate(review.createdAt, language)}</small>
                                    </article>
                                ))}
                            </div>
                        ) : (
                            <ReviewEmptyState
                                icon={<MessageSquare />}
                                title={isZh ? '还没有评价' : 'No reviews yet'}
                                detail={
                                    isZh
                                        ? '完成购买后可以分享真实体验'
                                        : 'Share your experience after a purchase'
                                }
                                action={isZh ? '去选购' : 'Shop now'}
                                onAction={onShop}
                            />
                        )}
                    </section>
                </>
            )}
        </main>
    );
}

export function ProductReviewsSection({
    api,
    productId,
    market,
    language,
}: {
    api: ShopApi;
    productId: string;
    market: MarketConfig;
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    const query = useQuery({
        queryKey: storefrontQueryKeys.productReviews(market.code, languageCodeFor(language), productId),
        queryFn: ({ signal }) => api.productReviews(productId, signal),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const reviews = query.data?.items ?? [];
    const average = query.data?.averageRating ?? 0;
    return (
        <section className="detail-block detail-review-block">
            <header>
                <strong>{isZh ? '用户评价' : 'Reviews'}</strong>
                <span>
                    {reviews.length
                        ? `${average.toFixed(1)} · ${query.data?.totalItems ?? reviews.length}`
                        : isZh
                          ? '暂无评价'
                          : 'No reviews yet'}
                </span>
            </header>
            {query.isLoading ? (
                <div className="product-review-loading" aria-busy="true">
                    <span />
                    <span />
                </div>
            ) : (query.isPaused && query.data === undefined) || query.isError ? (
                <button className="product-review-retry" type="button" onClick={() => void query.refetch()}>
                    <RefreshCw aria-hidden="true" />
                    {query.isPaused
                        ? offlineLoadError(language)
                        : isZh
                          ? '加载失败，点击重试'
                          : 'Could not load reviews. Retry'}
                </button>
            ) : reviews.length ? (
                <div className="product-review-list">
                    {reviews.map(review => (
                        <article key={review.id}>
                            <header>
                                <span>{review.customerName}</span>
                                <small>{formatReviewDate(review.createdAt, language)}</small>
                            </header>
                            <ReviewStars rating={review.rating} />
                            <strong>{review.title}</strong>
                            <p>{review.body}</p>
                            <em>
                                <CheckCircle2 aria-hidden="true" />
                                {isZh ? '已验证购买' : 'Verified purchase'}
                            </em>
                            {review.merchantResponse && (
                                <blockquote>
                                    <strong>{isZh ? '商家回复' : 'Store response'}</strong>
                                    {review.merchantResponse}
                                </blockquote>
                            )}
                        </article>
                    ))}
                </div>
            ) : (
                <div className="detail-empty-review">
                    <MessageSquare aria-hidden="true" />
                    <span>
                        <strong>
                            {isZh ? '等待第一条真实评价' : 'Waiting for the first verified review'}
                        </strong>
                        <small>{isZh ? '评价将在审核通过后显示' : 'Approved reviews appear here'}</small>
                    </span>
                </div>
            )}
        </section>
    );
}

function ReviewComposer({
    candidate,
    language,
    onCancel,
    onSubmit,
}: {
    candidate: StorefrontReviewCandidate;
    language: StorefrontLanguage;
    onCancel: () => void;
    onSubmit: (input: SubmitStorefrontReviewInput) => Promise<void>;
}) {
    const isZh = language === 'zh';
    const [rating, setRating] = useState(5);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (title.trim().length < 2 || title.trim().length > 120) {
            setError(isZh ? '评价标题需为 2 到 120 个字符' : 'Title must be 2 to 120 characters');
            return;
        }
        if (body.trim().length < 10 || body.trim().length > 2_000) {
            setError(isZh ? '评价内容需为 10 到 2000 个字符' : 'Review must be 10 to 2000 characters');
            return;
        }
        setSubmitting(true);
        setError('');
        try {
            await onSubmit({
                orderLineId: candidate.orderLineId,
                rating,
                title: title.trim(),
                body: body.trim(),
            });
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
        } finally {
            setSubmitting(false);
        }
    };
    return (
        <form className="review-composer" onSubmit={event => void submit(event)}>
            <header>
                <span>
                    <strong>{candidate.productName}</strong>
                    <small>{candidate.variantName}</small>
                </span>
                <button type="button" onClick={onCancel} disabled={submitting}>
                    {isZh ? '取消' : 'Cancel'}
                </button>
            </header>
            <fieldset>
                <legend>{isZh ? '商品评分' : 'Rating'}</legend>
                <div className="review-rating-input">
                    {[1, 2, 3, 4, 5].map(value => (
                        <button
                            type="button"
                            key={value}
                            className={value <= rating ? 'is-active' : undefined}
                            onClick={() => setRating(value)}
                            aria-label={isZh ? `${value} 星` : `${value} stars`}
                        >
                            <Star aria-hidden="true" />
                        </button>
                    ))}
                </div>
            </fieldset>
            <label>
                <span>{isZh ? '评价标题' : 'Title'}</span>
                <input
                    value={title}
                    maxLength={120}
                    onChange={event => setTitle(event.target.value)}
                    disabled={submitting}
                />
            </label>
            <label>
                <span>{isZh ? '评价内容' : 'Review'}</span>
                <textarea
                    value={body}
                    rows={5}
                    maxLength={2000}
                    onChange={event => setBody(event.target.value)}
                    disabled={submitting}
                />
            </label>
            {error && (
                <small className="form-error" role="alert">
                    {error}
                </small>
            )}
            <button className="review-submit" type="submit" disabled={submitting}>
                {submitting ? (isZh ? '提交中' : 'Submitting') : isZh ? '提交评价' : 'Submit review'}
            </button>
        </form>
    );
}

function ReviewStars({ rating }: { rating: number }) {
    return (
        <span className="review-stars" aria-label={`${rating}/5`}>
            {[1, 2, 3, 4, 5].map(value => (
                <Star key={value} className={value <= rating ? 'is-active' : undefined} aria-hidden="true" />
            ))}
        </span>
    );
}

function ReviewStateBadge({
    state,
    language,
}: {
    state: StorefrontReview['state'];
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    const labels = {
        PENDING: isZh ? '待审核' : 'Pending',
        APPROVED: isZh ? '已发布' : 'Published',
        REJECTED: isZh ? '未通过' : 'Not approved',
    };
    return <span className={`review-state is-${state.toLowerCase()}`}>{labels[state]}</span>;
}

function ReviewEmptyState({
    icon,
    title,
    detail,
    action,
    onAction,
}: {
    icon: React.ReactNode;
    title: string;
    detail: string;
    action: string;
    onAction: () => void;
}) {
    return (
        <section className="empty-state">
            <span>{icon}</span>
            <strong>{title}</strong>
            <small>{detail}</small>
            <button type="button" onClick={onAction}>
                {action}
            </button>
        </section>
    );
}

function formatReviewDate(value: string, language: StorefrontLanguage): string {
    return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(new Date(value));
}
