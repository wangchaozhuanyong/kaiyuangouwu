import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    Input,
    Label,
    Skeleton,
    api,
    toast,
    useMutation,
    usePermissions,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { RefreshCw, UserRoundCheck } from 'lucide-react';
import { useState } from 'react';

import {
    CustomerOperationsResult,
    createCustomerFollowUpMutation,
    customerOperationsQuery,
    refreshCustomerOperationsMutation,
    updateCustomerFollowUpMutation,
} from './customer-operations.graphql';

interface Props {
    context: { entity?: { id?: string } };
}

interface ActionDraft {
    id: string;
    action: 'RESCHEDULE' | 'COMPLETE' | 'DISMISS';
    dueAt: string;
    outcomeCode: string;
    note: string;
}

const messages = {
    defaultTitle: msg({ id: 'operations.customer360.defaultTitle', message: 'Customer follow-up' }),
    refreshed: msg({ id: 'operations.customer360.refreshed', message: 'Customer profile recalculated' }),
    refreshFailed: msg({
        id: 'operations.customer360.refreshFailed',
        message: 'Could not recalculate customer profile',
    }),
    completeTask: msg({ id: 'operations.customer360.completeTask', message: 'Complete the follow-up task' }),
    created: msg({ id: 'operations.customer360.created', message: 'Customer follow-up created' }),
    createFailed: msg({
        id: 'operations.customer360.createFailed',
        message: 'Could not create customer follow-up',
    }),
    enterNote: msg({ id: 'operations.customer360.enterNote', message: 'Enter an action note' }),
    updated: msg({ id: 'operations.customer360.updated', message: 'Customer follow-up updated' }),
    updateFailed: msg({
        id: 'operations.customer360.updateFailed',
        message: 'Could not update customer follow-up',
    }),
    loadFailed: msg({ id: 'operations.customer360.loadFailed', message: 'Could not load customer profile' }),
    retry: msg({ id: 'operations.customer360.retry', message: 'Retry' }),
    heading: msg({ id: 'operations.customer360.heading', message: 'Customer 360 and follow-up workflow' }),
    description: msg({
        id: 'operations.customer360.description',
        message:
            'Net lifetime value is calculated by currency from settled orders. At-risk customers enter the follow-up queue automatically.',
    }),
    cancelNew: msg({ id: 'operations.customer360.cancelNew', message: 'Cancel new task' }),
    newFollowUp: msg({ id: 'operations.customer360.newFollowUp', message: 'New follow-up' }),
    recalculate: msg({ id: 'operations.customer360.recalculate', message: 'Recalculate profile' }),
    segment: msg({ id: 'operations.customer360.segment', message: 'Customer segment' }),
    churnRisk: msg({ id: 'operations.customer360.churnRisk', message: 'Churn risk' }),
    recentPurchase: msg({ id: 'operations.customer360.recentPurchase', message: 'Recent purchase' }),
    noSettledOrders: msg({ id: 'operations.customer360.noSettledOrders', message: 'No settled orders' }),
    daysAgo: msg({ id: 'operations.customer360.daysAgo', message: 'days ago' }),
    netLtv: msg({ id: 'operations.customer360.netLtv', message: 'net LTV' }),
    ordersUnit: msg({ id: 'operations.customer360.ordersUnit', message: 'orders' }),
    received: msg({ id: 'operations.customer360.received', message: 'Received' }),
    refunded: msg({ id: 'operations.customer360.refunded', message: 'Refunded' }),
    serviceRecords: msg({ id: 'operations.customer360.serviceRecords', message: 'Service records' }),
    afterSales: msg({ id: 'operations.customer360.afterSales', message: 'After-sales' }),
    openAfterSales: msg({ id: 'operations.customer360.openAfterSales', message: 'Open after-sales' }),
    doNotContact: msg({
        id: 'operations.customer360.doNotContact',
        message: 'Customer requested no contact',
    }),
    segmentReasons: msg({ id: 'operations.customer360.segmentReasons', message: 'Segment reasons:' }),
    followUpTitle: msg({ id: 'operations.customer360.followUpTitle', message: 'Follow-up title' }),
    priority: msg({ id: 'operations.customer360.priority', message: 'Priority' }),
    priority1: msg({ id: 'operations.customer360.priority1', message: 'P1' }),
    priority2: msg({ id: 'operations.customer360.priority2', message: 'P2' }),
    priority3: msg({ id: 'operations.customer360.priority3', message: 'P3' }),
    dueAt: msg({ id: 'operations.customer360.dueAt', message: 'Follow-up time' }),
    followUpNote: msg({ id: 'operations.customer360.followUpNote', message: 'Follow-up note' }),
    createTask: msg({ id: 'operations.customer360.createTask', message: 'Create task' }),
    pending: msg({ id: 'operations.customer360.pending', message: 'Pending follow-ups' }),
    itemsUnit: msg({ id: 'operations.customer360.itemsUnit', message: 'items' }),
    overdue: msg({ id: 'operations.customer360.overdue', message: 'Overdue' }),
    deadline: msg({ id: 'operations.customer360.deadline', message: 'Due' }),
    systemCreated: msg({ id: 'operations.customer360.systemCreated', message: 'Created by system' }),
    manuallyCreated: msg({ id: 'operations.customer360.manuallyCreated', message: 'Created manually' }),
    recordOutcome: msg({ id: 'operations.customer360.recordOutcome', message: 'Record outcome' }),
    reschedule: msg({ id: 'operations.customer360.reschedule', message: 'Reschedule' }),
    close: msg({ id: 'operations.customer360.close', message: 'Close' }),
    outcome: msg({ id: 'operations.customer360.outcome', message: 'Outcome' }),
    resolved: msg({ id: 'operations.customer360.resolved', message: 'Resolved' }),
    contacted: msg({ id: 'operations.customer360.contacted', message: 'Contacted' }),
    noResponse: msg({ id: 'operations.customer360.noResponse', message: 'No response' }),
    stopContact: msg({ id: 'operations.customer360.stopContact', message: 'Do not contact' }),
    notNeeded: msg({ id: 'operations.customer360.notNeeded', message: 'No further action' }),
    newDueAt: msg({ id: 'operations.customer360.newDueAt', message: 'New follow-up time' }),
    actionNote: msg({ id: 'operations.customer360.actionNote', message: 'Action note' }),
    cancel: msg({ id: 'operations.customer360.cancel', message: 'Cancel' }),
    save: msg({ id: 'operations.customer360.save', message: 'Save' }),
    empty: msg({ id: 'operations.customer360.empty', message: 'No pending follow-ups.' }),
};

