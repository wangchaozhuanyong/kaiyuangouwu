import {
    sensitiveActionHeaders,
    SensitiveActionPasswordField,
} from '@/vdb/components/shared/sensitive-action-password.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { rotateApiKeyDocument } from '../api-keys.graphql.js';

interface RotateApiKeyButtonProps {
    apiKeyId: string;
    onSuccess: (newApiKey: string) => void;
}

export function RotateApiKeyButton({ apiKeyId, onSuccess }: RotateApiKeyButtonProps) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [password, setPassword] = useState('');
    const { t } = useLingui();

    const rotateMutation = useMutation({
        mutationFn: (currentPassword: string) =>
            api.mutate(rotateApiKeyDocument, { id: apiKeyId }, sensitiveActionHeaders(currentPassword)),
        onSuccess: data => {
            setConfirmOpen(false);
            onSuccess(data.rotateApiKey.apiKey);
            toast.success(t`API key rotated successfully`);
        },
        onError: err => {
            toast.error(t`Failed to rotate API key`, {
                description: err instanceof Error ? err.message : t`Unknown error`,
            });
        },
        onSettled: () => setPassword(''),
    });

    const handleOpenChange = (open: boolean) => {
        setConfirmOpen(open);
        if (!open) setPassword('');
    };

    return (
        <>
            <Button variant="outline" onClick={() => setConfirmOpen(true)}>
                <RefreshCwIcon className="h-4 w-4" />
                <Trans>Rotate Key</Trans>
            </Button>

            <Dialog open={confirmOpen} onOpenChange={handleOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            <Trans>Rotate API Key</Trans>
                        </DialogTitle>
                        <DialogDescription>
                            <Trans>
                                Rotating this key will immediately invalidate the current key. Any
                                integrations using it will stop working until updated with the new key.
                            </Trans>
                        </DialogDescription>
                    </DialogHeader>
                    <SensitiveActionPasswordField
                        value={password}
                        onChange={setPassword}
                        disabled={rotateMutation.isPending}
                    />
                    <DialogFooter>
                        <Button variant="outline" onClick={() => handleOpenChange(false)}>
                            <Trans>Cancel</Trans>
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => rotateMutation.mutate(password)}
                            disabled={!password || rotateMutation.isPending}
                        >
                            <Trans>Rotate Key</Trans>
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
