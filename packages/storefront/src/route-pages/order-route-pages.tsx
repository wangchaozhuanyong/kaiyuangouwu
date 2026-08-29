import { Package, UserRound } from 'lucide-react';

import { clearAllStorefrontTwoFactorSessions } from '../client-plugins/two-factor/session-storage';
import {
    LazyAccountSecurityPage,
    LazyAddressesPage,
    LazyLogisticsPage,
    LazyOrderDetailPage,
    LazyOrdersPage,
} from '../lazy-storefront-pages';
import { PageSkeleton } from '../route-loading';
import { AuthPageBoundary, EmptyState, Subpage } from '../storefront-ui/page-shell';
import { ActiveCustomer } from '../types';

import { RouteGate, useRouteRuntime as useRuntime } from './shared';

export function OrdersRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="orders">
            <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
                <LazyOrdersPage
                    api={runtime.api}
                    customer={runtime.customer}
                    market={runtime.market}
                    locale={runtime.locale}
                    language={runtime.language}
                    storefrontName={runtime.storefrontName}
                    initialTab={runtime.route.tab ?? 'all'}
                    onBack={runtime.goBack}
                    onBuyAgain={runtime.addOrderToCart}
                    onNotify={runtime.notify}
                />
            </AuthPageBoundary>
        </RouteGate>
    );
}

export function LogisticsRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="logistics">
            <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
                <LazyLogisticsPage
                    api={runtime.api}
                    customer={runtime.customer}
                    market={runtime.market}
                    locale={runtime.locale}
                    language={runtime.language}
                    onBack={runtime.goBack}
                />
            </AuthPageBoundary>
        </RouteGate>
    );
}

export function OrderDetailRoutePage() {
    const runtime = useRuntime();
    const isZh = runtime.language === 'zh';
    if (!runtime.customer) {
        return (
            <Subpage
                title={isZh ? '订单详情' : 'Order details'}
                language={runtime.language}
                onBack={runtime.goBack}
            >
                <EmptyState
                    icon={<UserRound />}
                    title={isZh ? '登录后查看订单' : 'Sign in to view orders'}
                    detail={
                        isZh ? '订单详情仅对当前账户可见' : 'Order details are available to your account.'
                    }
                    action={isZh ? '去登录' : 'Sign in'}
                    onAction={() => runtime.navigate({ name: 'login' })}
                />
            </Subpage>
        );
    }
    if (
        !runtime.selectedOrder &&
        (runtime.routeOrderLoading || (runtime.route.id && !runtime.routeOrderError))
    ) {
        return (
            <Subpage
                title={isZh ? '订单详情' : 'Order details'}
                language={runtime.language}
                onBack={runtime.goBack}
            >
                <PageSkeleton label={isZh ? '正在加载订单详情' : 'Loading order details'} />
            </Subpage>
        );
    }
    if (!runtime.selectedOrder) {
        return (
            <Subpage
                title={isZh ? '订单详情' : 'Order details'}
                language={runtime.language}
                onBack={runtime.goBack}
            >
                <EmptyState
                    icon={<Package />}
                    title={isZh ? '没有找到订单' : 'Order not found'}
                    detail={runtime.routeOrderError}
                    action={runtime.routeOrderError ? (isZh ? '重试' : 'Retry') : undefined}
                    onAction={runtime.routeOrderError ? () => void runtime.orderQuery.refetch() : undefined}
                />
            </Subpage>
        );
    }
    return (
        <RouteGate name="order-detail">
            <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
                <LazyOrderDetailPage
                    order={runtime.selectedOrder}
                    market={runtime.market}
                    locale={runtime.locale}
                    language={runtime.language}
                    storefrontName={runtime.storefrontName}
                    onBack={runtime.goBack}
                    onBuyAgain={runtime.addOrderToCart}
                    onReopen={runtime.reopenPendingOrder}
                    onCancelOrder={runtime.cancelAuthorizedOrder}
                    onCreateAfterSales={runtime.createAfterSalesRequest}
                    onUnavailable={() => runtime.notify(isZh ? '当前商品不可用' : 'Unavailable')}
                />
            </AuthPageBoundary>
        </RouteGate>
    );
}

export function AddressesRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="addresses">
            <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
                <LazyAddressesPage
                    api={runtime.api}
                    customer={runtime.customer}
                    market={runtime.market}
                    availableCountries={runtime.availableCountries}
                    language={runtime.language}
                    onBack={runtime.goBack}
                    onCustomerChange={(customer: ActiveCustomer | null) => runtime.setCustomer(customer)}
                    onNotify={runtime.notify}
                />
            </AuthPageBoundary>
        </RouteGate>
    );
}

export function AccountSecurityRoutePage() {
    const runtime = useRuntime();
    const isZh = runtime.language === 'zh';
    return (
        <RouteGate name="account-security">
            <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
                <LazyAccountSecurityPage
                    customer={runtime.customer}
                    language={runtime.language}
                    storefrontName={runtime.storefrontName}
                    onBack={runtime.goBack}
                    onLogout={() => {
                        void runtime.api.logout().then(() => {
                            clearAllStorefrontTwoFactorSessions();
                            runtime.clearPrivateQueryCache();
                            runtime.setCustomer(null);
                            runtime.notify(isZh ? '已退出登录' : 'Signed out');
                            runtime.navigate({ name: 'account' }, true);
                        });
                    }}
                />
            </AuthPageBoundary>
        </RouteGate>
    );
}
