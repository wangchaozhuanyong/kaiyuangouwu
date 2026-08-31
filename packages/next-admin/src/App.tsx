import { gql } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { clearAuthSession, hasActiveChannelSelection, setInitialActiveChannel } from './apollo';
import { ConfirmDialogProvider } from './components/ConfirmDialog';
import { getNextAdminExtensionRoutes } from './extensions/extension-api';
import './extensions/installed-extensions';
import { InitialPasswordChangeModule } from './pages/Auth/InitialPasswordChangeModule';
import { LoginModule } from './pages/Auth/LoginModule';
import { routeModuleLoaders } from './route-modules';
import { isAuthenticationRequiredError } from './utils/authentication-error';
import { toUserFacingError } from './utils/user-facing-error';

const AppShell = lazy(() => import('./layouts/AppShell').then(module => ({ default: module.AppShell })));

const ProfileModule = lazy(() =>
    routeModuleLoaders.profile().then(module => ({ default: module.ProfileModule })),
);
const DashboardModule = lazy(() =>
    routeModuleLoaders.dashboard().then(module => ({ default: module.DashboardModule })),
);
const CatalogModule = lazy(() =>
    routeModuleLoaders.catalog().then(module => ({ default: module.CatalogModule })),
);
const ProductEditor = lazy(() =>
    routeModuleLoaders.productEditor().then(module => ({ default: module.ProductEditor })),
);
const CategoriesModule = lazy(() =>
    routeModuleLoaders.categories().then(module => ({ default: module.CategoriesModule })),
);
const InventoryWarehouseModule = lazy(() =>
    routeModuleLoaders.inventory().then(module => ({
        default: module.InventoryWarehouseModule,
    })),
);
const AssetsModule = lazy(() =>
    routeModuleLoaders.assets().then(module => ({ default: module.AssetsModule })),
);
const SalesModule = lazy(() => routeModuleLoaders.sales().then(module => ({ default: module.SalesModule })));
const OrderEditor = lazy(() =>
    routeModuleLoaders.orderEditor().then(module => ({ default: module.OrderEditor })),
);
const CustomersModule = lazy(() =>
    routeModuleLoaders.customers().then(module => ({ default: module.CustomersModule })),
);
const RolesModule = lazy(() => routeModuleLoaders.roles().then(module => ({ default: module.RolesModule })));
const SystemOpsModule = lazy(() =>
    routeModuleLoaders.systemOps().then(module => ({ default: module.SystemOpsModule })),
);

const GET_ADMIN_BOOTSTRAP = gql`
    query GetAdminBootstrap {
        me {
            id
            identifier
            channels {
                id
                code
                token
            }
        }
        merchantInitialPasswordStatus {
            mustChangePassword
        }
    }
`;

interface AdminBootstrapData {
    me: {
        id: string;
        identifier: string;
        channels: Array<{ id: string; code: string; token: string }>;
    } | null;
    merchantInitialPasswordStatus: { mustChangePassword: boolean };
}

function SessionExpiredRedirect() {
    useEffect(() => clearAuthSession(), []);
    return <Navigate to="/login" replace />;
}

function AuthenticatedShell() {
    const [channelReady, setChannelReady] = useState(() => hasActiveChannelSelection());
    const authQuery = useQuery<AdminBootstrapData>(GET_ADMIN_BOOTSTRAP, {
        fetchPolicy: 'network-only',
    });
    const data = authQuery.data;
    const loading = authQuery.loading;
    const error = authQuery.error;

    // 会话恢复时需要先将唯一可用 Channel 写入请求上下文，再挂载业务页面。
    /* oxlint-disable react/set-state-in-effect */
    useEffect(() => {
        if (!data?.me || channelReady) return;
        if (data.me.channels.length === 1) setInitialActiveChannel(data.me.channels[0].token);
        setChannelReady(true);
    }, [channelReady, data?.me]);
    /* oxlint-enable react/set-state-in-effect */

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-medium text-slate-500">
                正在验证管理员会话...
            </div>
        );
    }

    if (isAuthenticationRequiredError(authQuery.error)) {
        return <SessionExpiredRedirect />;
    }

    if (error) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
                <section
                    className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm"
                    role="alert"
                >
                    <h1 className="text-base font-bold text-slate-900">管理员会话验证失败</h1>
                    <p className="mt-2 text-xs leading-5 text-rose-600">
                        {toUserFacingError(error, '暂时无法连接管理服务，请检查网络后重试。')}
                    </p>
                    <button
                        type="button"
                        onClick={() => void authQuery.refetch()}
                        className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                    >
                        重新验证
                    </button>
                </section>
            </div>
        );
    }

    if (!data?.me) {
        return <Navigate to="/login" replace />;
    }

    if (!channelReady) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-medium text-slate-500">
                正在进入账号所属店铺...
            </div>
        );
    }

    if (data.merchantInitialPasswordStatus.mustChangePassword) {
        return (
            <InitialPasswordChangeModule
                onCompleted={async () => {
                    await authQuery.refetch();
                }}
            />
        );
    }

    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-medium text-slate-500">
                    正在加载管理后台...
                </div>
            }
        >
            <AppShell />
        </Suspense>
    );
}

