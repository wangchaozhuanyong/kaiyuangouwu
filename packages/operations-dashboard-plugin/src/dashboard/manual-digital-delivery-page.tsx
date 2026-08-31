import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    AssetPickerDialog,
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
    Skeleton,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    Textarea,
    api,
    toast,
    useChannel,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { Clock3, Eye, Paperclip, RefreshCw, RotateCcw, Save, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
    ManualDeliveryRecord,
    manualDigitalDeliveriesQuery,
    publishManualDigitalDeliveryMutation,
    retryManualDigitalDeliveryMutation,
    saveManualDigitalDeliveryDraftMutation,
} from './manual-digital-delivery.graphql';

const messages = {
    title: msg({ id: 'operations.manualDelivery.title', message: 'Manual digital delivery' }),
    account: msg({ id: 'operations.manualDelivery.account', message: 'Account' }),
    password: msg({ id: 'operations.manualDelivery.password', message: 'Password' }),
    passwordKey: msg({ id: 'operations.manualDelivery.passwordKey', message: 'Password / key' }),
    draftSaved: msg({ id: 'operations.manualDelivery.draftSaved', message: 'Draft saved' }),
    deliveryQueued: msg({
        id: 'operations.manualDelivery.deliveryQueued',
        message: 'Delivery queued for email',
    }),
    originalDeliveryQueued: msg({
        id: 'operations.manualDelivery.originalDeliveryQueued',
        message: 'Original delivery queued again',
    }),
    refresh: msg({ id: 'operations.manualDelivery.refresh', message: 'Refresh' }),
    listTitle: msg({
        id: 'operations.manualDelivery.listTitle',
        message: 'Tasks and delivery history',
    }),
    listDescription: msg({
        id: 'operations.manualDelivery.listDescription',
        message: 'Enter exactly one package per purchased unit and verify the recipient before publishing.',
    }),
    loadError: msg({
        id: 'operations.manualDelivery.loadError',
        message: 'Could not load manual delivery tasks',
    }),
    orderProduct: msg({ id: 'operations.manualDelivery.orderProduct', message: 'Order / product' }),
    email: msg({ id: 'operations.manualDelivery.email', message: 'Email' }),
    quantity: msg({ id: 'operations.manualDelivery.quantity', message: 'Qty' }),
    sla: msg({ id: 'operations.manualDelivery.sla', message: 'SLA' }),
    status: msg({ id: 'operations.manualDelivery.status', message: 'Status' }),
    actions: msg({ id: 'operations.manualDelivery.actions', message: 'Actions' }),
    overdue: msg({ id: 'operations.manualDelivery.overdue', message: 'Overdue' }),
    open: msg({ id: 'operations.manualDelivery.open', message: 'Open' }),
    view: msg({ id: 'operations.manualDelivery.view', message: 'View' }),
    resend: msg({ id: 'operations.manualDelivery.resend', message: 'Resend original delivery' }),
    dialogTitle: msg({
        id: 'operations.manualDelivery.dialogTitle',
        message: 'Prepare and publish delivery',
    }),
    package: msg({ id: 'operations.manualDelivery.package', message: 'Package' }),
    accountOptional: msg({
        id: 'operations.manualDelivery.accountOptional',
        message: 'Account (optional)',
    }),
    passwordOptional: msg({
        id: 'operations.manualDelivery.passwordOptional',
        message: 'Password / key (optional)',
    }),
    instructions: msg({ id: 'operations.manualDelivery.instructions', message: 'Instructions' }),
    attachments: msg({ id: 'operations.manualDelivery.attachments', message: 'Attachments' }),
    asset: msg({ id: 'operations.manualDelivery.asset', message: 'Asset' }),
    removeAttachment: msg({
        id: 'operations.manualDelivery.removeAttachment',
        message: 'Remove attachment',
    }),
    selectAttachments: msg({
        id: 'operations.manualDelivery.selectAttachments',
        message: 'Select attachments',
    }),
    finalPreview: msg({
        id: 'operations.manualDelivery.finalPreview',
        message: 'Final email preview',
    }),
    recipient: msg({ id: 'operations.manualDelivery.recipient', message: 'Recipient' }),
    auditTrail: msg({ id: 'operations.manualDelivery.auditTrail', message: 'Audit trail' }),
    saveDraft: msg({ id: 'operations.manualDelivery.saveDraft', message: 'Save draft' }),
    verifiedPublish: msg({
        id: 'operations.manualDelivery.verifiedPublish',
        message: 'Verified, publish email',
    }),
    selectDeliveryAttachments: msg({
        id: 'operations.manualDelivery.selectDeliveryAttachments',
        message: 'Select delivery attachments',
    }),
    stateWaiting: msg({ id: 'operations.manualDelivery.state.waiting', message: 'Waiting' }),
    stateDraft: msg({ id: 'operations.manualDelivery.state.draft', message: 'Draft' }),
    stateSending: msg({ id: 'operations.manualDelivery.state.sending', message: 'Sending' }),
    stateSent: msg({ id: 'operations.manualDelivery.state.sent', message: 'Delivered' }),
    stateEmailFailed: msg({
        id: 'operations.manualDelivery.state.emailFailed',
        message: 'Email failed',
    }),
    stateManualReview: msg({
        id: 'operations.manualDelivery.state.manualReview',
        message: 'Manual review',
    }),
    stateCancelled: msg({ id: 'operations.manualDelivery.state.cancelled', message: 'Cancelled' }),
};

