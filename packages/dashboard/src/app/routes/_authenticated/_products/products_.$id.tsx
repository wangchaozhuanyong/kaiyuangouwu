import { RichTextInput } from '@/vdb/components/data-input/rich-text-input.js';
import { SlugInput } from '@/vdb/components/data-input/slug-input.js';
import { usePriceFactor } from '@/vdb/components/shared/assign-to-channel-dialog.js';
import { AssignedChannels } from '@/vdb/components/shared/assigned-channels.js';
import { AssignedFacetValues } from '@/vdb/components/shared/assigned-facet-values.js';
import { EntityAssets } from '@/vdb/components/shared/entity-assets.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { TranslatableFormFieldWrapper } from '@/vdb/components/shared/translatable-form-field.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Field } from '@/vdb/components/ui/field.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
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
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { hasMeaningfulRichText } from '@/vdb/utils/rich-text-content.js';
import { contentSourceLanguageCode } from '@/vdb/utils/supported-storefront-languages.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { Layers, LibraryBig, Package, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { AddOptionGroupDialog } from './components/add-option-group-dialog.js';
import { AddProductVariantDialog } from './components/add-product-variant-dialog.js';
import { GenerateVariantsPanel } from './components/generate-variants-panel.js';
import { ProductCollectionSelector } from './components/product-collection-selector.js';
import { ProductCollectionsPanel } from './components/product-collections-panel.js';
import { ProductFulfillmentTypePanel } from './components/product-fulfillment-type-panel.js';
import { ProductOptionGroupBadge } from './components/product-option-group-badge.js';
import { ProductVariantsTable } from './components/product-variants-table.js';
import {
    assignProductsToChannelDocument,
    catalogProductCreationContextDocument,
    createCatalogProductDocument,
    createProductDocument,
    productDetailDocument,
    removeOptionGroupsFromProductDocument,
    removeProductsFromChannelDocument,
    saveCatalogProductDocument,
    updateProductDocument,
    withProductVariantCustomFields,
} from './products.graphql.js';

const pageId = 'product-detail';
const WORKSPACE_DIRTY_EVENT = 'catalog-product-workspace-dirty';
const WORKSPACE_COLLECT_EVENT = 'catalog-product-workspace-collect';
const WORKSPACE_COMMITTED_EVENT = 'catalog-product-workspace-committed';

type ProductTranslationFormValue = {
    languageCode?: string | null;
    name?: string | null;
    slug?: string | null;
    description?: string | null;
};

interface CatalogProductCreationContextRecord {
    catalogProductCreationContext: {
        currencyCode: string;
        stockLocations: Array<{ id: string; name: string }>;
    };
}

interface InitialCatalogVariantDraft {
    stockLocationId: string;
    sku: string;
    enabled: boolean;
    barcode: string;
    specification: string;
    saleUnit: string;
    purchaseUnit: string;
    packageQuantity: string;
    shelfLifeDays: string;
    sellingPrice: string;
    purchaseCost: string;
    stockOnHand: string;
    minimumStock: string;
    maximumStock: string;
}

type Translate = ReturnType<typeof useLingui>['t'];

function productSourceTranslationIndex(
    translations: readonly ProductTranslationFormValue[] | null | undefined,
): number {
    const values = translations ?? [];
    const configuredSourceIndex = values.findIndex(
        translation => translation.languageCode === contentSourceLanguageCode,
    );
    const populatedIndex = values.findIndex(
        translation =>
            Boolean(translation.name?.trim()) ||
            Boolean(translation.slug?.trim()) ||
            hasMeaningfulRichText(translation.description),
    );
    const configuredSource = values[configuredSourceIndex];

    if (
        configuredSourceIndex >= 0 &&
        (Boolean(configuredSource?.name?.trim()) ||
            Boolean(configuredSource?.slug?.trim()) ||
            hasMeaningfulRichText(configuredSource?.description))
    ) {
        return configuredSourceIndex;
    }
    return populatedIndex >= 0 ? populatedIndex : Math.max(configuredSourceIndex, 0);
}

