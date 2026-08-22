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
    Input,
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
import { CheckCircle2, Clock3, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { ReactNode, useState } from 'react';

import {
    AfterSalesRequestRecord,
    AfterSalesRequestsResult,
    AfterSalesState,
    afterSalesRequestsQuery,
    transitionAfterSalesRequestMutation,
} from './after-sales.graphql';

type TransitionTarget = Extract<AfterSalesState, 'APPROVED' | 'REJECTED' | 'COMPLETED'>;

interface TransitionDraft {
    request: AfterSalesRequestRecord;
    state: TransitionTarget;
    resolution: string;
    approvedAmount: string;
}

const zhCopy = {
    title: '售后处理',
    description: '审核当前店铺的退款与退货申请。这里记录业务处理结果，不会调用真实支付退款。',
    refresh: '刷新',
    filter: '状态筛选',
    all: '全部状态',
    loadError: '售后申请加载失败',
    retry: '重试',
    empty: '当前筛选条件下没有售后申请',
    order: '订单',
    customer: '客户',
    requested: '申请金额',
    approved: '通过金额',
    submittedAt: '申请时间',
    items: '申请商品',
    descriptionLabel: '客户说明',
    timeline: '处理时间线',
    approve: '通过申请',
    reject: '驳回申请',
    complete: '标记完成',
    cancel: '取消',
    save: '确认处理',
    saving: '正在处理',
    resolution: '处理说明',
    resolutionHint: '客户可以在售后时间线中看到这段说明。',
    amount: '通过金额',
    amountHint: '按当前币种填写；不能超过申请金额。这里只记录审核金额。',
    invalidResolution: '处理说明不能为空且不能超过 2000 个字符',
    invalidAmount: '通过金额必须是 0 到申请金额之间的有效金额',
    refundUnavailable: '当前未接入真实支付退款。正金额申请必须完成并核验实际退款后才能标记完成。',
    updated: '售后状态已更新',
    activeChannel: '当前店铺',
};

const enCopy: typeof zhCopy = {
    title: 'After-sales',
    description:
        'Review refund and return requests for the active store. This records workflow only and does not call a payment refund.',
    refresh: 'Refresh',
    filter: 'Status filter',
    all: 'All statuses',
    loadError: 'Could not load after-sales requests',
    retry: 'Retry',
    empty: 'No after-sales requests match this filter',
    order: 'Order',
    customer: 'Customer',
    requested: 'Requested',
    approved: 'Approved',
    submittedAt: 'Submitted',
    items: 'Items',
    descriptionLabel: 'Customer description',
    timeline: 'Timeline',
    approve: 'Approve',
    reject: 'Reject',
    complete: 'Mark completed',
    cancel: 'Cancel',
    save: 'Confirm',
    saving: 'Processing',
    resolution: 'Resolution note',
    resolutionHint: 'The customer can see this note in the request timeline.',
    amount: 'Approved amount',
    amountHint:
        'Enter the active currency amount, not above the request total. This is an approval record only.',
    invalidResolution: 'The resolution note is required and cannot exceed 2000 characters',
    invalidAmount: 'The approved amount must be between zero and the requested amount',
    refundUnavailable:
        'Real payment refunds are not connected. A positive refund must be completed and verified before this request can be marked completed.',
    updated: 'After-sales status updated',
    activeChannel: 'Active store',
};

const states: AfterSalesState[] = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'];

export const afterSalesRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'sales',
        id: 'after-sales',
        url: '/after-sales',
        title: '售后处理',
        icon: RotateCcw,
        requiresPermission: ['UpdateOrder'],
    },
    path: '/after-sales',
    loader: () => ({ breadcrumb: () => '售后处理' }),
    component: () => <AfterSalesPage />,
};

function AfterSalesPage() {
    const { i18n } = useLingui();
    const isZh = i18n.locale.toLowerCase().startsWith('zh');
    const text = isZh ? zhCopy : enCopy;
    const { activeChannel } = useChannel();
    const [state, setState] = useState<AfterSalesState | 'ALL'>('ALL');
    const [draft, setDraft] = useState<TransitionDraft | null>(null);
    const query = useQuery({
        queryKey: ['operations-after-sales', activeChannel?.id, state],
        queryFn: () =>
            api.query<AfterSalesRequestsResult>(afterSalesRequestsQuery, {
                options: { take: 100, ...(state === 'ALL' ? {} : { state }) },
            }),
        enabled: Boolean(activeChannel?.id),
    });
    const requests = query.data?.afterSalesRequests.items ?? [];
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
                    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
                        <div className="space-y-1.5">
                            <Label>{text.filter}</Label>
                            <Select value={state} onValueChange={value => value && setState(value)}>
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
                            <Badge variant="secondary">
                                {query.data?.afterSalesRequests.totalItems ?? 0}
                            </Badge>
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
                        <div className="space-y-4">
                            {requests.map(request => (
                                <RequestCard
                                    key={request.id}
                                    request={request}
                                    isZh={isZh}
                                    text={text}
                                    pending={transition.isPending}
                                    onTransition={target => openTransition(request, target)}
                                />
                            ))}
                        </div>
                    )}
                </PageBlock>
            </PageLayout>
            <TransitionDialog
                draft={draft}
                isZh={isZh}
                text={text}
                pending={transition.isPending}
                onChange={setDraft}
                onClose={() => !transition.isPending && setDraft(null)}
                onSubmit={submit}
            />
        </Page>
    );
}