type ManualDeliveryText = { [key in keyof typeof messages]: string };

interface PackageDraft {
    account: string;
    password: string;
    note: string;
    attachmentAssetIds: string[];
}

export const manualDigitalDeliveryRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'sales',
        id: 'manual-digital-delivery',
        url: '/manual-digital-delivery',
        title: messages.title.id,
        icon: Clock3,
        requiresPermission: ['ReadOrder'],
    },
    path: '/manual-digital-delivery',
    loader: () => ({ breadcrumb: () => messages.title.id }),
    component: () => <ManualDigitalDeliveryPage />,
};

function ManualDigitalDeliveryPage() {
    const { t } = useLingui();
    const text = translateMessages(t);
    const { activeChannel } = useChannel();
    const [selected, setSelected] = useState<ManualDeliveryRecord | null>(null);
    const [packages, setPackages] = useState<PackageDraft[]>([]);
    const [assetPickerPackageIndex, setAssetPickerPackageIndex] = useState<number | null>(null);
    const query = useQuery({
        queryKey: ['manual-digital-deliveries', activeChannel?.id],
        queryFn: () =>
            api.query<{ manualDigitalDeliveries: { items: ManualDeliveryRecord[]; totalItems: number } }>(
                manualDigitalDeliveriesQuery,
                { options: { take: 100 } },
            ),
        enabled: Boolean(activeChannel?.id),
    });

    useEffect(() => {
        if (!selected) return;
        setPackages(
            Array.from({ length: selected.quantity }, (_, index) => {
                const saved = selected.packages[index];
                return {
                    account: saved?.fields.find(field => field.key === 'account')?.value ?? '',
                    password: saved?.fields.find(field => field.key === 'password')?.value ?? '',
                    note: saved?.note ?? '',
                    attachmentAssetIds: saved?.attachmentAssetIds ?? [],
                };
            }),
        );
    }, [selected]);

    const input = () => ({
        id: selected?.id,
        packages: packages.map(item => ({
            fields: [
                ...(item.account.trim()
                    ? [
                          {
                              key: 'account',
                              label: text.account,
                              value: item.account.trim(),
                              secret: false,
                          },
                      ]
                    : []),
                ...(item.password.trim()
                    ? [
                          {
                              key: 'password',
                              label: text.password,
                              value: item.password.trim(),
                              secret: true,
                          },
                      ]
                    : []),
            ],
            note: item.note,
            attachmentAssetIds: item.attachmentAssetIds,
        })),
    });
    const closeAndRefresh = () => {
        setSelected(null);
        void query.refetch();
    };
    const saveMutation = useMutation({
        mutationFn: () => api.mutate(saveManualDigitalDeliveryDraftMutation, { input: input() }),
        onSuccess: () => {
            toast.success(text.draftSaved);
            closeAndRefresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const publishMutation = useMutation({
        mutationFn: () => api.mutate(publishManualDigitalDeliveryMutation, { input: input() }),
        onSuccess: () => {
            toast.success(text.deliveryQueued);
            closeAndRefresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const retryMutation = useMutation({
        mutationFn: (id: string) => api.mutate(retryManualDigitalDeliveryMutation, { id }),
        onSuccess: () => {
            toast.success(text.originalDeliveryQueued);
            void query.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const items = query.data?.manualDigitalDeliveries.items ?? [];
    const isEditable = Boolean(selected && ['WAITING_PROCESSING', 'DRAFT'].includes(selected.state));

    return (
        <Page pageId="manual-digital-delivery">
            <PageTitle>{text.title}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" onClick={() => void query.refetch()}>
                        <RefreshCw />
                        {text.refresh}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="main"
                    blockId="manual-delivery-list"
                    title={text.listTitle}
                    description={text.listDescription}
                >
                    {query.isPending ? (
                        <Skeleton className="h-64 w-full" />
                    ) : query.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription>{text.loadError}</AlertDescription>
                        </Alert>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{text.orderProduct}</TableHead>
                                    <TableHead>{text.email}</TableHead>
                                    <TableHead>{text.quantity}</TableHead>
                                    <TableHead>{text.sla}</TableHead>
                                    <TableHead>{text.status}</TableHead>
                                    <TableHead className="text-right">{text.actions}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map(item => (
                                    <TableRow key={item.id}>
                                        <TableCell>
                                            <strong className="block">{item.productName}</strong>
                                            <span className="text-xs text-muted-foreground">
                                                {item.order.code} · {item.sku}
                                            </span>
                                        </TableCell>
                                        <TableCell className="max-w-56 break-all">
                                            {item.recipientEmail}
                                        </TableCell>
                                        <TableCell>{item.quantity}</TableCell>
                                        <TableCell className={item.overdue ? 'text-destructive' : ''}>
                                            {item.overdue
                                                ? text.overdue
                                                : new Date(item.expectedAt).toLocaleString()}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant={
                                                    item.state === 'SENT'
                                                        ? 'secondary'
                                                        : item.overdue
                                                          ? 'destructive'
                                                          : 'outline'
                                                }
                                            >
                                                {stateLabel(item.state, text)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => setSelected(item)}
                                                >
                                                    <Eye />
                                                    {['WAITING_PROCESSING', 'DRAFT'].includes(item.state)
                                                        ? text.open
                                                        : text.view}
                                                </Button>
                                                {['EMAIL_FAILED', 'MANUAL_REVIEW', 'SENT'].includes(
                                                    item.state,
                                                ) && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={retryMutation.isPending}
                                                        onClick={() => retryMutation.mutate(item.id)}
                                                    >
                                                        <RotateCcw />
                                                        {text.resend}
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </PageBlock>
            </PageLayout>
            <Dialog open={Boolean(selected)} onOpenChange={open => !open && setSelected(null)}>
                <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{text.dialogTitle}</DialogTitle>
                        <DialogDescription>
                            {selected
                                ? `${selected.order.code} · ${selected.productName} · ${selected.recipientEmail} · ${text.quantity} ${selected.quantity}`
                                : ''}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {packages.map((item, index) => (
                            <section key={index} className="space-y-3 rounded-lg border p-4">
                                <strong>
                                    {text.package} {index + 1}
                                </strong>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <Field
                                        disabled={!isEditable}
                                        label={text.accountOptional}
                                        value={item.account}
                                        onChange={value =>
                                            updatePackage(setPackages, packages, index, 'account', value)
                                        }
                                    />
                                    <Field
                                        disabled={!isEditable}
                                        label={text.passwordOptional}
                                        value={item.password}
                                        onChange={value =>
                                            updatePackage(setPackages, packages, index, 'password', value)
                                        }
                                    />
                                </div>
                                <Label>
                                    {text.instructions}
                                    <Textarea
                                        disabled={!isEditable}
                                        className="mt-2"
                                        value={item.note}
                                        onChange={event =>
                                            updatePackage(
                                                setPackages,
                                                packages,
                                                index,
                                                'note',
                                                event.target.value,
                                            )
                                        }
                                    />
                                </Label>
                                <div className="space-y-2">
                                    <Label>{text.attachments}</Label>
                                    <div className="flex flex-wrap gap-2">
                                        {item.attachmentAssetIds.map(assetId => (
                                            <Badge key={assetId} variant="secondary">
                                                {text.asset} #{assetId}
                                                {isEditable && (
                                                    <button
                                                        type="button"
                                                        className="ml-1"
                                                        aria-label={text.removeAttachment}
                                                        onClick={() =>
                                                            updatePackage(
                                                                setPackages,
                                                                packages,
                                                                index,
                                                                'attachmentAssetIds',
                                                                item.attachmentAssetIds.filter(
                                                                    id => id !== assetId,
                                                                ),
                                                            )
                                                        }
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                )}
                                            </Badge>
                                        ))}
                                    </div>
                                    {isEditable && (
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setAssetPickerPackageIndex(index)}
                                        >
                                            <Paperclip />
                                            {text.selectAttachments}
                                        </Button>
                                    )}
                                </div>
                            </section>
                        ))}
                    </div>
                    {selected && (
                        <section className="space-y-2 rounded-lg border bg-muted/30 p-4">
                            <strong>{text.finalPreview}</strong>
                            <p className="text-sm">
                                {text.recipient}: {selected.recipientEmail}
                            </p>
                            <p className="text-sm">
                                {selected.productName} · {text.quantity} {selected.quantity}
                            </p>
                            {packages.map((item, index) => (
                                <div key={index} className="rounded border bg-background p-2 text-sm">
                                    <strong>
                                        {text.package} {index + 1}
                                    </strong>
                                    {item.account && (
                                        <p>
                                            {text.account}: {item.account}
                                        </p>
                                    )}
                                    {item.password && (
                                        <p>
                                            {text.passwordKey}: {item.password}
                                        </p>
                                    )}
                                    {item.note && <p className="whitespace-pre-wrap">{item.note}</p>}
                                    {item.attachmentAssetIds.length > 0 && (
                                        <p>
                                            {text.attachments}:{' '}
                                            {item.attachmentAssetIds.map(id => `#${id}`).join(', ')}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </section>
                    )}
                    {selected?.events.length ? (
                        <section className="space-y-2 rounded-lg border p-4">
                            <strong>{text.auditTrail}</strong>
                            {selected.events.map(event => (
                                <div
                                    key={event.id}
                                    className="flex flex-wrap justify-between gap-2 border-t pt-2 text-sm"
                                >
                                    <span>{event.note}</span>
                                    <span className="text-muted-foreground">
                                        {new Date(event.createdAt).toLocaleString()} · {event.actorType}
                                    </span>
                                </div>
                            ))}
                        </section>
                    ) : null}
                    {isEditable && (
                        <DialogFooter>
                            <Button
                                variant="outline"
                                disabled={saveMutation.isPending}
                                onClick={() => saveMutation.mutate()}
                            >
                                <Save />
                                {text.saveDraft}
                            </Button>
                            <Button
                                disabled={publishMutation.isPending || packages.length !== selected?.quantity}
                                onClick={() => publishMutation.mutate()}
                            >
                                <Send />
                                {text.verifiedPublish}
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
            <AssetPickerDialog
                open={assetPickerPackageIndex !== null}
                onClose={() => setAssetPickerPackageIndex(null)}
                multiSelect
                title={text.selectDeliveryAttachments}
                onSelect={assets => {
                    if (assetPickerPackageIndex === null) return;
                    const current = packages[assetPickerPackageIndex]?.attachmentAssetIds ?? [];
                    updatePackage(setPackages, packages, assetPickerPackageIndex, 'attachmentAssetIds', [
                        ...new Set([...current, ...assets.map(asset => String(asset.id))]),
                    ]);
                }}
            />
        </Page>
    );
}

function Field({
    label,
    value,
    onChange,
    disabled = false,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    return (
        <Label>
            {label}
            <Input
                disabled={disabled}
                className="mt-2"
                value={value}
                onChange={event => onChange(event.target.value)}
            />
        </Label>
    );
}

function updatePackage<K extends keyof PackageDraft>(
    setter: (value: PackageDraft[]) => void,
    items: PackageDraft[],
    index: number,
    key: K,
    value: PackageDraft[K],
) {
    setter(items.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)));
}

function stateLabel(state: ManualDeliveryRecord['state'], text: ManualDeliveryText): string {
    const labels: Record<ManualDeliveryRecord['state'], string> = {
        WAITING_PROCESSING: text.stateWaiting,
        DRAFT: text.stateDraft,
        SENDING: text.stateSending,
        SENT: text.stateSent,
        EMAIL_FAILED: text.stateEmailFailed,
        MANUAL_REVIEW: text.stateManualReview,
        CANCELLED: text.stateCancelled,
    };
    return labels[state];
}

function translateMessages(t: ReturnType<typeof useLingui>['t']): ManualDeliveryText {
    return Object.fromEntries(
        Object.entries(messages).map(([key, descriptor]) => [key, t(descriptor)]),
    ) as ManualDeliveryText;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
