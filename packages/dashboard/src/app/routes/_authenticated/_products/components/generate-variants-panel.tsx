import { MoneyInput } from '@/vdb/components/data-input/money-input.js';
import { ConfirmationDialog } from '@/vdb/components/shared/confirmation-dialog.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import { Field, FieldError } from '@/vdb/components/ui/field.js';
import { Form } from '@/vdb/components/ui/form.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import { RadioGroup, RadioGroupItem } from '@/vdb/components/ui/radio-group.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { z, zodResolver } from '@/vdb/lib/zod.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Mail, Save, Search, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';

import { createProductVariantsDocument } from '../products.graphql.js';

interface OptionGroup {
    id: string;
    code: string;
    name: string;
    translations: Array<{
        languageCode: string;
        name: string;
    }>;
    options: Array<{
        id: string;
        code: string;
        name: string;
        translations: Array<{
            languageCode: string;
            name: string;
        }>;
    }>;
}

interface GeneratedVariant {
    id: string;
    name: string;
    optionIds: string[];
    optionNames: string[];
    optionNamesZh: string[];
}

type Translate = ReturnType<typeof useLingui>['t'];

function createVariantFormSchema(t: Translate) {
    const variantSchema = z
        .object({
            enabled: z.boolean(),
            sku: z.string(),
            price: z.string(),
            stock: z.string(),
        })
        .superRefine((data, ctx) => {
            if (!data.enabled) return;
            if (!data.sku || data.sku.length === 0) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t`SKU is required`,
                    path: ['sku'],
                });
            }
            if (data.price !== '' && (Number.isNaN(Number(data.price)) || Number(data.price) < 0)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t`Price must be a non-negative number`,
                    path: ['price'],
                });
            }
            const stockNum = Number(data.stock);
            if (
                data.stock !== '' &&
                (Number.isNaN(stockNum) || stockNum < 0 || !Number.isInteger(stockNum))
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t`Stock must be a non-negative integer`,
                    path: ['stock'],
                });
            }
        });

    return z.object({
        fulfillmentType: z.enum(['physical', 'digital']),
        variants: z.record(variantSchema),
    });
}

type VariantFormValues = z.infer<ReturnType<typeof createVariantFormSchema>>;

function translatedName(
    translations: Array<{ languageCode: string; name: string }>,
    languageCode: 'zh_Hans' | 'en',
    fallback: string,
): string {
    return translations.find(translation => translation.languageCode === languageCode)?.name || fallback;
}

function generateVariantCombinations(optionGroups: OptionGroup[]): GeneratedVariant[] {
    const validGroups = optionGroups.filter(g => g.options.length > 0);
    if (validGroups.length === 0) {
        return [
            {
                id: 'default',
                name: '',
                optionIds: [],
                optionNames: [],
                optionNamesZh: [],
            },
        ];
    }

    const combine = (
        groups: OptionGroup[],
        index: number,
        current: Array<{ id: string; name: string; nameZh: string }>,
    ): GeneratedVariant[] => {
        if (index === groups.length) {
            return [
                {
                    id: current.map(c => c.id).join('-'),
                    name: current.map(c => c.name).join(' '),
                    optionIds: current.map(c => c.id),
                    optionNames: current.map(c => c.name),
                    optionNamesZh: current.map(c => c.nameZh),
                },
            ];
        }
        const results: GeneratedVariant[] = [];
        for (const option of groups[index].options) {
            results.push(
                ...combine(groups, index + 1, [
                    ...current,
                    {
                        id: option.id,
                        name: option.name,
                        nameZh: translatedName(option.translations, 'zh_Hans', option.name),
                    },
                ]),
            );
        }
        return results;
    };

    return combine(validGroups, 0, []);
}

