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
const messages = {
    updated: msg({ id: 'operations.incidents.updated', message: 'Incident workflow updated' }),
    refresh: msg({ id: 'operations.incidents.refresh', message: 'Refresh' }),
    heading: msg({ id: 'operations.incidents.heading', message: 'Incident handling and evidence closure' }),
    description: msg({
        id: 'operations.incidents.description',
        message:
            'P0/P1 incidents require acknowledgement, recovery validation, review, and corrective action. Telegram is only a notification channel.',
    }),
    workflowStatus: msg({ id: 'operations.incidents.workflowStatus', message: 'Workflow status' }),
    active: msg({ id: 'operations.incidents.active', message: 'Open incidents' }),
    all: msg({ id: 'operations.incidents.all', message: 'All' }),
    severity: msg({ id: 'operations.incidents.severity', message: 'Severity' }),
    allSeverities: msg({ id: 'operations.incidents.allSeverities', message: 'All severities' }),
    empty: msg({ id: 'operations.incidents.empty', message: 'No incidents match this filter.' }),
    occurrences: msg({ id: 'operations.incidents.occurrences', message: 'occurrences' }),
    evidence: msg({ id: 'operations.incidents.evidence', message: 'Evidence' }),
    acknowledge: msg({ id: 'operations.incidents.acknowledge', message: 'Acknowledge' }),
    validateRecovery: msg({ id: 'operations.incidents.validateRecovery', message: 'Validate recovery' }),
    submitReview: msg({ id: 'operations.incidents.submitReview', message: 'Submit review' }),
    complete: msg({ id: 'operations.incidents.complete', message: 'Complete' }),
    evidenceChain: msg({ id: 'operations.incidents.evidenceChain', message: 'Incident evidence chain' }),
    evidenceDescription: msg({
        id: 'operations.incidents.evidenceDescription',
        message: 'Evidence hashes are verified in real time. Any mismatch is shown as an integrity failure.',
    }),
    valid: msg({ id: 'operations.incidents.valid', message: 'Valid' }),
    hashMismatch: msg({ id: 'operations.incidents.hashMismatch', message: 'Hash mismatch' }),
    immutableNote: msg({
        id: 'operations.incidents.immutableNote',
        message: 'This action is recorded in the immutable incident evidence chain.',
    }),
    rootCause: msg({ id: 'operations.incidents.rootCause', message: 'Root cause' }),
    impact: msg({ id: 'operations.incidents.impact', message: 'Impact summary' }),
    correctiveAction: msg({ id: 'operations.incidents.correctiveAction', message: 'Corrective action' }),
    ownerDepartment: msg({ id: 'operations.incidents.ownerDepartment', message: 'Owner department' }),
    dueAt: msg({ id: 'operations.incidents.dueAt', message: 'Due date' }),
    actionNote: msg({ id: 'operations.incidents.actionNote', message: 'Action note' }),
    cancel: msg({ id: 'operations.incidents.cancel', message: 'Cancel' }),
    saving: msg({ id: 'operations.incidents.saving', message: 'Saving…' }),
    confirm: msg({ id: 'operations.incidents.confirm', message: 'Confirm and retain evidence' }),
    acknowledgeTitle: msg({ id: 'operations.incidents.acknowledgeTitle', message: 'Acknowledge incident' }),
    recoveryTitle: msg({ id: 'operations.incidents.recoveryTitle', message: 'Validate business recovery' }),
    reviewTitle: msg({ id: 'operations.incidents.reviewTitle', message: 'Submit incident review' }),
    actionTitle: msg({ id: 'operations.incidents.actionTitle', message: 'Complete corrective action' }),
    statusOpen: msg({ id: 'operations.incidents.statusOpen', message: 'Awaiting acknowledgement' }),
    statusAcknowledged: msg({ id: 'operations.incidents.statusAcknowledged', message: 'In progress' }),
    statusRecovery: msg({
        id: 'operations.incidents.statusRecovery',
        message: 'Awaiting recovery validation',
    }),
    statusReview: msg({ id: 'operations.incidents.statusReview', message: 'Awaiting review' }),
    statusAction: msg({ id: 'operations.incidents.statusAction', message: 'Corrective action in progress' }),
    statusClosed: msg({ id: 'operations.incidents.statusClosed', message: 'Closed' }),
    unknownError: msg({ id: 'operations.incidents.unknownError', message: 'Unknown error' }),
};

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
    const { t } = useLingui();
    const statusLabels: Record<string, string> = {
        OPEN: t(messages.statusOpen),
        ACKNOWLEDGED: t(messages.statusAcknowledged),
        RECOVERY_PENDING: t(messages.statusRecovery),
        REVIEW_PENDING: t(messages.statusReview),
        ACTION_PENDING: t(messages.statusAction),
        CLOSED: t(messages.statusClosed),
    };
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
            toast.success(t(messages.updated));
            setDraft(null);
            await list.refetch();
            if (selectedId) await detail.refetch();
        },
        onError: error => toast.error(errorMessage(error, t(messages.unknownError))),
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
            <PageTitle>{title.id}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" onClick={() => void list.refetch()} disabled={list.isFetching}>
                        <RefreshCw className={list.isFetching ? 'animate-spin' : ''} />
                        {t(messages.refresh)}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="incident-response-list">
                    <div className="mb-4 grid gap-3 md:grid-cols-[1fr_180px_140px] md:items-end">
                        <div>
                            <h2 className="text-lg font-semibold">{t(messages.heading)}</h2>
                            <p className="text-sm text-muted-foreground">{t(messages.description)}</p>
                        </div>
                        <Select value={status} onValueChange={value => value && setStatus(value)}>
                            <SelectTrigger>
                                <SelectValue placeholder={t(messages.workflowStatus)} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ACTIVE">{t(messages.active)}</SelectItem>
                                <SelectItem value="ALL">{t(messages.all)}</SelectItem>
                                {[
                                    'OPEN',
                                    'ACKNOWLEDGED',
                                    'RECOVERY_PENDING',
                                    'REVIEW_PENDING',
                                    'ACTION_PENDING',
                                    'CLOSED',
                                ].map(value => (
                                    <SelectItem key={value} value={value}>
                                        {statusLabels[value] ?? value}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={severity} onValueChange={value => value && setSeverity(value)}>
                            <SelectTrigger>
                                <SelectValue placeholder={t(messages.severity)} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">{t(messages.allSeverities)}</SelectItem>
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
                            <AlertDescription>
                                {errorMessage(list.error, t(messages.unknownError))}
                            </AlertDescription>
                        </Alert>
                    )}
                    {!list.isLoading && !incidents.length && (
                        <Alert>
                            <CheckCircle2 />
                            <AlertDescription>{t(messages.empty)}</AlertDescription>
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
                                                {statusLabels[incident.incidentStatus] ??
                                                    incident.incidentStatus}
                                            </Badge>
                                            <span className="text-xs font-medium text-muted-foreground">
                                                {incident.ownerDepartmentCode}
                                            </span>
                                        </div>
                                        <h3 className="mt-2 font-semibold">{incident.title}</h3>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {incident.eventType} · {incident.occurrenceCount}{' '}
                                            {t(messages.occurrences)} · {formatDate(incident.lastOccurredAt)}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setSelectedId(incident.id)}
                                        >
                                            <Eye />
                                            {t(messages.evidence)}
                                        </Button>
                                        {incident.incidentStatus === 'OPEN' && (
                                            <Button
                                                size="sm"
                                                onClick={() => openOperation('ACKNOWLEDGE', incident)}
                                            >
                                                {t(messages.acknowledge)}
                                            </Button>
                                        )}
                                        {incident.incidentStatus === 'RECOVERY_PENDING' && (
                                            <Button
                                                size="sm"
                                                onClick={() => openOperation('RECOVERY', incident)}
                                            >
                                                {t(messages.validateRecovery)}
                                            </Button>
                                        )}
                                        {incident.incidentStatus === 'REVIEW_PENDING' && (
                                            <Button
                                                size="sm"
                                                onClick={() => openOperation('REVIEW', incident)}
                                            >
                                                {t(messages.submitReview)}
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
                                                        {t(messages.complete)}
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
                        <SheetTitle>{t(messages.evidenceChain)}</SheetTitle>
                        <SheetDescription>{t(messages.evidenceDescription)}</SheetDescription>
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
                                            {t(messages.valid)}
                                        </span>
                                    ) : (
                                        <span className="text-xs font-semibold text-destructive">
                                            {t(messages.hashMismatch)}
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
    const { t } = useLingui();
    const operationTitles: Record<Operation, string> = {
        ACKNOWLEDGE: t(messages.acknowledgeTitle),
        RECOVERY: t(messages.recoveryTitle),
        REVIEW: t(messages.reviewTitle),
        ACTION: t(messages.actionTitle),
    };
    const isReview = draft?.operation === 'REVIEW';
    return (
        <Dialog open={Boolean(draft)} onOpenChange={open => !open && setDraft(null)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{draft ? operationTitles[draft.operation] : ''}</DialogTitle>
                    <DialogDescription>{t(messages.immutableNote)}</DialogDescription>
                </DialogHeader>
                {draft && (
                    <div className="space-y-4">
                        {isReview ? (
                            <>
                                <Field label={t(messages.rootCause)}>
                                    <Textarea
                                        value={draft.rootCause}
                                        onChange={event =>
                                            setDraft({ ...draft, rootCause: event.target.value })
                                        }
                                        minLength={20}
                                    />
                                </Field>
                                <Field label={t(messages.impact)}>
                                    <Textarea
                                        value={draft.impactSummary}
                                        onChange={event =>
                                            setDraft({ ...draft, impactSummary: event.target.value })
                                        }
                                        minLength={20}
                                    />
                                </Field>
                                <Field label={t(messages.correctiveAction)}>
                                    <Input
                                        value={draft.actionTitle}
                                        onChange={event =>
                                            setDraft({ ...draft, actionTitle: event.target.value })
                                        }
                                    />
                                </Field>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label={t(messages.ownerDepartment)}>
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
                                    <Field label={t(messages.dueAt)}>
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
                            <Field label={t(messages.actionNote)}>
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
                        {t(messages.cancel)}
                    </Button>
                    <Button onClick={submit} disabled={pending || !validDraft(draft)}>
                        {pending ? t(messages.saving) : t(messages.confirm)}
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
function formatDate(value: string) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
    );
}
function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error ? error.message : fallback;
}
