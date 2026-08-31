import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/vdb/components/ui/sheet.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useCommerceMode } from '@/vdb/hooks/use-commerce-mode.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { createProductVariantsDocument, withProductVariantCustomFields } from '../products.graphql.js';
import { getNewVariantInventoryInput, getProductFulfillmentType } from './product-fulfillment-type.js';
import { ProductOptionSelect } from './product-option-select.js';

const productVariantFulfillmentFragment = graphql(`
    fragment ProductVariantFulfillment on ProductVariant {
        customFields {
            fulfillmentType
            digitalDeliveryMode
            digitalStockPolicy
        }
    }
`);

const getProductOptionGroupsDocument = graphql(
    `
        query GetProductOptionGroups($productId: ID!) {
            product(id: $productId) {
                id
                name
                translations {
                    languageCode
                    name
                }
                optionGroups {
                    id
                    code
                    name
                    translations {
                        languageCode
                        name
                    }
                    options {
                        id
                        code
                        name
                        translations {
                            languageCode
                            name
                        }
                    }
                }
                variants {
                    id
                    name
                    sku
                    ...ProductVariantFulfillment
                    options {
                        id
                        code
                        name
                        groupId
                    }
                }
            }
        }
    `,
    [productVariantFulfillmentFragment],
);

type Translate = ReturnType<typeof useLingui>['t'];

const createFormSchema = (t: Translate) =>
    z.object({
        nameZh: z
            .string()
            .trim()
            .min(1, t`Simplified Chinese name is required`),
        sku: z
            .string()
            .trim()
            .min(1, t`SKU is required`),
        price: z
            .string()
            .min(1, t`Price is required`)
            .refine(value => Number.isFinite(Number(value)) && Number(value) >= 0, t`Price is invalid`),
        stockOnHand: z
            .string()
            .min(1, t`Stock level is required`)
            .refine(
                value => Number.isInteger(Number(value)) && Number(value) >= 0,
                t`Stock level must be a non-negative integer`,
            ),
        fulfillmentType: z.enum(['physical', 'digital']),
        options: z.record(z.string(), z.string()),
    });

type FormValues = z.infer<ReturnType<typeof createFormSchema>>;

function translatedName(
    translations: Array<{ languageCode: string; name: string }>,
    languageCode: 'zh_Hans' | 'en',
    fallback: string,
): string {
    return translations.find(translation => translation.languageCode === languageCode)?.name || fallback;
}

