import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import {
    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { detailPageRouteLoader } from '@/vdb/framework/page/detail-page-route-loader.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ExternalLink, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { CustomerGroupMembersTable } from './components/customer-group-members-table.js';
import {
    createCustomerGroupDocument,
    customerGroupDetailDocument,
    updateCustomerGroupDocument,
} from './customer-groups.graphql.js';

const pageId = 'customer-group-detail';

export const Route = createFileRoute('/_authenticated/_customer-groups/customer-groups_/$id')({
    component: CustomerGroupDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: customerGroupDetailDocument,
        breadcrumb: (isNew, entity) => [
            { path: '/customer-groups', label: <Trans>Customer Groups</Trans> },
            isNew ? <Trans>New customer group</Trans> : entity?.name,
        ],
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function CustomerGroupDetailPage() {
    const params = Route.useParams();
    return <CustomerGroupEditor customerGroupId={params.id} />;
}

export interface CustomerGroupEditorProps {
    customerGroupId: string;
    presentation?: 'page' | 'sheet';
    onDirtyChange?: (isDirty: boolean) => void;
    onRequestClose?: () => void;
    onSaved?: (behavior: 'close' | 'keep-open') => void;
}

export function CustomerGroupEditor({
    customerGroupId,
    presentation = 'page',
    onDirtyChange,
    onRequestClose,
    onSaved,
}: Readonly<CustomerGroupEditorProps>) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const createAnotherRef = useRef(false);
    const creatingNewEntity = customerGroupId === NEW_ENTITY_PATH;
    const { t } = useLingui();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: customerGroupDetailDocument,
        createDocument: createCustomerGroupDocument,
        updateDocument: updateCustomerGroupDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                name: entity.name,
                customFields: entity.customFields,
            };
        },
        params: { id: customerGroupId },
        onSuccess: async data => {
            toast.success(
                creatingNewEntity
                    ? t`Successfully created customer group`
                    : t`Successfully updated customer group`,
            );
            void queryClient.invalidateQueries({ queryKey: ['PaginatedListDataTable'] });
            if (presentation === 'sheet') {
                if (creatingNewEntity && createAnotherRef.current) {
                    createAnotherRef.current = false;
                    form.reset();
                    onSaved?.('keep-open');
                } else {
                    resetForm();
                    onSaved?.('close');
                }
            } else {
                resetForm();
            }
            if (presentation === 'page' && creatingNewEntity && data?.id) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast.error(
                creatingNewEntity ? t`Failed to create customer group` : t`Failed to update customer group`,
                {
                    description: err instanceof Error ? err.message : t`Unknown error`,
                },
            );
        },
    });

    useEffect(() => {
        onDirtyChange?.(form.formState.isDirty);
    }, [form.formState.isDirty, onDirtyChange]);

    return (
        <Page
            pageId={pageId}
            form={form}
            submitHandler={submitHandler}
            entity={entity}
            className={presentation === 'sheet' ? 'm-0 min-w-0 p-4' : undefined}
        >
            <PageTitle>
                {creatingNewEntity ? <Trans>New customer group</Trans> : (entity?.name ?? '')}
            </PageTitle>
            <PageActionBar>
                {presentation === 'sheet' && (
                    <Button
                        type="button"
                        variant="outline"
                        render={<Link to={`/customer-groups/${customerGroupId}`} preload={false} />}
                    >
                        <ExternalLink className="h-4 w-4" />
                        <Trans>Open full page</Trans>
                    </Button>
                )}
                {presentation === 'sheet' && creatingNewEntity && (
                    <Button
                        type="submit"
                        variant="outline"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                        onClick={() => {
                            createAnotherRef.current = true;
                        }}
                    >
                        {isPending ? <Trans>Saving...</Trans> : <Trans>Save and add another</Trans>}
                    </Button>
                )}
                <ActionBarItem
                    itemId="save-button"
                    requiresPermission={[creatingNewEntity ? 'CreateCustomerGroup' : 'UpdateCustomerGroup']}
                >
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                        onClick={() => {
                            createAnotherRef.current = false;
                        }}
                    >
                        {isPending ? (
                            <Trans>Saving...</Trans>
                        ) : creatingNewEntity ? (
                            <Trans>Create</Trans>
                        ) : (
                            <Trans>Update</Trans>
                        )}
                    </Button>
                </ActionBarItem>
                {presentation === 'sheet' && onRequestClose && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={onRequestClose}
                        aria-label={t`Close`}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                )}
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="name"
                            label={<Trans>Name</Trans>}
                            render={({ field }) => <Input placeholder="" {...field} />}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="CustomerGroup" control={form.control} />
                {entity && (
                    <PageBlock column="main" blockId="customers" title={<Trans>Customers</Trans>}>
                        <CustomerGroupMembersTable customerGroupId={entity?.id} />
                    </PageBlock>
                )}
            </PageLayout>
        </Page>
    );
}
