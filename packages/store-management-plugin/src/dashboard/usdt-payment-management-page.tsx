import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    ConfirmationDialog,
    DashboardRouteDefinition,
    Input,
    Page,
    PageBlock,
    PageLayout,
    PageTitle,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    api,
    toast,
    useMutation,
    useQuery,
} from '@vendure/dashboard';
import { Check, RefreshCw, WalletCards, X } from 'lucide-react';
import { useState } from 'react';

import {
    StorePaymentDetailListRecord,
    StorePaymentDetailRecord,
    StorePaymentStatsRecord,
    StoreUsdtManualRefundListRecord,
    StoreUsdtPaymentIntentRecord,
    StoreUsdtPaymentStatsRecord,
    StoreUsdtWalletRecord,
} from './store-currency.graphql';
import { UsdtManualRefundDialog, UsdtManualRefundList } from './usdt-manual-refund-dialog';
import {
    platformUsdtPaymentManagementQuery,
    reviewStoreUsdtWalletMutation,
} from './usdt-payment-management.graphql';

interface PlatformUsdtPaymentManagementResult {
    storeUsdtWallets: StoreUsdtWalletRecord[];
    storeUsdtPaymentStats: StoreUsdtPaymentStatsRecord[];
    storeUsdtPaymentIntents: StoreUsdtPaymentIntentRecord[];
    storePaymentStats: StorePaymentStatsRecord[];
    storePaymentDetails: StorePaymentDetailListRecord;
    storeUsdtManualRefunds: StoreUsdtManualRefundListRecord;
}

const REPORT_PAGE_SIZE = 50;

export const usdtPaymentManagementRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'system',
        id: 'usdt-payment-management',
        url: '/usdt-payment-management',
        title: '支付与收款管理',
        icon: WalletCards,
        requiresPermission: ['SuperAdmin'],
    },
    path: '/usdt-payment-management',
    loader: () => ({ breadcrumb: () => '支付与收款管理' }),
    component: () => <UsdtPaymentManagementPage />,
};