export function CustomerOperationsPageBlock({ context }: Readonly<Props>) {
    const { t } = useLingui();
    const customerId = context.entity?.id;
    const { hasPermissions } = usePermissions();
    const canUpdate = hasPermissions(['UpdateCustomer']);
    const queryClient = useQueryClient();
    const queryKey = ['customer-operations', customerId];
    const [showCreate, setShowCreate] = useState(false);
    const [title, setTitle] = useState(() => t(messages.defaultTitle));
    const [note, setNote] = useState('');
    const [dueAt, setDueAt] = useState(() => localDateTime(Date.now() + 86_400_000));
    const [priority, setPriority] = useState('P2');
    const [action, setAction] = useState<ActionDraft | null>(null);
    const query = useQuery({
        queryKey,
        enabled: Boolean(customerId),
        queryFn: () => api.query<CustomerOperationsResult>(customerOperationsQuery, { customerId }),
    });
    const refreshMutation = useMutation({
        mutationFn: () => api.mutate(refreshCustomerOperationsMutation, { customerId }),
        onSuccess: async () => {
            toast.success(t(messages.refreshed));
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : t(messages.refreshFailed)),
    });
    const createMutation = useMutation({
        mutationFn: () => {
            if (!customerId || !title.trim() || !note.trim() || !dueAt)
                throw new Error(t(messages.completeTask));
            return api.mutate(createCustomerFollowUpMutation, {
                input: {
                    customerId,
                    priority,
                    dueAt: new Date(dueAt).toISOString(),
                    title: title.trim(),
                    note: note.trim(),
                    idempotencyKey: `dashboard-follow-up-${customerId}-${Date.now()}`,
                },
            });
        },
        onSuccess: async () => {
            toast.success(t(messages.created));
            setShowCreate(false);
            setNote('');
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : t(messages.createFailed)),
    });
    const actionMutation = useMutation({
        mutationFn: () => {
            if (!action?.note.trim()) throw new Error(t(messages.enterNote));
            return api.mutate(updateCustomerFollowUpMutation, {
                input: {
                    id: action.id,
                    action: action.action,
                    dueAt: action.action === 'RESCHEDULE' ? new Date(action.dueAt).toISOString() : null,
                    outcomeCode:
                        action.action === 'COMPLETE'
                            ? action.outcomeCode
                            : action.action === 'DISMISS'
                              ? 'NOT_NEEDED'
                              : null,
                    note: action.note.trim(),
                    idempotencyKey: `${action.action.toLowerCase()}-${action.id}-${Date.now()}`,
                },
            });
        },
        onSuccess: async () => {
            toast.success(t(messages.updated));
            setAction(null);
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : t(messages.updateFailed)),
    });

    if (!customerId) return null;
    if (query.isLoading) return <Skeleton className="h-40 w-full" />;
    if (query.isError) {
        return (
            <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-3">
                    <span>{t(messages.loadFailed)}</span>
                    <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                        <RefreshCw className="size-4" /> {t(messages.retry)}
                    </Button>
                </AlertDescription>
            </Alert>
        );
    }
    const profile = query.data?.customerOperationsProfile;
    const followUps = query.data?.customerFollowUps.items ?? [];
    if (!profile) return null;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="flex items-center gap-2 text-base font-semibold">
                        <UserRoundCheck className="size-4" /> {t(messages.heading)}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">{t(messages.description)}</p>
                </div>
                {canUpdate && (
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowCreate(value => !value)}>
                            {showCreate ? t(messages.cancelNew) : t(messages.newFollowUp)}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={refreshMutation.isPending}
                            onClick={() => refreshMutation.mutate()}
                        >
                            <RefreshCw className="size-4" /> {t(messages.recalculate)}
                        </Button>
                    </div>
                )}
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
                <Metric label={t(messages.segment)} value={profile.segment} />
                <Metric label={t(messages.churnRisk)} value={profile.churnRisk} />
                <Metric
                    label="R / F / M"
                    value={`${profile.recencyScore} / ${profile.frequencyScore} / ${profile.monetaryScore}`}
                />
                <Metric
                    label={t(messages.recentPurchase)}
                    value={
                        profile.recencyDays == null
                            ? t(messages.noSettledOrders)
                            : `${profile.recencyDays} ${t(messages.daysAgo)}`
                    }
                />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                {profile.currencyMetrics.map(metric => (
                    <div key={metric.currencyCode} className="rounded-lg border p-3">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>
                                {metric.currencyCode} {t(messages.netLtv)}
                            </span>
                            <span>
                                {metric.orderCount} {t(messages.ordersUnit)}
                            </span>
                        </div>
                        <strong className="mt-1 block text-lg">
                            {money(metric.netLifetimeValue, metric.currencyCode)}
                        </strong>
                        <p className="mt-1 text-xs text-muted-foreground">
                            {t(messages.received)} {money(metric.grossRevenue, metric.currencyCode)} ·{' '}
                            {t(messages.refunded)} {money(metric.refundTotal, metric.currencyCode)}
                        </p>
                    </div>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
                {t(messages.serviceRecords)} {profile.serviceInteractionCount} · {t(messages.afterSales)}{' '}
                {profile.afterSalesCount} · {t(messages.openAfterSales)} {profile.openAfterSalesCount}
                {profile.doNotContact ? ` · ${t(messages.doNotContact)}` : ''}
            </p>
            {profile.reasons.length > 0 && (
                <p className="text-xs text-muted-foreground">
                    {t(messages.segmentReasons)} {profile.reasons.join('; ')}
                </p>
            )}

            {showCreate && canUpdate && (
                <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
                    <Field label={t(messages.followUpTitle)}>
                        <Input value={title} onChange={event => setTitle(event.target.value)} />
                    </Field>
                    <Field label={t(messages.priority)}>
                        <select
                            value={priority}
                            onChange={event => setPriority(event.target.value)}
                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                        >
                            <option value="P1">{t(messages.priority1)}</option>
                            <option value="P2">{t(messages.priority2)}</option>
                            <option value="P3">{t(messages.priority3)}</option>
                        </select>
                    </Field>
                    <Field label={t(messages.dueAt)}>
                        <Input
                            type="datetime-local"
                            value={dueAt}
                            onChange={event => setDueAt(event.target.value)}
                        />
                    </Field>
                    <Field label={t(messages.followUpNote)}>
                        <Input value={note} onChange={event => setNote(event.target.value)} />
                    </Field>
                    <div className="flex justify-end sm:col-span-2">
                        <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
                            {t(messages.createTask)}
                        </Button>
                    </div>
                </div>
            )}

            <div className="space-y-3">
                <div className="flex justify-between text-sm font-medium">
                    <span>{t(messages.pending)}</span>
                    <span>
                        {query.data?.customerFollowUps.totalItems ?? 0} {t(messages.itemsUnit)}
                    </span>
                </div>
                {followUps.map(item => (
                    <div key={item.id} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-2 font-medium">
                                    {item.title} <Badge variant="outline">{item.priority}</Badge>
                                    {item.overdue && (
                                        <Badge variant="destructive">{t(messages.overdue)}</Badge>
                                    )}
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground">{item.note}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {t(messages.deadline)} {new Date(item.dueAt).toLocaleString()} ·{' '}
                                    {item.source === 'SYSTEM'
                                        ? t(messages.systemCreated)
                                        : t(messages.manuallyCreated)}
                                </p>
                            </div>
                            {canUpdate && (
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        onClick={() => setAction(makeAction(item.id, 'COMPLETE', item.dueAt))}
                                    >
                                        {t(messages.recordOutcome)}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            setAction(makeAction(item.id, 'RESCHEDULE', item.dueAt))
                                        }
                                    >
                                        {t(messages.reschedule)}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setAction(makeAction(item.id, 'DISMISS', item.dueAt))}
                                    >
                                        {t(messages.close)}
                                    </Button>
                                </div>
                            )}
                        </div>
                        {action?.id === item.id && (
                            <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2">
                                {action.action === 'COMPLETE' && (
                                    <Field label={t(messages.outcome)}>
                                        <select
                                            value={action.outcomeCode}
                                            onChange={event =>
                                                setAction({ ...action, outcomeCode: event.target.value })
                                            }
                                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                                        >
                                            <option value="RESOLVED">{t(messages.resolved)}</option>
                                            <option value="CONTACTED">{t(messages.contacted)}</option>
                                            <option value="NO_RESPONSE">{t(messages.noResponse)}</option>
                                            <option value="DO_NOT_CONTACT">{t(messages.stopContact)}</option>
                                            <option value="NOT_NEEDED">{t(messages.notNeeded)}</option>
                                        </select>
                                    </Field>
                                )}
                                {action.action === 'RESCHEDULE' && (
                                    <Field label={t(messages.newDueAt)}>
                                        <Input
                                            type="datetime-local"
                                            value={action.dueAt}
                                            onChange={event =>
                                                setAction({ ...action, dueAt: event.target.value })
                                            }
                                        />
                                    </Field>
                                )}
                                <Field label={t(messages.actionNote)} wide>
                                    <Input
                                        value={action.note}
                                        onChange={event => setAction({ ...action, note: event.target.value })}
                                    />
                                </Field>
                                <div className="flex justify-end gap-2 sm:col-span-2">
                                    <Button variant="outline" onClick={() => setAction(null)}>
                                        {t(messages.cancel)}
                                    </Button>
                                    <Button
                                        disabled={actionMutation.isPending}
                                        onClick={() => actionMutation.mutate()}
                                    >
                                        {t(messages.save)}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
                {!followUps.length && <p className="text-sm text-muted-foreground">{t(messages.empty)}</p>}
            </div>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <strong className="mt-1 block text-sm">{value}</strong>
        </div>
    );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
    return (
        <div className={wide ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
            <Label>{label}</Label>
            {children}
        </div>
    );
}

function makeAction(id: string, action: ActionDraft['action'], currentDueAt: string): ActionDraft {
    return {
        id,
        action,
        dueAt: localDateTime(new Date(currentDueAt).getTime() + 86_400_000),
        outcomeCode: 'RESOLVED',
        note: '',
    };
}

function localDateTime(timestamp: number): string {
    const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
    return date.toISOString().slice(0, 16);
}

function money(amount: number, currencyCode: string): string {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(
        amount / 100,
    );
}
