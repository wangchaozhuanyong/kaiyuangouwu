import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import {
    CustomFieldsPageBlock,
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
import { createSellerDocument, sellerDetailDocument, updateSellerDocument } from './sellers.graphql.js';

const pageId = 'seller-detail';

export const Route = createFileRoute('/_authenticated/_sellers/sellers_/$id')({
    component: SellerDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: sellerDetailDocument,
        breadcrumb: (isNew, entity) => [
            { path: '/sellers', label: <Trans>Sellers</Trans> },
            isNew ? <Trans>New seller</Trans> : entity?.name,
        ],
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function SellerDetailPage() {
    const params = Route.useParams();
    return <SellerEditor sellerId={params.id} />;
}

export interface SellerEditorProps {
    sellerId: string;
    presentation?: 'page' | 'sheet';
    onDirtyChange?: (isDirty: boolean) => void;
    onRequestClose?: () => void;
    onSaved?: (behavior: 'close' | 'keep-open') => void;
}

export function SellerEditor({
    sellerId,
    presentation = 'page',
    onDirtyChange,
    onRequestClose,
    onSaved,
}: Readonly<SellerEditorProps>) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const createAnotherRef = useRef(false);
    const creatingNewEntity = sellerId === NEW_ENTITY_PATH;
    const { t } = useLingui();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: sellerDetailDocument,
        createDocument: createSellerDocument,
        updateDocument: updateSellerDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                name: entity.name,
                customFields: entity.customFields,
            };
        },
        params: { id: sellerId },
        onSuccess: async data => {
            toast(creatingNewEntity ? t`Successfully created seller` : t`Successfully updated seller`);
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
            if (presentation === 'page' && creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast(creatingNewEntity ? t`Failed to create seller` : t`Failed to update seller`, {
                description: err instanceof Error ? err.message : t`Unknown error`,
            });
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
            <PageTitle>{creatingNewEntity ? <Trans>New seller</Trans> : (entity?.name ?? '')}</PageTitle>
            <PageActionBar>
                {presentation === 'sheet' && (
                    <Button
                        type="button"
                        variant="outline"
                        render={<Link to={`/sellers/${sellerId}`} preload={false} />}
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
                    requiresPermission={[creatingNewEntity ? 'CreateSeller' : 'UpdateSeller']}
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
                    <div className="md:flex w-full gap-4">
                        <div className="w-1/2">
                            <FormFieldWrapper
                                control={form.control}
                                name="name"
                                label={<Trans>Name</Trans>}
                                render={({ field }) => <Input placeholder="" {...field} />}
                            />
                        </div>
                    </div>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Seller" control={form.control} />
            </PageLayout>
        </Page>
    );
}
