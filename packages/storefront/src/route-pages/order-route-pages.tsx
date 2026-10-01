import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';

import { checkoutAddress } from '../checkout-address';
import { languageCodeFor } from '../i18n';
import {
    LazyAccountSecurityPage,
    LazyAddressesPage,
    LazyLogisticsPage,
    LazyOrderDetailPage,
    LazyOrdersPage,
} from '../lazy-storefront-pages';
import { offlineLoadError } from '../loading-state';
import { orderStatusRefreshInterval } from '../order-refresh';
import { PUBLIC_QUERY_GC_TIME, storefrontQueryKeys } from '../query-client';
import { PageSkeleton } from '../route-loading';
import { storefrontErrorMessage } from '../storefront-errors';
import { AuthPageBoundary, EmptyState, InlineError, Sheet, Subpage } from '../storefront-ui/page-shell';
import { ActiveCustomer, CustomerAvatarHistoryEntry, DataSubjectRequest, FraudRiskCase } from '../types';

import '../commerce-styles';
import { registerRoutePreload, RouteGate, useRouteRuntime as useRuntime } from './shared';

export function OrdersRoutePage() {
    const runtime = useRuntime();
    const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
    useEffect(() => setDetailOrderId(null), [runtime.customer?.id, runtime.market.code]);
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
                    onOpenOrder={setDetailOrderId}
                />
                {detailOrderId && runtime.customer && (
                    <OrderDetailsDrawer
                        key={detailOrderId}
                        orderId={detailOrderId}
                        onClose={() => setDetailOrderId(null)}
                    />
                )}
            </AuthPageBoundary>
        </RouteGate>
    );
}

function OrderDetailsDrawer({ orderId, onClose }: { orderId: string; onClose: () => void }) {
    const runtime = useRuntime();
    const queryClient = useQueryClient();
    const isZh = runtime.language === 'zh';
    const query = useQuery({
        queryKey: storefrontQueryKeys.order(
            storefrontQueryKeys.market(runtime.market),
            languageCodeFor(runtime.language),
            runtime.customer?.id ?? '',
            orderId,
        ),
        queryFn: async ({ signal }) => {
            const order = await runtime.api.order(orderId, signal);
            if (!order) throw new Error(isZh ? '订单不存在或无权查看' : 'Order not found');
            return order;
        },
        enabled: Boolean(runtime.customer),
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: currentQuery => orderStatusRefreshInterval(currentQuery.state.data?.state),
        gcTime: PUBLIC_QUERY_GC_TIME,
    });
    const error =
        query.isPaused && !query.data
            ? offlineLoadError(runtime.language)
            : query.error instanceof Error
              ? storefrontErrorMessage(query.error, runtime.language)
              : '';
    return (
        <Sheet
            title={isZh ? '订单详情' : 'Order details'}
            language={runtime.language}
            className="order-detail-sheet"
            onClose={onClose}
        >
            {!query.data ? (
                <div className="order-detail-sheet-state">
                    {error ? (
                        <EmptyState
                            icon={<Package />}
                            title={isZh ? '订单详情暂不可用' : 'Order details unavailable'}
                            detail={error}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => void query.refetch()}
                        />
                    ) : (
                        <PageSkeleton label={isZh ? '正在加载订单详情' : 'Loading order details'} />
                    )}
                </div>
            ) : (
                <>
                    {error && (
                        <InlineError
                            message={error}
                            action={isZh ? '重试' : 'Retry'}
                            onAction={() => void query.refetch()}
                        />
                    )}
                    <LazyOrderDetailPage
                        presentation="drawer"
                        api={runtime.api}
                        order={query.data}
                        market={runtime.market}
                        locale={runtime.locale}
                        language={runtime.language}
                        reviewEnabled={runtime.reviewSettingsStatus === 'enabled'}
                        storefrontName={runtime.storefrontName}
                        onBack={onClose}
                        onBuyAgain={runtime.addOrderToCart}
                        onReopen={runtime.reopenPendingOrder}
                        onCancelOrder={runtime.cancelAuthorizedOrder}
                        onCreateAfterSales={async input => {
                            await runtime.createAfterSalesRequest(input);
                            onClose();
                        }}
                        onConfirmDelivery={async fulfillmentId => {
                            await runtime.api.confirmFulfillmentDelivery(fulfillmentId);
                            await queryClient.invalidateQueries({
                                queryKey: storefrontQueryKeys.customerScope(
                                    storefrontQueryKeys.market(runtime.market),
                                    languageCodeFor(runtime.language),
                                    runtime.customer?.id ?? '',
                                ),
                            });
                            runtime.notify(isZh ? '已确认收货，订单状态已更新' : 'Delivery confirmed');
                        }}
                        onUnavailable={() => runtime.notify(isZh ? '当前商品不可用' : 'Unavailable')}
                        onNotify={runtime.notify}
                    />
                </>
            )}
        </Sheet>
    );
}

