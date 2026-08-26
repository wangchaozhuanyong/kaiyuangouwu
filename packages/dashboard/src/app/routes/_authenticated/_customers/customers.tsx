import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { DeleteCustomersBulkAction } from './components/customer-bulk-actions.js';
import { CustomerStatusBadge } from './components/customer-status-badge.js';
import { customerListDocument } from './customers.graphql.js';

export const Route = createFileRoute('/_authenticated/_customers/customers')({
    component: CustomerListPage,
    loader: () => ({ breadcrumb: () => <Trans>Customers</Trans> }),
});

function CustomerListPage() {
    const { t } = useLingui();
    return (
        <ListPage
            title={<Trans>Customers</Trans>}
            pageId="customer-list"
            listQuery={customerListDocument}
            searchPlaceholder={t`Search customer name, phone number or email`}
            onSearchTermChange={searchTerm => {
                return searchTerm
                    ? {
                          lastName: { contains: searchTerm },
                          emailAddress: { contains: searchTerm },
                          phoneNumber: { contains: searchTerm },
                      }
                    : {};
            }}
            transformVariables={variables => {
                return {
                    options: {
                        ...variables.options,
                        filterOperator: 'OR',
                    },
                };
            }}
            route={Route}
            customizeColumns={{
                user: {
                    header: () => <Trans>Account status</Trans>,
                    cell: ({ row }) => {
                        const value = row.original.user;
                        return <CustomerStatusBadge user={value} />;
                    },
                },
                groups: {
                    header: () => <Trans>Customer groups</Trans>,
                    cell: ({ row }) => {
                        return (
                            <div className="flex flex-wrap gap-1">
                                {row.original.groups?.map(g => (
                                    <Badge variant="secondary" key={g.id}>
                                        {g.name}
                                    </Badge>
                                ))}
                            </div>
                        );
                    },
                },
            }}
            additionalColumns={{
                name: {
                    id: 'name',
                    meta: {
                        dependencies: ['id', 'firstName', 'lastName'],
                    },
                    header: () => <Trans>Customer name</Trans>,
                    cell: ({ row }) => {
                        const value = `${row.original.firstName} ${row.original.lastName}`;
                        return <span>{value}</span>;
                    },
                },
            }}
            defaultColumnOrder={['name', 'phoneNumber', 'emailAddress', 'groups', 'user', 'createdAt']}
            defaultVisibility={{
                name: true,
                phoneNumber: true,
                emailAddress: true,
                groups: true,
                user: true,
                createdAt: true,
            }}
            primaryRowAction={{ label: <Trans>View</Trans>, href: row => `./${row.original.id}` }}
            bulkActions={[
                {
                    component: DeleteCustomersBulkAction,
                },
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateCustomer']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon />
                    <Trans>Create customer</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
