import { useLingui } from '@lingui/react/macro';
import { DashboardRouteDefinition, defineDashboardExtension } from '@vendure/dashboard';
import { Bot, KeyRound } from 'lucide-react';

import { messages } from './messages';
import { TwoFactorSessionGuardProvider } from './session-guard-provider';
import { TwoFactorPage } from './two-factor-page';

const twoFactorRoute: DashboardRouteDefinition = {
    navMenuItem: {
        sectionId: 'ai-services',
        id: 'two-factor-codes',
        url: '/two-factor-codes',
        title: messages.title.id,
        icon: KeyRound,
    },
    path: '/two-factor-codes',
    loader: () => ({ breadcrumb: () => <TwoFactorBreadcrumb /> }),
    component: () => <TwoFactorPage />,
};

defineDashboardExtension({
    navSections: [
        {
            id: 'ai-services',
            title: messages.navSection.id,
            icon: Bot,
            order: 550,
            placement: 'top',
        },
    ],
    routes: [twoFactorRoute],
    customProviders: [
        {
            id: 'two-factor-session-guard',
            component: TwoFactorSessionGuardProvider,
            location: 'app',
        },
    ],
});

function TwoFactorBreadcrumb() {
    const { t } = useLingui();
    return t(messages.title);
}
