import { useMutation } from '@tanstack/react-query';
import { PowerIcon, PowerOffIcon, TagIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { AssignToChannelBulkAction } from '@/vdb/components/shared/assign-to-channel-bulk-action.js';
import { usePriceFactor } from '@/vdb/components/shared/assign-to-channel-dialog.js';
import { RemoveFromChannelBulkAction } from '@/vdb/components/shared/remove-from-channel-bulk-action.js';
import {
    sensitiveActionHeaders,
    SensitiveActionPasswordField,
} from '@/vdb/components/shared/sensitive-action-password.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';

import { AssignFacetValuesDialog } from '../../_products/components/assign-facet-values-dialog.js';
import {
    assignProductVariantsToChannelDocument,
    deleteProductVariantsDocument,
    getProductVariantsWithFacetValuesByIdsDocument,
    productVariantDetailDocument,
    removeProductVariantsFromChannelDocument,
    updateProductVariantsDocument,
} from '../product-variants.graphql.js';

export const DeleteProductVariantsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteProductVariantsDocument}
            entityName="product variants"
            requiredPermissions={['DeleteCatalog', 'DeleteProduct']}
            selection={selection}
            table={table}
        />
    );
};

function SetProductVariantsEnabledBulkAction({
    selection,
    table,
    enabled,
}: Parameters<BulkActionComponent<any>>[0] & { enabled: boolean }) {
    const { refetchPaginatedList } = usePaginatedList();
    const { t } = useLingui();
    const [password, setPassword] = useState('');
    const mutation = useMutation({
        mutationFn: (currentPassword: string) =>
            api.mutate(
                updateProductVariantsDocument,
                { input: selection.map(variant => ({ id: variant.id, enabled })) },
                sensitiveActionHeaders(currentPassword),
            ),
        onSuccess: () => {
            toast.success(enabled ? t`Product variants enabled` : t`Product variants disabled`);
            refetchPaginatedList();
            table.resetRowSelection();
        },
        onError: error => {
            toast.error(
                enabled ? t`Failed to enable product variants` : t`Failed to disable product variants`,
                { description: error instanceof Error ? error.message : t`Unknown error` },
            );
        },
        onSettled: () => setPassword(''),
    });

    return (
        <DataTableBulkActionItem
            requiresPermission={['UpdateCatalog', 'UpdateProduct']}
            onClick={() => mutation.mutate(password)}
            label={enabled ? <Trans>Enable</Trans> : <Trans>Disable</Trans>}
            confirmationText={
                enabled ? (
                    <Trans>Enable the selected {selection.length} product variants?</Trans>
                ) : (
                    <Trans>
                        Disable the selected {selection.length} product variants? They will no longer be
                        available for purchase.
                    </Trans>
                )
            }
            confirmationFields={
                <SensitiveActionPasswordField
                    value={password}
                    onChange={setPassword}
                    disabled={mutation.isPending}
                />
            }
            confirmDisabled={!password || mutation.isPending}
            onConfirmationOpenChange={open => {
                if (!open && !mutation.isPending) setPassword('');
            }}
            disabled={mutation.isPending}
            icon={enabled ? PowerIcon : PowerOffIcon}
        />
    );
}

export const EnableProductVariantsBulkAction: BulkActionComponent<any> = props => (
    <SetProductVariantsEnabledBulkAction {...props} enabled={true} />
);

export const DisableProductVariantsBulkAction: BulkActionComponent<any> = props => (
    <SetProductVariantsEnabledBulkAction {...props} enabled={false} />
);

export const AssignProductVariantsToChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const { priceFactor, priceFactorField } = usePriceFactor();

    return (
        <AssignToChannelBulkAction
            selection={selection}
            table={table}
            entityType="variants"
            mutationFn={api.mutate(assignProductVariantsToChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={(channelId: string) => ({
                productVariantIds: selection.map(s => s.id),
                channelId,
                priceFactor,
            })}
            additionalFields={priceFactorField}
        />
    );
};

export const RemoveProductVariantsFromChannelBulkAction: BulkActionComponent<any> = ({
    selection,
    table,
}) => {
    const { activeChannel } = useChannel();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            table={table}
            entityType="product variants"
            mutationFn={api.mutate(removeProductVariantsFromChannelDocument)}
            requiredPermissions={['UpdateCatalog', 'UpdateProduct']}
            buildInput={() => ({
                productVariantIds: selection.map(s => s.id),
                channelId: activeChannel?.id,
            })}
        />
    );
};

export const AssignFacetValuesToProductVariantsBulkAction: BulkActionComponent<any> = ({
    selection,
    table,
}) => {
    const { refetchPaginatedList } = usePaginatedList();
    const [dialogOpen, setDialogOpen] = useState(false);

    const handleSuccess = () => {
        refetchPaginatedList();
        table.resetRowSelection();
    };

    return (
        <>
            <DataTableBulkActionItem
                requiresPermission={['UpdateCatalog', 'UpdateProduct']}
                onClick={() => setDialogOpen(true)}
                label={<Trans>Edit facet values</Trans>}
                icon={TagIcon}
                closeOnClick={false}
            />
            <AssignFacetValuesDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                entityIds={selection.map(s => s.id)}
                entityType="variants"
                queryFn={variables => api.query(getProductVariantsWithFacetValuesByIdsDocument, variables)}
                mutationFn={api.mutate(updateProductVariantsDocument)}
                detailDocument={productVariantDetailDocument}
                onSuccess={handleSuccess}
            />
        </>
    );
};
