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
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { PackageCheck, RefreshCw, TriangleAlert, Truck } from 'lucide-react';
import { useState } from 'react';

import { systemStatusDisplayLabel } from '../../../common/src/system-display-labels';

import {
    FulfillmentDeliveryOrderResult,
    FulfillmentDeliveryStatus,
    fulfillmentDeliveryOrderQuery,
    updateFulfillmentDeliveryMutation,
} from './fulfillment-delivery.graphql';

interface Props {
    context: { entity?: { id?: string } };
}

interface ActionDraft {
    fulfillmentId: string;
    status: Exclude<FulfillmentDeliveryStatus, 'IN_TRANSIT'> | 'IN_TRANSIT';
    carrier: string;
    trackingCode: string;
    proofReference: string;
    note: string;
}

const messages = {
    enterNote: msg({ id: 'operations.delivery.enterNote', message: 'Enter an action note' }),
    reshipDetails: msg({
        id: 'operations.delivery.reshipDetails',
        message: 'Carrier and tracking code are required to reship',
    }),
    proofRequired: msg({
        id: 'operations.delivery.proofRequired',
        message: 'Traceable proof is required to confirm delivery',
    }),
    updated: msg({ id: 'operations.delivery.updated', message: 'Delivery evidence updated' }),
    updateFailed: msg({
        id: 'operations.delivery.updateFailed',
        message: 'Could not update delivery evidence',
    }),
    loadFailed: msg({ id: 'operations.delivery.loadFailed', message: 'Could not load delivery evidence' }),
    retry: msg({ id: 'operations.delivery.retry', message: 'Retry' }),
    heading: msg({ id: 'operations.delivery.heading', message: 'Delivery evidence and exceptions' }),
    description: msg({
        id: 'operations.delivery.description',
        message:
            'Delivery requires proof. Exceptions, reshipments, and customer confirmations are retained as events.',
    }),
    fulfillment: msg({ id: 'operations.delivery.fulfillment', message: 'Fulfillment #' }),
    overdue: msg({ id: 'operations.delivery.overdue', message: 'Overdue' }),
    noTracking: msg({ id: 'operations.delivery.noTracking', message: 'No tracking code' }),
    recordException: msg({ id: 'operations.delivery.recordException', message: 'Record exception' }),
    reship: msg({ id: 'operations.delivery.reship', message: 'Reship' }),
    confirmDelivered: msg({ id: 'operations.delivery.confirmDelivered', message: 'Confirm delivery' }),
    carrier: msg({ id: 'operations.delivery.carrier', message: 'Carrier' }),
    newTracking: msg({ id: 'operations.delivery.newTracking', message: 'New tracking code' }),
    proof: msg({ id: 'operations.delivery.proof', message: 'Proof of delivery' }),
    actionNote: msg({ id: 'operations.delivery.actionNote', message: 'Action note' }),
    cancel: msg({ id: 'operations.delivery.cancel', message: 'Cancel' }),
    save: msg({ id: 'operations.delivery.save', message: 'Save delivery event' }),
};

