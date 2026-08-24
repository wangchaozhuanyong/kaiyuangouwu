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
    Input,
    Label,
    Link,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
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
import { CheckCircle2, ChevronLeft, ChevronRight, Eye, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { useState } from 'react';

import {
    AfterSalesRequestRecord,
    AfterSalesRequestsResult,
    AfterSalesState,
    afterSalesRequestsQuery,
    transitionAfterSalesRequestMutation,
} from './after-sales.graphql';

type TransitionTarget = Extract<AfterSalesState, 'APPROVED' | 'REJECTED' | 'COMPLETED'>;
type AfterSalesView = Extract<AfterSalesState, 'PENDING' | 'APPROVED' | 'COMPLETED'> | 'CLOSED';

interface TransitionDraft {
    request: AfterSalesRequestRecord;
    state: TransitionTarget;
    resolution: string;
    approvedAmount: string;
}

const messages = {
    title: msg({ id: 'operations.afterSales.title', message: 'After-sales management' }),
    description: msg({
        id: 'operations.afterSales.description',
        message:
            'Prioritize requests awaiting a decision. Approval and a completed payment refund are shown separately.',
    }),
    refresh: msg({ id: 'operations.afterSales.refresh', message: 'Refresh' }),
    filter: msg({ id: 'operations.afterSales.filter', message: 'Status filter' }),
    all: msg({ id: 'operations.afterSales.all', message: 'All statuses' }),
    loadError: msg({
        id: 'operations.afterSales.loadError',
        message: 'Could not load after-sales requests',
    }),
    retry: msg({ id: 'operations.afterSales.retry', message: 'Retry' }),
    viewDetails: msg({ id: 'operations.afterSales.viewDetails', message: 'View details' }),
    openOrder: msg({ id: 'operations.afterSales.openOrder', message: 'Open order for refund' }),
    closed: msg({ id: 'operations.afterSales.closed', message: 'Closed' }),
    page: msg({ id: 'operations.afterSales.page', message: 'Page' }),
    previousPage: msg({ id: 'operations.afterSales.previousPage', message: 'Previous page' }),
    nextPage: msg({ id: 'operations.afterSales.nextPage', message: 'Next page' }),
    empty: msg({
        id: 'operations.afterSales.empty',
        message: 'No after-sales requests match this filter',
    }),
    order: msg({ id: 'operations.afterSales.order', message: 'Order' }),
    customer: msg({ id: 'operations.afterSales.customer', message: 'Customer' }),
    requested: msg({ id: 'operations.afterSales.requested', message: 'Requested' }),
    approved: msg({ id: 'operations.afterSales.approved', message: 'Approved' }),
    submittedAt: msg({ id: 'operations.afterSales.submittedAt', message: 'Submitted' }),
    items: msg({ id: 'operations.afterSales.items', message: 'Items' }),
    descriptionLabel: msg({
        id: 'operations.afterSales.customerDescription',
        message: 'Customer description',
    }),
    timeline: msg({ id: 'operations.afterSales.timeline', message: 'Timeline' }),
    approve: msg({ id: 'operations.afterSales.approve', message: 'Approve' }),
    reject: msg({ id: 'operations.afterSales.reject', message: 'Reject' }),
    complete: msg({ id: 'operations.afterSales.complete', message: 'Mark completed' }),
    completeAfterRefund: msg({
        id: 'operations.afterSales.completeAfterRefund',
        message: 'Refund completed, mark complete',
    }),
    cancel: msg({ id: 'operations.afterSales.cancel', message: 'Cancel' }),
    save: msg({ id: 'operations.afterSales.confirm', message: 'Confirm' }),
    saving: msg({ id: 'operations.afterSales.processing', message: 'Processing' }),
    resolution: msg({ id: 'operations.afterSales.resolution', message: 'Resolution note' }),
    resolutionHint: msg({
        id: 'operations.afterSales.resolutionHint',
        message: 'The customer can see this note in the request timeline.',
    }),
    amount: msg({ id: 'operations.afterSales.approvedAmount', message: 'Approved amount' }),
    amountHint: msg({
        id: 'operations.afterSales.approvedAmountHint',
        message:
            'Enter the active currency amount, not above the request total. This is an approval record only.',
    }),
    invalidResolution: msg({
        id: 'operations.afterSales.invalidResolution',
        message: 'The resolution note is required and cannot exceed 2000 characters',
    }),
    invalidAmount: msg({
        id: 'operations.afterSales.invalidAmount',
        message: 'The approved amount must be between zero and the requested amount',
    }),
    refundReminder: msg({
        id: 'operations.afterSales.refundReminder',
        message:
            'Process the payment refund in the order first. After confirming the refund result, return here and mark this request completed.',
    }),
    updated: msg({ id: 'operations.afterSales.updated', message: 'After-sales status updated' }),
    activeChannel: msg({ id: 'operations.afterSales.activeStore', message: 'Active store' }),
    statePending: msg({ id: 'operations.afterSales.state.pending', message: 'Pending' }),
    stateApproved: msg({ id: 'operations.afterSales.state.approved', message: 'Approved' }),
    stateRejected: msg({ id: 'operations.afterSales.state.rejected', message: 'Rejected' }),
    stateCancelled: msg({ id: 'operations.afterSales.state.cancelled', message: 'Cancelled' }),
    stateCompleted: msg({ id: 'operations.afterSales.state.completed', message: 'Completed' }),
    typeReturnAndRefund: msg({
        id: 'operations.afterSales.type.returnAndRefund',
        message: 'Return and refund',
    }),
    typeRefundOnly: msg({ id: 'operations.afterSales.type.refundOnly', message: 'Refund only' }),
    transitionApprove: msg({
        id: 'operations.afterSales.transition.approve',
        message: 'Approve request',
    }),
    transitionReject: msg({
        id: 'operations.afterSales.transition.reject',
        message: 'Reject request',
    }),
    transitionComplete: msg({
        id: 'operations.afterSales.transition.complete',
        message: 'Complete request',
    }),
};

type AfterSalesText = Record<keyof typeof messages, string>;

const views: AfterSalesView[] = ['PENDING', 'APPROVED', 'COMPLETED', 'CLOSED'];
const PAGE_SIZE = 20;

export const afterSalesRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'sales',
        id: 'after-sales',
        url: '/after-sales',
        title: messages.title.id,
        icon: RotateCcw,
        requiresPermission: ['UpdateOrder'],
    },
    path: '/after-sales',
    loader: () => ({ breadcrumb: () => messages.title.id }),
    component: () => <AfterSalesPage />,
};

