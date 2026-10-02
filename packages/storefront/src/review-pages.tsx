import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    ImagePlus,
    MessageSquare,
    Package,
    RefreshCw,
    Star,
    X,
} from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';

import { ShopApi } from './api';
import { useDesktopLayout } from './desktop-layout';
import { languageCodeFor } from './i18n';
import { offlineLoadError } from './loading-state';
import {
    PUBLIC_QUERY_GC_TIME,
    publicQueryMeta,
    ROUTE_QUERY_STALE_TIME,
    storefrontQueryKeys,
} from './query-client';
import { storefrontErrorMessage } from './storefront-errors';
import { EmptyState, Sheet, SubHeader } from './storefront-ui/page-shell';
import { formatMoney, SafeImage } from './storefront-ui/product-display';
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

const REVIEW_PAGE_SIZE = 20;
type ReviewDraft = Pick<SubmitStorefrontReviewInput, 'rating' | 'title' | 'body' | 'anonymous' | 'images'>;

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
    const desktop = useDesktopLayout();
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
    const candidatesQuery = useInfiniteQuery({
        queryKey: storefrontQueryKeys.reviewCandidates(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            customer?.id ?? '',
        ),
        queryFn: ({ pageParam, signal }) =>
            api.reviewCandidates({ skip: pageParam, take: REVIEW_PAGE_SIZE }, signal),
        initialPageParam: 0,
        getNextPageParam: (lastPage, pages) =>
            lastPage.length === REVIEW_PAGE_SIZE
                ? pages.reduce((total, page) => total + page.length, 0)
                : undefined,
        enabled: Boolean(customer),
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const reviews = reviewsQuery.data ?? [];
    const candidates = candidatesQuery.data?.pages.flat() ?? [];
    const [selected, setSelected] = useState<StorefrontReviewCandidate | null>(null);
    const [activeList, setActiveList] = useState<'pending' | 'submitted'>('pending');
    const [showAllCandidates, setShowAllCandidates] = useState(false);
    // Drafts live only in this mounted page; they never enter storage or another customer/store scope.
    const drafts = useRef(new Map<string, ReviewDraft>());
    const draftScope = `${storefrontQueryKeys.market(market)}:${customer?.id ?? ''}`;
    const visibleCandidates = showAllCandidates ? candidates : candidates.slice(0, 4);
    useEffect(() => {
        drafts.current.clear();
        setSelected(null);
    }, [draftScope]);
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
        drafts.current.delete(input.orderLineId);
        setSelected(null);
        setActiveList('submitted');
        onNotify(isZh ? '评价已提交，审核通过后将公开展示' : 'Review submitted for moderation');
    };

    return (
        <main className="page subpage review-center-page">
            <SubHeader title={isZh ? '评价中心' : 'Reviews'} language={language} onBack={onBack} />
            {!customer ? (
                <EmptyState
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
                <EmptyState
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
                    {desktop && (
                        <div className="desktop-account-workbench-toolbar review-center-toolbar">
                            <h1>{isZh ? '评价中心' : 'Reviews'}</h1>
                            <div role="tablist" aria-label={isZh ? '评价列表' : 'Review lists'}>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={activeList === 'pending'}
                                    aria-controls="review-pending-panel"
                                    onClick={() => setActiveList('pending')}
                                >
                                    {isZh
                                        ? `待评价 ${candidates.length}${candidatesQuery.hasNextPage ? '+' : ''}`
                                        : `To review ${candidates.length}${candidatesQuery.hasNextPage ? '+' : ''}`}
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={activeList === 'submitted'}
                                    aria-controls="review-submitted-panel"
                                    onClick={() => setActiveList('submitted')}
                                >
                                    {isZh ? `本次提交 ${reviews.length}` : `Submitted ${reviews.length}`}
                                </button>
                            </div>
                        </div>
                    )}
                    {selected && (
                        <ReviewComposer
                            key={selected.orderLineId}
                            draft={drafts.current.get(selected.orderLineId)}
                            onDraftChange={draft => drafts.current.set(selected.orderLineId, draft)}
                            candidate={selected}
                            language={language}
                            locale={market.locale}
                            onCancel={() => setSelected(null)}
                            onSubmit={submit}
                        />
                    )}
                    <section
                        id="review-pending-panel"
                        role={desktop ? 'tabpanel' : undefined}
                        hidden={desktop && activeList !== 'pending'}
                        className="review-center-section review-center-pending"
                    >
                        <header>
                            <div>
                                <strong>
                                    {isZh ? '待评价商品' : 'Ready to review'}
                                    <span className="review-section-count">
                                        {' '}
                                        · {candidates.length}
                                        {candidatesQuery.hasNextPage ? '+' : ''}
                                    </span>
                                </strong>
                                <small>
                                    {isZh
                                        ? '选择一件商品，分享你的真实体验'
                                        : 'Choose an item and share your experience'}
                                </small>
                            </div>
                        </header>
                        {candidates.length ? (
                            <div className="review-candidate-list" id="review-candidate-list">
                                {visibleCandidates.map(candidate => {
                                    const imageUrl = candidate.imageUrl;
                                    const variantLabel = reviewVariantLabel(candidate);
                                    return (
                                        <article key={candidate.orderLineId} className="review-candidate-row">
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
                                                <small>
                                                    {isZh ? '含税单价 ' : 'Unit price incl. tax '}
                                                    {formatMoney(
                                                        candidate.unitPriceWithTax,
                                                        candidate.currencyCode,
                                                        market.locale,
                                                    )}
                                                </small>
                                                <small
                                                    className="review-candidate-order"
                                                    title={`${candidate.orderCode} · ${candidate.orderLineId}`}
                                                >
                                                    {isZh ? '订单行 ' : 'Line '}
                                                    {candidate.orderLineId}
                                                    {' · '}
                                                    {isZh ? '订单 ' : 'Order '}
                                                    {candidate.orderCode}
                                                </small>
                                            </span>
                                            <button
                                                type="button"
                                                className="review-candidate-action"
                                                aria-haspopup="dialog"
                                                aria-expanded={
                                                    selected?.orderLineId === candidate.orderLineId
                                                }
                                                aria-label={`${isZh ? '写评价' : 'Review'}: ${candidate.productName}`}
                                                onClick={() => setSelected(candidate)}
                                            >
                                                {isZh ? '写评价' : 'Review'}
                                                <ChevronRight aria-hidden="true" />
                                            </button>
                                        </article>
                                    );
                                })}
                                {(candidates.length > 4 || candidatesQuery.hasNextPage) && (
                                    <button
                                        type="button"
                                        className="review-candidate-more"
                                        aria-expanded={showAllCandidates}
                                        aria-controls="review-candidate-list"
                                        disabled={candidatesQuery.isFetchingNextPage}
                                        onClick={() => {
                                            if (!showAllCandidates) setShowAllCandidates(true);
                                            else if (candidatesQuery.hasNextPage)
                                                void candidatesQuery.fetchNextPage();
                                            else setShowAllCandidates(false);
                                        }}
                                    >
                                        {showAllCandidates
                                            ? candidatesQuery.isFetchingNextPage
                                                ? isZh
                                                    ? '加载中…'
                                                    : 'Loading…'
                                                : candidatesQuery.hasNextPage
                                                  ? isZh
                                                      ? '加载更多商品'
                                                      : 'Load more items'
                                                  : isZh
                                                    ? '收起列表'
                                                    : 'Show fewer'
                                            : isZh
                                              ? '查看其余商品'
                                              : 'Show more items'}
                                        {!showAllCandidates || !candidatesQuery.hasNextPage ? (
                                            <ChevronDown aria-hidden="true" />
                                        ) : null}
                                    </button>
                                )}
                                {candidatesQuery.isFetchNextPageError && (
                                    <p className="review-center-hint" role="alert">
                                        {isZh
                                            ? '加载更多商品失败，请重试'
                                            : 'Could not load more items. Try again.'}
                                    </p>
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
                    <section
                        id="review-submitted-panel"
                        role={desktop ? 'tabpanel' : undefined}
                        hidden={desktop && activeList !== 'submitted'}
                        className="review-center-section"
                    >
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
                                        {review.images?.length > 0 && (
                                            <ReviewImageGallery images={review.images} language={language} />
                                        )}
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
                            <EmptyState
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
    const query = useInfiniteQuery({
        queryKey: storefrontQueryKeys.productReviews(
            storefrontQueryKeys.market(market),
            languageCodeFor(language),
            productId,
        ),
        queryFn: ({ pageParam, signal }) =>
            api.productReviews(productId, { skip: pageParam, take: REVIEW_PAGE_SIZE }, signal),
        initialPageParam: 0,
        getNextPageParam: (lastPage, pages) => {
            if (lastPage.items.length === 0) return undefined;
            const loaded = pages.reduce((total, page) => total + page.items.length, 0);
            return loaded < lastPage.totalItems ? loaded : undefined;
        },
        staleTime: ROUTE_QUERY_STALE_TIME,
        gcTime: PUBLIC_QUERY_GC_TIME,
        meta: publicQueryMeta(),
    });
    const reviews = query.data?.pages.flatMap(page => page.items) ?? [];
    const totalItems = query.data?.pages[0]?.totalItems ?? 0;
    const average = query.data?.pages[0]?.averageRating ?? 0;
    return (
        <section className="detail-block detail-review-block">
            <header>
                <strong>{isZh ? '用户评价' : 'Reviews'}</strong>
                <span>
                    {reviews.length
                        ? `${average.toFixed(1)} · ${totalItems}`
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
            ) : (query.isPaused && query.data === undefined) ||
              (query.isError && query.data === undefined) ? (
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
                            <div className="product-review-main">
                                <div className="product-review-copy">
                                    <ReviewStars rating={review.rating} />
                                    <strong>{review.title}</strong>
                                    <p>{review.body}</p>
                                    {review.orderLineId && (
                                        <em>
                                            <CheckCircle2 aria-hidden="true" />
                                            {isZh ? '已关联订单' : 'Linked to order'}
                                        </em>
                                    )}
                                </div>
                                {review.images?.length > 0 && (
                                    <ReviewImageGallery images={review.images} language={language} />
                                )}
                            </div>
                            {review.merchantResponse && (
                                <blockquote>
                                    <strong>{isZh ? '商家回复' : 'Store response'}</strong>
                                    {review.merchantResponse}
                                </blockquote>
                            )}
                        </article>
                    ))}
                    {query.hasNextPage && (
                        <button
                            className="product-review-retry"
                            type="button"
                            disabled={query.isFetchingNextPage}
                            onClick={() => void query.fetchNextPage()}
                        >
                            {query.isFetchingNextPage
                                ? isZh
                                    ? '加载中…'
                                    : 'Loading…'
                                : isZh
                                  ? '查看更多评价'
                                  : 'Load more reviews'}
                        </button>
                    )}
                    {query.isFetchNextPageError && (
                        <p className="review-center-hint" role="alert">
                            {isZh ? '加载更多评价失败，请重试' : 'Could not load more reviews. Try again.'}
                        </p>
                    )}
                </div>
            ) : (
                <div className="detail-empty-review">
                    <MessageSquare aria-hidden="true" />
                    <span>
                        <strong>
                            {isZh ? '等待第一条审核通过的评价' : 'Waiting for the first approved review'}
                        </strong>
                        <small>{isZh ? '评价将在审核通过后显示' : 'Approved reviews appear here'}</small>
                    </span>
                </div>
            )}
        </section>
    );
}

function ReviewImageGallery({
    images,
    language,
}: {
    images: StorefrontReview['images'];
    language: StorefrontLanguage;
}) {
    const isZh = language === 'zh';
    return (
        <div className="product-review-images" aria-label={isZh ? '评价图片' : 'Review images'}>
            {images.map((image, index) => (
                <a
                    key={image.id}
                    href={image.preview}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={isZh ? `查看评价图片 ${index + 1}` : `View review image ${index + 1}`}
                >
                    <SafeImage
                        src={image.preview}
                        alt={isZh ? `评价图片 ${index + 1}` : `Review image ${index + 1}`}
                        loading="lazy"
                    />
                </a>
            ))}
        </div>
    );
}

function ReviewComposer({
    draft,
    onDraftChange,
    candidate,
    language,
    locale,
    onCancel,
    onSubmit,
}: {
    draft?: ReviewDraft;
    onDraftChange: (draft: ReviewDraft) => void;
    candidate: StorefrontReviewCandidate;
    language: StorefrontLanguage;
    locale: string;
    onCancel: () => void;
    onSubmit: (input: SubmitStorefrontReviewInput) => Promise<void>;
}) {
    const isZh = language === 'zh';
    const [rating, setRating] = useState(draft?.rating ?? 0);
    const [title, setTitle] = useState(draft?.title ?? '');
    const [body, setBody] = useState(draft?.body ?? '');
    const [anonymous, setAnonymous] = useState(draft?.anonymous ?? false);
    const [images, setImages] = useState<File[]>(draft?.images ?? []);
    const [imagePreviews, setImagePreviews] = useState<string[]>([]);
    const [error, setError] = useState('');
    const errorRef = useRef<HTMLElement>(null);
    useEffect(() => {
        if (error) errorRef.current?.focus();
    }, [error]);
    const [submitting, setSubmitting] = useState(false);
    useEffect(() => {
        onDraftChange({ rating, title, body, anonymous, images });
    }, [rating, title, body, anonymous, images, onDraftChange]);
    useEffect(() => {
        const urls = images.map(file => URL.createObjectURL(file));
        setImagePreviews(urls);
        return () => urls.forEach(url => URL.revokeObjectURL(url));
    }, [images]);
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (rating < 1 || rating > 5) {
            setError(isZh ? '请先选择商品评分' : 'Choose a rating before submitting');
            return;
        }
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
                anonymous,
                images,
            });
        } catch (submitError) {
            setError(storefrontErrorMessage(submitError, language));
        } finally {
            setSubmitting(false);
        }
    };
    return (
        <Sheet
            title={isZh ? '写评价' : 'Write a review'}
            language={language}
            side="right"
            className="review-composer-sheet"
            onClose={() => {
                if (!submitting) onCancel();
            }}
        >
            <form
                id="review-composer"
                aria-busy={submitting}
                className="review-composer"
                onSubmit={event => void submit(event)}
            >
                <div className="review-composer-body">
                    <header className="review-composer-summary">
                        <span className="review-candidate-image">
                            {candidate.imageUrl ? (
                                <SafeImage src={candidate.imageUrl} alt="" imageKind="thumbnail" />
                            ) : (
                                <Package aria-hidden="true" />
                            )}
                        </span>
                        <span>
                            <strong>{candidate.productName}</strong>
                            {reviewVariantLabel(candidate) && <small>{reviewVariantLabel(candidate)}</small>}
                            <small>
                                {formatMoney(candidate.unitPriceWithTax, candidate.currencyCode, locale)}
                                {' · '}
                                {isZh ? '订单行 ' : 'Line '}
                                {candidate.orderLineId}
                            </small>
                        </span>
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
                                    disabled={submitting}
                                    aria-label={isZh ? `${value} 星` : `${value} stars`}
                                    aria-pressed={value === rating}
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
                    <div className="review-image-picker">
                        <span>{isZh ? '评价图片（最多 4 张）' : 'Review images (up to 4)'}</span>
                        <div className="review-image-previews">
                            {imagePreviews.map((url, index) => (
                                <div className="review-image-preview" key={url}>
                                    <img
                                        src={url}
                                        alt={
                                            isZh ? `待上传图片 ${index + 1}` : `Image to upload ${index + 1}`
                                        }
                                    />
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setImages(current =>
                                                current.filter((_, position) => position !== index),
                                            )
                                        }
                                        disabled={submitting}
                                        aria-label={
                                            isZh ? `移除图片 ${index + 1}` : `Remove image ${index + 1}`
                                        }
                                    >
                                        <X aria-hidden="true" />
                                    </button>
                                </div>
                            ))}
                            {images.length < 4 && (
                                <label className="review-image-add">
                                    <ImagePlus aria-hidden="true" />
                                    <span>{isZh ? '添加图片' : 'Add images'}</span>
                                    <input
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        multiple
                                        disabled={submitting}
                                        onChange={event => {
                                            const selected = Array.from(event.target.files ?? []);
                                            event.target.value = '';
                                            if (images.length + selected.length > 4) {
                                                setError(
                                                    isZh
                                                        ? '每条评价最多上传 4 张图片'
                                                        : 'Up to 4 images per review',
                                                );
                                                return;
                                            }
                                            if (
                                                selected.some(
                                                    file =>
                                                        file.size > 5 * 1024 * 1024 ||
                                                        !['image/jpeg', 'image/png', 'image/webp'].includes(
                                                            file.type,
                                                        ),
                                                )
                                            ) {
                                                setError(
                                                    isZh
                                                        ? '仅支持 5MB 以内的 JPG、PNG 或 WebP 图片'
                                                        : 'Use JPG, PNG or WebP images under 5 MB',
                                                );
                                                return;
                                            }
                                            setError('');
                                            setImages(current => [...current, ...selected]);
                                        }}
                                    />
                                </label>
                            )}
                        </div>
                    </div>
                    <label className="review-anonymous-option">
                        <input
                            type="checkbox"
                            checked={anonymous}
                            onChange={event => setAnonymous(event.target.checked)}
                            disabled={submitting}
                        />
                        <span>
                            {isZh
                                ? '匿名展示（商家仍可核对订单归属）'
                                : 'Display anonymously (the store can still verify your order)'}
                        </span>
                    </label>
                    {error && (
                        <small className="form-error" role="alert" ref={errorRef} tabIndex={-1}>
                            {error}
                        </small>
                    )}
                </div>
                <footer className="review-composer-footer">
                    <button className="review-cancel" type="button" onClick={onCancel} disabled={submitting}>
                        {isZh ? '取消' : 'Cancel'}
                    </button>
                    <button className="review-submit" type="submit" disabled={submitting}>
                        {submitting ? (isZh ? '提交中' : 'Submitting') : isZh ? '提交评价' : 'Submit review'}
                    </button>
                </footer>
            </form>
        </Sheet>
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

function formatReviewDate(value: string, language: StorefrontLanguage): string {
    return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(new Date(value));
}
