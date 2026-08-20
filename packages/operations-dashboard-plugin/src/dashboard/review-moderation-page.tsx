import { useLingui } from '@lingui/react';
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
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

const zhCopy = {
    title: '评价审核',
    description: '审核当前店铺的已购商品评价。只有通过后才会在商品页公开展示。',
    refresh: '刷新',
    filter: '状态筛选',
    all: '全部状态',
    activeChannel: '当前店铺',
    empty: '当前筛选条件下没有评价',
    loadError: '评价加载失败',
    retry: '重试',
    verified: '已验证购买',
    approve: '通过并发布',
    reject: '驳回',
    response: '商家回复 / 处理说明',
    responseHint: '通过时可选填写公开回复；驳回时必须填写原因。',
    cancel: '取消',
    confirm: '确认处理',
    processing: '正在处理',
    rejectionRequired: '驳回原因至少需要 3 个字符',
    responseTooLong: '回复不能超过 2000 个字符',
    updated: '评价状态已更新',
    page: '页',
};

const enCopy: typeof zhCopy = {
    title: 'Review moderation',
    description:
        'Moderate verified-purchase reviews for the active store. Only approved reviews appear publicly.',
    refresh: 'Refresh',
    filter: 'Status filter',
    all: 'All statuses',
    activeChannel: 'Active store',
    empty: 'No reviews match this filter',
    loadError: 'Could not load reviews',
    retry: 'Retry',
    verified: 'Verified purchase',
    approve: 'Approve and publish',
    reject: 'Reject',
    response: 'Store response / moderation note',
    responseHint: 'An approval response is optional and public. A rejection reason is required.',
    cancel: 'Cancel',
    confirm: 'Confirm',
    processing: 'Processing',
    rejectionRequired: 'A rejection reason of at least 3 characters is required',
    responseTooLong: 'The response cannot exceed 2000 characters',
    updated: 'Review status updated',
    page: 'Page',
};

const states: ReviewState[] = ['PENDING', 'APPROVED', 'REJECTED'];
const PAGE_SIZE = 30;

export const reviewModerationRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'sales',
        id: 'review-moderation',
        url: '/review-moderation',
        title: '评价审核',
        icon: MessageSquareText,
        requiresPermission: ['UpdateCatalog'],
    },
    path: '/review-moderation',
    loader: () => ({ breadcrumb: () => '评价审核' }),
    component: () => <ReviewModerationPage />,
};

function ReviewModerationPage() {
    const { i18n } = useLingui();
    const isZh = i18n.locale.toLowerCase().startsWith('zh');
    const text = isZh ? zhCopy : enCopy;
    const { activeChannel } = useChannel();
    const [state, setState] = useState<ReviewState | 'ALL'>('PENDING');
    const [skip, setSkip] = useState(0);
    const [draft, setDraft] = useState<ModerationDraft | null>(null);
    const query = useQuery({
        queryKey: ['operations-review-moderation', activeChannel?.id, state, skip],
        queryFn: () =>
            api.query(reviewsQuery, {
                options: { skip, take: PAGE_SIZE, ...(state === 'ALL' ? {} : { state }) },
            }) as Promise<ReviewsResult>,
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
                        <div className="space-y-1.5">
                            <Label>{text.filter}</Label>
                            <Select
                                value={state}
                                onValueChange={value => {
                                    if (!value) return;
                                    setState(value as ReviewState | 'ALL');
                                    setSkip(0);
                                }}
                            >
                                <SelectTrigger className="w-52">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ALL">{text.all}</SelectItem>
                                    {states.map(item => (
                                        <SelectItem key={item} value={item}>
                                            {stateLabel(item, isZh)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
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
                            <div className="space-y-4">
                                {reviews.map(review => (
                                    <ReviewCard
                                        key={review.id}
                                        review={review}
                                        isZh={isZh}
                                        text={text}
                                        pending={moderation.isPending}
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
                                    aria-label={isZh ? '上一页' : 'Previous page'}
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
                                    aria-label={isZh ? '下一页' : 'Next page'}
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
                isZh={isZh}
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
    isZh,
    text,
    pending,
    onModerate,
}: {
    review: ReviewRecord;
    isZh: boolean;
    text: typeof zhCopy;
    pending: boolean;
    onModerate: (target: ModerationTarget) => void;
}) {
    return (
        <article className="rounded-lg border bg-card p-4 shadow-sm">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <strong>{review.productName}</strong>
                        <Badge variant={badgeVariant(review.state)}>{stateLabel(review.state, isZh)}</Badge>
                        <Badge variant="outline">{review.sku}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {review.customerName} · {formatDate(review.createdAt)}
                    </p>
                </div>
                <span className="flex items-center gap-1 text-sm text-amber-600">
                    <Star className="size-4 fill-current" aria-hidden="true" />
                    <strong>{review.rating}/5</strong>
                </span>
            </header>
            <div className="py-4">
                <div className="flex items-center gap-2 text-xs text-emerald-700">
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    {text.verified}
                </div>
                <h3 className="mt-3 text-base font-semibold">{review.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {review.body}
                </p>
                {review.merchantResponse && (
                    <div className="mt-3 rounded-md bg-muted/50 p-3 text-sm">
                        <strong className="block text-xs">{text.response}</strong>
                        <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                            {review.merchantResponse}
                        </p>
                    </div>
                )}
            </div>
            {review.state === 'PENDING' && (
                <footer className="flex flex-wrap justify-end gap-2 border-t pt-3">
                    <Button variant="outline" disabled={pending} onClick={() => onModerate('REJECTED')}>
                        <XCircle className="size-4" aria-hidden="true" />
                        {text.reject}
                    </Button>
                    <Button disabled={pending} onClick={() => onModerate('APPROVED')}>
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        {text.approve}
                    </Button>
                </footer>
            )}
        </article>
    );
}

function ModerationDialog({
    draft,
    isZh,
    text,
    pending,
    onChange,
    onClose,
    onSubmit,
}: {
    draft: ModerationDraft | null;
    isZh: boolean;
    text: typeof zhCopy;
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

function stateLabel(state: ReviewState, isZh: boolean): string {
    const labels: Record<ReviewState, [string, string]> = {
        PENDING: ['待审核', 'Pending'],
        APPROVED: ['已发布', 'Published'],
        REJECTED: ['已驳回', 'Rejected'],
    };
    return labels[state][isZh ? 0 : 1];
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