export function GenerateVariantsPanel({
    productId,
    productName,
    productTranslations,
    optionGroups,
    onSuccess,
    onBack,
}: Readonly<{
    productId: string;
    productName: string;
    productTranslations: Array<{ languageCode: string; name: string }>;
    optionGroups: OptionGroup[];
    onSuccess?: () => void;
    onBack?: {
        handler: () => void;
        confirmation?: { title: string; description: string };
    };
}>) {
    const { t } = useLingui();
    const { activeChannel } = useChannel();
    const formSchema = useMemo(() => createVariantFormSchema(t), [t]);

    const variants = useMemo(() => generateVariantCombinations(optionGroups), [optionGroups]);

    // For small products (few option-group combinations) the historical
    // "all variants enabled by default" workflow is convenient. For products
    // built on a shared option group with many values (the reporter's case in
    // OSS-531 — 129 colors), defaulting every variant on forces the user to
    // uncheck almost everything. Above the threshold we flip the default off
    // and let them check only the ones they want; the filter + master toggle
    // above the table make that workflow practical.
    const enableByDefault = variants.length <= 20;

    const form = useForm<VariantFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            fulfillmentType: 'physical',
            variants: Object.fromEntries(
                variants.map(v => [v.id, { enabled: enableByDefault, sku: '', price: '', stock: '' }]),
            ),
        },
        mode: 'onChange',
    });

    const createVariantsMutation = useMutation({
        mutationFn: api.mutate(createProductVariantsDocument),
    });

    const handleCreateVariants = form.handleSubmit(async formValues => {
        const productNameZh = translatedName(productTranslations, 'zh_Hans', productName);

        const variantsToCreate = variants
            .filter(v => formValues.variants[v.id]?.enabled)
            .map(v => {
                const data = formValues.variants[v.id];
                const nameZh = v.optionNamesZh.length
                    ? `${productNameZh} ${v.optionNamesZh.join(' ')}`
                    : productNameZh;
                return {
                    productId,
                    sku: data.sku,
                    price: Number(data.price),
                    stockOnHand: formValues.fulfillmentType === 'physical' ? Number(data.stock) : 0,
                    trackInventory:
                        formValues.fulfillmentType === 'digital' ? ('FALSE' as const) : ('TRUE' as const),
                    customFields: {
                        fulfillmentType: formValues.fulfillmentType,
                        ...(formValues.fulfillmentType === 'digital'
                            ? { digitalDeliveryMode: 'manual_service' as const }
                            : {}),
                    },
                    optionIds: v.optionIds,
                    translations: [
                        {
                            languageCode: 'zh_Hans' as const,
                            name: nameZh,
                        },
                    ],
                };
            });

        if (variantsToCreate.length === 0) return;

        try {
            await createVariantsMutation.mutateAsync({ input: variantsToCreate });
            toast.success(t`Successfully created variants`);
            onSuccess?.();
        } catch (error) {
            toast.error(t`Failed to create variants`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        }
    });

    const watchedVariants = useWatch({ control: form.control, name: 'variants' });
    const fulfillmentType = useWatch({ control: form.control, name: 'fulfillmentType' });
    const enabledCount = variants.filter(v => watchedVariants?.[v.id]?.enabled).length;

    const [filter, setFilter] = useState('');
    const debouncedFilter = useDebounce(filter, 300);
    const filteredVariants = useMemo(() => {
        if (!debouncedFilter) return variants;
        // Rows render `optionNames.join(' / ')`, so accept that exact shape
        // ("Red / M") as well as the space-joined source name.
        const normalize = (s: string) =>
            s
                .toLowerCase()
                .replace(/\s*\/\s*/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        const q = normalize(debouncedFilter);
        if (!q) return variants;
        return variants.filter(v => normalize(v.name).includes(q));
    }, [variants, debouncedFilter]);

    // Master toggle drives every variant currently visible after the filter,
    // not the whole list — so a user can scope a check/uncheck-all to e.g.
    // "Red" without losing their selections in other rows.
    const visibleEnabledCount = filteredVariants.filter(v => watchedVariants?.[v.id]?.enabled).length;
    const allVisibleEnabled = filteredVariants.length > 0 && visibleEnabledCount === filteredVariants.length;
    const someVisibleEnabled = visibleEnabledCount > 0;
    const handleToggleVisible = () => {
        const shouldEnable = !allVisibleEnabled;
        // Single setValue with the full record avoids N RHF subscriber updates
        // (the table has 129+ rows for shared option groups).
        const next = { ...(form.getValues('variants') ?? {}) };
        for (const v of filteredVariants) {
            next[v.id] = { ...next[v.id], enabled: shouldEnable };
        }
        form.setValue('variants', next, { shouldDirty: true });
    };

    const showVariantTools = variants.length > 1;
    const isFiltered = debouncedFilter.length > 0;

    return (
        <Form {...form}>
            <div className="space-y-4">
                <div className="space-y-2">
                    <div>
                        <p className="text-sm font-medium">
                            <Trans>Product type and delivery</Trans>
                        </p>
                        <p className="text-sm text-muted-foreground">
                            <Trans>This setting will be saved on every SKU created below.</Trans>
                        </p>
                    </div>
                    <Controller
                        control={form.control}
                        name="fulfillmentType"
                        render={({ field }) => (
                            <RadioGroup
                                value={field.value}
                                onValueChange={field.onChange}
                                className="grid gap-3 md:grid-cols-2"
                            >
                                <Label
                                    htmlFor="new-variant-type-physical"
                                    className={`cursor-pointer rounded-lg border p-3 hover:bg-accent/50 ${
                                        field.value === 'physical' ? 'border-primary bg-primary/5' : ''
                                    }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <RadioGroupItem
                                            id="new-variant-type-physical"
                                            value="physical"
                                            aria-label={t`Physical product`}
                                            className="mt-1"
                                        />
                                        <div>
                                            <div className="flex items-center gap-2 font-medium">
                                                <Truck className="h-4 w-4" />
                                                <Trans>Physical product</Trans>
                                            </div>
                                            <p className="mt-1 text-sm font-normal text-muted-foreground">
                                                <Trans>
                                                    Uses stock, shipping address and logistics fulfillment.
                                                </Trans>
                                            </p>
                                        </div>
                                    </div>
                                </Label>
                                <Label
                                    htmlFor="new-variant-type-digital"
                                    className={`cursor-pointer rounded-lg border p-3 hover:bg-accent/50 ${
                                        field.value === 'digital' ? 'border-primary bg-primary/5' : ''
                                    }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <RadioGroupItem
                                            id="new-variant-type-digital"
                                            value="digital"
                                            aria-label={t`Digital product`}
                                            className="mt-1"
                                        />
                                        <div>
                                            <div className="flex items-center gap-2 font-medium">
                                                <Mail className="h-4 w-4" />
                                                <Trans>Digital product</Trans>
                                            </div>
                                            <p className="mt-1 text-sm font-normal text-muted-foreground">
                                                <Trans>
                                                    Delivered to the checkout email after payment; no shipping
                                                    or stock.
                                                </Trans>
                                            </p>
                                        </div>
                                    </div>
                                </Label>
                            </RadioGroup>
                        )}
                    />
                </div>
                {showVariantTools && (
                    <div className="flex items-center gap-3">
                        <div className="relative w-full max-w-sm">
                            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                value={filter}
                                onChange={e => setFilter(e.target.value)}
                                placeholder={t`Filter variants...`}
                                className="pl-8"
                                data-testid="variant-filter-input"
                            />
                        </div>
                        <div className="text-sm text-muted-foreground">
                            {(() => {
                                // Hoist locals so Lingui extracts named placeholders
                                // (`{shown}`, `{total}`, `{selected}`) in the .po
                                // catalog instead of positional `{0}`, `{1}`, `{2}`.
                                const shown = filteredVariants.length;
                                const total = variants.length;
                                const selected = enabledCount;
                                return isFiltered ? (
                                    <Trans>
                                        Showing {shown} of {total} • {selected} selected
                                    </Trans>
                                ) : (
                                    <Trans>
                                        {selected} of {total} selected
                                    </Trans>
                                );
                            })()}
                        </div>
                    </div>
                )}
                <Table>
                    <TableHeader>
                        <TableRow>
                            {showVariantTools && (
                                <TableHead className="w-12">
                                    <Checkbox
                                        checked={allVisibleEnabled || someVisibleEnabled}
                                        indeterminate={someVisibleEnabled && !allVisibleEnabled}
                                        onCheckedChange={handleToggleVisible}
                                        disabled={filteredVariants.length === 0}
                                        aria-label={t`Toggle all visible variants`}
                                        data-testid="variant-toggle-all"
                                    />
                                </TableHead>
                            )}
                            {showVariantTools && (
                                <TableHead>
                                    <Trans>Variant</Trans>
                                </TableHead>
                            )}
                            <TableHead>
                                <Trans>SKU</Trans>
                            </TableHead>
                            <TableHead>
                                <Trans>Price</Trans>
                            </TableHead>
                            {fulfillmentType === 'physical' && (
                                <TableHead>
                                    <Trans>Stock on Hand</Trans>
                                </TableHead>
                            )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredVariants.length === 0 && (
                            <TableRow>
                                <TableCell
                                    colSpan={
                                        (showVariantTools ? 4 : 2) + (fulfillmentType === 'physical' ? 1 : 0)
                                    }
                                    className="text-center text-muted-foreground py-8"
                                >
                                    <Trans>No variants match the current filter.</Trans>
                                </TableCell>
                            </TableRow>
                        )}
                        {filteredVariants.map(variant => (
                            <TableRow key={variant.id}>
                                {showVariantTools && (
                                    <TableCell>
                                        <Controller
                                            control={form.control}
                                            name={`variants.${variant.id}.enabled`}
                                            render={({ field }) => (
                                                <Checkbox
                                                    checked={field.value}
                                                    onCheckedChange={field.onChange}
                                                />
                                            )}
                                        />
                                    </TableCell>
                                )}

                                {showVariantTools && (
                                    <TableCell className="font-medium">
                                        {variant.optionNames.join(' / ')}
                                    </TableCell>
                                )}

                                <TableCell>
                                    <Controller
                                        control={form.control}
                                        name={`variants.${variant.id}.sku`}
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid || undefined}>
                                                <Input
                                                    {...field}
                                                    placeholder="SKU"
                                                    data-testid="variant-sku-input"
                                                />
                                                {fieldState.invalid && (
                                                    <FieldError errors={[fieldState.error]} />
                                                )}
                                            </Field>
                                        )}
                                    />
                                </TableCell>

                                <TableCell>
                                    <Controller
                                        control={form.control}
                                        name={`variants.${variant.id}.price`}
                                        render={({ field, fieldState }) => (
                                            <Field data-invalid={fieldState.invalid || undefined}>
                                                <MoneyInput
                                                    {...field}
                                                    value={Number(field.value) || 0}
                                                    onChange={value => field.onChange(value.toString())}
                                                    currency={activeChannel?.defaultCurrencyCode}
                                                />
                                                {fieldState.invalid && (
                                                    <FieldError errors={[fieldState.error]} />
                                                )}
                                            </Field>
                                        )}
                                    />
                                </TableCell>

                                {fulfillmentType === 'physical' && (
                                    <TableCell>
                                        <Controller
                                            control={form.control}
                                            name={`variants.${variant.id}.stock`}
                                            render={({ field, fieldState }) => (
                                                <Field data-invalid={fieldState.invalid || undefined}>
                                                    <Input
                                                        {...field}
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        data-testid="variant-stock-input"
                                                    />
                                                    {fieldState.invalid && (
                                                        <FieldError errors={[fieldState.error]} />
                                                    )}
                                                </Field>
                                            )}
                                        />
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                <div className="flex justify-between items-center">
                    <div>
                        {onBack &&
                            (onBack.confirmation ? (
                                <ConfirmationDialog
                                    title={onBack.confirmation.title}
                                    description={onBack.confirmation.description}
                                    onConfirm={onBack.handler}
                                >
                                    <button
                                        type="button"
                                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        ← <Trans>Back</Trans>
                                    </button>
                                </ConfirmationDialog>
                            ) : (
                                <button
                                    type="button"
                                    onClick={onBack.handler}
                                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    ← <Trans>Back</Trans>
                                </button>
                            ))}
                    </div>
                    <Button
                        type="button"
                        onClick={() => void handleCreateVariants()}
                        disabled={createVariantsMutation.isPending || enabledCount === 0}
                    >
                        <Save className="mr-2 h-4 w-4" />
                        {createVariantsMutation.isPending && <Trans>Creating...</Trans>}
                        {!createVariantsMutation.isPending && enabledCount === 1 && (
                            <Trans>Create variant</Trans>
                        )}
                        {!createVariantsMutation.isPending && enabledCount !== 1 && (
                            <Trans>Create {enabledCount} variants</Trans>
                        )}
                    </Button>
                </div>
            </div>
        </Form>
    );
}
