import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    DashboardRouteDefinition,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    Skeleton,
    Tabs,
    TabsList,
    TabsTrigger,
    Textarea,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import {
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    MessageSquareText,
    RefreshCw,
    ShieldCheck,
    Star,
    XCircle,
} from 'lucide-react';
import { useState } from 'react';

import {
    ReviewRecord,
    ReviewState,
    ReviewsResult,
    moderateReviewMutation,
    reviewsQuery,
} from './review-moderation.graphql';

type ModerationTarget = Extract<ReviewState, 'APPROVED' | 'REJECTED'>;

interface ModerationDraft {
    review: ReviewRecord;
    state: ModerationTarget;
    response: string;
}

const messages = {
    title: msg({ id: 'operations.reviews.title', message: 'Review management' }),
    description: msg({
        id: 'operations.reviews.description',
        message: 'Prioritize pending verified-purchase reviews. Approve clean reviews in one click.',
    }),
    refresh: msg({ id: 'operations.reviews.refresh', message: 'Refresh' }),
    filter: msg({ id: 'operations.reviews.filter', message: 'Status filter' }),
    all: msg({ id: 'operations.reviews.all', message: 'All statuses' }),
    activeChannel: msg({ id: 'operations.reviews.activeStore', message: 'Active store' }),
    empty: msg({ id: 'operations.reviews.empty', message: 'No reviews match this filter' }),
    loadError: msg({ id: 'operations.reviews.loadError', message: 'Could not load reviews' }),
    retry: msg({ id: 'operations.reviews.retry', message: 'Retry' }),
    verified: msg({ id: 'operations.reviews.verified', message: 'Verified purchase' }),
    approve: msg({ id: 'operations.reviews.approve', message: 'Approve and publish' }),
    replyAndApprove: msg({
        id: 'operations.reviews.replyAndApprove',
        message: 'Reply and publish',
    }),
    reject: msg({ id: 'operations.reviews.reject', message: 'Reject' }),
    response: msg({
        id: 'operations.reviews.response',
        message: 'Store response / moderation note',
    }),
    responseHint: msg({
        id: 'operations.reviews.responseHint',
        message: 'An approval response is optional and public. A rejection reason is required.',
    }),
    cancel: msg({ id: 'operations.reviews.cancel', message: 'Cancel' }),
    confirm: msg({ id: 'operations.reviews.confirm', message: 'Confirm' }),
    processing: msg({ id: 'operations.reviews.processing', message: 'Processing' }),
    rejectionRequired: msg({
        id: 'operations.reviews.rejectionRequired',
        message: 'A rejection reason of at least 3 characters is required',
    }),
    responseTooLong: msg({
        id: 'operations.reviews.responseTooLong',
        message: 'The response cannot exceed 2000 characters',
    }),
    updated: msg({ id: 'operations.reviews.updated', message: 'Review status updated' }),
    page: msg({ id: 'operations.reviews.page', message: 'Page' }),
    previousPage: msg({ id: 'operations.reviews.previousPage', message: 'Previous page' }),
    nextPage: msg({ id: 'operations.reviews.nextPage', message: 'Next page' }),
    statePending: msg({ id: 'operations.reviews.state.pending', message: 'Pending' }),
    stateApproved: msg({ id: 'operations.reviews.state.approved', message: 'Published' }),
    stateRejected: msg({ id: 'operations.reviews.state.rejected', message: 'Rejected' }),
};

type ReviewText = Record<keyof typeof messages, string>;

const states: ReviewState[] = ['PENDING', 'APPROVED', 'REJECTED'];
const PAGE_SIZE = 30;

export const reviewModerationRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'sales',
        id: 'review-moderation',
        url: '/review-moderation',
        title: messages.title.id,
        icon: MessageSquareText,
        requiresPermission: ['UpdateCatalog'],
    },
    path: '/review-moderation',
    loader: () => ({ breadcrumb: () => messages.title.id }),
    component: () => <ReviewModerationPage />,
};

