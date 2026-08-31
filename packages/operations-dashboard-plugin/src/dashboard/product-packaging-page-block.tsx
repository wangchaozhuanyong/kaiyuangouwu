import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    Input,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    Switch,
    api,
    toast,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { Box, PackageOpen, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
    ProductPackagingWorkspaceResult,
    productPackagingWorkspaceQuery,
    updateProductPackagingMutation,
} from './product-packaging.graphql';

interface ProductPackagingPageBlockProps {
    context: { entity?: { id?: string } };
}

const messages = {
    title: msg({ id: 'operations.productPackaging.title', message: 'Packaging & automatic unpacking' }),
    description: msg({
        id: 'operations.productPackaging.description',
        message:
            'Link package and loose-unit variants. When loose stock is short, packages are opened at payment confirmation.',
    }),
    unitVariant: msg({ id: 'operations.productPackaging.unitVariant', message: 'Loose-unit variant' }),
    packageVariant: msg({ id: 'operations.productPackaging.packageVariant', message: 'Package variant' }),
    chooseVariant: msg({ id: 'operations.productPackaging.chooseVariant', message: 'Choose a variant' }),
    unitLabel: msg({ id: 'operations.productPackaging.unitLabel', message: 'Loose-unit label' }),
    packageLabel: msg({ id: 'operations.productPackaging.packageLabel', message: 'Package label' }),
    unitDefault: msg({ id: 'operations.productPackaging.unitDefault', message: 'bottle' }),
    packageDefault: msg({ id: 'operations.productPackaging.packageDefault', message: 'case' }),
    unitsPerPackage: msg({
        id: 'operations.productPackaging.unitsPerPackage',
        message: 'Units per package',
    }),
    enabled: msg({ id: 'operations.productPackaging.enabled', message: 'Enable package selling' }),
    autoUnpack: msg({
        id: 'operations.productPackaging.autoUnpack',
        message: 'Automatically unpack when loose stock is short',
    }),
    save: msg({ id: 'operations.productPackaging.save', message: 'Save packaging settings' }),
    saving: msg({ id: 'operations.productPackaging.saving', message: 'Saving' }),
    saved: msg({
        id: 'operations.productPackaging.saved',
        message: 'Packaging and automatic unpacking settings saved',
    }),
    loadError: msg({
        id: 'operations.productPackaging.loadError',
        message: 'Could not load packaging settings',
    }),
    saveError: msg({
        id: 'operations.productPackaging.saveError',
        message: 'Could not save packaging settings',
    }),
    retry: msg({ id: 'operations.productPackaging.retry', message: 'Retry' }),
    needVariants: msg({
        id: 'operations.productPackaging.needVariants',
        message:
            'At least two variants are required. Create a loose-unit SKU and a package SKU in the variants section above.',
    }),
    invalidPair: msg({
        id: 'operations.productPackaging.invalidPair',
        message: 'The loose-unit and package variants must be different.',
    }),
    invalidQuantity: msg({
        id: 'operations.productPackaging.invalidQuantity',
        message: 'Units per package must be an integer of 2 or more.',
    }),
    stockTitle: msg({ id: 'operations.productPackaging.stockTitle', message: 'Current stock' }),
    packageStock: msg({ id: 'operations.productPackaging.packageStock', message: 'Packages available' }),
    unitStock: msg({ id: 'operations.productPackaging.unitStock', message: 'Loose units available' }),
    convertibleStock: msg({
        id: 'operations.productPackaging.convertibleStock',
        message: 'Total saleable loose units',
    }),
    history: msg({ id: 'operations.productPackaging.history', message: 'Recent unpacking records' }),
    noHistory: msg({
        id: 'operations.productPackaging.noHistory',
        message: 'No automatic unpacking has occurred yet.',
    }),
    order: msg({ id: 'operations.productPackaging.order', message: 'Order' }),
    warehouse: msg({ id: 'operations.productPackaging.warehouse', message: 'Warehouse' }),
    trackingRequired: msg({
        id: 'operations.productPackaging.trackingRequired',
        message: 'Both package and loose-unit variants must track inventory.',
    }),
};

type ProductPackagingText = { [key in keyof typeof messages]: string };

