import { DashboardRouteDefinition, defineDashboardExtension } from '@vendure/dashboard';
import { Mail, MailCheck } from 'lucide-react';

import { IcloudRelayPage } from './icloud-relay-page';

const icloudRelayRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'icloud-relay',
        id: 'icloud-relay-manage',
        url: '/icloud-relay',
        title: 'iCloud 邮箱管理',
        icon: MailCheck,
    },
    path: '/icloud-relay',
    loader: () => ({ breadcrumb: () => 'iCloud 邮箱管理' }),
    component: () => <IcloudRelayPage />,
};

defineDashboardExtension({
    navSections: [
        {
            id: 'icloud-relay',
            title: '邮箱中继',
            icon: Mail,
            order: 560,
            placement: 'top',
        },
    ],
    routes: [icloudRelayRoute],
});
