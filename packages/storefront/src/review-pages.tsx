import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    MessageSquare,
    Package,
    RefreshCw,
    Star,
} from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';

import { ShopApi } from './api';
import { languageCodeFor } from './i18n';
import { offlineLoadError } from './loading-state';
import {
    PUBLIC_QUERY_GC_TIME,
    ROUTE_QUERY_STALE_TIME,
    publicQueryMeta,
    storefrontQueryKeys,
} from './query-client';
import { storefrontErrorMessage } from './storefront-errors';
import { SubHeader } from './storefront-ui/page-shell';
import { SafeImage } from './storefront-ui/product-display';
import {
    ActiveCustomer,
    MarketConfig,
    StorefrontLanguage,
    StorefrontReview,
    StorefrontReviewCandidate,
    SubmitStorefrontReviewInput,
} from './types';

function reviewVariantLabel(candidate: StorefrontReviewCandidate): string {
    const productName = candidate.productName.trim();
    const variantName = candidate.variantName.trim();
    if (variantName === productName) return '';
    if (!variantName.startsWith(productName)) return variantName;
    const suffix = variantName.slice(productName.length);
    return /^[\s·•/|，,、-]/u.test(suffix) ? suffix.replace(/^[\s·•/|，,、-]+/u, '').trim() : variantName;
}

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
            storefrontQueryKeys.market(market),
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
            storefrontQueryKeys.market(market),
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
    const [showAllCandidates, setShowAllCandidates] = useState(false);
    const composerRef = useRef<HTMLFormElement>(null);
    const candidateImages = new Map(
        customer?.orders.items.flatMap(order =>
            order.lines.map(
                line =>
                    [
                        line.id,
                        line.productVariant.featuredAsset?.preview ??
                            line.productVariant.product.featuredAsset?.preview ??
                            null,
                    ] as const,
            ),
        ) ?? [],
    );
    const visibleCandidates = showAllCandidates ? candidates : candidates.slice(0, 4);
    useEffect(() => {
        if (selected) composerRef.current?.scrollIntoView({ block: 'start' });
    }, [selected]);
    const submit = async (input: SubmitStorefrontReviewInput) => {
        await api.submitReview(input);
        await Promise.all([
            queryClient.invalidateQueries({
                queryKey: storefrontQueryKeys.customerReviews(
                    storefrontQueryKeys.market(market),
                    languageCodeFor(language),
                    customer?.id ?? '',
                ),
            }),
            queryClient.invalidateQueries({
                queryKey: storefrontQueryKeys.reviewCandidates(
                    storefrontQueryKeys.market(market),
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
            <SubHeader title={isZh ? '评价中心' : 'Reviews'} language={language} onBack={onBack} />
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
                              ? storefrontErrorMessage(reviewsQuery.error, language)
                              : candidatesQuery.error instanceof Error
                                ? storefrontErrorMessage(candidatesQuery.error, language)
                                : ''
                    }
                    action={isZh ? '重试' : 'Retry'}
                    onAction={() => void Promise.all([reviewsQuery.refetch(), candidatesQuery.refetch()])}
                />
            ) : (
                <>
                    {selected && (
                        <ReviewComposer
                            key={selected.orderLineId}
                            formRef={composerRef}
                            candidate={selected}
                            language={language}
                            onCancel={() => setSelected(null)}
                            onSubmit={submit}
                        />
                    )}
                    <section className="review-center-section review-center-pending">
                        <header>
                            <div>
                                <strong>{isZh ? '待评价商品' : 'Ready to review'}</strong>
                                <small>
                                    {isZh
                                        ? '选择一件商品，分享你的真实体验'
                                        : 'Choose an item and share your experience'}
                                </small>
                            </div>
                            <span>{candidates.length}</span>
                        </header>
                        {candidates.length ? (
                            <div className="review-candidate-list" id="review-candidate-list">
                                {visibleCandidates.map(candidate => {
                                    const imageUrl = candidateImages.get(candidate.orderLineId);
                                    const variantLabel = reviewVariantLabel(candidate);
                                    return (
                                        <button
                                            type="button"
                                            key={candidate.orderLineId}
                                            className="review-candidate-row"
                                            aria-expanded={selected?.orderLineId === candidate.orderLineId}
                                            aria-controls={
                                                selected?.orderLineId === candidate.orderLineId
                                                    ? 'review-composer'
                                                    : undefined
                                            }
                                            onClick={() => setSelected(candidate)}
                                        >
                                            <span className="review-candidate-image">
                                                {imageUrl ? (
                                                    <SafeImage
                                                        src={imageUrl}
                                                        alt=""
                                                        imageKind="thumbnail"
                                                        loading="lazy"
                                                        decoding="async"
                                                    />
                                                ) : (
                                                    <Package aria-hidden="true" />
                                                )}
                                            </span>
                                            <span className="review-candidate-copy">
                                                <strong>{candidate.productName}</strong>
                                                {variantLabel && <small>{variantLabel}</small>}
                                                <small
                                                    className="review-candidate-order"
                                                    title={candidate.orderCode}
                                                >
                                                    {isZh ? '订单 ' : 'Order '}
                                                    {candidate.orderCode}
                                                </small>
                                            </span>
                                            <span className="review-candidate-action">
                                                {isZh ? '写评价' : 'Review'}
                                                <ChevronRight aria-hidden="true" />
                                            </span>
                                        </button>
                                    );
                                })}
                                {candidates.length > 4 && (
                                    <button
                                        type="button"
                                        className="review-candidate-more"
                                        aria-expanded={showAllCandidates}
                                        aria-controls="review-candidate-list"
                                        onClick={() => setShowAllCandidates(value => !value)}
                                    >
                                        {showAllCandidates
                                            ? isZh
                                                ? '收起列表'
                                                : 'Show fewer'
                                            : isZh
                                              ? `查看其余 ${candidates.length - 4} 件商品`
                                              : `Show ${candidates.length - 4} more items`}
                                        <ChevronDown aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                        ) : (
                            <p className="review-center-hint">
                                {isZh
                                    ? '付款成功的商品均可在此评价，欢迎分享真实体验'
                                    : 'Paid items will appear here for you to share your experience'}
                            </p>
                        )}
                    </section>
                    <section className="review-center-section">
                        <header>
                            <div>
                                <strong>{isZh ? '我的评价' : 'My reviews'}</strong>
                                <small>
                                    {isZh
                                        ? '查看已提交的评价与审核状态'
                                        : 'View submitted reviews and status'}
                                </small>
                            </div>
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
                        ) : candidates.length ? (
                            <p className="review-center-hint">
                                {isZh
                                    ? '还没有提交评价。选择上方商品，写下第一条使用体验。'
                                    : 'No submitted reviews yet. Choose an item above to write your first one.'}
                            </p>
                        ) : (
                            <ReviewEmptyState
                                compact
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
        queryKey: storefrontQueryKeys.productReviews(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            productId,
        ),
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
    formRef,
    candidate,
    language,
    onCancel,
    onSubmit,
}: {
    formRef: React.RefObject<HTMLFormElement | null>;
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
            setError(storefrontErrorMessage(submitError, language));
        } finally {
            setSubmitting(false);
        }
    };
    return (
        <form
            id="review-composer"
            ref={formRef}
            className="review-composer"
            onSubmit={event => void submit(event)}
        >
            <header>
                <span>
                    <strong>{candidate.productName}</strong>
                    {reviewVariantLabel(candidate) && <small>{reviewVariantLabel(candidate)}</small>}
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
    compact = false,
}: {
    icon: React.ReactNode;
    title: string;
    detail: string;
    action: string;
    onAction: () => void;
    compact?: boolean;
}) {
    return (
        <section className={compact ? 'empty-state is-compact' : 'empty-state'}>
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
