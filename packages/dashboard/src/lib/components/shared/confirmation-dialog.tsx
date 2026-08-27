import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/vdb/components/ui/alert-dialog.js';
import { Trans } from '@lingui/react/macro';
import { useState } from 'react';
import { SensitiveActionPasswordField } from './sensitive-action-password.js';

export function ConfirmationDialog({
    title,
    description,
    onConfirm,
    children,
    confirmText,
    cancelText,
    requirePassword = false,
}: {
    title: string;
    description: string;
    onConfirm: (password?: string) => void;
    confirmText?: string;
    cancelText?: string;
    requirePassword?: boolean;
    children: React.ReactElement;
}) {
    const [open, setOpen] = useState(false);
    const [password, setPassword] = useState('');
    return (
        <AlertDialog
            open={open}
            onOpenChange={nextOpen => {
                setOpen(nextOpen);
                if (!nextOpen) setPassword('');
            }}
        >
            <AlertDialogTrigger render={children} onClick={() => setOpen(true)} />

            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                {requirePassword && <SensitiveActionPasswordField value={password} onChange={setPassword} />}
                <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setOpen(false)}>
                        {cancelText ?? <Trans>Cancel</Trans>}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        type="button"
                        onClick={() => {
                            onConfirm(password || undefined);
                            setOpen(false);
                            setPassword('');
                        }}
                        disabled={requirePassword && !password}
                    >
                        {confirmText ?? <Trans>Continue</Trans>}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
