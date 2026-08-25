import { Badge, Skeleton, api, useQuery } from '@vendure/dashboard';
import { gql } from 'graphql-tag';

const orderCouponAllocationsQuery = gql`
    query StoreOrderCouponAllocations($id: ID!) {
        order(id: $id) {
            id
            currencyCode
            storeCouponAllocations {
                id
                customerCouponId
                campaignId
                campaignName
                status
                currencyCode
                discountAmount
                discountAmountWithTax
                refundedAmount
                appliedAt
                usedAt
                releasedAt
                refundedAt
                refundId
            }
        }
    }
`;

interface OrderCouponAllocationsResult {
    order: {
        id: string;
        currencyCode: string;
        storeCouponAllocations: Array<{
            id: string;
            customerCouponId: string;
            campaignName: string;
            status: string;
            currencyCode: string;
            discountAmountWithTax: number;
            refundedAmount: number;
            usedAt: string | null;
            refundedAt: string | null;
            refundId: string | null;
        }>;
    } | null;
}

export function StoreCouponOrderBlock({ context }: { context: { entity?: { id?: string } } }) {
    const orderId = context.entity?.id;
    const query = useQuery({
        queryKey: ['store-order-coupon-allocations', orderId],
        queryFn: () => api.query<OrderCouponAllocationsResult>(orderCouponAllocationsQuery, { id: orderId }),
        enabled: Boolean(orderId),
    });

    if (query.isLoading) return <Skeleton className="h-16 w-full" />;
    if (query.isError) {
        return <p className="text-sm text-destructive">优惠券明细加载失败，请刷新后重试。</p>;
    }
    const allocations = query.data?.order?.storeCouponAllocations ?? [];
    if (!allocations.length) {
        return <p className="text-sm text-muted-foreground">该订单未使用用户领取的优惠券。</p>;
    }

    return (
        <div className="space-y-3">
            {allocations.map(allocation => (
                <div
                    key={allocation.id}
                    className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                    <div>
                        <div className="flex items-center gap-2">
                            <strong className="text-sm">{allocation.campaignName}</strong>
                            <Badge variant="outline">{couponAllocationStatus(allocation.status)}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                            用户券 #{allocation.customerCouponId}
                            {allocation.refundId ? ` · 退款 #${allocation.refundId}` : ''}
                        </p>
                    </div>
                    <div className="text-left sm:text-right">
                        <strong className="text-sm text-emerald-700">
                            -{formatMoney(allocation.discountAmountWithTax, allocation.currencyCode)}
                        </strong>
                        {allocation.refundedAmount > 0 ? (
                            <small className="block text-muted-foreground">
                                已退款 {formatMoney(allocation.refundedAmount, allocation.currencyCode)}
                            </small>
                        ) : null}
                    </div>
                </div>
            ))}
        </div>
    );
}

function couponAllocationStatus(status: string) {
    return (
        (
            {
                LOCKED: '已锁定',
                USED: '已核销',
                RELEASED: '已释放',
                REFUNDED: '已退款',
            } as Record<string, string>
        )[status] ?? status
    );
}

function formatMoney(value: number, currencyCode: string) {
    return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: currencyCode,
    }).format(value / 100);
}
