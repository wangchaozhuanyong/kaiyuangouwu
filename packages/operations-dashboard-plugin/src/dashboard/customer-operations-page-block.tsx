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

export function CustomerOperationsPageBlock({ context }: Readonly<Props>) {
    const customerId = context.entity?.id;
    const { hasPermissions } = usePermissions();
    const canUpdate = hasPermissions(['UpdateCustomer']);
    const queryClient = useQueryClient();
    const queryKey = ['customer-operations', customerId];
    const [showCreate, setShowCreate] = useState(false);
    const [title, setTitle] = useState('客户回访');
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
            toast.success('客户画像已重新计算');
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : '客户画像重算失败'),
    });
    const createMutation = useMutation({
        mutationFn: () => {
            if (!customerId || !title.trim() || !note.trim() || !dueAt) throw new Error('请完整填写跟进任务');
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
            toast.success('客户跟进任务已创建');
            setShowCreate(false);
            setNote('');
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : '客户跟进创建失败'),
    });
    const actionMutation = useMutation({
        mutationFn: () => {
            if (!action?.note.trim()) throw new Error('请填写操作说明');
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
            toast.success('客户跟进已更新');
            setAction(null);
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : '客户跟进更新失败'),
    });

    if (!customerId) return null;
    if (query.isLoading) return <Skeleton className="h-40 w-full" />;
    if (query.isError) {
        return (
            <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-3">
                    <span>客户画像读取失败</span>
                    <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                        <RefreshCw className="size-4" /> 重试
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
                        <UserRoundCheck className="size-4" /> 客户 360 与跟进闭环
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                        已结算订单按币种计算净 LTV，风险客户自动进入跟进队列。
                    </p>
                </div>
                {canUpdate && (
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setShowCreate(value => !value)}>
                            {showCreate ? '取消新任务' : '新建跟进'}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={refreshMutation.isPending}
                            onClick={() => refreshMutation.mutate()}
                        >
                            <RefreshCw className="size-4" /> 重算画像
                        </Button>
                    </div>
                )}
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
                <Metric label="客户分层" value={profile.segment} />
                <Metric label="流失风险" value={profile.churnRisk} />
                <Metric
                    label="R / F / M"
                    value={`${profile.recencyScore} / ${profile.frequencyScore} / ${profile.monetaryScore}`}
                />
                <Metric
                    label="最近购买"
                    value={profile.recencyDays == null ? '无已结算订单' : `${profile.recencyDays} 天前`}
                />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                {profile.currencyMetrics.map(metric => (
                    <div key={metric.currencyCode} className="rounded-lg border p-3">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{metric.currencyCode} 净 LTV</span>
                            <span>{metric.orderCount} 笔</span>
                        </div>
                        <strong className="mt-1 block text-lg">
                            {money(metric.netLifetimeValue, metric.currencyCode)}
                        </strong>
                        <p className="mt-1 text-xs text-muted-foreground">
                            实收 {money(metric.grossRevenue, metric.currencyCode)} · 退款{' '}
                            {money(metric.refundTotal, metric.currencyCode)}
                        </p>
                    </div>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
                服务记录 {profile.serviceInteractionCount} · 售后 {profile.afterSalesCount} · 未结售后{' '}
                {profile.openAfterSalesCount}
                {profile.doNotContact ? ' · 客户要求停止联系' : ''}
            </p>
            {profile.reasons.length > 0 && (
                <p className="text-xs text-muted-foreground">分层依据：{profile.reasons.join('；')}</p>
            )}

            {showCreate && canUpdate && (
                <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
                    <Field label="跟进标题">
                        <Input value={title} onChange={event => setTitle(event.target.value)} />
                    </Field>
                    <Field label="优先级">
                        <select
                            value={priority}
                            onChange={event => setPriority(event.target.value)}
                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                        >
                            <option value="P1">P1</option>
                            <option value="P2">P2</option>
                            <option value="P3">P3</option>
                        </select>
                    </Field>
                    <Field label="跟进时间">
                        <Input
                            type="datetime-local"
                            value={dueAt}
                            onChange={event => setDueAt(event.target.value)}
                        />
                    </Field>
                    <Field label="跟进说明">
                        <Input value={note} onChange={event => setNote(event.target.value)} />
                    </Field>
                    <div className="flex justify-end sm:col-span-2">
                        <Button disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
                            创建任务
                        </Button>
                    </div>
                </div>
            )}

            <div className="space-y-3">
                <div className="flex justify-between text-sm font-medium">
                    <span>待处理跟进</span>
                    <span>{query.data?.customerFollowUps.totalItems ?? 0} 项</span>
                </div>
                {followUps.map(item => (
                    <div key={item.id} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-2 font-medium">
                                    {item.title} <Badge variant="outline">{item.priority}</Badge>
                                    {item.overdue && <Badge variant="destructive">已逾期</Badge>}
                                </div>
                                <p className="mt-1 text-sm text-muted-foreground">{item.note}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    截止 {new Date(item.dueAt).toLocaleString()} ·{' '}
                                    {item.source === 'SYSTEM' ? '系统创建' : '人工创建'}
                                </p>
                            </div>
                            {canUpdate && (
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        onClick={() => setAction(makeAction(item.id, 'COMPLETE', item.dueAt))}
                                    >
                                        登记结果
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                            setAction(makeAction(item.id, 'RESCHEDULE', item.dueAt))
                                        }
                                    >
                                        改期
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setAction(makeAction(item.id, 'DISMISS', item.dueAt))}
                                    >
                                        关闭
                                    </Button>
                                </div>
                            )}
                        </div>
                        {action?.id === item.id && (
                            <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2">
                                {action.action === 'COMPLETE' && (
                                    <Field label="结果">
                                        <select
                                            value={action.outcomeCode}
                                            onChange={event =>
                                                setAction({ ...action, outcomeCode: event.target.value })
                                            }
                                            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                                        >
                                            <option value="RESOLVED">已解决</option>
                                            <option value="CONTACTED">已联系</option>
                                            <option value="NO_RESPONSE">未联系上</option>
                                            <option value="DO_NOT_CONTACT">停止联系</option>
                                            <option value="NOT_NEEDED">无需继续</option>
                                        </select>
                                    </Field>
                                )}
                                {action.action === 'RESCHEDULE' && (
                                    <Field label="新的跟进时间">
                                        <Input
                                            type="datetime-local"
                                            value={action.dueAt}
                                            onChange={event =>
                                                setAction({ ...action, dueAt: event.target.value })
                                            }
                                        />
                                    </Field>
                                )}
                                <Field label="操作说明" wide>
                                    <Input
                                        value={action.note}
                                        onChange={event => setAction({ ...action, note: event.target.value })}
                                    />
                                </Field>
                                <div className="flex justify-end gap-2 sm:col-span-2">
                                    <Button variant="outline" onClick={() => setAction(null)}>
                                        取消
                                    </Button>
                                    <Button
                                        disabled={actionMutation.isPending}
                                        onClick={() => actionMutation.mutate()}
                                    >
                                        保存
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
                {!followUps.length && <p className="text-sm text-muted-foreground">当前没有待处理跟进。</p>}
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
