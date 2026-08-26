import { Button, DashboardBaseWidget, Link, Skeleton, api, useChannel, useQuery } from '@vendure/dashboard';
import { RefreshCw } from 'lucide-react';

import { ReferralTodayMetricsResult, referralTodayMetricsQuery } from './referral.graphql';

export function ReferralTodayWidget() {
    const { activeChannel } = useChannel();
    const query = useQuery({
        queryKey: ['referral-today-widget', activeChannel?.id],
        queryFn: () => api.query<ReferralTodayMetricsResult>(referralTodayMetricsQuery),
        enabled: Boolean(activeChannel?.id),
        refetchInterval: 60_000,
    });
    const value = query.data?.referralTodayMetrics;
    const cards = value
        ? [
              ['网站访客', value.visitorCount],
              ['新增注册', value.newCustomerCount],
              ['消费客户', value.consumerCount],
              ['首次消费', value.firstTimeConsumerCount],
              ['老客复购', value.returningConsumerCount],
              ['成功订单', value.orderCount],
              ['新增邀请', value.todayInvitedCount],
              ['受邀首购', value.todayInvitedPurchaserCount],
          ]
        : [];

    return (
        <DashboardBaseWidget
            id="referral-today-widget"
            title="今日客户与邀请数据"
            description="北京时间口径；客户和访客均去重"
            actions={
                <div className="flex gap-1">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="刷新今日数据"
                        onClick={() => void query.refetch()}
                    >
                        <RefreshCw className={query.isRefetching ? 'animate-spin' : ''} />
                    </Button>
                    <Button variant="outline" size="sm" render={<Link to="/referral-rewards" />}>
                        查看邀请报表
                    </Button>
                </div>
            }
        >
            {query.isPending ? (
                <div className="grid grid-cols-4 gap-3">
                    {Array.from({ length: 8 }, (_, index) => (
                        <Skeleton key={index} className="h-16" />
                    ))}
                </div>
            ) : query.isError || !value ? (
                <div className="flex min-h-24 items-center justify-between text-sm text-muted-foreground">
                    <span>今日数据加载失败</span>
                    <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                        重试
                    </Button>
                </div>
            ) : (
                <div>
                    <div className="grid grid-cols-4 gap-x-5 gap-y-3">
                        {cards.map(([label, count]) => (
                            <div key={label} className="border-r last:border-0">
                                <span className="text-xs text-muted-foreground">{label}</span>
                                <strong className="mt-1 block text-xl tabular-nums">{count}</strong>
                            </div>
                        ))}
                    </div>
                    <p className="mb-0 mt-3 text-xs text-muted-foreground">
                        统计日期 {value.businessDate}
                        {value.salesByCurrency.map(
                            item =>
                                ` · ${item.currencyCode} ${new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2 }).format(item.sales / 100)}`,
                        )}
                    </p>
                </div>
            )}
        </DashboardBaseWidget>
    );
}
