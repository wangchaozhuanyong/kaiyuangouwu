import {
    Badge,
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Label,
    Textarea,
} from '@vendure/dashboard';
import { useMemo, useState } from 'react';

import { BatchImportErrorCode, ParsedBatchAccount, parseBatchImport } from './batch-parser';
import { TwoFactorText } from './messages';

export function BatchImportDialog({
    text,
    open,
    existingSecrets,
    onOpenChange,
    onImport,
}: {
    text: TwoFactorText;
    open: boolean;
    existingSecrets: string[];
    onOpenChange: (open: boolean) => void;
    onImport: (accounts: ParsedBatchAccount[]) => Promise<boolean>;
}) {
    const [input, setInput] = useState('');
    const [validated, setValidated] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const result = useMemo(() => parseBatchImport(input, existingSecrets), [existingSecrets, input]);

    const close = (nextOpen: boolean) => {
        onOpenChange(nextOpen);
        if (!nextOpen) {
            setInput('');
            setValidated(false);
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{text.batchDialogTitle}</DialogTitle>
                    <DialogDescription>{text.batchDialogDescription}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <Label htmlFor="two-factor-batch-input">{text.batchFormat}</Label>
                    <Textarea
                        id="two-factor-batch-input"
                        rows={10}
                        value={input}
                        placeholder={text.batchPlaceholder}
                        onChange={event => {
                            setInput(event.target.value);
                            setValidated(false);
                        }}
                    />
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">
                            {text.validRows}: {result.accounts.length}
                        </Badge>
                        <Badge variant={validated && result.errors.length > 0 ? 'destructive' : 'outline'}>
                            {text.invalidRows}: {result.errors.length}
                        </Badge>
                    </div>
                    {validated && result.errors.length > 0 && (
                        <div className="max-h-36 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 p-3">
                            <ul className="space-y-1 text-sm text-destructive">
                                {result.errors.map(error => (
                                    <li key={`${error.lineNumber}-${error.code}`}>
                                        {text.invalidLine} {error.lineNumber}:{' '}
                                        {batchErrorLabel(error.code, text)}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => close(false)}>
                        {text.cancel}
                    </Button>
                    <Button
                        type="button"
                        disabled={!input.trim() || submitting}
                        onClick={() => {
                            setValidated(true);
                            if (result.errors.length === 0 && result.accounts.length > 0) {
                                setSubmitting(true);
                                void onImport(result.accounts).then(success => {
                                    setSubmitting(false);
                                    if (success) close(false);
                                });
                            }
                        }}
                    >
                        {text.importAccounts}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function batchErrorLabel(code: BatchImportErrorCode, text: TwoFactorText): string {
    const labels: Record<BatchImportErrorCode, string> = {
        MISSING_NAME: text.invalidMissingName,
        MISSING_SECRET: text.invalidMissingSecret,
        INVALID_SECRET: text.invalidSecret,
        DUPLICATE_SECRET: text.invalidDuplicate,
        LIMIT_REACHED: text.invalidLimit,
    };
    return labels[code];
}
