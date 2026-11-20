// organize-imports-ignore -- Load shared controls before the recharge page's responsive styles.
import type { StorefrontLanguage } from '../types';
import './styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { standaloneRechargeApi } from '../api/standalone-recharge';
import { GptRechargePage } from '../client-plugins/gpt-recharge/gpt-recharge-page';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { PageReadinessBoundary } from '../page-readiness';
import { storefrontQueryClient, storefrontQueryKeys } from '../query-client';

type Tab = 'recharge' | 'query' | 'guide';
function readLocation(): { tab: Tab; language: StorefrontLanguage } {
    const params = new URLSearchParams(window.location.search);
    const rawTab = params.get('tab');
    return {
        tab: rawTab === 'query' || rawTab === 'guide' ? rawTab : 'recharge',
        language: params.get('lang') === 'en' ? 'en' : 'zh',
    };
}

function RechargePortal() {
    const [{ tab, language }, setLocation] = useState(readLocation);
    const online = useOnlineStatus();
    const marketKey = 'recharge-portal:' + window.location.pathname.replace(/\/$/u, '');
    useEffect(() => {
        const onPop = () => setLocation(readLocation());
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);
    useEffect(() => {
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
        const titles =
            language === 'zh'
                ? { recharge: '自助充值', query: '兑换码查询', guide: '使用说明' }
                : { recharge: 'Recharge', query: 'Code lookup', guide: 'Guide' };
        document.title = titles[tab] + (language === 'zh' ? ' · 兑换服务中心' : ' · Redemption center');
    }, [tab, language]);
    function navigate(nextTab: Tab, nextLanguage: StorefrontLanguage) {
        if (nextTab === tab && nextLanguage === language) return;
        const url = new URL('/', window.location.origin);
        url.pathname = window.location.pathname;
        if (nextTab !== 'recharge') url.searchParams.set('tab', nextTab);
        if (nextLanguage === 'en') url.searchParams.set('lang', 'en');
        if (nextTab === tab) window.history.replaceState(null, '', url);
        else window.history.pushState(null, '', url);
        setLocation({ tab: nextTab, language: nextLanguage });
    }
    return (
        <PageReadinessBoundary
            pending={false}
            online={online}
            language={language}
            onBack={() => navigate('recharge', language)}
            onRetry={() =>
                void storefrontQueryClient.refetchQueries(
                    {
                        queryKey: [
                            ...storefrontQueryKeys.privateScope(marketKey, language),
                            'gpt-recharge',
                            'config',
                        ],
                        type: 'active',
                    },
                    { cancelRefetch: false },
                )
            }
        >
            <GptRechargePage
                standalone
                marketKey={marketKey}
                client={standaloneRechargeApi}
                language={language}
                activeTab={tab}
                onTabChange={next => navigate(next, language)}
                onToggleLanguage={() => navigate(tab, language === 'zh' ? 'en' : 'zh')}
            />
        </PageReadinessBoundary>
    );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing redemption center root');
createRoot(root).render(
    <QueryClientProvider client={storefrontQueryClient}>
        <RechargePortal />
    </QueryClientProvider>,
);
