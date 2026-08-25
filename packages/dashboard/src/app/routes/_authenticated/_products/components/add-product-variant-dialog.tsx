import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { createProductVariantsDocument, withProductVariantCustomFields } from '../products.graphql.js';
import { getProductFulfillmentType } from './product-fulfillment-type.js';
import { ProductOptionSelect } from './product-option-select.js';

const productVariantFulfillmentFragment = graphql(`
    fragment ProductVariantFulfillment on ProductVariant {
        customFields
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
        nameZh: z.string().min(1, t`Simplified Chinese name is required`),
        sku: z.string().min(1, t`SKU is required`),
        price: z.string().min(1, t`Price is required`),
        stockOnHand: z.string().min(1, t`Stock level is required`),
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
    const { t } = useLingui();
    const formSchema = useMemo(() => createFormSchema(t), [t]);
    const [duplicateVariantError, setDuplicateVariantError] = useState<string | null>(null);
    const [nameTouched, setNameTouched] = useState(false);

    const { data: productData } = useQuery({
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
            fulfillmentType: 'physical',
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

    // Also check when the dialog opens and product data is loaded
    useEffect(() => {
        if (open && productData?.product) {
            checkForDuplicateVariant(form.getValues());
            const productType = getProductFulfillmentType(productData.product.variants);
            if (productType !== 'mixed' && !form.formState.isDirty) {
                form.setValue('fulfillmentType', productType);
            }
        }
    }, [open, productData?.product, checkForDuplicateVariant, form]);

    const createProductVariantMutation = useMutation({
        mutationFn: api.mutate(createProductVariantsDocument),
        onSuccess: () => {
            toast.success(t`Successfully created product variant`);
            setOpen(false);
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

            createProductVariantMutation.mutate({
                input: [
                    {
                        productId,
                        sku: values.sku,
                        price: Number(values.price),
                        stockOnHand: values.fulfillmentType === 'physical' ? Number(values.stockOnHand) : 0,
                        trackInventory:
                            values.fulfillmentType === 'digital' ? ('FALSE' as const) : ('TRUE' as const),
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
                                name: values.nameZh,
                            },
                        ],
                    },
                ],
            });
        },
        [createProductVariantMutation, productData?.product, duplicateVariantError, productId],
    );

    // Don't show the "Add variant" button if there are no option groups
    if (!productData?.product?.optionGroups.length) {
        return null;
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button variant="outline" />}>
                <Plus className="mr-2 h-4 w-4" />
                <Trans>Add variant</Trans>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Add product variant</Trans>
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        <Trans>Create a new product variant with options, pricing, and stock</Trans>
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form
                        onSubmit={e => {
                            e.stopPropagation();
                            form.handleSubmit(onSubmit)(e);
                        }}
                        className="space-y-4"
                    >
                        {productData?.product?.optionGroups.length && (
                            <div className="flex flex-col gap-2">
                                <div className="flex justify-between items-center">
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
                            render={({ field }) => <Input {...field} onFocus={() => setNameTouched(true)} />}
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
                        <FormFieldWrapper
                            control={form.control}
                            name="fulfillmentType"
                            label={<Trans>Product type and delivery</Trans>}
                            description={
                                form.watch('fulfillmentType') === 'digital' ? (
                                    <Trans>
                                        Delivered to the checkout email after payment; no shipping or stock.
                                    </Trans>
                                ) : (
                                    <Trans>Uses stock, shipping address and logistics fulfillment.</Trans>
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
                        {form.watch('fulfillmentType') === 'physical' && (
                            <FormFieldWrapper
                                control={form.control}
                                name="stockOnHand"
                                label={<Trans>Stock level</Trans>}
                                render={({ field }) => <Input type="number" min="0" step="1" {...field} />}
                            />
                        )}
                        <DialogFooter className="flex flex-col items-end gap-2">
                            {duplicateVariantError && (
                                <p className="text-sm text-destructive">{duplicateVariantError}</p>
                            )}
                            <Button
                                type="submit"
                                disabled={createProductVariantMutation.isPending || !!duplicateVariantError}
                            >
                                <Trans>Create variant</Trans>
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
