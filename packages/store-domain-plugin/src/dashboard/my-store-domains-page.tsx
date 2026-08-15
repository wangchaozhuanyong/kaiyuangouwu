import { useLingui } from '@lingui/react';
import {
    DashboardRouteDefinition,
    Page,
    PageBlock,
    PageLayout,
    PageTitle,
    Skeleton,
    useChannel,
} from '@vendure/dashboard';
import { Globe2 } from 'lucide-react';

import { StoreDomainPageBlock } from './store-domain-page-block';

const zhCopy = {
    title: '店铺域名',
    description: '管理当前店铺的独立域名和 DNS 验证。',
};

const enCopy: typeof zhCopy = {
    title: 'Store domains',
    description: 'Manage custom domains and DNS verification for the active store.',
};

export const myStoreDomainsRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'settings',
        id: 'my-store-domains',
        url: '/my-store-domains',
        title: '店铺域名',
        icon: Globe2,
        order: 20,
        requiresPermission: ['ReadStoreDomain'],
    },
    path: '/my-store-domains',
    loader: () => ({ breadcrumb: () => '店铺域名' }),
    component: () => <MyStoreDomainsPage />,
};

function MyStoreDomainsPage() {
    const { i18n } = useLingui();
    const text = i18n.locale.toLowerCase().startsWith('zh') ? zhCopy : enCopy;
    const { activeChannel, isLoading } = useChannel();

    return (
        <Page pageId="my-store-domains">
            <PageTitle>{text.title}</PageTitle>
            <PageLayout>
                <PageBlock
                    column="full"
                    blockId="my-store-domains-management"
                    title={text.title}
                    description={text.description}
                >
                    {isLoading || !activeChannel ? (
                        <div className="space-y-3" aria-busy="true">
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-24 w-full" />
                        </div>
                    ) : (
                        <StoreDomainPageBlock context={{ entity: { id: activeChannel.id } }} />
                    )}
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
