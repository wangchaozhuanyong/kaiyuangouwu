import { defineDashboardExtension } from '@vendure/dashboard';

import { StoreDomainPageBlock } from './store-domain-page-block';

defineDashboardExtension({
    pageBlocks: [
        {
            id: 'store-domains',
            title: undefined,
            location: {
                pageId: 'channel-detail',
                column: 'main',
                position: { blockId: 'storefront-connection', order: 'after' },
            },
            component: StoreDomainPageBlock,
            shouldRender: context => Boolean(context.entity?.id),
            requiresPermission: ['UpdateChannel'],
        },
    ],
});
