import { ChannelSelector } from '@/vdb/components/shared/channel-selector.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import {
    sensitiveActionHeaders,
    SensitiveActionPasswordField,
} from '@/vdb/components/shared/sensitive-action-password.js';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/vdb/components/ui/alert-dialog.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import {
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
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { FormEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PermissionsTableGrid } from './components/permissions-table-grid.js';
import { createRoleDocument, roleDetailDocument, updateRoleDocument } from './roles.graphql.js';

const pageId = 'role-detail';

export const Route = createFileRoute('/_authenticated/_roles/roles_/$id')({
    component: RoleDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: roleDetailDocument,
        breadcrumb(isNew, entity) {
            return [
                { path: '/roles', label: <Trans>Roles</Trans> },
                isNew ? <Trans>New role</Trans> : entity?.description,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function RoleDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const [passwordConfirmationOpen, setPasswordConfirmationOpen] = useState(false);
    const [password, setPassword] = useState('');
    const confirmedPasswordRef = useRef('');
    const pendingFormRef = useRef<HTMLFormElement | null>(null);
    const allowNextSubmitRef = useRef(false);

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: roleDetailDocument,
        createDocument: createRoleDocument,
        updateDocument: updateRoleDocument,
        getUpdateRequestHeaders: () => sensitiveActionHeaders(confirmedPasswordRef.current),
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                code: entity.code,
                description: entity.description,
                permissions: entity.permissions,
                channelIds: entity.channels.map(channel => channel.id),
            };
        },
        params: { id: params.id },
        onSuccess: async data => {
            confirmedPasswordRef.current = '';
            toast.success(creatingNewEntity ? t`Successfully created role` : t`Successfully updated role`);
            resetForm();
            if (creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            confirmedPasswordRef.current = '';
            toast.error(creatingNewEntity ? t`Failed to create role` : t`Failed to update role`, {
                description: err instanceof Error ? err.message : t`Unknown error`,
            });
        },
    });

    const securedSubmitHandler = (event: FormEvent<HTMLFormElement>) => {
        if (creatingNewEntity || allowNextSubmitRef.current) {
            allowNextSubmitRef.current = false;
            submitHandler(event);
            return;
        }
        event.preventDefault();
        pendingFormRef.current = event.currentTarget;
        setPasswordConfirmationOpen(true);
    };

    const handlePasswordDialogChange = (open: boolean) => {
        setPasswordConfirmationOpen(open);
        if (!open) setPassword('');
    };

    const handleConfirmUpdate = () => {
        if (!password) return;
        confirmedPasswordRef.current = password;
        allowNextSubmitRef.current = true;
        setPasswordConfirmationOpen(false);
        setPassword('');
        pendingFormRef.current?.requestSubmit();
    };

    return (
        <Page pageId={pageId} form={form} submitHandler={securedSubmitHandler} entity={entity}>
            <PageTitle>{creatingNewEntity ? <Trans>New role</Trans> : (entity?.description ?? '')}</PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateAdministrator']}>
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                    >
                        {creatingNewEntity ? <Trans>Create</Trans> : <Trans>Update</Trans>}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="description"
                            label={<Trans>Description</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="code"
                            label={<Trans>Code</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <PageBlock column="main" blockId="channels">
                    <div className="space-y-8">
                        <div className="md:grid md:grid-cols-2 gap-4">
                            <FormFieldWrapper
                                control={form.control}
                                name="channelIds"
                                label={<Trans>Managed stores</Trans>}
                                description={
                                    <Trans>
                                        This role can only view and manage data for the selected stores.
                                    </Trans>
                                }
                                render={({ field }) => (
                                    <ChannelSelector
                                        multiple={true}
                                        value={field.value ?? []}
                                        onChange={value => field.onChange(value)}
                                    />
                                )}
                            />
                        </div>
                        <FormFieldWrapper
                            control={form.control}
                            name="permissions"
                            label={<Trans>Permissions</Trans>}
                            render={({ field }) => (
                                <PermissionsTableGrid
                                    value={field.value ?? []}
                                    onChange={value => field.onChange(value)}
                                />
                            )}
                        />
                    </div>
                </PageBlock>
            </PageLayout>
            <AlertDialog open={passwordConfirmationOpen} onOpenChange={handlePasswordDialogChange}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            <Trans>Confirm role changes</Trans>
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            <Trans>
                                Changing role permissions can immediately affect administrator access. Enter
                                your current password to continue.
                            </Trans>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <SensitiveActionPasswordField
                        value={password}
                        onChange={setPassword}
                        disabled={isPending}
                    />
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={() => handlePasswordDialogChange(false)}>
                            <Trans>Cancel</Trans>
                        </AlertDialogCancel>
                        <AlertDialogAction
                            type="button"
                            onClick={handleConfirmUpdate}
                            disabled={!password || isPending}
                        >
                            <Trans>Update role</Trans>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Page>
    );
}
