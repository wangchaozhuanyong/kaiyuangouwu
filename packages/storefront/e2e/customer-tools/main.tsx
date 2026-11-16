import { createRoot } from 'react-dom/client';

import { ClientPluginSlot } from '../../src/client-plugins/client-plugin-registry';
import { type StorefrontContentBlock } from '../../src/types';

const block: StorefrontContentBlock = {
    id: 'fixture-tools',
    code: 'storefront-client-plugins',
    type: 'CLIENT_PLUGINS',
    enabled: true,
    position: 0,
    title: '',
    description: '',
    imageUrl: null,
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    startsAt: null,
    endsAt: null,
    settings: null,
    items: ['two-factor-code-tool', 'icloud-mail-query-entry', 'tax-free-address-entry'].map(
        (pluginCode, position) => ({
            id: pluginCode,
            enabled: true,
            position,
            label: '',
            description: '',
            imageUrl: null,
            targetType: 'NONE',
            targetValue: null,
            settings: { pluginCode, placement: 'BUSINESS_SERVICES_MAIN' },
        }),
    ),
};
const language = new URL(location.href).searchParams.get('lang') === 'en' ? 'en' : 'zh';
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
createRoot(root).render(
    <ClientPluginSlot
        block={block}
        placement="BUSINESS_SERVICES_MAIN"
        language={language}
        onNavigate={() => undefined}
    />,
);
