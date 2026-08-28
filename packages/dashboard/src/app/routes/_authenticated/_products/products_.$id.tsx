import { RichTextInput } from '@/vdb/components/data-input/rich-text-input.js';
import { SlugInput } from '@/vdb/components/data-input/slug-input.js';
import { usePriceFactor } from '@/vdb/components/shared/assign-to-channel-dialog.js';
import { AssignedChannels } from '@/vdb/components/shared/assigned-channels.js';
import { AssignedFacetValues } from '@/vdb/components/shared/assigned-facet-values.js';
import { EntityAssets } from '@/vdb/components/shared/entity-assets.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Field } from '@/vdb/components/ui/field.js';
import { Input } from '@/vdb/components/ui/input.js';
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
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { hasMeaningfulRichText } from '@/vdb/utils/rich-text-content.js';
import { contentSourceLanguageCode } from '@/vdb/utils/supported-storefront-languages.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Layers, LibraryBig, Package, PlusIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { AddOptionGroupDialog } from './components/add-option-group-dialog.js';
import { GenerateVariantsPanel } from './components/generate-variants-panel.js';
import { ProductCollectionsPanel } from './components/product-collections-panel.js';
import { ProductFulfillmentTypePanel } from './components/product-fulfillment-type-panel.js';
import { ProductOptionGroupBadge } from './components/product-option-group-badge.js';
import { ProductVariantsTable } from './components/product-variants-table.js';
import {
    assignProductsToChannelDocument,
    createProductDocument,
    productDetailDocument,
    removeOptionGroupsFromProductDocument,
    removeProductsFromChannelDocument,
    updateProductDocument,
    withProductVariantCustomFields,
} from './products.graphql.js';

const pageId = 'product-detail';