export function LogisticsRoutePage() {
    const runtime = useRuntime();
    return (
        <RouteGate name="logistics">
            <AuthPageBoundary
                language={runtime.language}
                onBack={() => runtime.navigate({ name: 'account' })}
            >
                <LazyLogisticsPage
                    route={runtime.route}
                    api={runtime.api}
                    customer={runtime.customer}
                    market={runtime.market}
                    locale={runtime.locale}
                    language={runtime.language}
                    onBack={() => runtime.navigate({ name: 'account' })}
                />
            </AuthPageBoundary>
        </RouteGate>
    );
}

export function OrderDetailRoutePage() {
    const runtime = useRuntime();
    const isZh = runtime.language === 'zh';
    const back = () =>
        runtime.route.source?.startsWith('logistics')
            ? runtime.navigate(
                  {
                      name: 'logistics',
                      id: runtime.route.source === 'logistics-detail' ? runtime.route.id : undefined,
                      deliveryStatus: runtime.route.deliveryStatus,
                      term: runtime.route.term,
                  },
                  true,
              )
            : runtime.goBack();
    if (!runtime.customer) {
        return (
            <Subpage title={isZh ? '订单详情' : 'Order details'} language={runtime.language} onBack={back}>
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
            <Subpage title={isZh ? '订单详情' : 'Order details'} language={runtime.language} onBack={back}>
                <PageSkeleton label={isZh ? '正在加载订单详情' : 'Loading order details'} />
            </Subpage>
        );
    }
    if (!runtime.selectedOrder) {
        return (
            <Subpage title={isZh ? '订单详情' : 'Order details'} language={runtime.language} onBack={back}>
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
            <AuthPageBoundary language={runtime.language} onBack={back}>
                <LazyOrderDetailPage
                    api={runtime.api}
                    order={runtime.selectedOrder}
                    market={runtime.market}
                    locale={runtime.locale}
                    language={runtime.language}
                    reviewEnabled={runtime.reviewSettingsStatus === 'enabled'}
                    storefrontName={runtime.storefrontName}
                    onBack={back}
                    backLabel={
                        runtime.route.source === 'logistics-detail'
                            ? isZh
                                ? '返回物流详情'
                                : 'Back to delivery'
                            : runtime.route.source === 'logistics'
                              ? isZh
                                  ? '返回物流列表'
                                  : 'Back to deliveries'
                              : undefined
                    }
                    onBuyAgain={runtime.addOrderToCart}
                    onReopen={runtime.reopenPendingOrder}
                    onCancelOrder={runtime.cancelAuthorizedOrder}
                    onCreateAfterSales={runtime.createAfterSalesRequest}
                    onConfirmDelivery={async fulfillmentId => {
                        await runtime.api.confirmFulfillmentDelivery(fulfillmentId);
                        await runtime.orderQuery.refetch();
                        runtime.notify(isZh ? '已确认收货，订单状态已更新' : 'Delivery confirmed');
                    }}
                    onUnavailable={() => runtime.notify(isZh ? '当前商品不可用' : 'Unavailable')}
                    onNotify={runtime.notify}
                />
            </AuthPageBoundary>
        </RouteGate>
    );
}

export function AddressesRoutePage() {
    const runtime = useRuntime();
    const returnTo =
        runtime.route.returnTo === 'purchase' || runtime.route.returnTo === 'checkout'
            ? runtime.route.returnTo
            : undefined;
    const checkoutOrderId = runtime.route.checkoutOrderId;
    const selectionMode = Boolean(returnTo && checkoutOrderId);
    const addressId = checkoutAddress(runtime.customer, runtime.route.addressId)?.id;
    const back = () =>
        selectionMode && returnTo
            ? runtime.navigate({ name: returnTo, checkoutOrderId, addressId: runtime.route.addressId }, true)
            : runtime.goBack();
    return (
        <RouteGate name="addresses">
            <AuthPageBoundary language={runtime.language} onBack={back}>
                <LazyAddressesPage
                    selection={
                        selectionMode && returnTo
                            ? {
                                  addressId,
                                  editAddress: runtime.route.editAddress,
                                  onUse: address =>
                                      runtime.navigate(
                                          { name: returnTo, checkoutOrderId, addressId: address.id },
                                          true,
                                      ),
                              }
                            : undefined
                    }
                    api={runtime.api}
                    customer={runtime.customer}
                    market={runtime.market}
                    availableCountries={runtime.availableCountries}
                    availableProvinces={runtime.availableProvinces}
                    language={runtime.language}
                    commerceMode={runtime.commerceMode}
                    onBack={back}
                    onCustomerChange={(customer: ActiveCustomer | null) => runtime.setCustomer(customer)}
                    onNotify={runtime.notify}
                />
            </AuthPageBoundary>
        </RouteGate>
    );
}

export function AccountSecurityRoutePage() {
    const runtime = useRuntime();
    return <AccountSecurityRouteContent key={runtime.customer?.id ?? 'guest'} runtime={runtime} />;
}

function AccountSecurityRouteContent({ runtime }: { runtime: ReturnType<typeof useRuntime> }) {
    const isZh = runtime.language === 'zh';
    const [avatarHistory, setAvatarHistory] = useState<CustomerAvatarHistoryEntry[]>([]);
    const [avatarHistoryLoading, setAvatarHistoryLoading] = useState(Boolean(runtime.customer));
    const [dataSubjectRequests, setDataSubjectRequests] = useState<DataSubjectRequest[]>([]);
    const [dataSubjectLoading, setDataSubjectLoading] = useState(Boolean(runtime.customer));
    const [fraudRiskCases, setFraudRiskCases] = useState<FraudRiskCase[]>([]);
    const [fraudRiskLoading, setFraudRiskLoading] = useState(Boolean(runtime.customer));
    const refreshAvatarHistory = async () => {
        if (!runtime.customer) {
            setAvatarHistory([]);
            setAvatarHistoryLoading(false);
            return;
        }
        setAvatarHistoryLoading(true);
        try {
            setAvatarHistory(await runtime.api.customerAvatarHistory());
        } catch (error) {
            runtime.notify(storefrontErrorMessage(error, runtime.language));
        } finally {
            setAvatarHistoryLoading(false);
        }
    };
    const refreshDataSubjectRequests = async () => {
        if (!runtime.customer) {
            setDataSubjectRequests([]);
            setDataSubjectLoading(false);
            return;
        }
        setDataSubjectLoading(true);
        try {
            setDataSubjectRequests(await runtime.api.dataSubjectRequests());
        } catch (error) {
            runtime.notify(storefrontErrorMessage(error, runtime.language));
        } finally {
            setDataSubjectLoading(false);
        }
    };
    const refreshFraudRiskCases = async () => {
        if (!runtime.customer) {
            setFraudRiskCases([]);
            setFraudRiskLoading(false);
            return;
        }
        setFraudRiskLoading(true);
        try {
            setFraudRiskCases(await runtime.api.fraudRiskCases());
        } catch (error) {
            runtime.notify(storefrontErrorMessage(error, runtime.language));
        } finally {
            setFraudRiskLoading(false);
        }
    };
    useEffect(() => {
        const controller = new AbortController();
        if (!runtime.customer) {
            setAvatarHistory([]);
            setAvatarHistoryLoading(false);
            return () => controller.abort();
        }
        setAvatarHistoryLoading(true);
        void runtime.api
            .customerAvatarHistory(controller.signal)
            .then(history => setAvatarHistory(history))
            .catch(error => {
                if (!controller.signal.aborted) {
                    runtime.notify(storefrontErrorMessage(error, runtime.language));
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setAvatarHistoryLoading(false);
            });
        return () => controller.abort();
    }, [isZh, runtime.api, runtime.customer?.id, runtime.notify]);
    useEffect(() => {
        const controller = new AbortController();
        if (!runtime.customer) {
            setFraudRiskCases([]);
            setFraudRiskLoading(false);
            return () => controller.abort();
        }
        setFraudRiskLoading(true);
        void runtime.api
            .fraudRiskCases(controller.signal)
            .then(cases => setFraudRiskCases(cases))
            .catch(error => {
                if (!controller.signal.aborted)
                    runtime.notify(storefrontErrorMessage(error, runtime.language));
            })
            .finally(() => {
                if (!controller.signal.aborted) setFraudRiskLoading(false);
            });
        return () => controller.abort();
    }, [isZh, runtime.api, runtime.customer?.id, runtime.notify]);
    useEffect(() => {
        const controller = new AbortController();
        if (!runtime.customer) {
            setDataSubjectRequests([]);
            setDataSubjectLoading(false);
            return () => controller.abort();
        }
        setDataSubjectLoading(true);
        void runtime.api
            .dataSubjectRequests(controller.signal)
            .then(requests => setDataSubjectRequests(requests))
            .catch(error => {
                if (!controller.signal.aborted) {
                    runtime.notify(storefrontErrorMessage(error, runtime.language));
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setDataSubjectLoading(false);
            });
        return () => controller.abort();
    }, [isZh, runtime.api, runtime.customer?.id, runtime.notify]);
    return (
        <RouteGate name="account-security">
            <AuthPageBoundary language={runtime.language} onBack={runtime.goBack}>
                <LazyAccountSecurityPage
                    customer={runtime.customer}
                    language={runtime.language}
                    storefrontName={runtime.storefrontName}
                    commerceMode={runtime.commerceMode}
                    onBack={runtime.goBack}
                    avatarHistory={avatarHistory}
                    avatarHistoryLoading={avatarHistoryLoading}
                    dataSubjectRequests={dataSubjectRequests}
                    dataSubjectLoading={dataSubjectLoading}
                    fraudRiskCases={fraudRiskCases}
                    fraudRiskLoading={fraudRiskLoading}
                    onAvatarChange={async (file: File) => {
                        const avatar = await runtime.api.uploadCustomerAvatar(file);
                        runtime.setCustomer((current: ActiveCustomer | null) =>
                            current ? { ...current, avatar } : current,
                        );
                        await refreshAvatarHistory();
                        runtime.notify(isZh ? '头像已更新' : 'Profile photo updated');
                    }}
                    onAvatarRestore={async retentionId => {
                        const avatar = await runtime.api.restoreCustomerAvatar(retentionId);
                        runtime.setCustomer((current: ActiveCustomer | null) =>
                            current ? { ...current, avatar } : current,
                        );
                        await refreshAvatarHistory();
                        runtime.notify(isZh ? '历史头像已恢复' : 'Previous profile photo restored');
                    }}
                    onAvatarRemove={async () => {
                        await runtime.api.removeCustomerAvatar();
                        runtime.setCustomer((current: ActiveCustomer | null) =>
                            current ? { ...current, avatar: null } : current,
                        );
                        await refreshAvatarHistory();
                        runtime.notify(
                            isZh ? '头像已移入30天恢复区' : 'Profile photo moved to 30-day recovery',
                        );
                    }}
                    onDataExport={password => runtime.api.exportPersonalData(password)}
                    onRequestAccountClosure={async password => {
                        await runtime.api.requestAccountClosure(password);
                        await refreshDataSubjectRequests();
                    }}
                    onCancelAccountClosure={async () => {
                        await runtime.api.cancelAccountClosure();
                        await refreshDataSubjectRequests();
                    }}
                    onAppealFraudRiskCase={async (id, reason) => {
                        await runtime.api.appealFraudRiskCase(id, reason);
                        await refreshFraudRiskCases();
                    }}
                    onLogout={() => {
                        void runtime.api.logout().then(() => {
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

export const preloadOrdersRoutePage = registerRoutePreload(OrdersRoutePage, LazyOrdersPage);
export const preloadLogisticsRoutePage = registerRoutePreload(LogisticsRoutePage, LazyLogisticsPage);
export const preloadOrderDetailRoutePage = registerRoutePreload(OrderDetailRoutePage, LazyOrderDetailPage);
export const preloadAddressesRoutePage = registerRoutePreload(AddressesRoutePage, LazyAddressesPage);
export const preloadAccountSecurityRoutePage = registerRoutePreload(
    AccountSecurityRoutePage,
    LazyAccountSecurityPage,
);