function UsdtPaymentManagementPage() {
    const [channelId, setChannelId] = useState('ALL');
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [paymentPage, setPaymentPage] = useState(0);
    const [refundPage, setRefundPage] = useState(0);
    const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
    const dateOptions = reportDateOptions(fromDate, toDate);
    const query = useQuery({
        queryKey: ['platform-usdt-payment-management', channelId, fromDate, toDate, paymentPage, refundPage],
        queryFn: () =>
            api.query<PlatformUsdtPaymentManagementResult>(platformUsdtPaymentManagementQuery, {
                channelId: channelId === 'ALL' ? null : channelId,
                statsOptions: dateOptions,
                paymentOptions: {
                    ...dateOptions,
                    skip: paymentPage * REPORT_PAGE_SIZE,
                    take: REPORT_PAGE_SIZE,
                },
                refundOptions: {
                    ...dateOptions,
                    skip: refundPage * REPORT_PAGE_SIZE,
                    take: REPORT_PAGE_SIZE,
                },
            }),
    });
    const reviewMutation = useMutation({
        mutationFn: (input: { channelId: string; approved: boolean; rejectionReason?: string }) =>
            api.mutate(reviewStoreUsdtWalletMutation, { input }),
        onSuccess: async (_result, input) => {
            toast.success(input.approved ? '收款地址已审核启用' : '收款地址已驳回');
            await query.refetch();
        },
        onError: error => toast.error(errorMessage(error)),
    });

    const wallets = query.data?.storeUsdtWallets ?? [];
    const stats = query.data?.storeUsdtPaymentStats ?? [];
    const intents = query.data?.storeUsdtPaymentIntents ?? [];
    const paymentStats = query.data?.storePaymentStats ?? [];
    const paymentDetails = query.data?.storePaymentDetails.items ?? [];
    const paymentDetailTotal = query.data?.storePaymentDetails.totalItems ?? 0;
    const manualRefunds = query.data?.storeUsdtManualRefunds.items ?? [];
    const manualRefundTotal = query.data?.storeUsdtManualRefunds.totalItems ?? 0;

    return (
        <Page pageId="usdt-payment-management">
            <PageTitle>支付与收款管理</PageTitle>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="usdt-wallet-review"
                    title="网店收款地址审核"
                    description="地址在数据库中以 AES-256-GCM 密文保存；审核通过后只用于该 Channel 的新报价。"
                >
                    {query.isLoading ? (
                        <Skeleton className="h-40" />
                    ) : query.isError ? (
                        <Alert variant="destructive">
                            <AlertDescription className="flex items-center justify-between gap-3">
                                <span>{errorMessage(query.error)}</span>
                                <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                                    <RefreshCw className="size-4" />
                                    重试
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : (
                        <div className="grid gap-3 lg:grid-cols-2">
                            {wallets.map(wallet => (
                                <article key={wallet.channelId} className="space-y-3 rounded-lg border p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <strong>{wallet.channelCode}</strong>
                                        <Badge
                                            variant={wallet.reviewStatus === 'ACTIVE' ? 'default' : 'outline'}
                                        >
                                            {walletStatusLabel(wallet.reviewStatus)}
                                        </Badge>
                                    </div>
                                    <div className="grid gap-1 text-sm text-muted-foreground">
                                        <span>当前地址：{wallet.activeReceivingAddressMasked ?? '无'}</span>
                                        <span className="break-all">
                                            待审地址：{wallet.pendingReceivingAddress ?? '无'}
                                        </span>
                                        <span className="break-all">
                                            待审指纹：{wallet.pendingReceivingAddressFingerprint ?? '无'}
                                        </span>
                                    </div>
                                    {wallet.reviewStatus === 'PENDING' ? (
                                        <div className="space-y-2 border-t pt-3">
                                            <Input
                                                value={rejectionReasons[wallet.channelId] ?? ''}
                                                placeholder="驳回原因（驳回时必填）"
                                                maxLength={500}
                                                onChange={event =>
                                                    setRejectionReasons(current => ({
                                                        ...current,
                                                        [wallet.channelId]: event.target.value,
                                                    }))
                                                }
                                            />
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    type="button"
                                                    variant="destructive"
                                                    disabled={reviewMutation.isPending}
                                                    onClick={() => {
                                                        const reason =
                                                            rejectionReasons[wallet.channelId]?.trim();
                                                        if (!reason) return toast.error('请先填写驳回原因');
                                                        reviewMutation.mutate({
                                                            channelId: wallet.channelId,
                                                            approved: false,
                                                            rejectionReason: reason,
                                                        });
                                                    }}
                                                >
                                                    <X className="size-4" />
                                                    驳回
                                                </Button>
                                                <ConfirmationDialog
                                                    title="确认启用该收款地址？"
                                                    description="通过后，该网店新生成的 USDT 订单将向此地址付款。"
                                                    confirmText="审核通过"
                                                    cancelText="取消"
                                                    onConfirm={() =>
                                                        reviewMutation.mutate({
                                                            channelId: wallet.channelId,
                                                            approved: true,
                                                        })
                                                    }
                                                >
                                                    <Button type="button" disabled={reviewMutation.isPending}>
                                                        <Check className="size-4" />
                                                        通过
                                                    </Button>
                                                </ConfirmationDialog>
                                            </div>
                                        </div>
                                    ) : null}
                                </article>
                            ))}
                        </div>
                    )}
                </PageBlock>

                <PageBlock
                    column="full"
                    blockId="payment-reporting-statistics"
                    title="全部支付方式收款统计"
                    description="按网店、支付方式和订单币种统计已结算实收、已结算退款与净收。"
                >
                    <div className="mb-4 grid gap-3 md:grid-cols-3">
                        <Select
                            value={channelId}
                            onValueChange={value => {
                                if (!value) return;
                                setChannelId(value);
                                setPaymentPage(0);
                                setRefundPage(0);
                            }}
                        >
                            <SelectTrigger aria-label="选择网店">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="ALL">全部网店</SelectItem>
                                {wallets.map(wallet => (
                                    <SelectItem key={wallet.channelId} value={wallet.channelId}>
                                        {wallet.channelCode}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Input
                            type="date"
                            aria-label="报表开始日期"
                            value={fromDate}
                            max={toDate || undefined}
                            onChange={event => {
                                setFromDate(event.target.value);
                                setPaymentPage(0);
                                setRefundPage(0);
                            }}
                        />
                        <Input
                            type="date"
                            aria-label="报表结束日期"
                            value={toDate}
                            min={fromDate || undefined}
                            onChange={event => {
                                setToDate(event.target.value);
                                setPaymentPage(0);
                                setRefundPage(0);
                            }}
                        />
                    </div>
                    <PlatformPaymentStats stats={paymentStats} />
                </PageBlock>

                <PageBlock
                    column="full"
                    blockId="payment-reporting-details"
                    title="全部支付方式明细"
                    description="按筛选时间分页查看支付；未结算支付也会显示，但不计入实收。"
                >
                    <PlatformPaymentDetails
                        details={paymentDetails}
                        onRefundRecorded={() => query.refetch()}
                    />
                    <ReportPagination
                        page={paymentPage}
                        totalItems={paymentDetailTotal}
                        onPageChange={setPaymentPage}
                    />
                </PageBlock>

                <PageBlock
                    column="full"
                    blockId="usdt-manual-refund-details"
                    title="USDT 人工退款记录"
                    description="退款链上交易、法币退款金额、实际 USDT 数量与操作人审计记录。"
                >
                    <UsdtManualRefundList refunds={manualRefunds} />
                    <ReportPagination
                        page={refundPage}
                        totalItems={manualRefundTotal}
                        onPageChange={setRefundPage}
                    />
                </PageBlock>

                <PageBlock
                    column="full"
                    blockId="usdt-payment-statistics"
                    title="USDT 链上到账统计"
                    description="已到账 USDT 按链上实际金额统计，法币成交额保留原订单币种。"
                >
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {stats.map(summary => (
                            <article key={summary.channelId} className="rounded-lg border p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <strong>{summary.channelCode}</strong>
                                    <Badge variant="outline">{summary.settledCount} 笔到账</Badge>
                                </div>
                                <strong className="mt-3 block text-2xl tabular-nums">
                                    ₮{summary.receivedUsdtTotal.toFixed(6)}
                                </strong>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    {summary.fiatTotals.length
                                        ? summary.fiatTotals
                                              .map(
                                                  total =>
                                                      `${total.currencyCode} ${(total.amount / 100).toFixed(2)}`,
                                              )
                                              .join(' / ')
                                        : '暂无已到账法币订单'}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    等待 {summary.pendingCount} · 人工复核 {summary.manualReviewCount} · 过期{' '}
                                    {summary.expiredCount}
                                </p>
                            </article>
                        ))}
                    </div>
                </PageBlock>

                <PageBlock
                    column="full"
                    blockId="usdt-payment-details"
                    title="USDT 链上明细"
                    description="最新 200 条报价、到账和复核记录。"
                >
                    <div className="grid max-h-[44rem] gap-3 overflow-y-auto pr-1">
                        {intents.length ? (
                            intents.map(intent => <PaymentDetail key={intent.id} intent={intent} />)
                        ) : (
                            <p className="text-sm text-muted-foreground">暂无 USDT 收款记录。</p>
                        )}
                    </div>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}

function PlatformPaymentStats({ stats }: { stats: StorePaymentStatsRecord[] }) {
    if (!stats.length) return <p className="text-sm text-muted-foreground">暂无已结算的支付。</p>;
    return (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {stats.map(summary => (
                <article
                    key={`${summary.channelId}:${summary.paymentMethodCode}:${summary.currencyCode}`}
                    className="rounded-lg border p-4"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong>{summary.channelCode}</strong>
                        <Badge variant="outline">{summary.paymentMethodCode}</Badge>
                    </div>
                    <strong className="mt-3 block text-2xl tabular-nums">
                        {formatMoney(summary.currencyCode, summary.netAmount)}
                    </strong>
                    <p className="mt-2 text-sm text-muted-foreground">
                        实收 {formatMoney(summary.currencyCode, summary.grossAmount)} · 退款{' '}
                        {formatMoney(summary.currencyCode, summary.refundedAmount)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        已结算 {summary.settledCount} 笔 · 已退款 {summary.refundCount} 笔
                    </p>
                </article>
            ))}
        </div>
    );
}

function PlatformPaymentDetails({
    details,
    onRefundRecorded,
}: {
    details: StorePaymentDetailRecord[];
    onRefundRecorded: () => void | Promise<unknown>;
}) {
    if (!details.length) return <p className="text-sm text-muted-foreground">暂无支付明细。</p>;
    return (
        <div className="grid max-h-[44rem] gap-3 overflow-y-auto pr-1">
            {details.map(detail => (
                <article
                    key={`${detail.channelId}:${detail.id}`}
                    className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[1fr_auto]"
                >
                    <div className="min-w-0 space-y-1 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                            <strong>
                                {detail.channelCode} · 订单 {detail.orderCode}
                            </strong>
                            <Badge variant={detail.paymentState === 'Settled' ? 'default' : 'outline'}>
                                {paymentStateLabel(detail.paymentState)}
                            </Badge>
                            <Badge variant="outline">{detail.paymentMethodCode}</Badge>
                        </div>
                        <p className="break-all text-muted-foreground">
                            交易号：{detail.transactionId ?? '暂无'} · 支付 ID：{detail.id}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatDate(detail.createdAt)}</p>
                    </div>
                    <div className="text-left text-sm lg:text-right">
                        <strong className="block text-lg tabular-nums">
                            {formatMoney(detail.currencyCode, detail.amount)}
                        </strong>
                        <span className="block text-muted-foreground">
                            退款 {formatMoney(detail.currencyCode, detail.refundedAmount)}
                        </span>
                        <span className="block font-medium">
                            净收 {formatMoney(detail.currencyCode, detail.netAmount)}
                        </span>
                        {detail.paymentMethodCode === 'usdt-trc20' ? (
                            <div className="mt-3">
                                <UsdtManualRefundDialog
                                    payment={detail}
                                    onRecorded={() => void onRefundRecorded()}
                                />
                            </div>
                        ) : null}
                    </div>
                </article>
            ))}
        </div>
    );
}

function PaymentDetail({ intent }: { intent: StoreUsdtPaymentIntentRecord }) {
    return (
        <article className="grid gap-3 rounded-lg border p-4 lg:grid-cols-[1fr_auto]">
            <div className="min-w-0 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                    <strong>
                        {intent.channelCode} · 订单 {intent.orderCode}
                    </strong>
                    <Badge variant={intent.status === 'SETTLED' ? 'default' : 'outline'}>
                        {paymentStatusLabel(intent.status)}
                    </Badge>
                </div>
                <p className="text-muted-foreground">
                    订单金额 {intent.fiatCurrencyCode} {(intent.fiatAmount / 100).toFixed(2)} · 报价汇率{' '}
                    {intent.fiatPerUsdtRate.toFixed(4)} · 加价 {intent.markupPercent.toFixed(2)}%
                </p>
                <p className="break-all text-muted-foreground">
                    交易：{intent.transactionId ?? '未到账'} · 区块：{intent.blockNumber ?? '未确认'}
                </p>
                <p className="text-muted-foreground">
                    收款：{intent.receivingAddressMasked} · 付款方：{intent.senderAddressMasked ?? '未知'}
                </p>
                {intent.failureReason ? (
                    <p className="font-medium text-destructive">{intent.failureReason}</p>
                ) : null}
            </div>
            <div className="text-left lg:text-right">
                <strong className="block text-lg tabular-nums">
                    应收 ₮{intent.expectedUsdtAmount.toFixed(6)}
                </strong>
                <span className="text-sm text-muted-foreground">
                    实收 {intent.receivedUsdtAmount?.toFixed(6) ?? '—'}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                    {formatDate(intent.settledAt ?? intent.createdAt)}
                </span>
            </div>
        </article>
    );
}

function walletStatusLabel(status: string): string {
    return (
        {
            UNCONFIGURED: '未配置',
            PENDING: '待审核',
            ACTIVE: '已启用',
            REJECTED: '已驳回',
        }[status] ?? status
    );
}

function paymentStatusLabel(status: string): string {
    return (
        {
            PENDING: '等待到账',
            SETTLED: '已确认到账',
            MANUAL_REVIEW: '人工复核',
            EXPIRED: '已过期',
        }[status] ?? status
    );
}

function paymentStateLabel(state: string): string {
    return (
        {
            Created: '已创建',
            Authorized: '已授权',
            Settled: '已结算',
            Declined: '已拒绝',
            Error: '错误',
            Cancelled: '已取消',
        }[state] ?? state
    );
}

function ReportPagination({
    page,
    totalItems,
    onPageChange,
}: {
    page: number;
    totalItems: number;
    onPageChange: (page: number) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(totalItems / REPORT_PAGE_SIZE));
    if (!totalItems) return null;
    return (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
            <span className="text-muted-foreground">
                共 {totalItems} 条 · 第 {Math.min(page + 1, totalPages)} / {totalPages} 页
            </span>
            <div className="flex gap-2">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={page <= 0}
                    onClick={() => onPageChange(Math.max(0, page - 1))}
                >
                    上一页
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={page + 1 >= totalPages}
                    onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
                >
                    下一页
                </Button>
            </div>
        </div>
    );
}

function reportDateOptions(fromDate: string, toDate: string): { from?: string; to?: string } {
    return {
        ...(fromDate ? { from: new Date(`${fromDate}T00:00:00.000`).toISOString() } : {}),
        ...(toDate ? { to: new Date(`${toDate}T23:59:59.999`).toISOString() } : {}),
    };
}

function formatMoney(currencyCode: string, amount: number): string {
    return `${currencyCode} ${(amount / 100).toFixed(2)}`;
}

function formatDate(value: string | null): string {
    if (!value) return '无';
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).format(new Date(value));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
