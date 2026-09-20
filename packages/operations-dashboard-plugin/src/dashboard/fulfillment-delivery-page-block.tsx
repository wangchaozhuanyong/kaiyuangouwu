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

export function FulfillmentDeliveryPageBlock({ context }: Readonly<Props>) {
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
            if (!draft?.note.trim()) throw new Error('请填写操作说明');
            if (draft.status === 'IN_TRANSIT' && (!draft.carrier.trim() || !draft.trackingCode.trim())) {
                throw new Error('重新发运必须填写物流公司和运单号');
            }
            if (draft.status === 'DELIVERED' && !draft.proofReference.trim()) {
                throw new Error('确认送达必须填写可追溯凭证');
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
            toast.success('配送证据已更新');
            setDraft(null);
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : '配送证据更新失败'),
    });

    if (!orderId) return null;
    if (query.isLoading) return <Skeleton className="h-32 w-full" />;
    if (query.isError) {
        return (
            <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-3">
                    <span>配送证据加载失败</span>
                    <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                        <RefreshCw className="size-4" /> 重试
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
                    <Truck className="size-4" /> 配送证据与异常处理
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                    送达必须带凭证；配送异常、重新发运和客户确认都会保留事件记录。
                </p>
            </div>
            {fulfillments.map(fulfillment => {
                const evidence = fulfillment.deliveryEvidence;
                return (
                    <div key={fulfillment.id} className="space-y-3 rounded-lg border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-2 font-medium">
                                    履约 #{fulfillment.id}
                                    <Badge
                                        variant={
                                            evidence?.status === 'EXCEPTION' ? 'destructive' : 'secondary'
                                        }
                                    >
                                        {evidence?.status ?? fulfillment.state}
                                    </Badge>
                                    {evidence?.overdue && <Badge variant="outline">已逾期</Badge>}
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {evidence?.carrier ?? fulfillment.method} ·{' '}
                                    {evidence?.trackingCode ?? fulfillment.trackingCode ?? '无运单号'}
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
                                            登记异常
                                        </Button>
                                    )}
                                    {evidence?.status === 'EXCEPTION' && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setDraft(makeDraft(fulfillment, 'IN_TRANSIT'))}
                                        >
                                            重新发运
                                        </Button>
                                    )}
                                    <Button
                                        size="sm"
                                        onClick={() => setDraft(makeDraft(fulfillment, 'DELIVERED'))}
                                    >
                                        <PackageCheck className="size-4" /> 确认送达
                                    </Button>
                                </div>
                            )}
                        </div>
                        {draft?.fulfillmentId === fulfillment.id && (
                            <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                                {draft.status === 'IN_TRANSIT' && (
                                    <>
                                        <Field label="物流公司">
                                            <Input
                                                value={draft.carrier}
                                                onChange={event =>
                                                    setDraft({ ...draft, carrier: event.target.value })
                                                }
                                            />
                                        </Field>
                                        <Field label="新运单号">
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
                                    <Field label="送达凭证">
                                        <Input
                                            value={draft.proofReference}
                                            onChange={event =>
                                                setDraft({ ...draft, proofReference: event.target.value })
                                            }
                                        />
                                    </Field>
                                )}
                                <Field label="操作说明" wide>
                                    <Input
                                        value={draft.note}
                                        onChange={event => setDraft({ ...draft, note: event.target.value })}
                                    />
                                </Field>
                                <div className="flex justify-end gap-2 sm:col-span-2">
                                    <Button variant="outline" onClick={() => setDraft(null)}>
                                        取消
                                    </Button>
                                    <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
                                        保存配送事件
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
