import { lazyRouteComponent, useRouter } from '@tanstack/react-router';

import { requestMdacFlights } from '../client-plugins/mdac/flight-lookup';
import { usePageRouteCommit } from '../page-readiness';
import { storefrontQueryKeys } from '../query-client';
import { storefrontErrorMessage } from '../storefront-errors';
import { hasStorefrontBackSource } from '../storefront-navigation-history';
import { AsyncRouteStatePage } from '../storefront-ui/page-shell';

import { registerRoutePreload, useRouteRuntime as useRuntime } from './shared';

const MdacPage = lazyRouteComponent(() => import('../client-plugins/mdac/mdac-page'), 'MdacPage');

export function MdacRoutePage() {
    usePageRouteCommit();
    const runtime = useRuntime();
    const router = useRouter({ warn: false });
    const onBack = router && hasStorefrontBackSource(router) ? runtime.goBack : undefined;
    const plugin = runtime.contentBlocks
        .filter(
            block =>
                block.enabled &&
                block.code === 'storefront-client-plugins' &&
                block.type === 'CLIENT_PLUGINS',
        )
        .flatMap(block => block.items)
        .find(
            item =>
                item.enabled &&
                item.settings?.pluginCode === 'mdac-entry' &&
                typeof window !== 'undefined' &&
                item.settings.allowedHost === window.location.hostname,
        );
    if (runtime.contentQuery.data === undefined)
        return (
            <AsyncRouteStatePage
                routeName="mdac"
                state={runtime.contentQuery.isError ? 'error' : 'loading'}
                error={
                    runtime.contentQuery.isError
                        ? storefrontErrorMessage(runtime.contentQuery.error, runtime.language)
                        : ''
                }
                language={runtime.language}
                onBack={onBack}
                onRetry={() => void runtime.contentQuery.refetch({ cancelRefetch: false })}
            />
        );
    if (!plugin)
        return (
            <AsyncRouteStatePage
                routeName="mdac"
                state="error"
                error={
                    runtime.language === 'zh'
                        ? '当前店铺尚未开启入境卡助手'
                        : 'Malaysia arrival card is not enabled in this store'
                }
                language={runtime.language}
                onBack={onBack}
                onRetry={() => void runtime.contentQuery.refetch({ cancelRefetch: false })}
            />
        );
    return (
        <MdacPage
            language={runtime.language}
            storeName={runtime.storefrontName}
            onBack={onBack}
            flightService={
                plugin.settings?.flightLookupEnabled === true
                    ? {
                          marketKey: storefrontQueryKeys.market(runtime.market),
                          lookup: (input, signal) => requestMdacFlights(runtime.api, input, signal),
                      }
                    : undefined
            }
        />
    );
}

export const preloadMdacRoutePage = registerRoutePreload(MdacRoutePage, MdacPage);
