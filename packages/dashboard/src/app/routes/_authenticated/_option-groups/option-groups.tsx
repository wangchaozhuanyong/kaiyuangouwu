import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRightIcon, Layers3Icon, PlusIcon } from 'lucide-react';
import {
    AssignOptionGroupsToChannelBulkAction,
    DeleteOptionGroupsBulkAction,
    RemoveOptionGroupsFromChannelBulkAction,
} from './components/option-group-bulk-actions.js';
import { optionGroupListDocument } from './option-groups.graphql.js';

const optionGroupLibraryLabel = msg({ id: 'nav.optionGroups', message: 'Option groups' });
const exampleOptionValues = ['S', 'M', 'L'].join(' / ');

export const Route = createFileRoute('/_authenticated/_option-groups/option-groups')({
    component: OptionGroupListPage,
    loader: () => ({ breadcrumb: () => <OptionGroupLibraryLabel /> }),
});

function OptionGroupListPage() {
    const { t } = useLingui();

    return (
        <ListPage
            pageId="option-group-list"
            title={<OptionGroupLibraryLabel />}
            description={<OptionGroupGuidance />}
            listQuery={optionGroupListDocument}
            searchPlaceholder={t`Search option groups...`}
            simpleToolbar={true}
            defaultVisibility={{
                name: true,
                options: true,
                productCount: true,
            }}
            defaultColumnOrder={['name', 'options', 'productCount']}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <span>{row.original.name}</span>,
                },
                code: {
                    meta: { disabled: true },
                },
                options: {
                    header: () => <Trans>Option Values</Trans>,
                    cell: ({ row }) => {
                        const visibleOptions = row.original.options.slice(0, 4);
                        const remaining = row.original.options.length - visibleOptions.length;
                        return row.original.options.length ? (
                            <div className="flex max-w-xl flex-wrap items-center gap-1.5">
                                {visibleOptions.map(option => (
                                    <Badge key={option.id} variant="secondary">
                                        {option.name}
                                    </Badge>
                                ))}
                                {remaining > 0 && <Badge variant="outline">+{remaining}</Badge>}
                            </div>
                        ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                        );
                    },
                },
                productCount: {
                    header: () => <Trans>Products</Trans>,
                },
            }}
            onSearchTermChange={searchTerm => {
                return {
                    name: { contains: searchTerm },
                };
            }}
            bulkActions={[
                [
                    {
                        order: 100,
                        component: AssignOptionGroupsToChannelBulkAction,
                    },
                    {
                        order: 200,
                        component: RemoveOptionGroupsFromChannelBulkAction,
                    },
                ],
                [
                    {
                        component: DeleteOptionGroupsBulkAction,
                    },
                ],
            ]}
            primaryRowAction={{
                label: (
                    <span>
                        <Trans>Edit</Trans> <Trans>Option Values</Trans>
                    </span>
                ),
                href: row => `./${row.original.id}`,
            }}
            route={Route}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateProduct', 'CreateCatalog']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>New Option Group</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}

function OptionGroupLibraryLabel() {
    const { i18n } = useLingui();
    return i18n._(optionGroupLibraryLabel);
}

function OptionGroupGuidance() {
    return (
        <section
            aria-labelledby="option-group-guidance-title"
            className="rounded-lg border bg-muted/30 px-4 py-3"
        >
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
                        <Layers3Icon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div>
                        <p id="option-group-guidance-title" className="font-medium">
                            <Trans>Recommended workflow</Trans>
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            <Trans>Assign an existing option group or create a new one</Trans>
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline" className="gap-1.5 py-1.5">
                        <Trans>Option Groups</Trans>
                        <span className="font-normal text-muted-foreground">
                            <Trans>For example: Size</Trans>
                        </span>
                    </Badge>
                    <ArrowRightIcon className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="outline" className="gap-1.5 py-1.5">
                        <Trans>Option Values</Trans>
                        <span className="font-normal text-muted-foreground">{exampleOptionValues}</span>
                    </Badge>
                    <ArrowRightIcon className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="outline" className="py-1.5">
                        <Trans>Variants</Trans>
                    </Badge>
                </div>
            </div>
        </section>
    );
}