export const Route = createFileRoute('/_authenticated/_products/products_/$id')({
    beforeLoad: ({ params }) => {
        throw redirect({ to: '/products', search: { editor: params.id } });
    },
    component: ProductDetailPage,
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

function InitialCatalogVariantFields({
    draft,
    collectionIds,
    creationContext,
    loading,
    error,
    validationMessage,
    onRetry,
    onDraftChange,
    onCollectionIdsChange,
}: Readonly<{
    draft: InitialCatalogVariantDraft;
    collectionIds: string[];
    creationContext: CatalogProductCreationContextRecord['catalogProductCreationContext'] | undefined;
    loading: boolean;
    error: unknown;
    validationMessage: string | null;
    onRetry: () => void;
    onDraftChange: (draft: InitialCatalogVariantDraft) => void;
    onCollectionIdsChange: (ids: string[]) => void;
}>) {
    const { t } = useLingui();
    const update = (values: Partial<InitialCatalogVariantDraft>) => onDraftChange({ ...draft, ...values });
    const margin = initialCatalogMargin(draft.sellingPrice, draft.purchaseCost);

    if (loading) {
        return (
            <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground" role="status">
                <Trans>Loading store currency and warehouse...</Trans>
            </div>
        );
    }
    if (error || !creationContext) {
        return (
            <div className="space-y-3 rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
                <p>
                    <Trans>
                        Unable to load product creation context. Product creation is temporarily unavailable.
                    </Trans>
                </p>
                <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                    <Trans>Retry</Trans>
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Label>
                    <Trans>Product group</Trans> <span className="text-destructive">*</span>
                </Label>
                <ProductCollectionSelector
                    value={collectionIds}
                    selectedCollections={[]}
                    onChange={onCollectionIdsChange}
                />
                {collectionIds.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                        <Trans>Select at least one product group so the product can be categorized.</Trans>
                    </p>
                )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <InitialCatalogField label={t`SKU code`} required>
                    <Input value={draft.sku} onChange={event => update({ sku: event.target.value })} />
                </InitialCatalogField>
                <InitialCatalogField label={t`Barcode`}>
                    <Input
                        value={draft.barcode}
                        onChange={event => update({ barcode: event.target.value })}
                    />
                </InitialCatalogField>
                <InitialCatalogField label={t`Specification`}>
                    <Input
                        value={draft.specification}
                        onChange={event => update({ specification: event.target.value })}
                    />
                </InitialCatalogField>
                <InitialCatalogField label={t`Selling unit`}>
                    <Input
                        value={draft.saleUnit}
                        onChange={event => update({ saleUnit: event.target.value })}
                    />
                </InitialCatalogField>
                <InitialCatalogField label={t`Purchasing unit`}>
                    <Input
                        value={draft.purchaseUnit}
                        onChange={event => update({ purchaseUnit: event.target.value })}
                    />
                </InitialCatalogField>
                <InitialCatalogField label={t`Package conversion`} required>
                    <InitialNumberInput
                        value={draft.packageQuantity}
                        step="0.001"
                        onChange={packageQuantity => update({ packageQuantity })}
                    />
                </InitialCatalogField>
                <InitialCatalogField label={t`Selling price (${creationContext.currencyCode})`} required>
                    <InitialNumberInput
                        value={draft.sellingPrice}
                        step="0.01"
                        onChange={sellingPrice => update({ sellingPrice })}
                    />
                </InitialCatalogField>
                <InitialCatalogField label={t`Purchase cost (${creationContext.currencyCode})`} required>
                    <InitialNumberInput
                        value={draft.purchaseCost}
                        step="0.001"
                        onChange={purchaseCost => update({ purchaseCost })}
                    />
                </InitialCatalogField>
                <InitialCatalogField label={t`Margin (calculated)`}>
                    <div className="flex h-9 items-center">
                        <Badge variant={margin != null && margin < 0 ? 'destructive' : 'secondary'}>
                            {margin == null ? '—' : `${(margin * 100).toFixed(1)}%`}
                        </Badge>
                    </div>
                </InitialCatalogField>
                <InitialCatalogField label={t`Current warehouse`} required>
                    <Select
                        value={draft.stockLocationId}
                        onValueChange={stockLocationId => stockLocationId && update({ stockLocationId })}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder={t`Select warehouse`} />
                        </SelectTrigger>
                        <SelectContent>
                            {creationContext.stockLocations.map(location => (
                                <SelectItem key={location.id} value={location.id}>
                                    {location.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </InitialCatalogField>
                <InitialCatalogField label={t`Stock on hand`} required>
                    <InitialNumberInput
                        value={draft.stockOnHand}
                        step="1"
                        onChange={stockOnHand => update({ stockOnHand })}
                    />
                </InitialCatalogField>
                <InitialCatalogField label={t`Minimum stock`}>
                    <InitialNumberInput
                        value={draft.minimumStock}
                        step="1"
                        onChange={minimumStock => update({ minimumStock })}
                    />
                </InitialCatalogField>
                <InitialCatalogField label={t`Maximum stock`}>
                    <InitialNumberInput
                        value={draft.maximumStock}
                        step="1"
                        onChange={maximumStock => update({ maximumStock })}
                    />
                </InitialCatalogField>
                <InitialCatalogField label={t`Shelf life (days)`}>
                    <InitialNumberInput
                        value={draft.shelfLifeDays}
                        step="1"
                        onChange={shelfLifeDays => update({ shelfLifeDays })}
                    />
                </InitialCatalogField>
                <div className="flex items-center justify-between rounded-lg border p-4 sm:col-span-2 xl:col-span-1">
                    <div>
                        <Label htmlFor="initial-catalog-variant-enabled">
                            <Trans>SKU sales status</Trans>
                        </Label>
                        <p className="mt-1 text-xs text-muted-foreground">
                            <Trans>Can be disabled independently from the product.</Trans>
                        </p>
                    </div>
                    <Switch
                        id="initial-catalog-variant-enabled"
                        checked={draft.enabled}
                        onCheckedChange={enabled => update({ enabled })}
                    />
                </div>
            </div>
            {validationMessage && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                    {validationMessage}
                </p>
            )}
        </div>
    );
}

function InitialCatalogField({
    label,
    required,
    children,
}: Readonly<{ label: string; required?: boolean; children: ReactNode }>) {
    return (
        <div className="space-y-2">
            <Label>
                {label} {required && <span className="text-destructive">*</span>}
            </Label>
            {children}
        </div>
    );
}

function InitialNumberInput({
    value,
    step,
    onChange,
}: Readonly<{ value: string; step: string; onChange: (value: string) => void }>) {
    return (
        <Input
            type="number"
            min="0"
            step={step}
            value={value}
            onChange={event => onChange(event.target.value)}
        />
    );
}

function ProductDetailPage() {
    const params = Route.useParams();
    return <ProductEditor productId={params.id} />;
}

export interface ProductEditorProps {
    productId: string;
    presentation?: 'page' | 'sheet';
    onDirtyChange?: (isDirty: boolean) => void;
    onRequestClose?: () => void;
    onSaved?: (behavior: 'close' | 'keep-open', productId: string) => void;
}

export function ProductEditor({
    productId,
    presentation = 'page',
    onDirtyChange,
    onRequestClose,
    onSaved,
}: Readonly<ProductEditorProps>) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const creatingNewEntity = productId === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const refreshRef = useRef<() => void>(() => undefined);
    const { channels } = useChannel();
    const { priceFactor, priceFactorField } = usePriceFactor();
    const [catalogWorkspaceDirty, setCatalogWorkspaceDirty] = useState(false);
    const [initialVariant, setInitialVariant] = useState<InitialCatalogVariantDraft>(() =>
        emptyInitialCatalogVariant(),
    );
    const [initialCollectionIds, setInitialCollectionIds] = useState<string[]>([]);
    const creationContextQuery = useQuery({
        queryKey: ['catalog-product-creation-context'],
        queryFn: () =>
            api.query<CatalogProductCreationContextRecord>(catalogProductCreationContextDocument, {}),
        enabled: creatingNewEntity,
    });
    const creationContext = creationContextQuery.data?.catalogProductCreationContext;
    const catalogApiUnavailable = isCatalogApiUnavailableError(creationContextQuery.error);
    const defaultStockLocationId = creationContext?.stockLocations[0]?.id ?? '';

    useEffect(() => {
        if (!creatingNewEntity || initialVariant.stockLocationId || !defaultStockLocationId) return;
        setInitialVariant(current => ({ ...current, stockLocationId: defaultStockLocationId }));
    }, [creatingNewEntity, defaultStockLocationId, initialVariant.stockLocationId]);

    const initialCatalogDirty = useMemo(
        () =>
            creatingNewEntity &&
            (JSON.stringify(initialVariant) !==
                JSON.stringify(emptyInitialCatalogVariant(defaultStockLocationId)) ||
                initialCollectionIds.length > 0),
        [creatingNewEntity, defaultStockLocationId, initialCollectionIds.length, initialVariant],
    );
    const initialCatalogValidationMessage = !creatingNewEntity
        ? null
        : catalogApiUnavailable
          ? null
          : !creationContext
            ? t`Product creation context is still loading`
            : initialCollectionIds.length === 0
              ? t`Select at least one product group`
              : initialCatalogVariantValidationMessage(initialVariant, t);
    const initialCatalogValid = !creatingNewEntity || initialCatalogValidationMessage == null;

    const { form, submitHandler, entity, isPending, refreshEntity, resetForm } = useDetailPage({
        pageId,
        entityName: 'Product',
        queryDocument: withProductVariantCustomFields(productDetailDocument),
        createDocument: createProductDocument,
        updateDocument: updateProductDocument,
        customCreateMutationFn: async product => {
            if (catalogApiUnavailable) {
                const result = await api.mutate(createProductDocument, { input: product });
                return result.createProduct as any;
            }
            if (!creationContext) {
                throw new Error(t`Product creation context is still loading. Please try again shortly.`);
            }
            const variant = initialCatalogVariantInput(initialVariant, t);
            const result = await api.mutate<{ createCatalogProduct: { id: string } }>(
                createCatalogProductDocument,
                {
                    input: {
                        product,
                        variant,
                        collectionIds: initialCollectionIds,
                    },
                },
            );
            return result.createCatalogProduct as any;
        },
        customUpdateMutationFn: async product => {
            const variants: Record<string, unknown>[] = [];
            const failures: unknown[] = [];
            window.dispatchEvent(
                new CustomEvent(WORKSPACE_COLLECT_EVENT, {
                    detail: {
                        productId,
                        register: (variant: Record<string, unknown>) => variants.push(variant),
                        fail: (error: unknown) => failures.push(error),
                    },
                }),
            );
            if (failures.length > 0) throw failures[0];
            try {
                const result = await api.mutate<{ saveCatalogProduct: { id: string } }>(
                    saveCatalogProductDocument,
                    { input: { product, variants } },
                );
                return result.saveCatalogProduct as any;
            } catch (error) {
                if (!isCatalogApiUnavailableError(error)) throw error;
                const result = await api.mutate(updateProductDocument, { input: product });
                return result.updateProduct as any;
            }
        },
        extendSchema: schema =>
            schema.superRefine((values, ctx) => {
                const translations = values.translations ?? [];
                const sourceIndex = productSourceTranslationIndex(translations);
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
        params: { id: productId },
        onSuccess: async data => {
            toast.success(
                creatingNewEntity ? t`Successfully created product` : t`Successfully updated product`,
            );
            const listRefresh = queryClient.invalidateQueries({
                queryKey: ['PaginatedListDataTable'],
                refetchType: 'active',
            });
            if (!creatingNewEntity) {
                window.dispatchEvent(new CustomEvent(WORKSPACE_COMMITTED_EVENT, { detail: { productId } }));
            }
            resetForm();
            setCatalogWorkspaceDirty(false);
            setInitialVariant(emptyInitialCatalogVariant(defaultStockLocationId));
            setInitialCollectionIds([]);
            onDirtyChange?.(false);
            if (presentation === 'sheet') {
                onSaved?.('keep-open', data.id);
            } else if (creatingNewEntity) {
                void navigate({ to: `../$id`, params: { id: data.id } });
            }
            await listRefresh;
        },
        onError: err => {
            toast.error(creatingNewEntity ? t`Failed to create product` : t`Failed to update product`, {
                description: err instanceof Error ? err.message : t`Unknown error`,
            });
        },
    });
    const watchedTranslations = form.watch('translations') as ProductTranslationFormValue[] | undefined;
    const watchedSourceTranslation =
        watchedTranslations?.[productSourceTranslationIndex(watchedTranslations)];
    const descriptionValidationError =
        form.formState.isDirty && !hasMeaningfulRichText(watchedSourceTranslation?.description)
            ? { type: 'required', message: t`This field is required` }
            : undefined;

    useEffect(() => {
        const handleWorkspaceDirty = (event: Event) => {
            const detail = (event as CustomEvent<{ productId: string; isDirty: boolean }>).detail;
            if (detail?.productId === productId) setCatalogWorkspaceDirty(detail.isDirty);
        };
        window.addEventListener(WORKSPACE_DIRTY_EVENT, handleWorkspaceDirty);
        return () => window.removeEventListener(WORKSPACE_DIRTY_EVENT, handleWorkspaceDirty);
    }, [productId]);

    useEffect(() => {
        onDirtyChange?.(form.formState.isDirty || catalogWorkspaceDirty || initialCatalogDirty);
    }, [catalogWorkspaceDirty, form.formState.isDirty, initialCatalogDirty, onDirtyChange]);

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
        <Page
            pageId={pageId}
            form={form}
            submitHandler={submitHandler}
            entity={entity}
            className={presentation === 'sheet' ? 'm-0 min-w-0 p-4' : undefined}
        >
            <PageTitle>{creatingNewEntity ? <Trans>New product</Trans> : (entity?.name ?? '')}</PageTitle>
            <PageActionBar>
                <ActionBarItem
                    itemId="save-button"
                    requiresPermission={
                        creatingNewEntity
                            ? ['CreateProduct', 'CreateCatalog']
                            : ['UpdateProduct', 'UpdateCatalog']
                    }
                >
                    <Button
                        type="submit"
                        disabled={
                            (!form.formState.isDirty && !catalogWorkspaceDirty && !initialCatalogDirty) ||
                            !form.formState.isValid ||
                            !initialCatalogValid ||
                            isPending
                        }
                    >
                        {creatingNewEntity ? <Trans>Create</Trans> : <Trans>Update</Trans>}
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
                        validationError={descriptionValidationError}
                        render={({ field }) => <RichTextInput {...field} required aria-required="true" />}
                    />
                </PageBlock>
                {creatingNewEntity && !catalogApiUnavailable && (
                    <PageBlock
                        column="main"
                        blockId="initial-catalog-variant"
                        title={<Trans>Initial SKU, pricing and inventory</Trans>}
                        description={
                            <Trans>
                                The product and its first SKU are created together. If any step fails, nothing
                                is saved.
                            </Trans>
                        }
                    >
                        <InitialCatalogVariantFields
                            draft={initialVariant}
                            collectionIds={initialCollectionIds}
                            creationContext={creationContext}
                            loading={creationContextQuery.isLoading}
                            error={creationContextQuery.error}
                            validationMessage={initialCatalogValidationMessage}
                            onRetry={() => void creationContextQuery.refetch()}
                            onDraftChange={setInitialVariant}
                            onCollectionIdsChange={setInitialCollectionIds}
                        />
                    </PageBlock>
                )}
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
                            productId={productId}
                            registerRefresher={refresher => {
                                refreshRef.current = refresher;
                            }}
                            fromProductDetailPage={true}
                        />
                        <div className="mt-4 flex gap-2">
                            <AddProductVariantDialog
                                productId={productId}
                                onSuccess={() => {
                                    refreshEntity();
                                    refreshRef.current();
                                }}
                            />
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

function emptyInitialCatalogVariant(stockLocationId = ''): InitialCatalogVariantDraft {
    return {
        stockLocationId,
        sku: '',
        enabled: true,
        barcode: '',
        specification: '',
        saleUnit: '',
        purchaseUnit: '',
        packageQuantity: '1',
        shelfLifeDays: '',
        sellingPrice: '0.00',
        purchaseCost: '0.000',
        stockOnHand: '0',
        minimumStock: '',
        maximumStock: '',
    };
}

function initialCatalogVariantValidationMessage(
    draft: InitialCatalogVariantDraft,
    t: Translate,
): string | null {
    try {
        initialCatalogVariantInput(draft, t);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : t`The first SKU information is incomplete`;
    }
}

function initialCatalogVariantInput(draft: InitialCatalogVariantDraft, t: Translate) {
    if (!draft.stockLocationId) throw new Error(t`Select the current warehouse`);
    if (!draft.sku.trim()) throw new Error(t`SKU code is required`);
    const packageQuantity = requiredCatalogNumber(draft.packageQuantity, t`Package conversion`, t);
    if (packageQuantity <= 0) throw new Error(t`Package conversion must be greater than 0`);
    const minimumStock = optionalCatalogInteger(draft.minimumStock, t`Minimum stock`, t);
    const maximumStock = optionalCatalogInteger(draft.maximumStock, t`Maximum stock`, t);
    if (minimumStock != null && maximumStock != null && maximumStock < minimumStock) {
        throw new Error(t`Maximum stock cannot be lower than minimum stock`);
    }
    return {
        stockLocationId: draft.stockLocationId,
        sku: draft.sku.trim(),
        enabled: draft.enabled,
        barcode: draft.barcode.trim() || null,
        specification: draft.specification.trim() || null,
        saleUnit: draft.saleUnit.trim() || null,
        purchaseUnit: draft.purchaseUnit.trim() || null,
        packageQuantity,
        shelfLifeDays: optionalCatalogInteger(draft.shelfLifeDays, t`Shelf life`, t),
        sellingPrice: Math.round(requiredCatalogNumber(draft.sellingPrice, t`Selling price`, t) * 100),
        purchaseCostMicrounits: Math.round(
            requiredCatalogNumber(draft.purchaseCost, t`Purchase cost`, t) * 1_000,
        ),
        stockOnHand: requiredCatalogInteger(draft.stockOnHand, t`Stock on hand`, t),
        minimumStock,
        maximumStock,
    };
}

function requiredCatalogNumber(value: string, label: string, t: Translate): number {
    if (!value.trim()) throw new Error(t`${label} is required`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(t`${label} must be a non-negative number`);
    return parsed;
}

function requiredCatalogInteger(value: string, label: string, t: Translate): number {
    const parsed = requiredCatalogNumber(value, label, t);
    if (!Number.isInteger(parsed)) throw new Error(t`${label} must be an integer`);
    return parsed;
}

function optionalCatalogInteger(value: string, label: string, t: Translate): number | null {
    if (!value.trim()) return null;
    return requiredCatalogInteger(value, label, t);
}

function initialCatalogMargin(sellingPrice: string, purchaseCost: string): number | null {
    const price = Number(sellingPrice);
    const cost = Number(purchaseCost);
    if (!Number.isFinite(price) || !Number.isFinite(cost) || price <= 0) return null;
    return (price - cost) / price;
}

function isCatalogApiUnavailableError(error: unknown): boolean {
    return (
        error instanceof Error &&
        /Cannot query field "(?:catalogProductCreationContext|createCatalogProduct|saveCatalogProduct)"|Unknown type "(?:CreateCatalogProductInput|SaveCatalogProductInput)"/u.test(
            error.message,
        )
    );
}
