import { AuthContext, type AuthContext as AuthContextValue } from '@/vdb/providers/auth.js';
import {
    ChannelContext,
    type Channel,
    type ChannelContext as ChannelContextValue,
} from '@/vdb/providers/channel-provider.js';
import { I18nProvider } from '@/vdb/providers/i18n-provider.js';
import { Theme, ThemeProvider } from '@/vdb/providers/theme-provider.js';
import {
    UserSettingsContext,
    type UserSettings,
    type UserSettingsContextType,
} from '@/vdb/providers/user-settings.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    AnyRoute,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
} from '@tanstack/react-router';
import { PropsWithChildren, useMemo, useState } from 'react';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: false,
            staleTime: Infinity,
            networkMode: 'offlineFirst',
        },
    },
});

const storybookChannel = {
    id: '1',
    code: 'default-channel',
    token: 'storybook-channel',
    defaultLanguageCode: 'en',
    defaultCurrencyCode: 'USD',
    pricesIncludeTax: false,
    availableLanguageCodes: ['en'],
    availableCurrencyCodes: ['USD'],
} as Channel;

const storybookAuth: AuthContextValue = {
    status: 'authenticated',
    isAuthenticated: true,
    user: undefined,
    channels: [
        {
            id: storybookChannel.id,
            code: storybookChannel.code,
            token: storybookChannel.token,
            permissions: ['SuperAdmin'],
        },
    ] as NonNullable<AuthContextValue['channels']>,
    login: (_username, _password, onSuccess) => onSuccess?.(),
    logout: async onSuccess => onSuccess?.(),
    refreshCurrentUser: () => undefined,
};

const storybookChannelContext: ChannelContextValue = {
    isLoading: false,
    channels: [storybookChannel],
    activeChannel: {
        ...storybookChannel,
        defaultTaxZone: { id: '1' },
    } as NonNullable<ChannelContextValue['activeChannel']>,
    setActiveChannel: () => undefined,
    refreshChannels: () => undefined,
};

const initialSettings: UserSettings = {
    displayLanguage: 'en',
    displayLocale: 'US',
    contentLanguage: 'en',
    theme: 'system',
    displayUiExtensionPoints: false,
    mainNavExpanded: true,
    activeChannelId: storybookChannel.id,
    devMode: false,
    hasSeenOnboarding: true,
    tableSettings: {},
    widgetLayout: {},
};

function StorybookUserSettingsProvider({ children }: PropsWithChildren) {
    const [settings, setSettings] = useState<UserSettings>(initialSettings);

    const value = useMemo<UserSettingsContextType>(
        () => ({
            settingsStoreIsAvailable: false,
            settings,
            setDisplayLanguage: displayLanguage =>
                setSettings(current => ({ ...current, displayLanguage })),
            setDisplayLocale: displayLocale => setSettings(current => ({ ...current, displayLocale })),
            setContentLanguage: contentLanguage =>
                setSettings(current => ({ ...current, contentLanguage })),
            setTheme: theme => setSettings(current => ({ ...current, theme })),
            setDisplayUiExtensionPoints: displayUiExtensionPoints =>
                setSettings(current => ({ ...current, displayUiExtensionPoints })),
            setMainNavExpanded: mainNavExpanded =>
                setSettings(current => ({ ...current, mainNavExpanded })),
            setActiveChannelId: activeChannelId =>
                setSettings(current => ({ ...current, activeChannelId })),
            setDevMode: devMode => setSettings(current => ({ ...current, devMode })),
            setHasSeenOnboarding: hasSeenOnboarding =>
                setSettings(current => ({ ...current, hasSeenOnboarding })),
            setTableSettings: (tableId, key, tableValue) =>
                setSettings(current => ({
                    ...current,
                    tableSettings: {
                        ...current.tableSettings,
                        [tableId]: {
                            ...current.tableSettings?.[tableId],
                            [key]: tableValue,
                        },
                    },
                })),
            setWidgetLayout: widgetLayout => setSettings(current => ({ ...current, widgetLayout })),
        }),
        [settings],
    );

    return <UserSettingsContext.Provider value={value}>{children}</UserSettingsContext.Provider>;
}

/**
 * Deterministic Storybook providers. They deliberately avoid the real AuthProvider,
 * ChannelProvider and UserSettingsProvider so rendering a story never logs into or
 * fetches from a Vendure server as a side effect.
 */
export function CommonProviders({
    children,
    defaultTheme = 'light',
}: {
    children: React.ReactNode;
    defaultTheme?: Theme;
}) {
    return (
        <QueryClientProvider client={queryClient}>
            <StorybookUserSettingsProvider>
                <AuthContext.Provider value={storybookAuth}>
                    <I18nProvider>
                        <ThemeProvider defaultTheme={defaultTheme}>
                            <ChannelContext.Provider value={storybookChannelContext}>
                                {children}
                            </ChannelContext.Provider>
                        </ThemeProvider>
                    </I18nProvider>
                </AuthContext.Provider>
            </StorybookUserSettingsProvider>
        </QueryClientProvider>
    );
}

/** Required by stories that need a Tanstack Router Route object. */
export function createDemoRoute(path?: string, initialPath?: string) {
    const rootRoute = createRootRoute();
    const route = createRoute({
        getParentRoute: () => rootRoute,
        path: path ?? 'test',
        component: () => <div>Test Route</div>,
        loader: () => ({ breadcrumb: 'Test' }),
    });
    const router = createRouter({
        routeTree: rootRoute.addChildren([route]),
        history: createMemoryHistory({
            initialEntries: [initialPath ?? '/test'],
        }),
    });
    return { route, router };
}

/** A wrapper around components that need a Tanstack Router context. */
export function DemoRouterProvider(props: {
    path?: string;
    initialPath?: string;
    component: (route: AnyRoute) => React.ReactNode;
}) {
    const rootRoute = createRootRoute();
    const route = createRoute({
        getParentRoute: () => rootRoute,
        path: props.path ?? 'test',
        component: () => props.component(route),
        loader: () => ({ breadcrumb: 'Test' }),
    });

    const router = createRouter({
        routeTree: rootRoute.addChildren([route]),
        history: createMemoryHistory({
            initialEntries: [props.initialPath ?? '/test'],
        }),
    });

    return <RouterProvider router={router} />;
}
