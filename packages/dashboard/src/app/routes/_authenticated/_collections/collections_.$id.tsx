import { SlugInput } from '@/vdb/components/data-input/index.js';
import { RichTextInput } from '@/vdb/components/data-input/rich-text-input.js';
import { EntityAssets } from '@/vdb/components/shared/entity-assets.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Field, FieldLabel } from '@/vdb/components/ui/field.js';
import { Input } from '@/vdb/components/ui/input.js';
import { RadioGroup, RadioGroupItem } from '@/vdb/components/ui/radio-group.js';
import { Switch } from '@/vdb/components/ui/switch.js';
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
import { api } from '@/vdb/graphql/api.js';
import { useJobQueuePolling } from '@/vdb/hooks/use-job-queue-polling.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { FolderTree, ImageIcon, Store } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
    collectionDetailDocument,
    createCollectionDocument,
    moveCollectionDocument,
    updateCollectionDocument,
} from './collections.graphql.js';
import { CollectionContentsPreviewTable } from './components/collection-contents-preview-table.js';
import { CollectionContentsTable } from './components/collection-contents-table.js';
import { CollectionFiltersSelector } from './components/collection-filters-selector.js';
import { CollectionTreePanel } from './components/collection-tree-panel.js';

const pageId = 'collection-detail';