export function AddProductVariantDialog({
    productId,
    onSuccess,
}: {
    productId: string;
    onSuccess?: () => void;
}) {
    const [open, setOpen] = useState(false);
    const { activeChannel } = useChannel();
    const { fixedFulfillmentType } = useCommerceMode();
    const { t } = useLingui();
    const formSchema = useMemo(() => createFormSchema(t), [t]);
    const [duplicateVariantError, setDuplicateVariantError] = useState<string | null>(null);
    const [nameTouched, setNameTouched] = useState(false);

    const { data: productData, refetch: refetchProductData } = useQuery({
        queryKey: ['productOptionGroups', productId],
        queryFn: () =>
            api.query(withProductVariantCustomFields(getProductOptionGroupsDocument), { productId }),
    });

    const form = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            nameZh: '',
            sku: '',
            price: '0',
            stockOnHand: '0',
            fulfillmentType: fixedFulfillmentType ?? 'physical',
            options: {},
        },
    });

    const checkForDuplicateVariant = useCallback(
        (values: FormValues) => {
            if (!productData?.product) return;

            const newOptionIds = Object.values(values.options).sort();
            if (newOptionIds.length !== productData.product.optionGroups.length) {
                setDuplicateVariantError(null);
                return;
            }

            const existingVariant = productData.product.variants.find(variant => {
                const variantOptionIds = variant.options.map(opt => opt.id).sort();
                return JSON.stringify(variantOptionIds) === JSON.stringify(newOptionIds);
            });

            if (existingVariant) {
                setDuplicateVariantError(
                    `A variant with these options already exists: ${existingVariant.name} (${existingVariant.sku})`,
                );
            } else {
                setDuplicateVariantError(null);
            }
        },
        [productData?.product],
    );

    const generateNameFromOptions = useCallback(
        (values: FormValues) => {
            if (!productData?.product?.name || nameTouched) return;

            const selectedOptions = Object.entries(values.options)
                .map(([groupId, optionId]) => {
                    const group = productData.product?.optionGroups.find(g => g.id === groupId);
                    return group?.options.find(o => o.id === optionId);
                })
                .filter((option): option is NonNullable<typeof option> => option != null);

            if (selectedOptions.length === productData.product.optionGroups.length) {
                const productNameZh = translatedName(
                    productData.product.translations,
                    'zh_Hans',
                    productData.product.name,
                );
                form.setValue(
                    'nameZh',
                    `${productNameZh} ${selectedOptions
                        .map(option => translatedName(option.translations, 'zh_Hans', option.name))
                        .join(' ')}`,
                    { shouldDirty: true },
                );
            }
        },
        [productData?.product, nameTouched, form],
    );

    // Watch for changes in options to check for duplicates and update name
    const options = form.watch('options');
    useEffect(() => {
        checkForDuplicateVariant(form.getValues());
        generateNameFromOptions(form.getValues());
    }, [JSON.stringify(options), checkForDuplicateVariant, generateNameFromOptions, form]);

    // Also check when the sheet opens and product data is loaded
    useEffect(() => {
        if (open && productData?.product) {
            checkForDuplicateVariant(form.getValues());
            const productType =
                fixedFulfillmentType ?? getProductFulfillmentType(productData.product.variants);
            if (productType !== 'mixed' && (!form.formState.isDirty || fixedFulfillmentType)) {
                form.setValue('fulfillmentType', productType);
            }
        }
    }, [open, productData?.product, checkForDuplicateVariant, fixedFulfillmentType, form]);

    const createProductVariantMutation = useMutation({
        mutationFn: api.mutate(createProductVariantsDocument),
        onSuccess: async () => {
            toast.success(t`Successfully created product variant`);
            setOpen(false);
            setNameTouched(false);
            form.reset();
            await refetchProductData();
            onSuccess?.();
        },
        onError: error => {
            toast.error(t`Failed to create product variant`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        },
    });

    const onSubmit = useCallback(
        (values: FormValues) => {
            if (!productData?.product) return;
            if (duplicateVariantError) return;
            if (
                Object.values(values.options).filter(Boolean).length !==
                productData.product.optionGroups.length
            ) {
                toast.error(t`Select one value for every product option`);
                return;
            }

            createProductVariantMutation.mutate({
                input: [
                    {
                        productId,
                        sku: values.sku.trim(),
                        price: Number(values.price),
                        ...getNewVariantInventoryInput(Number(values.stockOnHand)),
                        customFields: {
                            fulfillmentType: values.fulfillmentType,
                            ...(values.fulfillmentType === 'digital'
                                ? { digitalDeliveryMode: 'manual_service' as const }
                                : {}),
                        },
                        optionIds: Object.values(values.options),
                        translations: [
                            {
                                languageCode: 'zh_Hans',
                                name: values.nameZh.trim(),
                            },
                        ],
                    },
                ],
            });
        },
        [createProductVariantMutation, productData?.product, duplicateVariantError, productId, t],
    );

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && form.formState.isDirty && !window.confirm(t`Discard the unsaved product variant?`)) {
            return;
        }
        if (!nextOpen) {
            form.reset();
            setNameTouched(false);
            setDuplicateVariantError(null);
        }
        setOpen(nextOpen);
    };

    // Don't show the "Add variant" button if there are no option groups
    if (!productData?.product?.optionGroups.length) {
        return null;
    }

    return (
        <Sheet open={open} onOpenChange={handleOpenChange}>
            <SheetTrigger render={<Button variant="outline" />}>
                <Plus className="mr-2 h-4 w-4" />
                <Trans>Add variant</Trans>
            </SheetTrigger>
            <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-[640px]">
                <SheetHeader>
                    <SheetTitle>
                        <Trans>Add product variant</Trans>
                    </SheetTitle>
                    <SheetDescription>
                        <Trans>Create a new product variant with options, pricing, and stock</Trans>
                    </SheetDescription>
                </SheetHeader>
                <Form {...form}>
                    <form
                        onSubmit={e => {
                            e.stopPropagation();
                            form.handleSubmit(onSubmit)(e);
                        }}
                        className="flex flex-1 flex-col"
                    >
                        <div className="flex-1 space-y-4 py-6">
                            {productData?.product?.optionGroups.length && (
                                <div className="flex flex-col gap-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium">
                                            <Trans>Product options</Trans>
                                        </label>
                                    </div>
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                {productData?.product?.optionGroups.map(group => (
                                    <ProductOptionSelect
                                        key={group.id}
                                        group={group}
                                        value={form.watch(`options.${group.id}`)}
                                        onChange={value => {
                                            form.setValue(`options.${group.id}`, value, {
                                                shouldDirty: true,
                                                shouldValidate: true,
                                            });
                                        }}
                                    />
                                ))}
                            </div>
                            <FormFieldWrapper
                                control={form.control}
                                name="nameZh"
                                label={<Trans>Name (Simplified Chinese)</Trans>}
                                render={({ field }) => (
                                    <Input {...field} onFocus={() => setNameTouched(true)} />
                                )}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="sku"
                                label={<Trans>SKU</Trans>}
                                render={({ field }) => <Input {...field} />}
                            />
                            <FormFieldWrapper
                                control={form.control}
                                name="price"
                                label={<Trans>Price</Trans>}
                                render={({ field }) => (
                                    <MoneyInput
                                        {...field}
                                        value={Number(field.value) || 0}
                                        onChange={value => field.onChange(value.toString())}
                                        currency={activeChannel?.defaultCurrencyCode}
                                    />
                                )}
                            />
                            {fixedFulfillmentType ? (
                                <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                                    {fixedFulfillmentType === 'digital' ? (
                                        <Trans>
                                            This store only supports digital products delivered by email.
                                        </Trans>
                                    ) : (
                                        <Trans>
                                            This store only supports physical products delivered by logistics.
                                        </Trans>
                                    )}
                                </div>
                            ) : (
                                <FormFieldWrapper
                                    control={form.control}
                                    name="fulfillmentType"
                                    label={<Trans>Product type and delivery</Trans>}
                                    description={
                                        form.watch('fulfillmentType') === 'digital' ? (
                                            <Trans>
                                                Delivered to the checkout email after payment; no shipping is
                                                required.
                                            </Trans>
                                        ) : (
                                            <Trans>
                                                Uses stock, shipping address and logistics fulfillment.
                                            </Trans>
                                        )
                                    }
                                    render={({ field }) => (
                                        <Select
                                            items={{
                                                physical: t`Physical product`,
                                                digital: t`Digital product`,
                                            }}
                                            value={field.value}
                                            onValueChange={field.onChange}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="physical">
                                                    <Trans>Physical product</Trans>
                                                </SelectItem>
                                                <SelectItem value="digital">
                                                    <Trans>Digital product</Trans>
                                                </SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                            )}
                            <FormFieldWrapper
                                control={form.control}
                                name="stockOnHand"
                                label={<Trans>Stock level</Trans>}
                                description={
                                    <Trans>Inventory tracking follows the global setting by default.</Trans>
                                }
                                render={({ field }) => <Input type="number" min="0" step="1" {...field} />}
                            />
                        </div>
                        <SheetFooter className="border-t pt-4">
                            {duplicateVariantError && (
                                <p className="text-sm text-destructive">{duplicateVariantError}</p>
                            )}
                            <Button
                                type="submit"
                                disabled={createProductVariantMutation.isPending || !!duplicateVariantError}
                            >
                                <Trans>Create variant</Trans>
                            </Button>
                        </SheetFooter>
                    </form>
                </Form>
            </SheetContent>
        </Sheet>
    );
}