function RequestCard({
    request,
    isZh,
    text,
    pending,
    onTransition,
}: {
    request: AfterSalesRequestRecord;
    isZh: boolean;
    text: typeof zhCopy;
    pending: boolean;
    onTransition: (state: TransitionTarget) => void;
}) {
    const requiresVerifiedRefund = request.state === 'APPROVED' && (request.approvedAmount ?? 0) > 0;
    return (
        <article className="rounded-lg border bg-card p-4 shadow-sm">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 text-muted-foreground">{stateIcon(request.state)}</span>
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <strong>{request.code}</strong>
                            <Badge variant={badgeVariant(request.state)}>
                                {stateLabel(request.state, isZh)}
                            </Badge>
                            <Badge variant="outline">{typeLabel(request.type, isZh)}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {text.order} {request.order.code} · {text.customer} {request.customerName} (
                            {request.customerEmail})
                        </p>
                    </div>
                </div>
                <div className="text-right text-sm">
                    <div>
                        {text.requested}：
                        <strong>{formatMoney(request.requestedAmount, request.currencyCode)}</strong>
                    </div>
                    {request.approvedAmount != null && (
                        <div className="mt-1 text-muted-foreground">
                            {text.approved}：{formatMoney(request.approvedAmount, request.currencyCode)}
                        </div>
                    )}
                </div>
            </header>
            <div className="grid gap-5 py-4 lg:grid-cols-2">
                <section>
                    <h3 className="text-sm font-medium">{text.items}</h3>
                    <div className="mt-2 divide-y rounded-md border">
                        {request.items.map(item => (
                            <div
                                key={item.id}
                                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                            >
                                <span>
                                    <strong className="block font-medium">{item.productName}</strong>
                                    <small className="text-muted-foreground">
                                        {item.sku} ×{item.quantity}
                                    </small>
                                </span>
                                <span>{formatMoney(item.lineAmountWithTax, request.currencyCode)}</span>
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
                    <ol className="mt-2 space-y-3">
                        {request.events.map(event => (
                            <li key={event.id} className="grid grid-cols-[12px_minmax(0,1fr)] gap-2 text-sm">
                                <span className="mt-1.5 size-2 rounded-full bg-primary" />
                                <div>
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <strong>{stateLabel(event.state, isZh)}</strong>
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
            </div>
            {(request.state === 'PENDING' || request.state === 'APPROVED') && (
                <footer className="flex flex-wrap justify-end gap-2 border-t pt-3">
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
                                <Alert className="mr-auto w-full lg:w-auto lg:flex-1">
                                    <AlertDescription>{text.refundUnavailable}</AlertDescription>
                                </Alert>
                            )}
                            <Button
                                disabled={pending || requiresVerifiedRefund}
                                title={requiresVerifiedRefund ? text.refundUnavailable : undefined}
                                onClick={() => onTransition('COMPLETED')}
                            >
                                <CheckCircle2 className="size-4" aria-hidden="true" />
                                {text.complete}
                            </Button>
                        </>
                    )}
                </footer>
            )}
        </article>
    );
}

function TransitionDialog({
    draft,
    isZh,
    text,
    pending,
    onChange,
    onClose,
    onSubmit,
}: {
    draft: TransitionDraft | null;
    isZh: boolean;
    text: typeof zhCopy;
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
                    <DialogTitle>{transitionLabel(draft.state, isZh)}</DialogTitle>
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

function stateLabel(state: AfterSalesState, isZh: boolean): string {
    const labels: Record<AfterSalesState, [string, string]> = {
        PENDING: ['待处理', 'Pending'],
        APPROVED: ['已通过', 'Approved'],
        REJECTED: ['已驳回', 'Rejected'],
        CANCELLED: ['已撤销', 'Cancelled'],
        COMPLETED: ['已完成', 'Completed'],
    };
    return labels[state][isZh ? 0 : 1];
}

function typeLabel(type: AfterSalesRequestRecord['type'], isZh: boolean): string {
    return type === 'RETURN_AND_REFUND'
        ? isZh
            ? '退货退款'
            : 'Return and refund'
        : isZh
          ? '仅退款'
          : 'Refund only';
}

function transitionLabel(state: TransitionTarget, isZh: boolean): string {
    if (state === 'APPROVED') return isZh ? '通过售后申请' : 'Approve request';
    if (state === 'REJECTED') return isZh ? '驳回售后申请' : 'Reject request';
    return isZh ? '完成售后处理' : 'Complete request';
}

function stateIcon(state: AfterSalesState): ReactNode {
    if (state === 'PENDING') return <Clock3 className="size-5" aria-hidden="true" />;
    if (state === 'APPROVED' || state === 'COMPLETED') {
        return <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" />;
    }
    return <XCircle className="size-5" aria-hidden="true" />;
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