function ReviewModerationPage() {
    const { t } = useLingui();
    const text = translateMessages(t);
    const { activeChannel } = useChannel();
    const [state, setState] = useState<ReviewState | 'ALL'>('PENDING');
    const [skip, setSkip] = useState(0);
    const [draft, setDraft] = useState<ModerationDraft | null>(null);
    const query = useQuery({
        queryKey: ['operations-review-moderation', activeChannel?.id, state, skip],
        queryFn: () =>
            api.query<ReviewsResult>(reviewsQuery, {
                options: { skip, take: PAGE_SIZE, ...(state === 'ALL' ? {} : { state }) },
            }),
        enabled: Boolean(activeChannel?.id),
    });
    const reviews = query.data?.storefrontReviews.items ?? [];
    const totalItems = query.data?.storefrontReviews.totalItems ?? 0;
    const currentPage = Math.floor(skip / PAGE_SIZE) + 1;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const moderation = useMutation({
        mutationFn: (input: ModerationDraft) =>
            api.mutate(moderateReviewMutation, {
                input: {
                    id: input.review.id,
                    state: input.state,
                    response: input.response.trim() || null,
                },
            }),
        onSuccess: async () => {
            toast.success(text.updated);
            setDraft(null);
            await query.refetch();
        },
        onError: error => toast.error(error instanceof Error ? error.message : String(error)),
    });
    const submit = () => {
        if (!draft) return;
        const response = draft.response.trim();
        if (response.length > 2_000) {
            toast.error(text.responseTooLong);
            return;
        }
        if (draft.state === 'REJECTED' && response.length < 3) {
            toast.error(text.rejectionRequired);
            return;
        }
        moderation.mutate(draft);
    };

    return (
        <Page pageId="review-moderation">
            <PageTitle>{text.title}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" onClick={() => void query.refetch()}>
                        <RefreshCw className="size-4" aria-hidden="true" />
                        {text.refresh}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="review-moderation-list"
                    title={text.title}
                    description={text.description}
                >
                    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                        <Tabs
                            value={state}
                            onValueChange={value => {
                                if (value !== 'ALL' && !states.includes(value as ReviewState)) return;
                                setState(value as ReviewState | 'ALL');
                                setSkip(0);
                            }}
                        >
                            <TabsList className="h-auto flex-wrap justify-start">
                                <TabsTrigger value="ALL">{text.all}</TabsTrigger>
                                {states.map(item => (
                                    <TabsTrigger key={item} value={item}>
                                        {stateLabel(item, text)}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{text.activeChannel}</span>
                            <Badge variant="outline">{activeChannel?.code ?? '-'}</Badge>
                            <Badge variant="secondary">{totalItems}</Badge>
                        </div>
                    </div>
                    {query.isPending ? (
                        <div className="space-y-3" aria-busy="true">
                            <Skeleton className="h-40 w-full" />
                            <Skeleton className="h-40 w-full" />
                        </div>
                    ) : query.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription className="flex items-center justify-between gap-3">
                                <span>{text.loadError}</span>
                                <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                                    {text.retry}
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : reviews.length === 0 ? (
                        <div className="py-14 text-center text-sm text-muted-foreground">{text.empty}</div>
                    ) : (
                        <>
                            <div className="divide-y overflow-hidden rounded-lg border bg-card">
                                {reviews.map(review => (
                                    <ReviewCard
                                        key={review.id}
                                        review={review}
                                        text={text}
                                        pending={moderation.isPending}
                                        onApprove={() =>
                                            moderation.mutate({
                                                review,
                                                state: 'APPROVED',
                                                response: '',
                                            })
                                        }
                                        onModerate={target =>
                                            setDraft({
                                                review,
                                                state: target,
                                                response: review.merchantResponse ?? '',
                                            })
                                        }
                                    />
                                ))}
                            </div>
                            <div className="mt-5 flex items-center justify-end gap-2">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    aria-label={text.previousPage}
                                    disabled={skip === 0 || query.isFetching}
                                    onClick={() => setSkip(value => Math.max(0, value - PAGE_SIZE))}
                                >
                                    <ChevronLeft className="size-4" aria-hidden="true" />
                                </Button>
                                <span className="min-w-24 text-center text-sm text-muted-foreground">
                                    {text.page} {currentPage} / {totalPages}
                                </span>
                                <Button
                                    variant="outline"
                                    size="icon"
                                    aria-label={text.nextPage}
                                    disabled={skip + PAGE_SIZE >= totalItems || query.isFetching}
                                    onClick={() => setSkip(value => value + PAGE_SIZE)}
                                >
                                    <ChevronRight className="size-4" aria-hidden="true" />
                                </Button>
                            </div>
                        </>
                    )}
                </PageBlock>
            </PageLayout>
            <ModerationDialog
                draft={draft}
                text={text}
                pending={moderation.isPending}
                onChange={setDraft}
                onClose={() => !moderation.isPending && setDraft(null)}
                onSubmit={submit}
            />
        </Page>
    );
}

function ReviewCard({
    review,
    text,
    pending,
    onApprove,
    onModerate,
}: {
    review: ReviewRecord;
    text: ReviewText;
    pending: boolean;
    onApprove: () => void;
    onModerate: (target: ModerationTarget) => void;
}) {
    return (
        <article className="grid gap-4 p-4 transition-colors hover:bg-muted/30 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] lg:items-center">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <strong className="truncate">{review.productName}</strong>
                    <Badge variant={badgeVariant(review.state)}>{stateLabel(review.state, text)}</Badge>
                    <Badge variant="outline">{review.sku}</Badge>
                </div>
                <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{review.customerName}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={review.createdAt}>{formatDate(review.createdAt)}</time>
                </p>
                <div className="mt-2 flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1 text-amber-600">
                        <Star className="size-4 fill-current" aria-hidden="true" />
                        <strong>{review.rating}/5</strong>
                    </span>
                    <span className="flex items-center gap-1 text-emerald-700">
                        <ShieldCheck className="size-4" aria-hidden="true" />
                        {text.verified}
                    </span>
                </div>
            </div>
            <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">{review.title}</h3>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {review.body}
                </p>
                {review.merchantResponse && (
                    <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
                        <strong>{text.response}：</strong>
                        {review.merchantResponse}
                    </p>
                )}
            </div>
            {review.state === 'PENDING' ? (
                <div className="flex flex-wrap justify-end gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => onModerate('REJECTED')}
                    >
                        <XCircle className="size-4" aria-hidden="true" />
                        {text.reject}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() => onModerate('APPROVED')}
                    >
                        <MessageSquareText className="size-4" aria-hidden="true" />
                        {text.replyAndApprove}
                    </Button>
                    <Button size="sm" disabled={pending} onClick={onApprove}>
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        {text.approve}
                    </Button>
                </div>
            ) : (
                <span className="text-right text-sm text-muted-foreground">
                    {review.moderatedAt ? formatDate(review.moderatedAt) : '-'}
                </span>
            )}
        </article>
    );
}

function ModerationDialog({
    draft,
    text,
    pending,
    onChange,
    onClose,
    onSubmit,
}: {
    draft: ModerationDraft | null;
    text: ReviewText;
    pending: boolean;
    onChange: (draft: ModerationDraft | null) => void;
    onClose: () => void;
    onSubmit: () => void;
}) {
    if (!draft) return null;
    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{draft.state === 'APPROVED' ? text.approve : text.reject}</DialogTitle>
                    <DialogDescription>
                        {draft.review.productName} · {draft.review.customerName}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-1.5 py-2">
                    <Label htmlFor="review-moderation-response">{text.response}</Label>
                    <Textarea
                        id="review-moderation-response"
                        rows={6}
                        maxLength={2000}
                        value={draft.response}
                        disabled={pending}
                        onChange={event => onChange({ ...draft, response: event.target.value })}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{text.responseHint}</span>
                        <span>{draft.response.length}/2000</span>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={pending} onClick={onClose}>
                        {text.cancel}
                    </Button>
                    <Button disabled={pending} onClick={onSubmit}>
                        {pending ? text.processing : text.confirm}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function translateMessages(t: ReturnType<typeof useLingui>['t']): ReviewText {
    return Object.fromEntries(
        Object.entries(messages).map(([key, descriptor]) => [key, t(descriptor)]),
    ) as ReviewText;
}

function stateLabel(state: ReviewState, text: ReviewText): string {
    const labels: Record<ReviewState, string> = {
        PENDING: text.statePending,
        APPROVED: text.stateApproved,
        REJECTED: text.stateRejected,
    };
    return labels[state];
}

function badgeVariant(state: ReviewState): 'default' | 'secondary' | 'destructive' {
    if (state === 'PENDING') return 'default';
    if (state === 'APPROVED') return 'secondary';
    return 'destructive';
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
    );
}
