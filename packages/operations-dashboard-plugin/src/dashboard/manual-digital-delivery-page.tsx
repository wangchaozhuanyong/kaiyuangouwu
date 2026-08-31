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

const title = msg({ id: 'operations.manualDelivery.title', message: 'Manual digital delivery' });

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
        title: title.id,
        icon: Clock3,
        requiresPermission: ['ReadOrder'],
    },
    path: '/manual-digital-delivery',
    loader: () => ({ breadcrumb: () => title.id }),
    component: () => <ManualDigitalDeliveryPage />,
};

function ManualDigitalDeliveryPage() {
    const { t, i18n } = useLingui();
    const isZh = i18n.locale.toLowerCase().startsWith('zh');
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
                              label: isZh ? '账号' : 'Account',
                              value: item.account.trim(),
                              secret: false,
                          },
                      ]
                    : []),
                ...(item.password.trim()
                    ? [
                          {
                              key: 'password',
                              label: isZh ? '密码' : 'Password',
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
            toast.success(isZh ? '草稿已保存' : 'Draft saved');
            closeAndRefresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const publishMutation = useMutation({
        mutationFn: () => api.mutate(publishManualDigitalDeliveryMutation, { input: input() }),
        onSuccess: () => {
            toast.success(isZh ? '成品已进入邮件发送队列' : 'Delivery queued for email');
            closeAndRefresh();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const retryMutation = useMutation({
        mutationFn: (id: string) => api.mutate(retryManualDigitalDeliveryMutation, { id }),
        onSuccess: () => {
            toast.success(isZh ? '已使用原成品重新发送' : 'Original delivery queued again');
            void query.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });
    const items = query.data?.manualDigitalDeliveries.items ?? [];
    const isEditable = Boolean(selected && ['WAITING_PROCESSING', 'DRAFT'].includes(selected.state));

    return (
        <Page pageId="manual-digital-delivery">
            <PageTitle>{t(title)}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <Button variant="outline" onClick={() => void query.refetch()}>
                        <RefreshCw />
                        {isZh ? '刷新' : 'Refresh'}
                    </Button>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock
                    column="main"
                    blockId="manual-delivery-list"
                    title={isZh ? '待处理与发送记录' : 'Tasks and delivery history'}
                    description={
                        isZh
                            ? '按购买数量录入等量成品；发布前核对收件邮箱、商品和最终内容。'
                            : 'Enter exactly one package per purchased unit and verify the recipient before publishing.'
                    }
                >
                    {query.isPending ? (
                        <Skeleton className="h-64 w-full" />
                    ) : query.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription>
                                {isZh ? '人工交付任务加载失败' : 'Could not load manual delivery tasks'}
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{isZh ? '订单/商品' : 'Order / product'}</TableHead>
                                    <TableHead>{isZh ? '邮箱' : 'Email'}</TableHead>
                                    <TableHead>{isZh ? '数量' : 'Qty'}</TableHead>
                                    <TableHead>{isZh ? '时效' : 'SLA'}</TableHead>
                                    <TableHead>{isZh ? '状态' : 'Status'}</TableHead>
                                    <TableHead className="text-right">{isZh ? '操作' : 'Actions'}</TableHead>
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
                                                ? isZh
                                                    ? '已超时'
                                                    : 'Overdue'
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
                                                {stateLabel(item.state, isZh)}
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
                                                        ? isZh
                                                            ? '处理'
                                                            : 'Open'
                                                        : isZh
                                                          ? '查看'
                                                          : 'View'}
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
                                                        {isZh ? '重发原成品' : 'Resend'}
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
                        <DialogTitle>
                            {isZh ? '录入并发布人工成品' : 'Prepare and publish delivery'}
                        </DialogTitle>
                        <DialogDescription>
                            {selected
                                ? `${selected.order.code} · ${selected.productName} · ${selected.recipientEmail} · ${isZh ? '数量' : 'Qty'} ${selected.quantity}`
                                : ''}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {packages.map((item, index) => (
                            <section key={index} className="space-y-3 rounded-lg border p-4">
                                <strong>{isZh ? `第 ${index + 1} 份成品` : `Package ${index + 1}`}</strong>
                                <div className="grid gap-3 md:grid-cols-2">
                                    <Field
                                        disabled={!isEditable}
                                        label={isZh ? '账号（选填）' : 'Account (optional)'}
                                        value={item.account}
                                        onChange={value =>
                                            updatePackage(setPackages, packages, index, 'account', value)
                                        }
                                    />
                                    <Field
                                        disabled={!isEditable}
                                        label={isZh ? '密码/密钥（选填）' : 'Password / key (optional)'}
                                        value={item.password}
                                        onChange={value =>
                                            updatePackage(setPackages, packages, index, 'password', value)
                                        }
                                    />
                                </div>
                                <Label>
                                    {isZh ? '自由文本说明' : 'Instructions'}
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
                                    <Label>{isZh ? '附件' : 'Attachments'}</Label>
                                    <div className="flex flex-wrap gap-2">
                                        {item.attachmentAssetIds.map(assetId => (
                                            <Badge key={assetId} variant="secondary">
                                                Asset #{assetId}
                                                {isEditable && (
                                                    <button
                                                        type="button"
                                                        className="ml-1"
                                                        aria-label={isZh ? '移除附件' : 'Remove attachment'}
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
                                            {isZh ? '从素材库选择附件' : 'Select attachments'}
                                        </Button>
                                    )}
                                </div>
                            </section>
                        ))}
                    </div>
                    {selected && (
                        <section className="space-y-2 rounded-lg border bg-muted/30 p-4">
                            <strong>{isZh ? '最终邮件预览' : 'Final email preview'}</strong>
                            <p className="text-sm">
                                {isZh ? '收件人' : 'Recipient'}：{selected.recipientEmail}
                            </p>
                            <p className="text-sm">
                                {selected.productName} · {isZh ? '数量' : 'Qty'} {selected.quantity}
                            </p>
                            {packages.map((item, index) => (
                                <div key={index} className="rounded border bg-background p-2 text-sm">
                                    <strong>{isZh ? `第 ${index + 1} 份` : `Package ${index + 1}`}</strong>
                                    {item.account && (
                                        <p>
                                            {isZh ? '账号' : 'Account'}：{item.account}
                                        </p>
                                    )}
                                    {item.password && (
                                        <p>
                                            {isZh ? '密码/密钥' : 'Password / key'}：{item.password}
                                        </p>
                                    )}
                                    {item.note && <p className="whitespace-pre-wrap">{item.note}</p>}
                                    {item.attachmentAssetIds.length > 0 && (
                                        <p>
                                            {isZh ? '附件' : 'Attachments'}：
                                            {item.attachmentAssetIds.map(id => `#${id}`).join(', ')}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </section>
                    )}
                    {selected?.events.length ? (
                        <section className="space-y-2 rounded-lg border p-4">
                            <strong>{isZh ? '审计记录' : 'Audit trail'}</strong>
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
                                {isZh ? '保存草稿' : 'Save draft'}
                            </Button>
                            <Button
                                disabled={publishMutation.isPending || packages.length !== selected?.quantity}
                                onClick={() => publishMutation.mutate()}
                            >
                                <Send />
                                {isZh ? '预览已核对，发布邮件' : 'Verified, publish email'}
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
            <AssetPickerDialog
                open={assetPickerPackageIndex !== null}
                onClose={() => setAssetPickerPackageIndex(null)}
                multiSelect
                title={isZh ? '选择人工交付附件' : 'Select delivery attachments'}
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

function stateLabel(state: ManualDeliveryRecord['state'], isZh: boolean): string {
    const labels = isZh
        ? {
              WAITING_PROCESSING: '待处理',
              DRAFT: '草稿',
              SENDING: '发送中',
              SENT: '已交付',
              EMAIL_FAILED: '邮件失败',
              MANUAL_REVIEW: '人工核查',
              CANCELLED: '已取消',
          }
        : {
              WAITING_PROCESSING: 'Waiting',
              DRAFT: 'Draft',
              SENDING: 'Sending',
              SENT: 'Delivered',
              EMAIL_FAILED: 'Email failed',
              MANUAL_REVIEW: 'Manual review',
              CANCELLED: 'Cancelled',
          };
    return labels[state];
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
