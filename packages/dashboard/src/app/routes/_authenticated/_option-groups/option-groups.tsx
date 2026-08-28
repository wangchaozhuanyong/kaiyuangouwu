import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRightIcon, Layers3Icon, Link2Icon, PlusIcon } from 'lucide-react';
import { type MouseEvent } from 'react';

import {
    AssignOptionGroupsToChannelBulkAction,
    DeleteOptionGroupsBulkAction,
    RemoveOptionGroupsFromChannelBulkAction,
} from './components/option-group-bulk-actions.js';
import { optionGroupListDocument } from './option-groups.graphql.js';

const optionGroupLibraryLabel = msg({ id: 'nav.optionGroups', message: 'Option groups' });
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
                linkedProducts: true,
            }}
            defaultColumnOrder={['name', 'options', 'linkedProducts']}
            customizeColumns={{
                name: {
                    header: () => <Trans>Specification template</Trans>,
                    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
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
                products: {
                    meta: { disabled: true },
                },
            }}
            additionalColumns={{
                linkedProducts: {
                    meta: { dependencies: ['products'] },
                    header: () => <Trans>Linked products</Trans>,
                    cell: ({ row }) => <LinkedProductsCell products={row.original.products} />,
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
                label: <Trans>Manage template</Trans>,
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

function LinkedProductsCell({
    products,
}: Readonly<{
    products: {
        items: Array<{ id: string; name: string }>;
        totalItems: number;
    };
}>) {
    const { t } = useLingui();
    const remaining = products.totalItems - products.items.length;

    return products.items.length > 0 ? (
        <div className="flex max-w-xl flex-wrap items-center gap-1.5">
            {products.items.map(product => (
                <Link
                    key={product.id}
                    to={`/products/${product.id}`}
                    preload={false}
                    onClick={(event: MouseEvent<HTMLAnchorElement>) => event.stopPropagation()}
                    aria-label={t`Open product ${product.name}`}
                    className={[
                        'inline-flex max-w-48 items-center gap-1 rounded-md bg-muted px-2 py-1',
                        'text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    ].join(' ')}
                >
                    <span className="truncate">{product.name}</span>
                    <ArrowUpRightIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </Link>
            ))}
            {remaining > 0 && <Badge variant="outline">+{remaining}</Badge>}
        </div>
    ) : (
        <span className="text-sm text-muted-foreground">
            <Trans>Not linked to any product</Trans>
        </span>
    );
}

function OptionGroupLibraryLabel() {
    const { i18n } = useLingui();
    return i18n._(optionGroupLibraryLabel);
}

function OptionGroupGuidance() {
    return (
        <section aria-labelledby="option-group-guidance-title" className="rounded-lg bg-muted/40 px-4 py-3">
            <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
                    <Layers3Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                    <p id="option-group-guidance-title" className="font-medium">
                        <Trans>Templates and products are linked in both directions</Trans>
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        <Trans>
                            This list shows which products use each template. Open a product name to manage
                            its templates, or open the template to edit its option values.
                        </Trans>
                    </p>
                    <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Link2Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        <Trans>Changes to a shared template affect every linked product.</Trans>
                    </div>
                </div>
            </div>
        </section>
    );
}
