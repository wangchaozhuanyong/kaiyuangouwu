import { ConfirmationDialog } from '@/vdb/components/shared/confirmation-dialog.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Label } from '@/vdb/components/ui/label.js';
import { RadioGroup, RadioGroupItem } from '@/vdb/components/ui/radio-group.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { Download, Mail, Package, Save, Truck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { updateProductVariantsDocument } from '../products.graphql.js';
import {
    FulfillmentType,
    getProductFulfillmentType,
    getUpdatedFulfillmentCustomFields,
} from './product-fulfillment-type.js';

interface ProductVariantFulfillmentSummary {
    id: string;
    customFields?: unknown;
}

export function ProductFulfillmentTypePanel({
    variants,
    onUpdated,
}: Readonly<{
    variants: ProductVariantFulfillmentSummary[];
    onUpdated: () => void;
}>) {
    const { t } = useLingui();
    const currentType = useMemo(() => getProductFulfillmentType(variants), [variants]);
    const [selectedType, setSelectedType] = useState<FulfillmentType | 'mixed'>(currentType);

    useEffect(() => {
        setSelectedType(currentType);
    }, [currentType]);

    const updateMutation = useMutation({
        mutationFn: api.mutate(updateProductVariantsDocument),
        onSuccess: () => {
            toast.success(t`Product delivery method updated`);
            onUpdated();
        },
        onError: error => {
            toast.error(t`Failed to update product delivery method`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        },
    });

    const applyType = (fulfillmentType: FulfillmentType) => {
        updateMutation.mutate({
            input: variants.map(variant => ({
                id: variant.id,
                customFields: getUpdatedFulfillmentCustomFields(variant.customFields, fulfillmentType),
            })),
        });
    };

    const hasChanges = selectedType !== 'mixed' && selectedType !== currentType;
    const selectedLabel = selectedType === 'digital' ? t`Digital product` : t`Physical product`;

    return (
        <div className="space-y-4" data-testid="product-fulfillment-type-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Trans>Current setting</Trans>
                    {currentType === 'physical' && (
                        <Badge variant="secondary">
                            <Package className="mr-1 h-3.5 w-3.5" />
                            <Trans>Physical product</Trans>
                        </Badge>
                    )}
                    {currentType === 'digital' && (
                        <Badge variant="secondary">
                            <Download className="mr-1 h-3.5 w-3.5" />
                            <Trans>Digital product</Trans>
                        </Badge>
                    )}
                    {currentType === 'mixed' && (
                        <Badge variant="outline">
                            <Trans>Mixed product</Trans>
                        </Badge>
                    )}
                </div>
                <span className="text-xs text-muted-foreground">
                    <Trans>{variants.length} SKUs will use this setting</Trans>
                </span>
            </div>

            {currentType === 'mixed' && (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning-text">
                    <Trans>
                        This product contains both physical and digital SKUs. You can keep editing each SKU
                        separately, or choose one type below to apply it to every SKU.
                    </Trans>
                </div>
            )}

            <RadioGroup
                value={selectedType}
                onValueChange={value => setSelectedType(value as FulfillmentType)}
                className="grid gap-3 md:grid-cols-2"
            >
                <Label
                    htmlFor="product-type-physical"
                    className={`cursor-pointer rounded-lg border p-4 transition-colors hover:bg-accent/50 ${
                        selectedType === 'physical' ? 'border-primary bg-primary/5' : ''
                    }`}
                >
                    <div className="flex items-start gap-3">
                        <RadioGroupItem id="product-type-physical" value="physical" className="mt-1" />
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 font-medium">
                                <Truck className="h-4 w-4" />
                                <Trans>Physical product</Trans>
                            </div>
                            <p className="text-sm font-normal text-muted-foreground">
                                <Trans>
                                    Customers enter a shipping address and select a shipping method. Orders
                                    use stock and are fulfilled with logistics tracking.
                                </Trans>
                            </p>
                        </div>
                    </div>
                </Label>

                <Label
                    htmlFor="product-type-digital"
                    className={`cursor-pointer rounded-lg border p-4 transition-colors hover:bg-accent/50 ${
                        selectedType === 'digital' ? 'border-primary bg-primary/5' : ''
                    }`}
                >
                    <div className="flex items-start gap-3">
                        <RadioGroupItem id="product-type-digital" value="digital" className="mt-1" />
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 font-medium">
                                <Mail className="h-4 w-4" />
                                <Trans>Digital product</Trans>
                            </div>
                            <p className="text-sm font-normal text-muted-foreground">
                                <Trans>
                                    No shipping address or shipping method is required. Inventory tracking is
                                    disabled and the order is delivered to the email entered at checkout after
                                    payment.
                                </Trans>
                            </p>
                        </div>
                    </div>
                </Label>
            </RadioGroup>

            <div className="flex justify-end">
                <PermissionGuard requires={['UpdateProduct', 'UpdateCatalog']}>
                    {selectedType !== 'mixed' && hasChanges ? (
                        <ConfirmationDialog
                            title={t`Apply ${selectedLabel} to all SKUs?`}
                            description={
                                selectedType === 'digital'
                                    ? t`All SKUs will use email delivery and inventory tracking will be disabled. Existing orders keep their recorded delivery type.`
                                    : t`All SKUs will require shipping. Configure stock and shipping methods before accepting orders.`
                            }
                            confirmText={t`Apply to all SKUs`}
                            onConfirm={() => applyType(selectedType)}
                        >
                            <Button type="button" disabled={updateMutation.isPending}>
                                <Save className="mr-2 h-4 w-4" />
                                <Trans>Apply to all SKUs</Trans>
                            </Button>
                        </ConfirmationDialog>
                    ) : (
                        <Button type="button" disabled variant="outline">
                            <Trans>All SKUs use this setting</Trans>
                        </Button>
                    )}
                </PermissionGuard>
            </div>
        </div>
    );
}
