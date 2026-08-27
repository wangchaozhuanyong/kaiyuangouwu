import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { channelListQuery } from './channels.graphql.js';
import { DeleteChannelsBulkAction } from './components/channel-bulk-actions.js';

export const Route = createFileRoute('/_authenticated/_channels/channels')({
    component: ChannelListPage,
    loader: () => ({ breadcrumb: () => <Trans>Stores</Trans> }),
});

function ChannelListPage() {
    const { formatLanguageName } = useLocalFormat();
    const { activeChannel } = useChannel();
    return (
        <ListPage
            pageId="channel-list"
            title={<Trans>Stores</Trans>}
            listQuery={channelListQuery}
            route={Route}
            defaultVisibility={{
                code: true,
                token: false,
                availableCurrencyCodes: false,
                availableLanguageCodes: false,
                defaultCurrencyCode: true,
                defaultLanguageCode: true,
                defaultTaxZone: false,
                defaultShippingZone: false,
                currentStore: true,
            }}
            onSearchTermChange={searchTerm => {
                return {
                    code: { contains: searchTerm },
                };
            }}
            customizeColumns={{
                code: {
                    header: () => <Trans>Store name</Trans>,
                    cell: ({ row }) => {
                        return (
                            <DetailPageButton
                                id={row.original.id}
                                label={<ChannelCodeLabel code={row.original.code} />}
                            />
                        );
                    },
                },
                seller: {
                    header: () => <Trans>Operating entity</Trans>,
                    cell: ({ row }) => {
                        return row.original.seller?.name;
                    },
                },
                defaultLanguageCode: {
                    header: () => <Trans>Default content language</Trans>,
                    cell: ({ row }) => {
                        return formatLanguageName(row.original.defaultLanguageCode);
                    },
                },
                defaultCurrencyCode: {
                    header: () => <Trans>Settlement currency</Trans>,
                },
                token: {
                    header: () => <Trans>Store API token</Trans>,
                    cell: ({ row }) => (
                        <DetailPageButton id={row.original.id} label={<Trans>View details</Trans>} />
                    ),
                },
            }}
            additionalColumns={{
                currentStore: {
                    meta: { dependencies: ['id'] },
                    header: () => <Trans>Status</Trans>,
                    cell: ({ row }) =>
                        row.original.id === activeChannel?.id ? (
                            <Badge variant="secondary">
                                <Trans>Currently managing</Trans>
                            </Badge>
                        ) : (
                            <span className="text-sm text-muted-foreground">
                                <Trans>Available</Trans>
                            </span>
                        ),
                    enableSorting: false,
                },
            }}
            defaultColumnOrder={[
                'currentStore',
                'code',
                'seller',
                'defaultCurrencyCode',
                'defaultLanguageCode',
                'token',
            ]}
            bulkActions={[
                {
                    component: DeleteChannelsBulkAction,
                },
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateChannel']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>Create store</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