export const Route = createFileRoute('/_authenticated/_collections/collections_/$id')({
    component: CollectionDetailPage,
    validateSearch: (search: Record<string, unknown>) => ({
        parentId: typeof search.parentId === 'string' && search.parentId ? search.parentId : undefined,
    }),
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: collectionDetailDocument,
        breadcrumb: (isNew, entity, location) => {
            const isCreatingChild = isNew && new URLSearchParams(location.searchStr).has('parentId');
            return [
                { path: '/collections', label: <Trans>Collections</Trans> },
                isCreatingChild ? (
                    <Trans>New child product group</Trans>
                ) : isNew ? (
                    <Trans>New collection</Trans>
                ) : (
                    entity?.name
                ),
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function CollectionDetailPage() {
    const params = Route.useParams();
    const routeSearch = Route.useSearch();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const createNextChildRef = useRef(false);
    const [rootCollectionId, setRootCollectionId] = useState<string>();
    const [filtersArgsValid, setFiltersArgsValid] = useState(true);

    const { isPolling: pendingFilterApplication, startPolling } = useJobQueuePolling(
        'apply-collection-filters',
        () => queryClient.invalidateQueries({ queryKey: ['PaginatedListDataTable'] }),
    );

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: collectionDetailDocument,
        createDocument: createCollectionDocument,
        transformCreateInput: values => {
            return {
                ...values,
                filters: (values.filters ?? []).filter(f => f.code !== ''),
            };
        },
        updateDocument: updateCollectionDocument,
        transformUpdateInput: values => {
            const { parentId: _parentId, ...updateValues } = values;
            return {
                ...updateValues,
                filters: (values.filters ?? []).filter(f => f.code !== ''),
            };
        },
        extendSchema: schema =>
            schema.refine(
                values =>
                    values.translations?.some((translation: { slug?: string | null }) =>
                        Boolean(translation.slug?.trim()),
                    ),
                {
                    path: ['translations', 0, 'slug'],
                    message: t`This field is required`,
                },
            ),
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                isPrivate: entity.isPrivate,
                featuredAssetId: entity.featuredAsset?.id,
                assets: entity.assets.map(asset => asset.id),
                parentId: entity.parent?.id,
                translations: entity.translations.map(translation => ({
                    id: translation.id,
                    languageCode: translation.languageCode,
                    name: translation.name,
                    slug: translation.slug,
                    description: translation.description,
                    customFields: (translation as any).customFields,
                })),
                filters: entity.filters.map(f => ({
                    code: f.code,
                    arguments: f.args.map(a => ({ name: a.name, value: a.value })),
                })),
                inheritFilters: entity.inheritFilters,
                customFields: entity.customFields,
            };
        },
        params: { id: params.id },
        onSuccess: async data => {
            const filtersWereDirty =
                form.getFieldState('inheritFilters').isDirty || form.getFieldState('filters').isDirty;
            const parentWasDirty = form.getFieldState('parentId').isDirty;
            const selectedParentId = form.getValues('parentId');

            if (!creatingNewEntity && parentWasDirty && selectedParentId && entity?.id) {
                try {
                    await api.mutate(moveCollectionDocument, {
                        input: {
                            collectionId: entity.id,
                            parentId: selectedParentId,
                            index: 0,
                        },
                    });
                    queryClient.removeQueries({ queryKey: ['collection-tree'] });
                    queryClient.removeQueries({ queryKey: ['collection-tree-children'] });
                    queryClient.removeQueries({ queryKey: ['collection-parent-summary'] });
                    await queryClient.invalidateQueries({ queryKey: ['DetailPage', 'CollectionDetail'] });
                    await queryClient.invalidateQueries({ queryKey: ['PaginatedListDataTable'] });
                } catch (error) {
                    toast.error(t`Product group details were saved, but its parent could not be changed`, {
                        description: error instanceof Error ? error.message : t`Unknown error`,
                    });
                    return;
                }
            }

            toast(
                creatingNewEntity ? t`Successfully created collection` : t`Successfully updated collection`,
            );
            resetForm();
            if (filtersWereDirty || parentWasDirty) {
                startPolling();
            }
            if (creatingNewEntity) {
                queryClient.removeQueries({ queryKey: ['collection-tree'] });
                queryClient.removeQueries({ queryKey: ['collection-tree-children'] });
                const createNextChild = createNextChildRef.current;
                createNextChildRef.current = false;
                if (createNextChild) {
                    await navigate({
                        to: '/collections/new',
                        search: { parentId: data.id },
                    });
                } else {
                    await navigate({
                        to: `../$id`,
                        params: { id: data.id },
                        search: {},
                    });
                }
            }
        },
        onError: err => {
            toast(creatingNewEntity ? t`Failed to create collection` : t`Failed to update collection`, {
                description: err instanceof Error ? err.message : t`Unknown error`,
            });
        },
    });

    useEffect(() => {
        if (creatingNewEntity && routeSearch.parentId) {
            form.setValue('parentId', routeSearch.parentId, {
                shouldDirty: false,
                shouldValidate: true,
            });
        }
    }, [creatingNewEntity, form, routeSearch.parentId]);

    const shouldPreviewContents =
        form.getFieldState('inheritFilters').isDirty ||
        form.getFieldState('filters').isDirty ||
        pendingFilterApplication;

    const currentFiltersValue = form.watch('filters');
    const currentInheritFiltersValue = form.watch('inheritFilters');
    const currentParentId = form.watch('parentId');

    const { data: selectedParentData, isLoading: selectedParentIsLoading } = useQuery({
        queryKey: ['collection-parent-summary', currentParentId],
        queryFn: () => api.query(collectionDetailDocument, { id: currentParentId as string }),
        enabled: Boolean(currentParentId && currentParentId !== rootCollectionId),
        staleTime: 1000 * 60 * 5,
    });

    const isTopLevel = !currentParentId || currentParentId === rootCollectionId;
    const selectedParent = isTopLevel ? undefined : selectedParentData?.collection;
    const selectedParentPath = selectedParent?.breadcrumbs
        .slice(1, -1)
        .map(breadcrumb => breadcrumb.name)
        .join(' / ');
    const childLevel = selectedParent ? selectedParent.breadcrumbs.length : 1;
    const isCreatingChild = creatingNewEntity && !isTopLevel;

    const selectParent = (collectionId: string | undefined) => {
        const nextParentId = collectionId ?? (creatingNewEntity ? undefined : rootCollectionId);
        form.setValue('parentId', nextParentId, {
            shouldDirty: true,
            shouldValidate: true,
        });
    };

    const addChild = (collectionId: string) => {
        if (creatingNewEntity) {
            selectParent(collectionId);
            return;
        }
        void navigate({
            to: '/collections/new',
            search: { parentId: collectionId },
        });
    };

    const saveDisabled = !form.formState.isDirty || !form.formState.isValid || isPending || !filtersArgsValid;

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>
                {creatingNewEntity ? (
                    isCreatingChild ? (
                        <Trans>New child product group</Trans>
                    ) : (
                        <Trans>New collection</Trans>
                    )
                ) : (
                    (entity?.name ?? '')
                )}
            </PageTitle>
            <PageActionBar>
                <ActionBarItem
                    itemId="save-button"
                    requiresPermission={
                        creatingNewEntity
                            ? ['CreateCollection', 'CreateCatalog']
                            : ['UpdateCollection', 'UpdateCatalog']
                    }
                >
                    <Button
                        type="submit"
                        variant={creatingNewEntity ? 'outline' : undefined}
                        disabled={saveDisabled}
                        onClick={() => {
                            createNextChildRef.current = false;
                        }}
                    >
                        {creatingNewEntity ? (
                            isCreatingChild ? (
                                <Trans>Create child product group</Trans>
                            ) : (
                                <Trans>Create</Trans>
                            )
                        ) : (
                            <Trans>Update</Trans>
                        )}
                    </Button>
                </ActionBarItem>
                {creatingNewEntity && (
                    <ActionBarItem
                        itemId="save-and-add-child-button"
                        requiresPermission={['CreateCollection', 'CreateCatalog']}
                    >
                        <Button
                            type="submit"
                            disabled={saveDisabled}
                            onClick={() => {
                                createNextChildRef.current = true;
                            }}
                        >
                            <Trans>Create and add another child</Trans>
                        </Button>
                    </ActionBarItem>
                )}
            </PageActionBar>
            <PageLayout sidePosition="left">
                <PageBlock
                    column="side"
                    blockId="category-tree"
                    title={<Trans>Product group structure</Trans>}
                    description={<Trans>Select a parent or quickly add a child product group.</Trans>}
                    className="@3xl/layout:sticky @3xl/layout:top-4"
                >
                    <CollectionTreePanel
                        selectedParentId={isTopLevel ? undefined : currentParentId}
                        currentCollectionId={entity?.id}
                        onSelectParent={selectParent}
                        onAddChild={addChild}
                        onRootCollectionIdChange={setRootCollectionId}
                    />
                </PageBlock>

                <PageBlock column="main" blockId="hierarchy">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                            <div className="rounded-md bg-primary/10 p-2 text-primary">
                                <FolderTree className="h-5 w-5" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                                <div className="text-xs text-muted-foreground">
                                    <Trans>Parent product group</Trans>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                    <span className="font-medium">
                                        {isTopLevel ? (
                                            <Trans>Top-level product group</Trans>
                                        ) : selectedParentIsLoading ? (
                                            <Trans>Loading parent product group...</Trans>
                                        ) : (
                                            (selectedParent?.name ?? <Trans>Unknown product group</Trans>)
                                        )}
                                    </span>
                                    <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                        <Trans>Level {childLevel}</Trans>
                                    </span>
                                </div>
                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                    {isTopLevel ? (
                                        <Trans>This product group has no parent.</Trans>
                                    ) : selectedParentIsLoading ? (
                                        <Trans>Loading hierarchy...</Trans>
                                    ) : (
                                        selectedParentPath || <Trans>Top-level product group</Trans>
                                    )}
                                </div>
                            </div>
                        </div>
                        <span className="text-xs text-muted-foreground">
                            <Trans>Choose another parent from the tree on the left.</Trans>
                        </span>
                    </div>
                </PageBlock>

                <PageBlock column="main" blockId="main-form" title={<Trans>Basic information</Trans>}>
                    <DetailFormGrid>
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="name"
                            label={<Trans>Product group name</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="slug"
                            label={<Trans>Slug</Trans>}
                            render={({ field }) => (
                                <SlugInput
                                    fieldName="slug"
                                    watchFieldName="name"
                                    entityName="Collection"
                                    entityId={entity?.id}
                                    {...field}
                                />
                            )}
                        />
                    </DetailFormGrid>
                    <TranslatableFormFieldWrapper
                        control={form.control}
                        name="description"
                        label={<Trans>Product group description</Trans>}
                        render={({ field }) => <RichTextInput {...field} />}
                    />
                </PageBlock>

                <PageBlock
                    column="main"
                    blockId="filters"
                    title={<Trans>Product assignment</Trans>}
                    description={
                        <Trans>Choose products manually or assign matching products automatically.</Trans>
                    }
                >
                    <FormFieldWrapper
                        control={form.control}
                        name="filters"
                        render={({ field }) => (
                            <CollectionFiltersSelector
                                value={field.value ?? []}
                                onChange={field.onChange}
                                onValidityChange={setFiltersArgsValid}
                            />
                        )}
                    />
                    {!isTopLevel && (
                        <div className="mt-5 border-t pt-5">
                            <FormFieldWrapper
                                control={form.control}
                                name="inheritFilters"
                                label={<Trans>Use parent product group conditions</Trans>}
                                description={
                                    <Trans>
                                        Products must also match the conditions of the parent product group.
                                    </Trans>
                                }
                                render={({ field }) => (
                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                )}
                            />
                        </div>
                    )}
                </PageBlock>

                <PageBlock column="main" blockId="storefront" title={<Trans>Storefront display</Trans>}>
                    <div className="grid gap-6 @xl:grid-cols-2">
                        <FormFieldWrapper
                            control={form.control}
                            name="isPrivate"
                            label={<Trans>Display status</Trans>}
                            description={<Trans>Control whether customers can see this product group.</Trans>}
                            renderFormControl={false}
                            render={({ field }) => (
                                <RadioGroup
                                    value={field.value ? 'hidden' : 'visible'}
                                    onValueChange={value => field.onChange(value === 'hidden')}
                                    className="mt-2 gap-3"
                                >
                                    <label
                                        htmlFor="collection-visible"
                                        className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors ${
                                            field.value
                                                ? 'border-border hover:bg-muted/40'
                                                : 'border-primary bg-primary/5'
                                        }`}
                                    >
                                        <RadioGroupItem
                                            id="collection-visible"
                                            value="visible"
                                            className="mt-0.5"
                                        />
                                        <span>
                                            <span className="flex items-center gap-2 text-sm font-medium">
                                                <Store className="h-4 w-4" aria-hidden="true" />
                                                <Trans>Visible in storefront</Trans>
                                            </span>
                                            <span className="mt-1 block text-xs text-muted-foreground">
                                                <Trans>
                                                    Customers can see it in navigation and product group
                                                    pages.
                                                </Trans>
                                            </span>
                                        </span>
                                    </label>
                                    <label
                                        htmlFor="collection-hidden"
                                        className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors ${
                                            field.value
                                                ? 'border-primary bg-primary/5'
                                                : 'border-border hover:bg-muted/40'
                                        }`}
                                    >
                                        <RadioGroupItem
                                            id="collection-hidden"
                                            value="hidden"
                                            className="mt-0.5"
                                        />
                                        <span>
                                            <span className="block text-sm font-medium">
                                                <Trans>Hidden from storefront</Trans>
                                            </span>
                                            <span className="mt-1 block text-xs text-muted-foreground">
                                                <Trans>
                                                    It remains editable in the dashboard but is hidden from
                                                    customers.
                                                </Trans>
                                            </span>
                                        </span>
                                    </label>
                                </RadioGroup>
                            )}
                        />
                        <Field>
                            <FieldLabel className="flex items-center gap-2">
                                <ImageIcon className="h-4 w-4" aria-hidden="true" />
                                <Trans>Product group image</Trans>
                            </FieldLabel>
                            <EntityAssets
                                assets={entity?.assets}
                                featuredAsset={entity?.featuredAsset}
                                compact={true}
                                value={form.getValues()}
                                onChange={value => {
                                    form.setValue('featuredAssetId', value.featuredAssetId ?? undefined, {
                                        shouldDirty: true,
                                        shouldValidate: true,
                                    });
                                    form.setValue('assetIds', value.assetIds ?? [], {
                                        shouldDirty: true,
                                        shouldValidate: true,
                                    });
                                }}
                            />
                        </Field>
                    </div>
                </PageBlock>

                <CustomFieldsPageBlock column="main" entityType="Collection" control={form.control} />

                <PageBlock column="main" blockId="contents" title={<Trans>Assigned products</Trans>}>
                    {pendingFilterApplication || shouldPreviewContents || creatingNewEntity ? (
                        <CollectionContentsPreviewTable
                            parentId={isTopLevel ? undefined : currentParentId}
                            filters={currentFiltersValue ?? []}
                            inheritFilters={currentInheritFiltersValue ?? false}
                        />
                    ) : (
                        <CollectionContentsTable collectionId={entity?.id} />
                    )}
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
