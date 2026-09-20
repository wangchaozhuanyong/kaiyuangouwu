import { msg } from '@lingui/core/macro';
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
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    Skeleton,
    Textarea,
    api,
    toast,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { CheckCircle2, Eye, RefreshCw, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import {
    IncidentActionRecord,
    IncidentDetailResult,
    IncidentListResult,
    IncidentRecord,
    acknowledgeIncidentMutation,
    completeIncidentActionMutation,
    incidentDetailQuery,
    incidentListQuery,
    submitIncidentReviewMutation,
    validateIncidentRecoveryMutation,
} from './incident-response.graphql';

const title = msg({ id: 'operations.incidents.title', message: 'Incident response' });

export const incidentResponseRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'system',
        id: 'incident-response',
        url: '/incident-response',
        title: title.id,
        icon: ShieldAlert,
        requiresPermission: ['SuperAdmin'],
    },
    path: '/incident-response',
    loader: () => ({ breadcrumb: () => title.id }),
    component: () => <IncidentResponsePage />,
};

type Operation = 'ACKNOWLEDGE' | 'RECOVERY' | 'REVIEW' | 'ACTION';

interface OperationDraft {
    operation: Operation;
    incident: IncidentRecord;
    action?: IncidentActionRecord;
    note: string;
    rootCause: string;
    impactSummary: string;
    actionTitle: string;
    ownerDepartmentCode: string;
    dueAt: string;
}