export const Route = createFileRoute('/_authenticated/_products/products_/$id')({
    component: ProductDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: () => withProductVariantCustomFields(productDetailDocument),
        breadcrumb(isNew, entity) {
            return [
                { path: '/products', label: <Trans>Products</Trans> },
                isNew ? <Trans>New product</Trans> : entity?.name,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function NoVariantsPrompt({
    productId,
    productUpdatedAt,
    productName,
    productTranslations,
    onOptionGroupCreated,
    onVariantCreated,
}: Readonly<{
    productId: string;
    productUpdatedAt: string;
    productName: string;
    productTranslations: Array<{ languageCode: string; name: string }>;
    onOptionGroupCreated: () => void;
    onVariantCreated: () => void;
}>) {
    const [mode, setMode] = useState<'choose' | 'single'>('choose');

    if (mode === 'single') {
        return (
            <GenerateVariantsPanel
                productId={productId}
                productName={productName}
                productTranslations={productTranslations}
                optionGroups={[]}
                onSuccess={onVariantCreated}
                onBack={{ handler: () => setMode('choose') }}
            />
        );
    }

    return (
        <div className="grid grid-cols-2 gap-3">
            <button
                type="button"
                onClick={() => setMode('single')}
                className={[
                    'flex flex-col items-center gap-2 rounded-md border border-dashed border-border',
                    'cursor-pointer p-6 text-center transition-colors hover:border-primary hover:bg-accent',
                ].join(' ')}
            >
                <Package className="h-8 w-8 text-muted-foreground" />
                <span className="font-medium">
                    <Trans>Simple product</Trans>
                </span>
                <span className="text-sm text-muted-foreground">
                    <Trans>Single variant, no options</Trans>
                </span>
            </button>
            <AddOptionGroupDialog
                productId={productId}
                productUpdatedAt={productUpdatedAt}
                existingGroupIds={[]}
                onSuccess={onOptionGroupCreated}
                trigger={
                    <button
                        type="button"
                        className={[
                            'flex w-full flex-col items-center gap-2 rounded-md border border-dashed',
                            'border-border cursor-pointer p-6 text-center transition-colors',
                            'hover:border-primary hover:bg-accent',
                        ].join(' ')}
                    >
                        <Layers className="h-8 w-8 text-muted-foreground" />
                        <span className="font-medium">
                            <Trans>Product with options</Trans>
                        </span>
                        <span className="text-sm text-muted-foreground">
                            <Trans>Size, colour, etc.</Trans>
                        </span>
                    </button>
                }
            />
        </div>
    );
}

function ProductDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const refreshRef = useRef<() => void>(() => undefined);
    const { channels } = useChannel();
    const { priceFactor, priceFactorField } = usePriceFactor();

    const { form, submitHandler, entity, isPending, refreshEntity, resetForm } = useDetailPage({
        pageId,
        entityName: 'Product',
        queryDocument: withProductVariantCustomFields(productDetailDocument),
        createDocument: createProductDocument,
        updateDocument: updateProductDocument,
        extendSchema: schema =>
            schema.superRefine((values, ctx) => {
                const translations = values.translations ?? [];
                const configuredSourceIndex = translations.findIndex(
                    (translation: { languageCode?: string | null }) =>
                        translation.languageCode === contentSourceLanguageCode,
                );
                const populatedIndex = translations.findIndex(
                    (translation: {
                        name?: string | null;
                        slug?: string | null;
                        description?: string | null;
                    }) =>
                        Boolean(translation.name?.trim()) ||
                        Boolean(translation.slug?.trim()) ||
                        hasMeaningfulRichText(translation.description),
                );
                const configuredSource = translations[configuredSourceIndex];
                const sourceIndex =
                    configuredSourceIndex >= 0 &&
                    (Boolean(configuredSource?.name?.trim()) ||
                        Boolean(configuredSource?.slug?.trim()) ||
                        hasMeaningfulRichText(configuredSource?.description))
                        ? configuredSourceIndex
                        : populatedIndex >= 0
                          ? populatedIndex
                          : Math.max(configuredSourceIndex, 0);
                const sourceTranslation = translations[sourceIndex];

                if (!sourceTranslation?.slug?.trim()) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['translations', sourceIndex, 'slug'],
                        message: t`This field is required`,
                    });
                }
                if (!hasMeaningfulRichText(sourceTranslation?.description)) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['translations', sourceIndex, 'description'],
                        message: t`This field is required`,
                    });
                }
            }),
        setValuesForUpdate: currentEntity => {
            return {
                id: currentEntity.id,
                expectedUpdatedAt: currentEntity.updatedAt,
                enabled: currentEntity.enabled,
                featuredAssetId: currentEntity.featuredAsset?.id,
                assetIds: currentEntity.assets.map(asset => asset.id),
                facetValueIds: currentEntity.facetValues.map(facetValue => facetValue.id),
                channelIds: currentEntity.channels.map(c => c.id) ?? [],
                translations: currentEntity.translations.map(translation => ({
                    id: translation.id,
                    languageCode: translation.languageCode,
                    name: translation.name,
                    slug: translation.slug,
                    description: translation.description,
                    customFields: (translation as any).customFields,
                })),
                customFields: currentEntity.customFields,
            };
        },
        params: { id: params.id },
        onSuccess: data => {
            toast.success(
                creatingNewEntity ? t`Successfully created product` : t`Successfully updated product`,
            );
            resetForm();
            if (creatingNewEntity) {
                void navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast.error(creatingNewEntity ? t`Failed to create product` : t`Failed to update product`, {
                description: err instanceof Error ? err.message : t`Unknown error`,
            });
        },
    });

    const removeAllOptionGroups = async (
        product: { id: string; updatedAt: string },
        optionGroups: Array<{ id: string }>,
    ) => {
        try {
            await api.mutate(removeOptionGroupsFromProductDocument, {
                productId: product.id,
                optionGroupIds: optionGroups.map(group => group.id),
                expectedUpdatedAt: product.updatedAt,
            });
            refreshEntity();
        } catch (error) {
            toast.error(t`Failed to remove option groups`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
            refreshEntity();
        }
    };

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>{creatingNewEntity ? <Trans>New product</Trans> : (entity?.name ?? '')}</PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateProduct', 'UpdateCatalog']}>
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                    >
                        {creatingNewEntity ? <Trans>Create</Trans> : <Trans>Update</Trans>}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="side" blockId="enabled-toggle">
                    <FormFieldWrapper
                        control={form.control}
                        name="enabled"
                        label={<Trans>Enabled</Trans>}
                        description={<Trans>When enabled, a product is available in the shop</Trans>}
                        render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                        )}
                    />
                </PageBlock>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="name"
                            label={<Trans>Product name</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <TranslatableFormFieldWrapper
                            control={form.control}
                            name="slug"
                            label={<Trans>Slug</Trans>}
                            render={({ field }) => (
                                <SlugInput
                                    {...field}
                                    entityName="Product"
                                    fieldName="slug"
                                    watchFieldName="name"
                                    entityId={entity?.id}
                                />
                            )}
                        />
                    </DetailFormGrid>

                    <TranslatableFormFieldWrapper
                        control={form.control}
                        name="description"
                        label={
                            <>
                                <span>
                                    <Trans>Description</Trans>
                                </span>
                                <span className="ml-1 text-destructive" aria-hidden="true">
                                    *
                                </span>
                            </>
                        }
                        render={({ field }) => <RichTextInput {...field} required aria-required="true" />}
                    />
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Product" control={form.control} />
                {entity && (
                    <PageBlock
                        column="main"
                        blockId="option-groups"
                        title={<Trans>Specification templates</Trans>}
                        description={
                            <Trans>
                                Templates define the selectable specifications for this product and are used
                                to generate SKUs.
                            </Trans>
                        }
                    >
                        <div className="space-y-3">
                            {entity.optionGroups.length > 0 ? (
                                entity.optionGroups.map(group => (
                                    <ProductOptionGroupBadge
                                        key={group.id}
                                        id={group.id}
                                        name={group.name}
                                        options={group.options}
                                        productId={entity.id}
                                        onRemoved={() => refreshEntity()}
                                    />
                                ))
                            ) : (
                                <div className="flex flex-col gap-3 rounded-lg bg-muted/40 px-4 py-4 sm:flex-row sm:items-center">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground shadow-sm">
                                        <Layers className="h-4 w-4" aria-hidden="true" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-medium">
                                            <Trans>No specification template linked</Trans>
                                        </p>
                                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                            <Trans>
                                                A single-SKU product can stay empty. For size, colour, or
                                                other choices, select a template from the library or create
                                                one here.
                                            </Trans>
                                        </p>
                                    </div>
                                </div>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                                <AddOptionGroupDialog
                                    productId={entity.id}
                                    productUpdatedAt={entity.updatedAt}
                                    existingGroupIds={entity.optionGroups.map(group => group.id)}
                                    onSuccess={() => refreshEntity()}
                                />
                                <Button variant="ghost" size="sm" render={<Link to="/option-groups" />}>
                                    <LibraryBig className="h-4 w-4" aria-hidden="true" />
                                    <Trans>Open specification template library</Trans>
                                </Button>
                            </div>
                        </div>
                    </PageBlock>
                )}
                {entity && entity.variantList.totalItems > 0 && (
                    <PageBlock
                        column="main"
                        blockId="product-fulfillment-type"
                        title={<Trans>Product type and delivery</Trans>}
                        description={
                            <Trans>
                                Choose whether this product needs logistics shipping or is delivered by email.
                            </Trans>
                        }
                    >
                        <ProductFulfillmentTypePanel
                            variants={entity.variants}
                            onUpdated={() => {
                                refreshEntity();
                                refreshRef.current();
                            }}
                        />
                    </PageBlock>
                )}
                {entity && entity.variantList.totalItems > 0 && (
                    <PageBlock column="main" blockId="product-variants-table">
                        <ProductVariantsTable
                            productId={params.id}
                            registerRefresher={refresher => {
                                refreshRef.current = refresher;
                            }}
                            fromProductDetailPage={true}
                        />
                        <div className="mt-4 flex gap-2">
                            <Button render={<Link to="./variants" />} variant="outline">
                                <PlusIcon className="mr-2 h-4 w-4" />
                                <Trans>Manage variants</Trans>
                            </Button>
                        </div>
                    </PageBlock>
                )}
                {entity && entity.variantList.totalItems === 0 && (
                    <PageBlock
                        column="main"
                        blockId="generate-variants"
                        title={<Trans>Product variants</Trans>}
                    >
                        {entity.optionGroups.length === 0 ? (
                            <NoVariantsPrompt
                                productId={entity.id}
                                productUpdatedAt={entity.updatedAt}
                                productName={entity.name}
                                productTranslations={entity.translations}
                                onOptionGroupCreated={() => refreshEntity()}
                                onVariantCreated={() => refreshEntity()}
                            />
                        ) : (
                            <GenerateVariantsPanel
                                productId={entity.id}
                                productName={entity.name}
                                productTranslations={entity.translations}
                                optionGroups={entity.optionGroups}
                                onSuccess={() => refreshEntity()}
                                onBack={{
                                    handler: () => {
                                        void removeAllOptionGroups(entity, entity.optionGroups);
                                    },
                                    confirmation: {
                                        title: t`Remove option groups?`,
                                        description: t`This will remove all option groups from this product and return to the variant setup choice.`,
                                    },
                                }}
                            />
                        )}
                    </PageBlock>
                )}
                <PageBlock column="side" blockId="facet-values" title={<Trans>Facet Values</Trans>}>
                    <FormFieldWrapper
                        control={form.control}
                        name="facetValueIds"
                        render={({ field }) => (
                            <AssignedFacetValues facetValues={entity?.facetValues ?? []} {...field} />
                        )}
                    />
                </PageBlock>
                {entity && (
                    <PageBlock
                        column="side"
                        blockId="product-collections"
                        title={<Trans>Product groups</Trans>}
                        description={
                            <Trans>
                                Choose product groups directly. Existing automatic rules continue to apply.
                            </Trans>
                        }
                    >
                        <ProductCollectionsPanel
                            key={entity.id}
                            productId={entity.id}
                            collections={entity.collections}
                            onMembershipRefresh={refreshEntity}
                        />
                    </PageBlock>
                )}
                {channels.length > 1 && entity && (
                    <PageBlock
                        column="side"
                        blockId="channels"
                        title={<Trans>Published stores</Trans>}
                        description={<Trans>Manage which stores can sell this product.</Trans>}
                    >
                        <AssignedChannels
                            channels={entity.channels}
                            entityId={entity.id}
                            entityType="product"
                            canUpdate={!creatingNewEntity}
                            assignMutationFn={api.mutate(assignProductsToChannelDocument)}
                            removeMutationFn={api.mutate(removeProductsFromChannelDocument)}
                            buildRemoveInput={(eid, channelId) => ({
                                productIds: [eid],
                                channelId,
                            })}
                            buildAssignInput={(eid, channelId) => ({
                                productIds: [eid],
                                channelId,
                                priceFactor,
                            })}
                            additionalAssignFields={priceFactorField}
                            queryKeyScope={['DetailPage', 'product']}
                        />
                    </PageBlock>
                )}

                <PageBlock column="side" blockId="assets" title={<Trans>Assets</Trans>}>
                    <Field>
                        <EntityAssets
                            assets={entity?.assets}
                            featuredAsset={entity?.featuredAsset}
                            compact={true}
                            imageGuidance="product"
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
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
