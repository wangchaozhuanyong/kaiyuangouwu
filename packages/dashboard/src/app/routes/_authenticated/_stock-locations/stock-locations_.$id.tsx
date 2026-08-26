import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Textarea } from '@/vdb/components/ui/textarea.js';
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
import {
    createStockLocationDocument,
    stockLocationDetailQuery,
    updateStockLocationDocument,
} from './stock-locations.graphql.js';

const pageId = 'stock-location-detail';

export const Route = createFileRoute('/_authenticated/_stock-locations/stock-locations_/$id')({
    component: StockLocationDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: stockLocationDetailQuery,
        breadcrumb(isNew, entity) {
            return [
                { path: '/stock-locations', label: <Trans>Stock Locations</Trans> },
                isNew ? <Trans>New stock location</Trans> : entity?.name,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function StockLocationDetailPage() {
    const params = Route.useParams();
    return <StockLocationEditor stockLocationId={params.id} />;
}

export interface StockLocationEditorProps {
    stockLocationId: string;
    presentation?: 'page' | 'sheet';
    onDirtyChange?: (isDirty: boolean) => void;
    onRequestClose?: () => void;
    onSaved?: (behavior: 'close' | 'keep-open') => void;
}

export function StockLocationEditor({
    stockLocationId,
    presentation = 'page',
    onDirtyChange,
    onRequestClose,
    onSaved,
}: Readonly<StockLocationEditorProps>) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const createAnotherRef = useRef(false);
    const creatingNewEntity = stockLocationId === NEW_ENTITY_PATH;
    const { t } = useLingui();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: stockLocationDetailQuery,
        createDocument: createStockLocationDocument,
        updateDocument: updateStockLocationDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                name: entity.name,
                description: entity.description,
                customFields: entity.customFields,
            };
        },
        params: { id: stockLocationId },
        onSuccess: async data => {
            toast.success(
                creatingNewEntity
                    ? t`Successfully created stock location`
                    : t`Successfully updated stock location`,
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
            if (presentation === 'page' && creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast.error(
                creatingNewEntity ? t`Failed to create stock location` : t`Failed to update stock location`,
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
                {creatingNewEntity ? <Trans>New stock location</Trans> : (entity?.name ?? '')}
            </PageTitle>
            <PageActionBar>
                {presentation === 'sheet' && (
                    <Button
                        type="button"
                        variant="outline"
                        render={<Link to={`/stock-locations/${stockLocationId}`} preload={false} />}
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
                    requiresPermission={[creatingNewEntity ? 'CreateStockLocation' : 'UpdateStockLocation']}
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
                            label={<Trans>Name</Trans>}
                            name="name"
                            render={({ field }) => <Input {...field} />}
                        />
                        <div></div>
                    </DetailFormGrid>
                    <FormFieldWrapper
                        control={form.control}
                        name="description"
                        label={<Trans>Description</Trans>}
                        render={({ field }) => <Textarea {...field} />}
                    />
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="StockLocation" control={form.control} />
            </PageLayout>
        </Page>
    );
}
