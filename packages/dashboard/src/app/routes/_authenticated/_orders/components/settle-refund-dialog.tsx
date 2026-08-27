import { SensitiveActionPasswordField } from '@/vdb/components/shared/sensitive-action-password.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Label } from '@/vdb/components/ui/label.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';

type SettleRefundDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSettle: (transactionId: string, password: string) => void;
    isLoading?: boolean;
};

export function SettleRefundDialog({
    open,
    onOpenChange,
    onSettle,
    isLoading,
}: Readonly<SettleRefundDialogProps>) {
    const { t } = useLingui();
    const [transactionId, setTransactionId] = useState('');
    const [password, setPassword] = useState('');

    const handleSettle = () => {
        if (transactionId.trim() && password) {
            onSettle(transactionId.trim(), password);
            setTransactionId('');
            setPassword('');
        }
    };

    const handleOpenChange = (newOpen: boolean) => {
        if (!newOpen) {
            setTransactionId('');
            setPassword('');
        }
        onOpenChange(newOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        <Trans>Settle refund</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Trans>Enter the transaction ID for this refund settlement</Trans>
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="transaction-id">
                            <Trans>Transaction ID</Trans>
                        </Label>
                        <Input
                            id="transaction-id"
                            value={transactionId}
                            onChange={e => setTransactionId(e.target.value)}
                            placeholder={t`Enter transaction ID...`}
                            disabled={isLoading}
                        />
                    </div>
                    <SensitiveActionPasswordField
                        value={password}
                        onChange={setPassword}
                        disabled={isLoading}
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button onClick={handleSettle} disabled={!transactionId.trim() || !password || isLoading}>
                        <Trans>Settle refund</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
