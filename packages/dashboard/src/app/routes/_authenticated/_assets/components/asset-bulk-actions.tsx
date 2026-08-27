import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/vdb/components/ui/alert-dialog.js';
import { Button } from '@/vdb/components/ui/button.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { useMutation } from '@tanstack/react-query';
import { Loader2, TrashIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { api } from '@/vdb/graphql/api.js';
import { AssetFragment } from '@/vdb/graphql/fragments.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { deleteAssetsDocument } from '../assets.graphql.js';

export const DeleteAssetsBulkAction = ({
    selection,
    refetch,
}: {
    selection: AssetFragment[];
    refetch: () => void;
}) => {
    const { t } = useLingui();
    const { hasPermissions } = usePermissions();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [usageMessage, setUsageMessage] = useState<string | null>(null);
    const selectionLength = selection.length;
    const canDelete = hasPermissions(['DeleteCatalog', 'DeleteAsset']);
    const { mutate, isPending } = useMutation({
        mutationFn: ({ force }: { force: boolean }) =>
            api.mutate(deleteAssetsDocument)({
                input: {
                    assetIds: selection.map(asset => asset.id),
                    force,
                },
            }),
        onSuccess: (result: ResultOf<typeof deleteAssetsDocument>, { force }) => {
            if (result.deleteAssets.result === 'DELETED') {
                toast.success(t`Deleted ${selectionLength} assets`);
                setDialogOpen(false);
                setUsageMessage(null);
                refetch();
                return;
            }

            const message = result.deleteAssets.message || t`Failed to delete`;
            if (!force) {
                setUsageMessage(message);
            } else {
                toast.error(t`Failed to delete assets: ${message}`);
            }
        },
        onError: error => {
            toast.error(t`Failed to delete ${selectionLength} assets`, {
                description: error instanceof Error ? error.message : undefined,
            });
        },
    });

    const openConfirmation = () => {
        setUsageMessage(null);
        setDialogOpen(true);
    };

    const handleOpenChange = (open: boolean) => {
        if (isPending) return;
        setDialogOpen(open);
        if (!open) {
            setUsageMessage(null);
        }
    };

    return (
        <>
            <Button
                variant="destructive"
                size="sm"
                className="h-8 whitespace-nowrap shadow-none"
                onClick={openConfirmation}
                disabled={!canDelete || isPending}
            >
                <TrashIcon className="h-4 w-4" />
                <Trans>Delete</Trans>
            </Button>

            <AlertDialog open={dialogOpen} onOpenChange={handleOpenChange}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {usageMessage ? <Trans>Asset is in use</Trans> : <Trans>Delete</Trans>}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {usageMessage ? (
                                usageMessage
                            ) : (
                                <Trans>Are you sure you want to delete {selectionLength} assets?</Trans>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isPending}>
                            <Trans>Cancel</Trans>
                        </AlertDialogCancel>
                        <Button
                            variant="destructive"
                            onClick={() => mutate({ force: usageMessage != null })}
                            disabled={isPending}
                        >
                            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                            {usageMessage ? <Trans>Delete anyway</Trans> : <Trans>Delete</Trans>}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};
