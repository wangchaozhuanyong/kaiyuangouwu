import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/index.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TrashIcon } from 'lucide-react';
import { toast } from 'sonner';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { deleteZonesDocument, removeCountryFromZoneMutation } from '../zones.graphql.js';

export const DeleteZonesBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteZonesDocument}
            entityName="zones"
            requiredPermissions={['DeleteZone']}
            selection={selection}
            table={table}
        />
    );
};

export function removeCountryFromZoneBulkAction(zoneId: string): BulkActionComponent<any> {
    const RemoveCountryFromZoneBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
        const { t } = useLingui();
        const queryClient = useQueryClient();
        const countryCount = selection.length;

        const { mutate } = useMutation({
            mutationFn: api.mutate(removeCountryFromZoneMutation),
            onSuccess: () => {
                toast.success(
                    countryCount === 1
                        ? t`Removed 1 country/region from zone`
                        : t`Removed ${countryCount} countries/regions from zone`,
                );
                queryClient.invalidateQueries({ queryKey: ['zone', zoneId] });
                table.resetRowSelection();
            },
            onError: () => {
                toast.error(t`Failed to remove countries from zone`);
            },
        });

        return (
            <DataTableBulkActionItem
                requiresPermission={['UpdateZone']}
                onClick={() => {
                    mutate({
                        zoneId,
                        memberIds: selection.map(s => s.id),
                    });
                }}
                label={<Trans>Remove from zone</Trans>}
                confirmationText={
                    countryCount === 1 ? (
                        <Trans>Are you sure you want to remove 1 country/region from this zone?</Trans>
                    ) : (
                        <Trans>
                            Are you sure you want to remove {countryCount} countries/regions from this zone?
                        </Trans>
                    )
                }
                icon={TrashIcon}
            />
        );
    };

    return RemoveCountryFromZoneBulkAction;
}