export function FulfillmentDeliveryPageBlock({ context }: Readonly<Props>) {
    const { t } = useLingui();
    const orderId = context.entity?.id;
    const queryClient = useQueryClient();
    const queryKey = ['fulfillment-delivery-order', orderId];
    const [draft, setDraft] = useState<ActionDraft | null>(null);
    const query = useQuery({
        queryKey,
        enabled: Boolean(orderId),
        queryFn: () =>
            api.query<FulfillmentDeliveryOrderResult>(fulfillmentDeliveryOrderQuery, { id: orderId }),
    });
    const mutation = useMutation({
        mutationFn: async () => {
            if (!draft?.note.trim()) throw new Error(t(messages.enterNote));
            if (draft.status === 'IN_TRANSIT' && (!draft.carrier.trim() || !draft.trackingCode.trim())) {
                throw new Error(t(messages.reshipDetails));
            }
            if (draft.status === 'DELIVERED' && !draft.proofReference.trim()) {
                throw new Error(t(messages.proofRequired));
            }
            return api.mutate(updateFulfillmentDeliveryMutation, {
                input: {
                    fulfillmentId: draft.fulfillmentId,
                    status: draft.status,
                    carrier: draft.status === 'IN_TRANSIT' ? draft.carrier.trim() : null,
                    trackingCode: draft.status === 'IN_TRANSIT' ? draft.trackingCode.trim() : null,
                    proofReference: draft.status === 'DELIVERED' ? draft.proofReference.trim() : null,
                    note: draft.note.trim(),
                    idempotencyKey: `${draft.status.toLowerCase()}-${draft.fulfillmentId}-${Date.now()}`,
                },
            });
        },
        onSuccess: async () => {
            toast.success(t(messages.updated));
            setDraft(null);
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : t(messages.updateFailed)),
    });

    if (!orderId) return null;
    if (query.isLoading) return <Skeleton className="h-32 w-full" />;
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
    const fulfillments = query.data?.order?.fulfillments ?? [];
    if (!fulfillments.length) return null;

    return (
        <div className="space-y-4">
            <div>
                <h3 className="flex items-center gap-2 text-base font-semibold">
                    <Truck className="size-4" /> {t(messages.heading)}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(messages.description)}</p>
            </div>
            {fulfillments.map(fulfillment => {
                const evidence = fulfillment.deliveryEvidence;
                return (
                    <div key={fulfillment.id} className="space-y-3 rounded-lg border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-2 font-medium">
                                    {t(messages.fulfillment)}
                                    {fulfillment.id}
                                    <Badge
                                        variant={
                                            evidence?.status === 'EXCEPTION' ? 'destructive' : 'secondary'
                                        }
                                    >
                                        {systemStatusDisplayLabel(evidence?.status) ??
                                            systemStatusDisplayLabel(fulfillment.state)}
                                    </Badge>
                                    {evidence?.overdue && (
                                        <Badge variant="outline">{t(messages.overdue)}</Badge>
                                    )}
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {evidence?.carrier ?? fulfillment.method} ·{' '}
                                    {evidence?.trackingCode ??
                                        fulfillment.trackingCode ??
                                        t(messages.noTracking)}
                                </p>
                                {evidence?.exceptionReason && (
                                    <p className="mt-2 flex items-center gap-1 text-sm text-destructive">
                                        <TriangleAlert className="size-4" /> {evidence.exceptionReason}
                                    </p>
                                )}
                                {evidence?.events
                                    .slice(-3)
                                    .reverse()
                                    .map(event => (
                                        <p key={event.id} className="mt-1 text-xs text-muted-foreground">
                                            {new Date(event.createdAt).toLocaleString()} · {event.actorLabel}{' '}
                                            · {event.note}
                                        </p>
                                    ))}
                            </div>
                            {fulfillment.state === 'Shipped' && (
                                <div className="flex flex-wrap gap-2">
                                    {evidence?.status !== 'EXCEPTION' && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setDraft(makeDraft(fulfillment, 'EXCEPTION'))}
                                        >
                                            {t(messages.recordException)}
                                        </Button>
                                    )}
                                    {evidence?.status === 'EXCEPTION' && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setDraft(makeDraft(fulfillment, 'IN_TRANSIT'))}
                                        >
                                            {t(messages.reship)}
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        onClick={() => setDraft(makeDraft(fulfillment, 'DELIVERED'))}
                                    >
                                        <PackageCheck className="size-4" /> {t(messages.confirmDelivered)}
                                    </Button>
                                </div>
                            )}
                        </div>
                        {draft?.fulfillmentId === fulfillment.id && (
                            <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                                {draft.status === 'IN_TRANSIT' && (
                                    <>
                                        <Field label={t(messages.carrier)}>
                                            <Input
                                                value={draft.carrier}
                                                onChange={event =>
                                                    setDraft({ ...draft, carrier: event.target.value })
                                                }
                                            />
                                        </Field>
                                        <Field label={t(messages.newTracking)}>
                                            <Input
                                                value={draft.trackingCode}
                                                onChange={event =>
                                                    setDraft({ ...draft, trackingCode: event.target.value })
                                                }
                                            />
                                        </Field>
                                    </>
                                )}
                                {draft.status === 'DELIVERED' && (
                                    <Field label={t(messages.proof)}>
                                        <Input
                                            value={draft.proofReference}
                                            onChange={event =>
                                                setDraft({ ...draft, proofReference: event.target.value })
                                            }
                                        />
                                    </Field>
                                )}
                                <Field label={t(messages.actionNote)} wide>
                                    <Input
                                        value={draft.note}
                                        onChange={event => setDraft({ ...draft, note: event.target.value })}
                                    />
                                </Field>
                                <div className="flex justify-end gap-2 sm:col-span-2">
                                    <Button variant="outline" onClick={() => setDraft(null)}>
                                        {t(messages.cancel)}
                                    </Button>
                                    <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
                                        {t(messages.save)}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function makeDraft(
    fulfillment: NonNullable<FulfillmentDeliveryOrderResult['order']>['fulfillments'][number],
    status: FulfillmentDeliveryStatus,
): ActionDraft {
    return {
        fulfillmentId: fulfillment.id,
        status,
        carrier: fulfillment.deliveryEvidence?.carrier ?? fulfillment.method,
        trackingCode: fulfillment.deliveryEvidence?.trackingCode ?? fulfillment.trackingCode ?? '',
        proofReference: '',
        note: '',
    };
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
    return (
        <div className={wide ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
            <Label>{label}</Label>
            {children}
        </div>
    );
}