export function ProductPackagingPageBlock({ context }: Readonly<ProductPackagingPageBlockProps>) {
    const productId = context.entity?.id;
    const { i18n, t } = useLingui();
    const text = translateMessages(t);
    const queryClient = useQueryClient();
    const queryKey = ['product-packaging', productId];
    const workspaceQuery = useQuery({
        queryKey,
        queryFn: () =>
            api.query<ProductPackagingWorkspaceResult>(productPackagingWorkspaceQuery, {
                productId,
            }),
        enabled: Boolean(productId),
    });
    const [unitVariantId, setUnitVariantId] = useState('');
    const [packageVariantId, setPackageVariantId] = useState('');
    const [unitLabel, setUnitLabel] = useState(() => t(messages.unitDefault));
    const [packageLabel, setPackageLabel] = useState(() => t(messages.packageDefault));
    const [unitsPerPackage, setUnitsPerPackage] = useState('24');
    const [enabled, setEnabled] = useState(true);
    const [autoUnpack, setAutoUnpack] = useState(true);

    const workspace = workspaceQuery.data;
    const variants = workspace?.product?.variants ?? [];
    const selectedVariants = useMemo(
        () => [
            variants.find(variant => variant.id === unitVariantId),
            variants.find(variant => variant.id === packageVariantId),
        ],
        [packageVariantId, unitVariantId, variants],
    );

    useEffect(() => {
        const rule = workspace?.productPackaging;
        if (rule) {
            setUnitVariantId(rule.unitVariant.id);
            setPackageVariantId(rule.packageVariant.id);
            setUnitLabel(rule.unitLabel);
            setPackageLabel(rule.packageLabel);
            setUnitsPerPackage(String(rule.unitsPerPackage));
            setEnabled(rule.enabled);
            setAutoUnpack(rule.autoUnpack);
        } else if (variants.length >= 2 && !unitVariantId && !packageVariantId) {
            setUnitVariantId(variants[0].id);
            setPackageVariantId(variants[1].id);
        }
    }, [packageVariantId, unitVariantId, variants, workspace?.productPackaging]);

    const saveMutation = useMutation({
        mutationFn: () => {
            const parsedQuantity = Number(unitsPerPackage);
            if (unitVariantId === packageVariantId) {
                throw new Error(text.invalidPair);
            }
            if (!Number.isInteger(parsedQuantity) || parsedQuantity < 2) {
                throw new Error(text.invalidQuantity);
            }
            if (selectedVariants.some(variant => variant?.trackInventory === 'FALSE')) {
                throw new Error(text.trackingRequired);
            }
            return api.mutate(updateProductPackagingMutation, {
                input: {
                    productId,
                    unitVariantId,
                    packageVariantId,
                    unitLabel: unitLabel.trim(),
                    packageLabel: packageLabel.trim(),
                    unitsPerPackage: parsedQuantity,
                    enabled,
                    autoUnpack,
                },
            });
        },
        onSuccess: async () => {
            toast.success(text.saved);
            await queryClient.invalidateQueries({ queryKey });
        },
        onError: error => toast.error(error instanceof Error ? error.message : text.saveError),
    });

    if (!productId) {
        return null;
    }
    if (workspaceQuery.isLoading) {
        return <Skeleton className="h-64 w-full" />;
    }
    if (workspaceQuery.isError) {
        return (
            <Alert variant="destructive">
                <AlertDescription className="flex items-center justify-between gap-3">
                    <span>{text.loadError}</span>
                    <Button variant="outline" size="sm" onClick={() => void workspaceQuery.refetch()}>
                        <RefreshCw className="size-4" />
                        {text.retry}
                    </Button>
                </AlertDescription>
            </Alert>
        );
    }
    if (variants.length < 2) {
        return (
            <div className="space-y-3">
                <BlockHeading title={text.title} description={text.description} />
                <Alert>
                    <AlertDescription>{text.needVariants}</AlertDescription>
                </Alert>
            </div>
        );
    }

    const stock = workspace?.productPackagingStock;
    const quantity = Number(unitsPerPackage);
    const equation = `${1} ${packageLabel || text.packageVariant} = ${Number.isInteger(quantity) ? quantity : '--'} ${unitLabel || text.unitVariant}`;

    return (
        <div className="space-y-6">
            <BlockHeading title={text.title} description={text.description} />

            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                    <Label>{text.unitVariant}</Label>
                    <Select value={unitVariantId} onValueChange={value => setUnitVariantId(value ?? '')}>
                        <SelectTrigger>
                            <SelectValue placeholder={text.chooseVariant} />
                        </SelectTrigger>
                        <SelectContent>
                            {variants.map(variant => (
                                <SelectItem key={variant.id} value={variant.id}>
                                    {variant.name} · {variant.sku}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>{text.packageVariant}</Label>
                    <Select
                        value={packageVariantId}
                        onValueChange={value => setPackageVariantId(value ?? '')}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder={text.chooseVariant} />
                        </SelectTrigger>
                        <SelectContent>
                            {variants.map(variant => (
                                <SelectItem key={variant.id} value={variant.id}>
                                    {variant.name} · {variant.sku}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="packaging-unit-label">{text.unitLabel}</Label>
                    <Input
                        id="packaging-unit-label"
                        value={unitLabel}
                        maxLength={32}
                        onChange={event => setUnitLabel(event.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="packaging-package-label">{text.packageLabel}</Label>
                    <Input
                        id="packaging-package-label"
                        value={packageLabel}
                        maxLength={32}
                        onChange={event => setPackageLabel(event.target.value)}
                    />
                </div>
                <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="packaging-units-per-package">{text.unitsPerPackage}</Label>
                    <div className="flex items-center gap-3">
                        <Input
                            id="packaging-units-per-package"
                            type="number"
                            min={2}
                            step={1}
                            value={unitsPerPackage}
                            onChange={event => setUnitsPerPackage(event.target.value)}
                        />
                        <Badge variant="secondary" className="whitespace-nowrap px-3 py-2">
                            {equation}
                        </Badge>
                    </div>
                </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <ToggleRow label={text.enabled} checked={enabled} onCheckedChange={setEnabled} />
                <ToggleRow label={text.autoUnpack} checked={autoUnpack} onCheckedChange={setAutoUnpack} />
            </div>

            {stock && (
                <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                    <div className="flex items-center gap-2 font-medium">
                        <Box className="size-4" />
                        {text.stockTitle}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <StockMetric
                            label={text.packageStock}
                            value={`${stock.packageStockAvailable} ${packageLabel}`}
                        />
                        <StockMetric
                            label={text.unitStock}
                            value={`${stock.unitStockAvailable} ${unitLabel}`}
                        />
                        <StockMetric
                            label={text.convertibleStock}
                            value={`${stock.convertibleUnitStock} ${unitLabel}`}
                        />
                    </div>
                </div>
            )}

            <Button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !unitVariantId || !packageVariantId}
            >
                <PackageOpen className="size-4" />
                {saveMutation.isPending ? text.saving : text.save}
            </Button>

            <div className="space-y-3 border-t pt-5">
                <h3 className="font-medium">{text.history}</h3>
                {workspace?.productPackagingUnpackEvents.length ? (
                    <div className="space-y-2">
                        {workspace.productPackagingUnpackEvents.map(event => (
                            <div
                                key={event.id}
                                className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                            >
                                <span>
                                    {event.packagesOpened} {packageLabel} → {event.unitsCreated} {unitLabel}
                                </span>
                                <span className="text-muted-foreground">
                                    {text.warehouse}: {event.stockLocation.name}
                                    {event.order ? ` · ${text.order}: ${event.order.code}` : ''}
                                    {' · '}
                                    {new Intl.DateTimeFormat(i18n.locale, {
                                        dateStyle: 'short',
                                        timeStyle: 'short',
                                    }).format(new Date(event.createdAt))}
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">{text.noHistory}</p>
                )}
            </div>
        </div>
    );
}

function translateMessages(t: ReturnType<typeof useLingui>['t']): ProductPackagingText {
    return Object.fromEntries(
        Object.entries(messages).map(([key, descriptor]) => [key, t(descriptor)]),
    ) as ProductPackagingText;
}

function BlockHeading({ title, description }: Readonly<{ title: string; description: string }>) {
    return (
        <div>
            <div className="flex items-center gap-2 font-medium">
                <PackageOpen className="size-4" />
                {title}
            </div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
    );
}

function ToggleRow({
    label,
    checked,
    onCheckedChange,
}: Readonly<{ label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }>) {
    return (
        <div className="flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
            <Label className="leading-5">{label}</Label>
            <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    );
}

function StockMetric({ label, value }: Readonly<{ label: string; value: string }>) {
    return (
        <div className="rounded-md bg-background px-3 py-2 shadow-sm">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 font-medium tabular-nums">{value}</p>
        </div>
    );
}
