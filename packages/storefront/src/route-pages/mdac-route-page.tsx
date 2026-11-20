import { lazyRouteComponent, useRouter } from '@tanstack/react-router';

import { usePageRouteCommit } from '../page-readiness';
import { storefrontErrorMessage } from '../storefront-errors';
import { AsyncRouteStatePage } from '../storefront-ui/page-shell';

import { registerRoutePreload, useRouteRuntime as useRuntime } from './shared';

const MdacPage = lazyRouteComponent(() => import('../client-plugins/mdac/mdac-page'), 'MdacPage');

export function MdacRoutePage() {
    usePageRouteCommit();
    const runtime = useRuntime();
    const router = useRouter({ warn: false });
    const enabled = runtime.contentBlocks.some(
        block =>
            block.enabled &&
            block.code === 'storefront-client-plugins' &&
            block.type === 'CLIENT_PLUGINS' &&
            block.items.some(
                item =>
                    item.enabled &&
                    item.settings?.pluginCode === 'mdac-entry' &&
                    typeof window !== 'undefined' &&
                    item.settings.allowedHost === window.location.hostname,
            ),
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
                onBack={runtime.goBack}
                onRetry={() => void runtime.contentQuery.refetch({ cancelRefetch: false })}
            />
        );
    if (!enabled)
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
                onBack={runtime.goBack}
                onRetry={() => void runtime.contentQuery.refetch({ cancelRefetch: false })}
            />
        );
    return (
        <MdacPage
            language={runtime.language}
            storeName={runtime.storefrontName}
            onBack={router?.history.canGoBack() ? runtime.goBack : undefined}
        />
    );
}

export const preloadMdacRoutePage = registerRoutePreload(MdacRoutePage, MdacPage);
