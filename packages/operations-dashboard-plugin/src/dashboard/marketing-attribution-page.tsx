import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
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
const messages = {
    from: msg({ id: 'operations.marketingAttribution.from', message: 'From' }),
    to: msg({ id: 'operations.marketingAttribution.to', message: 'To' }),
    refresh: msg({ id: 'operations.marketingAttribution.refresh', message: 'Refresh' }),
    recordCost: msg({ id: 'operations.marketingAttribution.recordCost', message: 'Record campaign cost' }),
    description: msg({
        id: 'operations.marketingAttribution.description',
        message:
            'Last non-direct touch within 30 days. Order attribution is frozen after payment settles; revenue and return metrics deduct settled refunds.',
    }),
    visitors: msg({ id: 'operations.marketingAttribution.visitors', message: 'Visitors' }),
    productViews: msg({ id: 'operations.marketingAttribution.productViews', message: 'Product views' }),
    checkoutViews: msg({ id: 'operations.marketingAttribution.checkoutViews', message: 'Checkout views' }),
    orders: msg({ id: 'operations.marketingAttribution.orders', message: 'Orders' }),
    netRevenue: msg({ id: 'operations.marketingAttribution.netRevenue', message: 'Net revenue' }),
    campaignCost: msg({ id: 'operations.marketingAttribution.campaignCost', message: 'Campaign cost' }),
    refundAdjustedRoas: msg({
        id: 'operations.marketingAttribution.refundAdjustedRoas',
        message: 'Refund-adjusted ROAS',
    }),
    refundAdjustedRoi: msg({
        id: 'operations.marketingAttribution.refundAdjustedRoi',
        message: 'Refund-adjusted ROI',
    }),
    sourceMedium: msg({ id: 'operations.marketingAttribution.sourceMedium', message: 'Source / medium' }),
    campaign: msg({ id: 'operations.marketingAttribution.campaign', message: 'Campaign' }),
    searchTerms: msg({ id: 'operations.marketingAttribution.searchTerms', message: 'Search terms' }),
    productCheckout: msg({
        id: 'operations.marketingAttribution.productCheckout',
        message: 'Product / checkout',
    }),
    conversion: msg({ id: 'operations.marketingAttribution.conversion', message: 'Conversion' }),
    cost: msg({ id: 'operations.marketingAttribution.cost', message: 'Cost' }),
    ledgerHint: msg({
        id: 'operations.marketingAttribution.ledgerHint',
        message: 'Append-only ledger. Record a negative amount to correct a prior entry.',
    }),
    businessDate: msg({ id: 'operations.marketingAttribution.businessDate', message: 'Business date' }),
    amount: msg({ id: 'operations.marketingAttribution.amount', message: 'Amount' }),
    source: msg({ id: 'operations.marketingAttribution.source', message: 'Source' }),
    medium: msg({ id: 'operations.marketingAttribution.medium', message: 'Medium' }),
    reasonInvoice: msg({ id: 'operations.marketingAttribution.reasonInvoice', message: 'Reason / invoice' }),
    cancel: msg({ id: 'operations.marketingAttribution.cancel', message: 'Cancel' }),
    appendCost: msg({ id: 'operations.marketingAttribution.appendCost', message: 'Append cost' }),
    costAppended: msg({
        id: 'operations.marketingAttribution.costAppended',
        message: 'Campaign cost appended',
    }),
    invalidAmount: msg({
        id: 'operations.marketingAttribution.invalidAmount',
        message: 'Amount must be non-zero with at most three decimals',
    }),
    amountError: msg({ id: 'operations.marketingAttribution.amountError', message: 'Amount is invalid' }),
};

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
    const { t } = useLingui();
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
                        <DateField label={t(messages.from)} value={from} onChange={setFrom} />
                        <DateField label={t(messages.to)} value={to} onChange={setTo} />
                        <Button
                            variant="outline"
                            onClick={() => void report.refetch()}
                            disabled={report.isFetching}
                        >
                            <RefreshCw className={report.isFetching ? 'animate-spin' : ''} />
                            {t(messages.refresh)}
                        </Button>
                        {canUpdate && (
                            <Button onClick={() => setCostOpen(true)}>
                                <Plus /> {t(messages.recordCost)}
                            </Button>
                        )}
                    </div>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="marketing-attribution-summary">
                    <p className="mb-4 text-sm text-muted-foreground">{t(messages.description)}</p>
                    <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
                        <Metric
                            label={t(messages.visitors)}
                            value={summary ? String(summary.visitorCount) : '—'}
                        />
                        <Metric
                            label={t(messages.productViews)}
                            value={summary ? String(summary.productViewCount) : '—'}
                        />
                        <Metric
                            label={t(messages.checkoutViews)}
                            value={summary ? String(summary.checkoutViewCount) : '—'}
                        />
                        <Metric
                            label={t(messages.orders)}
                            value={summary ? String(summary.orderCount) : '—'}
                        />
                        <Metric
                            label={t(messages.netRevenue)}
                            value={summary ? money(summary.netRevenueMicrounits, currencyCode) : '—'}
                        />
                        <Metric
                            label={t(messages.campaignCost)}
                            value={summary ? money(summary.campaignCostMicrounits, currencyCode) : '—'}
                        />
                        <Metric
                            label={t(messages.refundAdjustedRoas)}
                            value={ratio(summary?.refundAdjustedRoas)}
                        />
                        <Metric
                            label={t(messages.refundAdjustedRoi)}
                            value={percent(summary?.refundAdjustedRoi)}
                        />
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
                                            t(messages.sourceMedium),
                                            t(messages.campaign),
                                            t(messages.searchTerms),
                                            t(messages.visitors),
                                            t(messages.productCheckout),
                                            t(messages.orders),
                                            t(messages.conversion),
                                            t(messages.netRevenue),
                                            t(messages.cost),
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
    const { t } = useLingui();
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
                    amountMicrounits: signedMicrounits(
                        amount,
                        t(messages.invalidAmount),
                        t(messages.amountError),
                    ),
                    idempotencyKey: `dashboard:${crypto.randomUUID()}`,
                    reason,
                },
            }),
        onSuccess: async () => {
            toast.success(t(messages.costAppended));
            onOpenChange(false);
            await onSaved();
        },
        onError: error => toast.error(String(error)),
    });
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t(messages.recordCost)}</DialogTitle>
                    <DialogDescription>{t(messages.ledgerHint)}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label={t(messages.businessDate)} value={date} onChange={setDate} type="date" />
                    <Field
                        label={`${t(messages.amount)} (${currencyCode})`}
                        value={amount}
                        onChange={setAmount}
                    />
                    <Field label={t(messages.source)} value={source} onChange={setSource} />
                    <Field label={t(messages.medium)} value={medium} onChange={setMedium} />
                    <Field label={t(messages.campaign)} value={campaign} onChange={setCampaign} />
                    <Field label={t(messages.reasonInvoice)} value={reason} onChange={setReason} />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t(messages.cancel)}
                    </Button>
                    <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                        {t(messages.appendCost)}
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
function signedMicrounits(value: string, invalidAmount: string, amountError: string) {
    const normalized = value.trim().replace(/,/gu, '');
    if (!/^-?\d+(?:\.\d{1,3})?$/u.test(normalized)) throw new Error(invalidAmount);
    const result = Math.round(Number(normalized) * 1_000);
    if (!Number.isSafeInteger(result) || result === 0) throw new Error(amountError);
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