function App() {
    return (
        <ConfirmDialogProvider>
            <BrowserRouter basename={import.meta.env.BASE_URL}>
                <Routes>
                    <Route path="/login" element={<LoginModule />} />

                    <Route path="/" element={<AuthenticatedShell />}>
                        <Route index element={<Navigate to="/dashboard" replace />} />

                        {/* 1. 📊 工作台 */}
                        <Route path="dashboard" element={<DashboardModule />} />

                        {/* 个人中心 (位于右上角用户菜单) */}
                        <Route path="profile" element={<ProfileModule />} />

                        {/* 2. 🛍️ 商品管理 */}
                        <Route path="catalog">
                            <Route index element={<Navigate to="list" replace />} />
                            <Route path="list" element={<CatalogModule />} />
                            <Route path="products/new" element={<ProductEditor />} />
                            <Route path="products/:id" element={<ProductEditor />} />
                            <Route path="categories" element={<CategoriesModule />} />
                            <Route path="inventory" element={<InventoryWarehouseModule />} />
                            <Route path="assets" element={<AssetsModule />} />
                            <Route path="products" element={<Navigate to="/catalog/list" replace />} />
                            <Route path="variants" element={<Navigate to="/catalog/list" replace />} />
                            <Route
                                path="collections"
                                element={<Navigate to="/catalog/categories" replace />}
                            />
                            <Route
                                path="option-groups"
                                element={<Navigate to="/catalog/categories?tab=options" replace />}
                            />
                            <Route
                                path="facets"
                                element={<Navigate to="/catalog/categories?tab=facets" replace />}
                            />
                            <Route
                                path="stock-locations"
                                element={<Navigate to="/catalog/inventory?tab=warehouses" replace />}
                            />
                        </Route>

                        {/* 3. 📦 订单与售后 */}
                        <Route path="sales">
                            <Route index element={<Navigate to="orders" replace />} />
                            <Route path="orders" element={<SalesModule />} />
                            <Route path="orders/:id" element={<OrderEditor />} />
                            <Route
                                path="shipments"
                                element={<Navigate to="/sales/orders?tab=to-fulfill" replace />}
                            />
                        </Route>

                        {/* 4. 👥 客户 */}
                        <Route path="customers">
                            <Route index element={<Navigate to="list" replace />} />
                            <Route path="list" element={<CustomersModule />} />
                        </Route>

                        {/* 5. 🎯 营销 */}
                        <Route path="marketing">
                            <Route index element={<Navigate to="promotions" replace />} />
                            <Route path="coupons" element={<Navigate to="/marketing/promotions" replace />} />
                            <Route
                                path="flash-sales"
                                element={<Navigate to="/marketing/promotions?tab=flash-sales" replace />}
                            />
                            <Route
                                path="withdrawals"
                                element={<Navigate to="/marketing/referrals?tab=withdrawals" replace />}
                            />
                        </Route>

                        {/* 6. 🎨 店铺 (已去除重复的 /storefront/assets) */}
                        <Route path="storefront">
                            <Route index element={<Navigate to="decoration" replace />} />
                            <Route path="blocks" element={<Navigate to="/storefront/decoration" replace />} />
                            <Route
                                path="announcements"
                                element={<Navigate to="/storefront/content?tab=announcements" replace />}
                            />
                            <Route
                                path="promotion-page"
                                element={<Navigate to="/storefront/content?tab=landing" replace />}
                            />
                        </Route>

                        {/* 7. 🔌 插件与服务 */}
                        <Route path="plugins">
                            <Route index element={<Navigate to="client-plugins" replace />} />
                            <Route path="*" element={<Navigate to="client-plugins" replace />} />
                        </Route>

                        {/* 8. ⚙️ 系统与权限 */}
                        <Route path="settings">
                            <Route index element={<Navigate to="store-profile" replace />} />
                            <Route path="team" element={<RolesModule />} />
                            <Route path="system-ops" element={<SystemOpsModule />} />
                            <Route
                                path="stores"
                                element={<Navigate to="/settings/store-profile" replace />}
                            />
                            <Route
                                path="sellers"
                                element={<Navigate to="/settings/store-profile?tab=sellers" replace />}
                            />
                            <Route
                                path="roles"
                                element={<Navigate to="/settings/team?tab=roles" replace />}
                            />
                            <Route
                                path="job-queue"
                                element={<Navigate to="/settings/system-ops" replace />}
                            />
                            <Route
                                path="scheduled-tasks"
                                element={<Navigate to="/settings/system-ops?tab=schedules" replace />}
                            />
                            <Route
                                path="settings-store"
                                element={<Navigate to="/settings/system-ops?tab=settings" replace />}
                            />
                            <Route
                                path="api-keys"
                                element={<Navigate to="/settings/system-ops?tab=api-keys" replace />}
                            />
                        </Route>

                        {getNextAdminExtensionRoutes().map(route => {
                            const Component = route.component;
                            return (
                                <Route key={route.id} path={route.path.slice(1)} element={<Component />} />
                            );
                        })}

                        <Route path="operations/*" element={<Navigate to="/settings/system-ops" replace />} />
                        <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Route>
                </Routes>
            </BrowserRouter>
        </ConfirmDialogProvider>
    );
}

export default App;
