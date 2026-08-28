import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Label,
} from '@vendure/dashboard';
import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState } from 'react';

import { TwoFactorText } from './messages';
import { TwoFactorAccount } from './types';

export interface AccountDraft {
    projectName: string;
    secret: string;
}

export function AccountDialog({
    text,
    open,
    account,
    defaultSecret,
    onOpenChange,
    onSubmit,
}: {
    text: TwoFactorText;
    open: boolean;
    account: TwoFactorAccount | null;
    defaultSecret: string;
    onOpenChange: (open: boolean) => void;
    onSubmit: (draft: AccountDraft) => string | null;
}) {
    const [projectName, setProjectName] = useState('');
    const [secret, setSecret] = useState('');
    const [revealed, setRevealed] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setProjectName(account?.projectName ?? '');
        setSecret(account?.secret ?? defaultSecret);
        setRevealed(false);
        setError(null);
    }, [account, defaultSecret, open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{account ? text.editDialogTitle : text.addDialogTitle}</DialogTitle>
                    <DialogDescription>
                        {account ? text.editDialogDescription : text.addDialogDescription}
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="space-y-4"
                    onSubmit={event => {
                        event.preventDefault();
                        const nextError = onSubmit({ projectName, secret });
                        setError(nextError);
                        if (!nextError) onOpenChange(false);
                    }}
                >
                    <div className="space-y-2">
                        <Label htmlFor="two-factor-project-name">{text.projectName}</Label>
                        <Input
                            id="two-factor-project-name"
                            maxLength={80}
                            value={projectName}
                            placeholder={text.projectNamePlaceholder}
                            onChange={event => setProjectName(event.target.value)}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="two-factor-account-secret">{text.secret}</Label>
                        <div className="flex gap-2">
                            <Input
                                id="two-factor-account-secret"
                                type={revealed ? 'text' : 'password'}
                                autoComplete="off"
                                spellCheck={false}
                                value={secret}
                                placeholder={text.secretPlaceholder}
                                onChange={event => setSecret(event.target.value)}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                aria-label={revealed ? text.hide : text.reveal}
                                onClick={() => setRevealed(value => !value)}
                            >
                                {revealed ? (
                                    <EyeOff className="size-4" aria-hidden="true" />
                                ) : (
                                    <Eye className="size-4" aria-hidden="true" />
                                )}
                            </Button>
                        </div>
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            {text.cancel}
                        </Button>
                        <Button type="submit">{account ? text.save : text.addAccount}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
