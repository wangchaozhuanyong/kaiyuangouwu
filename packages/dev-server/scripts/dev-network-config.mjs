export function resolveDevelopmentNetwork({ mode, ensurePortlessProxy, getPortlessUrl }) {
    const usePortless = mode !== 'direct';
    if (usePortless) {
        ensurePortlessProxy();
    }
    const apiOrigin = usePortless ? getPortlessUrl('vendure') : 'http://localhost:3000';
    const dashboardOrigin = usePortless ? getPortlessUrl('dashboard.vendure') : 'http://localhost:5173';
    const dashboardUrl = dashboardOrigin;

    return {
        usePortless,
        apiOrigin,
        dashboardOrigin,
        dashboardUrl,
        sharedEnv: {
            VENDURE_SERVE_GRAPHIQL: 'false',
            VENDURE_SERVE_STATIC_DASHBOARD: 'false',
            VENDURE_DASHBOARD_URL: dashboardUrl,
            VITE_VENDURE_ADMIN_API_URL: `${apiOrigin}/admin-api`,
            ...(usePortless ? { VENDURE_TRUST_PROXY: 'true' } : {}),
        },
        serverEnv: usePortless ? {} : { API_PORT: '3000', PORT: '3000' },
        dashboardEnv: usePortless ? {} : { API_PORT: '3000', PORT: '5173' },
    };
}
