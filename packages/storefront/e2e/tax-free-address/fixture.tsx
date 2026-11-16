// organize-imports-ignore -- Match the storefront ESLint type import group.
import type { StorefrontContentBlock } from '../../src/types';
import { createRoot } from 'react-dom/client';

import { ClientPluginSlot } from '../../src/client-plugins/client-plugin-registry';

const block = {
    id: 'published-fixture',
    code: 'storefront-client-plugins',
    type: 'CLIENT_PLUGINS',
    enabled: true,
    items: [
        {
            id: 'address-fixture',
            enabled: true,
            position: 0,
            settings: { pluginCode: 'tax-free-address-entry', placement: 'BUSINESS_SERVICES_MAIN' },
        },
    ],
} as StorefrontContentBlock;

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
createRoot(root).render(
    <ClientPluginSlot
        block={block}
        placement="BUSINESS_SERVICES_MAIN"
        language="zh"
        onNavigate={() => undefined}
    />,
);
