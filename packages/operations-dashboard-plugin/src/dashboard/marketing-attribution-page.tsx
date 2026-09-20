import { msg } from '@lingui/core/macro';
import {
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
    api,
    toast,
    useChannel,
    useMutation,
    usePermissions,
    useQuery,
} from '@vendure/dashboard';
import { BarChart3, Plus, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
    MarketingAttributionResult,
    marketingAttributionQuery,
    recordMarketingCostMutation,
} from './marketing-attribution.graphql';

const title = msg({ id: 'operations.marketingAttribution.title', message: 'Marketing attribution' });

export const marketingAttributionRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'marketing',
        id: 'marketing-attribution',
        url: '/marketing-attribution',
        title: title.id,
        icon: BarChart3,
        requiresPermission: ['ReadOrder', 'ReadPromotion'],
    },
    path: '/marketing-attribution',
    loader: () => ({ breadcrumb: () => title.id }),
    component: () => <MarketingAttributionPage />,
};

function MarketingAttributionPage() {
    const initial = useMemo(() => defaultRange(), []);
    const [from, setFrom] = useState(initial.from);
    const [to, setTo] = useState(initial.to);
    const [costOpen, setCostOpen] = useState(false);
    const { activeChannel } = useChannel();
    const permissions = usePermissions();
    const canUpdate = permissions.hasPermissions(['UpdatePromotion']);
    const currencyCode = activeChannel?.defaultCurrencyCode ?? 'CNY';
    const range = isoRange(from, to);
    const report = useQuery({
        queryKey: ['marketing-attribution', from, to, currencyCode],
        queryFn: () =>
            api.query<MarketingAttributionResult>(marketingAttributionQuery, {
                input: { from: range?.from, to: range?.to, currencyCode },
            }),
        enabled: Boolean(range),
    });
    const data = report.data?.marketingAttributionReport;
    const summary = data?.summary;

    return (
        <Page pageId="marketing-attribution">
            <PageTitle>{title.id}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <div className="flex items-end gap-2">
                        <DateField label="From" value={from} onChange={setFrom} />
                        <DateField label="To" value={to} onChange={setTo} />
                        <Button
                            variant="outline"
                            onClick={() => void report.refetch()}
                            disabled={report.isFetching}
                        >
                            <RefreshCw className={report.isFetching ? 'animate-spin' : ''} />
                            Refresh
                        </Button>
                        {canUpdate && (
                            <Button onClick={() => setCostOpen(true)}>
                                <Plus /> Record campaign cost
                            </Button>
                        )}
                    </div>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="marketing-attribution-summary">
                    <p className="mb-4 text-sm text-muted-foreground">
                        Last non-direct touch within 30 days. Order attribution is frozen after payment
                        settles; revenue and return metrics deduct settled refunds.
                    </p>
                    <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
                        <Metric label="Visitors" value={summary ? String(summary.visitorCount) : '—'} />
                        <Metric
                            label="Product views"
                            value={summary ? String(summary.productViewCount) : '—'}
                        />
                        <Metric
                            label="Checkout views"
                            value={summary ? String(summary.checkoutViewCount) : '—'}
                        />
                        <Metric label="Orders" value={summary ? String(summary.orderCount) : '—'} />
                        <Metric
                            label="Net revenue"
                            value={summary ? money(summary.netRevenueMicrounits, currencyCode) : '—'}
                        />
                        <Metric
                            label="Campaign cost"
                            value={summary ? money(summary.campaignCostMicrounits, currencyCode) : '—'}
                        />
                        <Metric label="Refund-adjusted ROAS" value={ratio(summary?.refundAdjustedRoas)} />
                        <Metric label="Refund-adjusted ROI" value={percent(summary?.refundAdjustedRoi)} />
                    </div>
                </PageBlock>
                <PageBlock column="main" blockId="marketing-attribution-table">
                    {report.isLoading ? (
                        <Skeleton className="h-48 w-full" />
                    ) : report.error ? (
                        <p className="text-sm text-destructive">{String(report.error)}</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="border-b text-xs text-muted-foreground">
                                    <tr>
                                        {[
                                            'Source / medium',
                                            'Campaign',
                                            'Search terms',
                                            'Visitors',
                                            'Product / checkout',
                                            'Orders',
                                            'Conversion',
                                            'Net revenue',
                                            'Cost',
                                            'ROAS',
                                            'ROI',
                                        ].map(label => (
                                            <th key={label} className="whitespace-nowrap p-2">
                                                {label}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {(data?.items ?? []).map(item => (
                                        <tr key={`${item.source}:${item.medium}:${item.campaign}`}>
                                            <td className="p-2 font-medium">
                                                {item.source} / {item.medium}
                                            </td>
                                            <td className="p-2">{item.campaign}</td>
                                            <td className="max-w-64 p-2">
                                                {item.searchTerms.join(', ') || '—'}
                                            </td>
                                            <td className="p-2 tabular-nums">{item.visitorCount}</td>
                                            <td className="p-2 tabular-nums">
                                                {item.productViewCount} / {item.checkoutViewCount}
                                            </td>
                                            <td className="p-2 tabular-nums">{item.orderCount}</td>
                                            <td className="p-2 tabular-nums">
                                                {percent(item.conversionRate)}
                                            </td>
                                            <td className="p-2 tabular-nums">
                                                {money(item.netRevenueMicrounits, currencyCode)}
                                            </td>
                                            <td className="p-2 tabular-nums">
                                                {money(item.campaignCostMicrounits, currencyCode)}
                                            </td>
                                            <td className="p-2 tabular-nums">
                                                {ratio(item.refundAdjustedRoas)}
                                            </td>
                                            <td className="p-2 tabular-nums">
                                                {percent(item.refundAdjustedRoi)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </PageBlock>
            </PageLayout>
            <CostDialog
                open={costOpen}
                onOpenChange={setCostOpen}
                currencyCode={currencyCode}
                onSaved={() => report.refetch()}
            />
        </Page>
    );
}

function CostDialog({
    open,
    onOpenChange,
    currencyCode,
    onSaved,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currencyCode: string;
    onSaved: () => Promise<unknown>;
}) {
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [source, setSource] = useState('google');
    const [medium, setMedium] = useState('cpc');
    const [campaign, setCampaign] = useState('');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const mutation = useMutation({
        mutationFn: () =>
            api.mutate(recordMarketingCostMutation, {
                input: {
                    businessDate: date,
                    currencyCode,
                    source,
                    medium,
                    campaign,
                    amountMicrounits: signedMicrounits(amount),
                    idempotencyKey: `dashboard:${crypto.randomUUID()}`,
                    reason,
                },
            }),
        onSuccess: async () => {
            toast.success('Campaign cost appended');
            onOpenChange(false);
            await onSaved();
        },
        onError: error => toast.error(String(error)),
    });
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Record campaign cost</DialogTitle>
                    <DialogDescription>
                        Append-only ledger. Record a negative amount to correct a prior entry.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Business date" value={date} onChange={setDate} type="date" />
                    <Field label={`Amount (${currencyCode})`} value={amount} onChange={setAmount} />
                    <Field label="Source" value={source} onChange={setSource} />
                    <Field label="Medium" value={medium} onChange={setMedium} />
                    <Field label="Campaign" value={campaign} onChange={setCampaign} />
                    <Field label="Reason / invoice" value={reason} onChange={setReason} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                        Append cost
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function Field({
    label,
    value,
    onChange,
    type = 'text',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
}) {
    return (
        <div className="space-y-1">
            <Label>{label}</Label>
            <Input type={type} value={value} onChange={event => onChange(event.target.value)} />
        </div>
    );
}

function DateField(props: { label: string; value: string; onChange: (value: string) => void }) {
    return <Field {...props} type="date" />;
}
function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 truncate font-semibold tabular-nums" title={value}>
                {value}
            </div>
        </div>
    );
}
function defaultRange() {
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 86_400_000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
function isoRange(from: string, to: string) {
    return !from || !to || from > to ? null : { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` };
}
function signedMicrounits(value: string) {
    const normalized = value.trim().replace(/,/gu, '');
    if (!/^-?\d+(?:\.\d{1,3})?$/u.test(normalized))
        throw new Error('Amount must be non-zero with at most three decimals');
    const result = Math.round(Number(normalized) * 1_000);
    if (!Number.isSafeInteger(result) || result === 0) throw new Error('Amount is invalid');
    return result;
}
function money(value: number, currency: string) {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(value / 1_000);
}
function percent(value?: number | null) {
    return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}
function ratio(value?: number | null) {
    return value == null ? '—' : `${value.toFixed(2)}x`;
}
