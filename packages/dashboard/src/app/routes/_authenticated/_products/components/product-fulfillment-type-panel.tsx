import { ConfirmationDialog } from '@/vdb/components/shared/confirmation-dialog.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import { RadioGroup, RadioGroupItem } from '@/vdb/components/ui/radio-group.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { api } from '@/vdb/graphql/api.js';
import { useCommerceMode } from '@/vdb/hooks/use-commerce-mode.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { Download, Mail, Save, Truck } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { updateProductDocument } from '../products.graphql.js';
import { FulfillmentType, RefundPolicy, getProductLevelFulfillmentType } from './product-fulfillment-type.js';

interface ProductPolicyFields {
    fulfillmentType?: FulfillmentType;
    refundPolicy?: RefundPolicy;
    manualDeliverySlaMinutes?: number;
    [key: string]: unknown;
}

export function ProductFulfillmentTypePanel({
    productId,
    customFields,
    variantCount,
    onUpdated,
}: Readonly<{
    productId: string;
    customFields?: unknown;
    variantCount: number;
    onUpdated: () => void;
}>) {
    const { t } = useLingui();
    const { fixedFulfillmentType } = useCommerceMode();
    const currentFields = useMemo<ProductPolicyFields>(
        () => (customFields && typeof customFields === 'object' ? (customFields as ProductPolicyFields) : {}),
        [customFields],
    );
    const currentType = getProductLevelFulfillmentType(currentFields);
    const currentRefundPolicy = normalizeRefundPolicy(currentFields.refundPolicy);
    const currentSla = normalizeSla(currentFields.manualDeliverySlaMinutes);
    const [selectedType, setSelectedType] = useState<FulfillmentType>(fixedFulfillmentType ?? currentType);
    const [refundPolicy, setRefundPolicy] = useState<RefundPolicy>(currentRefundPolicy);
    const [slaMinutes, setSlaMinutes] = useState(String(currentSla));

    useEffect(() => {
        setSelectedType(fixedFulfillmentType ?? currentType);
        setRefundPolicy(currentRefundPolicy);
        setSlaMinutes(String(currentSla));
    }, [currentRefundPolicy, currentSla, currentType, fixedFulfillmentType]);

    const updateMutation = useMutation({
        mutationFn: api.mutate(updateProductDocument),
        onSuccess: () => {
            toast.success(t`Product policy updated`);
            onUpdated();
        },
        onError: error => {
            toast.error(t`Failed to update product policy`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        },
    });

    const save = () => {
        updateMutation.mutate({
            input: {
                id: productId,
                customFields: {
                    ...currentFields,
                    fulfillmentType: fixedFulfillmentType ?? selectedType,
                    refundPolicy,
                    manualDeliverySlaMinutes: normalizeSla(Number(slaMinutes)),
                },
            } as never,
        });
    };

    const hasChanges =
        selectedType !== currentType ||
        refundPolicy !== currentRefundPolicy ||
        normalizeSla(Number(slaMinutes)) !== currentSla;
    const selectedLabel = selectedType === 'digital' ? t`Digital product` : t`Physical product`;
    const saveButton = (
        <Button type="button" disabled={!hasChanges || updateMutation.isPending} onClick={save}>
            <Save className="mr-2 h-4 w-4" />
            <Trans>Save product policy</Trans>
        </Button>
    );

    return (
        <div className="space-y-5" data-testid="product-fulfillment-type-panel">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Trans>Current setting</Trans>
                    <Badge variant="secondary">
                        {currentType === 'physical' ? (
                            <>
                                <Truck className="mr-1 h-3.5 w-3.5" />
                                <Trans>Physical product</Trans>
                            </>
                        ) : (
                            <>
                                <Download className="mr-1 h-3.5 w-3.5" />
                                <Trans>Digital product</Trans>
                            </>
                        )}
                    </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                    <Trans>{variantCount} SKUs inherit the product type</Trans>
                </span>
            </div>

            {fixedFulfillmentType ? (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                    {fixedFulfillmentType === 'digital' ? (
                        <Trans>
                            This store only sells digital products. Product type is fixed to email delivery.
                        </Trans>
                    ) : (
                        <Trans>
                            This store only sells physical products. Product type is fixed to logistics
                            delivery.
                        </Trans>
                    )}
                </div>
            ) : (
                <RadioGroup
                    value={selectedType}
                    onValueChange={value => setSelectedType(value as FulfillmentType)}
                    className="grid gap-3 md:grid-cols-2"
                >
                    <PolicyOption
                        id="product-type-physical"
                        value="physical"
                        selected={selectedType === 'physical'}
                        icon={<Truck className="h-4 w-4" />}
                        title={<Trans>Physical product</Trans>}
                        description={
                            <Trans>
                                Uses stock, a physical address, shipping, warehouse operations, packaging and
                                automatic unpacking.
                            </Trans>
                        }
                    />
                    <PolicyOption
                        id="product-type-digital"
                        value="digital"
                        selected={selectedType === 'digital'}
                        icon={<Mail className="h-4 w-4" />}
                        title={<Trans>Digital product</Trans>}
                        description={
                            <Trans>
                                Uses the checkout delivery email and the SKU-level automatic card, manual
                                service, or file-download workflow.
                            </Trans>
                        }
                    />
                </RadioGroup>
            )}

            <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="product-refund-policy">
                        <Trans>Refund policy</Trans>
                    </Label>
                    <Select
                        value={refundPolicy}
                        onValueChange={value => setRefundPolicy(value as RefundPolicy)}
                    >
                        <SelectTrigger id="product-refund-policy">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="MERCHANT_REVIEW">
                                <Trans>Refund request with merchant review</Trans>
                            </SelectItem>
                            <SelectItem value="SEVEN_DAY_NO_REASON">
                                <Trans>Seven-day no-reason return</Trans>
                            </SelectItem>
                            <SelectItem value="NON_REFUNDABLE">
                                <Trans>Non-refundable</Trans>
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                {selectedType === 'digital' && (
                    <div className="space-y-2">
                        <Label htmlFor="manual-delivery-sla">
                            <Trans>Manual delivery estimate (minutes)</Trans>
                        </Label>
                        <Input
                            id="manual-delivery-sla"
                            type="number"
                            min={5}
                            max={525600}
                            step={5}
                            value={slaMinutes}
                            onChange={event => setSlaMinutes(event.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            <Trans>
                                Shown on product, checkout, and order pages for manually delivered SKUs.
                            </Trans>
                        </p>
                    </div>
                )}
            </div>

            <div className="flex justify-end">
                <PermissionGuard requires={['UpdateProduct', 'UpdateCatalog']}>
                    {selectedType !== currentType && hasChanges ? (
                        <ConfirmationDialog
                            title={t`Change this product to ${selectedLabel}?`}
                            description={
                                selectedType === 'digital'
                                    ? t`All SKUs will become digital. Physical stock, packaging, and shipping settings will no longer apply.`
                                    : t`All SKUs will become physical and require stock, a delivery address, and shipping configuration.`
                            }
                            confirmText={t`Confirm and save`}
                            onConfirm={save}
                        >
                            <Button type="button" disabled={updateMutation.isPending}>
                                <Save className="mr-2 h-4 w-4" />
                                <Trans>Save product policy</Trans>
                            </Button>
                        </ConfirmationDialog>
                    ) : (
                        saveButton
                    )}
                </PermissionGuard>
            </div>
        </div>
    );
}

function PolicyOption({
    id,
    value,
    selected,
    icon,
    title,
    description,
}: Readonly<{
    id: string;
    value: FulfillmentType;
    selected: boolean;
    icon: ReactNode;
    title: ReactNode;
    description: ReactNode;
}>) {
    return (
        <Label
            htmlFor={id}
            className={`cursor-pointer rounded-lg border p-4 transition-colors hover:bg-accent/50 ${selected ? 'border-primary bg-primary/5' : ''}`}
        >
            <div className="flex items-start gap-3">
                <RadioGroupItem id={id} value={value} className="mt-1" />
                <div className="space-y-2">
                    <div className="flex items-center gap-2 font-medium">
                        {icon}
                        {title}
                    </div>
                    <p className="text-sm font-normal text-muted-foreground">{description}</p>
                </div>
            </div>
        </Label>
    );
}

function normalizeRefundPolicy(value: unknown): RefundPolicy {
    return value === 'SEVEN_DAY_NO_REASON' || value === 'NON_REFUNDABLE' ? value : 'MERCHANT_REVIEW';
}

function normalizeSla(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(525600, Math.max(5, Math.trunc(number))) : 1440;
}