function AfterSalesPage() {
    const { t } = useLingui();
    const text = translateMessages(t);
    const { activeChannel } = useChannel();
    const [view, setView] = useState<AfterSalesView>('PENDING');
    const [skip, setSkip] = useState(0);
    const [selected, setSelected] = useState<AfterSalesRequestRecord | null>(null);
    const [draft, setDraft] = useState<TransitionDraft | null>(null);
    const query = useQuery({
        queryKey: ['operations-after-sales', activeChannel?.id, view, skip],
        queryFn: () =>
            api.query<AfterSalesRequestsResult>(afterSalesRequestsQuery, {
                options: {
                    skip,
                    take: PAGE_SIZE,
                    ...(view === 'CLOSED' ? { states: ['REJECTED', 'CANCELLED'] } : { state: view }),
                },
            }),
        enabled: Boolean(activeChannel?.id),
    });
    const requests = query.data?.afterSalesRequests.items ?? [];
    const totalItems = query.data?.afterSalesRequests.totalItems ?? 0;
    const currentPage = Math.floor(skip / PAGE_SIZE) + 1;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const transition = useMutation({
        mutationFn: (input: TransitionDraft) => {
            const approvedAmount =
                input.state === 'APPROVED' ? Math.round(Number(input.approvedAmount) * 100) : undefined;
            return api.mutate(transitionAfterSalesRequestMutation, {
                input: {
                    id: input.request.id,
                    state: input.state,
                    resolution: input.resolution.trim(),
                    ...(approvedAmount == null ? {} : { approvedAmount }),
                },
            });
        },
        onSuccess: async () => {
            toast.success(text.updated);
            setDraft(null);
            setSelected(null);
            await query.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const openTransition = (request: AfterSalesRequestRecord, target: TransitionTarget) => {
        setDraft({
            request,
            state: target,
            resolution: request.resolution ?? '',
            approvedAmount: formatMajorAmount(request.approvedAmount ?? request.requestedAmount),
        });
    };
    const submit = () => {
        if (!draft) return;
        if (!draft.resolution.trim() || draft.resolution.trim().length > 2_000) {
            toast.error(text.invalidResolution);
            return;
        }
        if (draft.state === 'APPROVED') {
            const amount = Math.round(Number(draft.approvedAmount) * 100);
            if (!Number.isFinite(amount) || amount < 0 || amount > draft.request.requestedAmount) {
                toast.error(text.invalidAmount);
                return;
            }
        }
        transition.mutate(draft);
    };

    return (
        <Page pageId="after-sales">
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
                    blockId="after-sales-list"
                    title={text.title}
                    description={text.description}
                >
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                        <Tabs
                            value={view}
                            onValueChange={value => {
                                if (!views.includes(value as AfterSalesView)) return;
                                setView(value as AfterSalesView);
                                setSkip(0);
                                setSelected(null);
                            }}
                        >
                            <TabsList className="h-auto flex-wrap justify-start">
                                {views.map(item => (
                                    <TabsTrigger key={item} value={item}>
                                        {viewLabel(item, text)}
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
                    ) : requests.length === 0 ? (
                        <div className="py-14 text-center text-sm text-muted-foreground">{text.empty}</div>
                    ) : (
                        <>
                            <div className="divide-y overflow-hidden rounded-lg border bg-card">
                                {requests.map(request => (
                                    <RequestRow
                                        key={request.id}
                                        request={request}
                                        text={text}
                                        onSelect={() => setSelected(request)}
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
            <RequestDetailsSheet
                request={selected}
                text={text}
                pending={transition.isPending}
                onClose={() => setSelected(null)}
                onTransition={target => selected && openTransition(selected, target)}
            />
            <TransitionDialog
                draft={draft}
                text={text}
                pending={transition.isPending}
                onChange={setDraft}
                onClose={() => !transition.isPending && setDraft(null)}
                onSubmit={submit}
            />
        </Page>
    );
}

function RequestRow({
    request,
    text,
    onSelect,
}: {
    request: AfterSalesRequestRecord;
    text: AfterSalesText;
    onSelect: () => void;
}) {
    const firstItem = request.items[0];
    const remainingItems = Math.max(0, request.items.length - 1);
    return (
        <article className="grid gap-4 p-4 transition-colors hover:bg-muted/30 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto_auto] lg:items-center">
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <strong>{request.code}</strong>
                    <Badge variant={badgeVariant(request.state)}>{stateLabel(request.state, text)}</Badge>
                    <Badge variant="outline">{typeLabel(request.type, text)}</Badge>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                    {text.order} {request.order.code} · {text.customer} {request.customerName}
                </p>
            </div>
            <div className="min-w-0 text-sm">
                <p className="truncate font-medium">{firstItem?.productName ?? '-'}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                    {firstItem?.sku ?? '-'}
                    {remainingItems > 0 ? ` +${remainingItems}` : ''}
                </p>
            </div>
            <div className="text-sm lg:text-right">
                <span className="text-muted-foreground">{text.requested}</span>
                <strong className="mt-1 block">
                    {formatMoney(request.requestedAmount, request.currencyCode)}
                </strong>
            </div>
            <time className="text-sm text-muted-foreground" dateTime={request.createdAt}>
                {formatDate(request.createdAt)}
            </time>
            <Button variant="outline" size="sm" onClick={onSelect}>
                <Eye className="size-4" aria-hidden="true" />
                {text.viewDetails}
            </Button>
        </article>
    );
}

function RequestDetailsSheet({
    request,
    text,
    pending,
    onClose,
    onTransition,
}: {
    request: AfterSalesRequestRecord | null;
    text: AfterSalesText;
    pending: boolean;
    onClose: () => void;
    onTransition: (state: TransitionTarget) => void;
}) {
    const requiresVerifiedRefund = request?.state === 'APPROVED' && (request.approvedAmount ?? 0) > 0;
    return (
        <Sheet open={Boolean(request)} onOpenChange={open => !open && onClose()}>
            <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
                {request && (
                    <>
                        <SheetHeader className="border-b px-6 py-5 text-left">
                            <div className="flex flex-wrap items-center gap-2 pr-10">
                                <SheetTitle>{request.code}</SheetTitle>
                                <Badge variant={badgeVariant(request.state)}>
                                    {stateLabel(request.state, text)}
                                </Badge>
                                <Badge variant="outline">{typeLabel(request.type, text)}</Badge>
                            </div>
                            <SheetDescription>
                                {text.order} {request.order.code} · {text.customer} {request.customerName} (
                                {request.customerEmail})
                            </SheetDescription>
                        </SheetHeader>
                        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
                            <div className="grid gap-3 rounded-lg bg-muted/50 p-4 sm:grid-cols-3">
                                <div>
                                    <span className="text-xs text-muted-foreground">{text.requested}</span>
                                    <strong className="mt-1 block">
                                        {formatMoney(request.requestedAmount, request.currencyCode)}
                                    </strong>
                                </div>
                                <div>
                                    <span className="text-xs text-muted-foreground">{text.approved}</span>
                                    <strong className="mt-1 block">
                                        {request.approvedAmount == null
                                            ? '-'
                                            : formatMoney(request.approvedAmount, request.currencyCode)}
                                    </strong>
                                </div>
                                <div>
                                    <span className="text-xs text-muted-foreground">{text.submittedAt}</span>
                                    <strong className="mt-1 block text-sm">
                                        {formatDate(request.createdAt)}
                                    </strong>
                                </div>
                            </div>
                            <section>
                                <h3 className="text-sm font-medium">{text.items}</h3>
                                <div className="mt-2 divide-y rounded-md border">
                                    {request.items.map(item => (
                                        <div
                                            key={item.id}
                                            className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                                        >
                                            <span className="min-w-0">
                                                <strong className="block truncate font-medium">
                                                    {item.productName}
                                                </strong>
                                                <small className="text-muted-foreground">
                                                    {item.sku} ×{item.quantity}
                                                </small>
                                            </span>
                                            <span>
                                                {formatMoney(item.lineAmountWithTax, request.currencyCode)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <h3 className="mt-4 text-sm font-medium">{text.descriptionLabel}</h3>
                                <p className="mt-2 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm leading-6">
                                    {request.description}
                                </p>
                            </section>
                            <section>
                                <h3 className="text-sm font-medium">{text.timeline}</h3>
                                <ol className="mt-3 space-y-3">
                                    {request.events.map(event => (
                                        <li
                                            key={event.id}
                                            className="grid grid-cols-[12px_minmax(0,1fr)] gap-2 text-sm"
                                        >
                                            <span className="mt-1.5 size-2 rounded-full bg-primary" />
                                            <div>
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <strong>{stateLabel(event.state, text)}</strong>
                                                    <small className="text-muted-foreground">
                                                        {formatDate(event.createdAt)}
                                                    </small>
                                                </div>
                                                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                                                    {event.note}
                                                </p>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </section>
                            {requiresVerifiedRefund && (
                                <Alert>
                                    <AlertDescription>{text.refundReminder}</AlertDescription>
                                </Alert>
                            )}
                        </div>
                        {(request.state === 'PENDING' || request.state === 'APPROVED') && (
                            <SheetFooter className="flex-row flex-wrap border-t px-6 py-4 sm:justify-end">
                                {request.state === 'PENDING' && (
                                    <>
                                        <Button
                                            variant="outline"
                                            disabled={pending}
                                            onClick={() => onTransition('REJECTED')}
                                        >
                                            <XCircle className="size-4" aria-hidden="true" />
                                            {text.reject}
                                        </Button>
                                        <Button disabled={pending} onClick={() => onTransition('APPROVED')}>
                                            <CheckCircle2 className="size-4" aria-hidden="true" />
                                            {text.approve}
                                        </Button>
                                    </>
                                )}
                                {request.state === 'APPROVED' && (
                                    <>
                                        {requiresVerifiedRefund && (
                                            <Button
                                                variant="outline"
                                                render={
                                                    <Link
                                                        to="/orders/$id"
                                                        params={{ id: request.order.id }}
                                                        search={{ action: 'refund' }}
                                                    />
                                                }
                                            >
                                                {text.openOrder}
                                            </Button>
                                        )}
                                        <Button disabled={pending} onClick={() => onTransition('COMPLETED')}>
                                            <CheckCircle2 className="size-4" aria-hidden="true" />
                                            {requiresVerifiedRefund
                                                ? text.completeAfterRefund
                                                : text.complete}
                                        </Button>
                                    </>
                                )}
                            </SheetFooter>
                        )}
                    </>
                )}
            </SheetContent>
        </Sheet>
    );
}

function TransitionDialog({
    draft,
    text,
    pending,
    onChange,
    onClose,
    onSubmit,
}: {
    draft: TransitionDraft | null;
    text: AfterSalesText;
    pending: boolean;
    onChange: (draft: TransitionDraft | null) => void;
    onClose: () => void;
    onSubmit: () => void;
}) {
    if (!draft) return null;
    return (
        <Dialog open onOpenChange={open => !open && onClose()}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>{transitionLabel(draft.state, text)}</DialogTitle>
                    <DialogDescription>
                        {draft.request.code} · {draft.request.order.code}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    {draft.state === 'APPROVED' && (
                        <div className="space-y-1.5">
                            <Label htmlFor="after-sales-approved-amount">{text.amount}</Label>
                            <Input
                                id="after-sales-approved-amount"
                                type="number"
                                min="0"
                                step="0.01"
                                value={draft.approvedAmount}
                                disabled={pending}
                                onChange={event => onChange({ ...draft, approvedAmount: event.target.value })}
                            />
                            <p className="text-xs text-muted-foreground">{text.amountHint}</p>
                        </div>
                    )}
                    <div className="space-y-1.5">
                        <Label htmlFor="after-sales-resolution">{text.resolution}</Label>
                        <Textarea
                            id="after-sales-resolution"
                            rows={6}
                            maxLength={2000}
                            value={draft.resolution}
                            disabled={pending}
                            onChange={event => onChange({ ...draft, resolution: event.target.value })}
                        />
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{text.resolutionHint}</span>
                            <span>{draft.resolution.length}/2000</span>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" disabled={pending} onClick={onClose}>
                        {text.cancel}
                    </Button>
                    <Button disabled={pending || !draft.resolution.trim()} onClick={onSubmit}>
                        {pending ? text.saving : text.save}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function translateMessages(t: ReturnType<typeof useLingui>['t']): AfterSalesText {
    return Object.fromEntries(
        Object.entries(messages).map(([key, descriptor]) => [key, t(descriptor)]),
    ) as AfterSalesText;
}

function stateLabel(state: AfterSalesState, text: AfterSalesText): string {
    const labels: Record<AfterSalesState, string> = {
        PENDING: text.statePending,
        APPROVED: text.stateApproved,
        REJECTED: text.stateRejected,
        CANCELLED: text.stateCancelled,
        COMPLETED: text.stateCompleted,
    };
    return labels[state];
}

function viewLabel(view: AfterSalesView, text: AfterSalesText): string {
    if (view === 'CLOSED') return text.closed;
    return stateLabel(view, text);
}

function typeLabel(type: AfterSalesRequestRecord['type'], text: AfterSalesText): string {
    return type === 'RETURN_AND_REFUND' ? text.typeReturnAndRefund : text.typeRefundOnly;
}

function transitionLabel(state: TransitionTarget, text: AfterSalesText): string {
    if (state === 'APPROVED') return text.transitionApprove;
    if (state === 'REJECTED') return text.transitionReject;
    return text.transitionComplete;
}

function badgeVariant(state: AfterSalesState): 'default' | 'secondary' | 'destructive' | 'outline' {
    if (state === 'PENDING') return 'default';
    if (state === 'APPROVED' || state === 'COMPLETED') return 'secondary';
    if (state === 'REJECTED') return 'destructive';
    return 'outline';
}

function formatMoney(value: number, currencyCode: string): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(
        value / 100,
    );
}

function formatMajorAmount(value: number): string {
    return (value / 100).toFixed(2);
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(value),
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
