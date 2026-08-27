import { Label } from '@/vdb/components/ui/label.js';
import { PasswordInput } from '@/vdb/components/ui/password-input.js';
import { Trans } from '@lingui/react/macro';
import { useId } from 'react';

export const SENSITIVE_ACTION_PASSWORD_HEADER = 'x-vendure-sensitive-action-password';

export function sensitiveActionHeaders(password: string): HeadersInit {
    return { [SENSITIVE_ACTION_PASSWORD_HEADER]: password };
}

export function SensitiveActionPasswordField({
    value,
    onChange,
    disabled,
}: Readonly<{
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}>) {
    const id = useId();

    return (
        <div className="grid gap-2 py-2">
            <Label htmlFor={id}>
                <Trans>Current account password</Trans>
            </Label>
            <PasswordInput
                id={id}
                autoComplete="current-password"
                value={value}
                disabled={disabled}
                onChange={event => onChange(event.target.value)}
                onKeyDown={event => event.stopPropagation()}
            />
            <p className="text-xs text-muted-foreground">
                <Trans>The password is only used to confirm this operation and will not be saved.</Trans>
            </p>
        </div>
    );
}