function IncidentResponsePage() {
    const [status, setStatus] = useState('ACTIVE');
    const [severity, setSeverity] = useState('ALL');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<OperationDraft | null>(null);
    const list = useQuery({
        queryKey: ['operations-incidents', status, severity],
        queryFn: () =>
            api.query<IncidentListResult>(incidentListQuery, {
                status: status === 'ALL' ? null : status,
                severity: severity === 'ALL' ? null : severity,
            }),
        refetchInterval: 15_000,
    });
    const detail = useQuery({
        queryKey: ['operations-incident-detail', selectedId],
        queryFn: () => api.query<IncidentDetailResult>(incidentDetailQuery, { id: selectedId }),
        enabled: Boolean(selectedId),
    });
    const allIncidents = list.data?.adminIncidents.items ?? [];
    const incidents =
        status === 'ACTIVE' ? allIncidents.filter(item => item.incidentStatus !== 'CLOSED') : allIncidents;

    const mutation = useMutation({
        mutationFn: async (input: OperationDraft) => {
            if (input.operation === 'ACKNOWLEDGE') {
                return api.mutate(acknowledgeIncidentMutation, { id: input.incident.id, note: input.note });
            }
            if (input.operation === 'RECOVERY') {
                return api.mutate(validateIncidentRecoveryMutation, {
                    id: input.incident.id,
                    note: input.note,
                });
            }
            if (input.operation === 'ACTION') {
                return api.mutate(completeIncidentActionMutation, {
                    actionId: input.action?.id,
                    note: input.note,
                });
            }
            return api.mutate(submitIncidentReviewMutation, {
                id: input.incident.id,
                input: {
                    rootCause: input.rootCause,
                    impactSummary: input.impactSummary,
                    correctiveActions: [
                        {
                            title: input.actionTitle,
                            ownerDepartmentCode: input.ownerDepartmentCode,
                            dueAt: new Date(input.dueAt).toISOString(),
                        },
                    ],
                },
            });
        },
        onSuccess: async () => {
            toast.success('事故流程已更新');
            setDraft(null);
            await list.refetch();
            if (selectedId) await detail.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const openOperation = (operation: Operation, incident: IncidentRecord, action?: IncidentActionRecord) => {
        const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
        setDraft({
            operation,
            incident,
            action,
            note: '',
            rootCause: '',
            impactSummary: '',
            actionTitle: '',
            ownerDepartmentCode: action?.ownerDepartmentCode ?? incident.ownerDepartmentCode,
            dueAt: dueAt.toISOString().slice(0, 16),
        });
    };

    return (
        <Page pageId="incident-response">
            <PageTitle>事故响应</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" onClick={() => void list.refetch()} disabled={list.isFetching}>
                        <RefreshCw className={list.isFetching ? 'animate-spin' : ''} />
                        刷新
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="incident-response-list">
                    <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px_140px] md:items-end">
                        <div>
                            <h2 className="text-lg font-semibold">事故处理与证据闭环</h2>
                            <p className="text-sm text-muted-foreground">
                                P0/P1 必须完成确认、恢复验证、复盘与整改；Telegram 仅是通知渠道。
                            </p>
                        </div>
                        <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger>
                                <SelectValue placeholder="流程状态" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ACTIVE">未闭环</SelectItem>
                                <SelectItem value="ALL">全部</SelectItem>
                                {[
                                    'OPEN',
                                    'ACKNOWLEDGED',
                                    'RECOVERY_PENDING',
                                    'REVIEW_PENDING',
                                    'ACTION_PENDING',
                                    'CLOSED',
                                ].map(value => (
                                    <SelectItem key={value} value={value}>
                                        {statusLabel(value)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={severity} onValueChange={setSeverity}>
                            <SelectTrigger>
                                <SelectValue placeholder="严重等级" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">全部等级</SelectItem>
                                {['P0', 'P1', 'P2', 'P3'].map(value => (
                                    <SelectItem key={value} value={value}>
                                        {value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {list.isLoading && (
                        <div className="space-y-3">
                            {[0, 1, 2].map(item => (
                                <Skeleton key={item} className="h-28" />
                            ))}
                        </div>
                    )}
                    {list.error && (
                        <Alert variant="destructive">
                            <TriangleAlert />
                            <AlertDescription>{errorMessage(list.error)}</AlertDescription>
                        </Alert>
                    )}
                    {!list.isLoading && !incidents.length && (
                        <Alert>
                            <CheckCircle2 />
                            <AlertDescription>当前筛选下没有事故。</AlertDescription>
                        </Alert>
                    )}
                    <div className="space-y-3">
                        {incidents.map(incident => (
                            <div key={incident.id} className="rounded-lg border p-4">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge
                                                variant={
                                                    incident.severity === 'P0' ? 'destructive' : 'outline'
                                                }
                                            >
                                                {incident.severity}
                                            </Badge>
                                            <Badge variant="secondary">
                                                {statusLabel(incident.incidentStatus)}
                                            </Badge>
                                            <span className="text-xs font-medium text-muted-foreground">
                                                {incident.ownerDepartmentCode}
                                            </span>
                                        </div>
                                        <h3 className="mt-2 font-semibold">{incident.title}</h3>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {incident.eventType} · {incident.occurrenceCount} 次 ·{' '}
                                            {formatDate(incident.lastOccurredAt)}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setSelectedId(incident.id)}
                                        >
                                            <Eye />
                                            证据
                                        </Button>
                                        {incident.incidentStatus === 'OPEN' && (
                                            <Button
                                                size="sm"
                                                onClick={() => openOperation('ACKNOWLEDGE', incident)}
                                            >
                                                确认接手
                                            </Button>
                                        )}
                                        {incident.incidentStatus === 'RECOVERY_PENDING' && (
                                            <Button
                                                size="sm"
                                                onClick={() => openOperation('RECOVERY', incident)}
                                            >
                                                验证恢复
                                            </Button>
                                        )}
                                        {incident.incidentStatus === 'REVIEW_PENDING' && (
                                            <Button
                                                size="sm"
                                                onClick={() => openOperation('REVIEW', incident)}
                                            >
                                                提交复盘
                                            </Button>
                                        )}
                                    </div>
                                </div>
                                {incident.actions.length > 0 && (
                                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                                        {incident.actions.map(action => (
                                            <div
                                                key={action.id}
                                                className="flex items-center justify-between gap-3 rounded-md bg-muted p-3 text-sm"
                                            >
                                                <div>
                                                    <p className="font-medium">{action.title}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {action.ownerDepartmentCode} ·{' '}
                                                        {formatDate(action.dueAt)} · {action.status}
                                                    </p>
                                                </div>
                                                {action.status === 'OPEN' && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() =>
                                                            openOperation('ACTION', incident, action)
                                                        }
                                                    >
                                                        完成
                                                    </Button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </PageBlock>
            </PageLayout>

            <Sheet open={Boolean(selectedId)} onOpenChange={open => !open && setSelectedId(null)}>
                <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
                    <SheetHeader>
                        <SheetTitle>事故证据链</SheetTitle>
                        <SheetDescription>证据哈希实时验证，任何异常均会显示为完整性失败。</SheetDescription>
                    </SheetHeader>
                    {detail.isLoading && <Skeleton className="mt-6 h-40" />}
                    <div className="mt-6 space-y-3">
                        {detail.data?.adminIncident.evidence.map(item => (
                            <div key={item.id} className="rounded-lg border p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <Badge variant="outline">{item.eventType}</Badge>
                                    {item.integrityValid ? (
                                        <span className="flex items-center gap-1 text-xs text-emerald-700">
                                            <ShieldCheck className="size-4" />
                                            完整
                                        </span>
                                    ) : (
                                        <span className="text-xs font-semibold text-destructive">
                                            哈希失配
                                        </span>
                                    )}
                                </div>
                                <p className="mt-2 text-sm font-medium">{item.summary}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {formatDate(item.occurredAt)} · {item.actorType}
                                    {item.actorUserId ? ` ${item.actorUserId}` : ''}
                                </p>
                                <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">
                                    {JSON.stringify(item.evidence, null, 2)}
                                </pre>
                            </div>
                        ))}
                    </div>
                </SheetContent>
            </Sheet>

            <OperationDialog
                draft={draft}
                setDraft={setDraft}
                submit={() => draft && mutation.mutate(draft)}
                pending={mutation.isPending}
            />
        </Page>
    );
}

function OperationDialog({
    draft,
    setDraft,
    submit,
    pending,
}: {
    draft: OperationDraft | null;
    setDraft: (draft: OperationDraft | null) => void;
    submit: () => void;
    pending: boolean;
}) {
    const isReview = draft?.operation === 'REVIEW';
    return (
        <Dialog open={Boolean(draft)} onOpenChange={open => !open && setDraft(null)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{draft ? operationTitle(draft.operation) : ''}</DialogTitle>
                    <DialogDescription>该操作会记入不可编辑的事故证据链。</DialogDescription>
                </DialogHeader>
                {draft && (
                    <div className="space-y-4">
                        {isReview ? (
                            <>
                                <Field label="根因">
                                    <Textarea
                                        value={draft.rootCause}
                                        onChange={event =>
                                            setDraft({ ...draft, rootCause: event.target.value })
                                        }
                                        minLength={20}
                                    />
                                </Field>
                                <Field label="影响说明">
                                    <Textarea
                                        value={draft.impactSummary}
                                        onChange={event =>
                                            setDraft({ ...draft, impactSummary: event.target.value })
                                        }
                                        minLength={20}
                                    />
                                </Field>
                                <Field label="整改任务">
                                    <Input
                                        value={draft.actionTitle}
                                        onChange={event =>
                                            setDraft({ ...draft, actionTitle: event.target.value })
                                        }
                                    />
                                </Field>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="责任部门">
                                        <Input
                                            value={draft.ownerDepartmentCode}
                                            onChange={event =>
                                                setDraft({
                                                    ...draft,
                                                    ownerDepartmentCode: event.target.value.toUpperCase(),
                                                })
                                            }
                                        />
                                    </Field>
                                    <Field label="截止时间">
                                        <Input
                                            type="datetime-local"
                                            value={draft.dueAt}
                                            onChange={event =>
                                                setDraft({ ...draft, dueAt: event.target.value })
                                            }
                                        />
                                    </Field>
                                </div>
                            </>
                        ) : (
                            <Field label="处理说明">
                                <Textarea
                                    value={draft.note}
                                    onChange={event => setDraft({ ...draft, note: event.target.value })}
                                    minLength={10}
                                />
                            </Field>
                        )}
                    </div>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={() => setDraft(null)}>
                        取消
                    </Button>
                    <Button onClick={submit} disabled={pending || !validDraft(draft)}>
                        {pending ? '正在保存…' : '确认并留存证据'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <Label>{label}</Label>
            {children}
        </div>
    );
}
function validDraft(draft: OperationDraft | null) {
    if (!draft) return false;
    if (draft.operation !== 'REVIEW') return draft.note.trim().length >= 10;
    return (
        draft.rootCause.trim().length >= 20 &&
        draft.impactSummary.trim().length >= 20 &&
        draft.actionTitle.trim().length >= 5 &&
        Boolean(draft.ownerDepartmentCode) &&
        Boolean(draft.dueAt)
    );
}
function operationTitle(operation: Operation) {
    return {
        ACKNOWLEDGE: '确认接手事故',
        RECOVERY: '验证业务恢复',
        REVIEW: '提交事故复盘',
        ACTION: '完成整改任务',
    }[operation];
}
function statusLabel(status: string) {
    return (
        {
            OPEN: '待确认',
            ACKNOWLEDGED: '处理中',
            RECOVERY_PENDING: '待恢复验证',
            REVIEW_PENDING: '待复盘',
            ACTION_PENDING: '整改中',
            CLOSED: '已闭环',
        }[status] ?? status
    );
}
function formatDate(value: string) {
    return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
    );
}
function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : '未知错误';
}
