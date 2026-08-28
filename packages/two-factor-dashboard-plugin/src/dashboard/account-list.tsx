import {
    Badge,
    Button,
    ConfirmationDialog,
    Input,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@vendure/dashboard';
import { Copy, Eye, EyeOff, KeyRound, Pencil, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { TwoFactorText } from './messages';
import { formatTotpCode } from './totp';
import { TwoFactorAccount } from './types';

export function AccountList({
    text,
    accounts,
    codes,
    secondsRemaining,
    onCopy,
    onEdit,
    onDelete,
    onClearAll,
}: {
    text: TwoFactorText;
    accounts: TwoFactorAccount[];
    codes: Record<string, string>;
    secondsRemaining: number;
    onCopy: (account: TwoFactorAccount) => void;
    onEdit: (account: TwoFactorAccount) => void;
    onDelete: (account: TwoFactorAccount) => void;
    onClearAll: () => void;
}) {
    const [search, setSearch] = useState('');
    const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set());
    const filteredAccounts = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        if (!query) return accounts;
        return accounts.filter(account => account.projectName.toLocaleLowerCase().includes(query));
    }, [accounts, search]);

    const toggleSecret = (accountId: string) => {
        setRevealedIds(current => {
            const next = new Set(current);
            if (next.has(accountId)) next.delete(accountId);
            else next.add(accountId);
            return next;
        });
    };

    return (
        <section aria-labelledby="two-factor-account-list-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <h2 id="two-factor-account-list-title" className="font-heading text-lg font-semibold">
                        {text.accountList}
                    </h2>
                    <Badge variant="secondary">{accounts.length} / 100</Badge>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
                        <Search
                            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden="true"
                        />
                        <Input
                            className="pl-9"
                            value={search}
                            placeholder={text.searchPlaceholder}
                            onChange={event => setSearch(event.target.value)}
                        />
                    </div>
                    {accounts.length > 0 && (
                        <ConfirmationDialog
                            title={text.clearConfirmTitle}
                            description={text.clearConfirmDescription}
                            confirmText={text.confirmClear}
                            cancelText={text.cancel}
                            onConfirm={onClearAll}
                        >
                            <Button type="button" variant="ghost" className="text-destructive">
                                <Trash2 className="size-4" aria-hidden="true" />
                                {text.clearAll}
                            </Button>
                        </ConfirmationDialog>
                    )}
                </div>
            </div>

            {accounts.length === 0 ? (
                <div className="mt-5 rounded-lg border border-dashed py-12 text-center">
                    <KeyRound className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                    <h3 className="mt-3 font-medium">{text.emptyTitle}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{text.emptyDescription}</p>
                </div>
            ) : filteredAccounts.length === 0 ? (
                <div className="mt-5 rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                    {text.emptyTitle}
                </div>
            ) : (
                <>
                    <div className="mt-5 hidden overflow-hidden rounded-lg border md:block">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{text.projectName}</TableHead>
                                    <TableHead>{text.secret}</TableHead>
                                    <TableHead>{text.dynamicCode}</TableHead>
                                    <TableHead>{text.remainingTime}</TableHead>
                                    <TableHead>{text.recentUse}</TableHead>
                                    <TableHead className="text-right">{text.actions}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredAccounts.map(account => (
                                    <TableRow key={account.id}>
                                        <TableCell className="font-medium">{account.projectName}</TableCell>
                                        <TableCell>
                                            <SecretValue
                                                account={account}
                                                revealed={revealedIds.has(account.id)}
                                                text={text}
                                                onToggle={() => toggleSecret(account.id)}
                                            />
                                        </TableCell>
                                        <TableCell className="font-mono text-base font-semibold tracking-wider">
                                            {codes[account.id]
                                                ? formatTotpCode(codes[account.id])
                                                : '--- ---'}
                                        </TableCell>
                                        <TableCell>
                                            <Countdown seconds={secondsRemaining} text={text} />
                                        </TableCell>
                                        <TableCell>{formatRecentUse(account.lastUsedAt, text)}</TableCell>
                                        <TableCell>
                                            <AccountActions
                                                account={account}
                                                codeReady={Boolean(codes[account.id])}
                                                text={text}
                                                onCopy={onCopy}
                                                onEdit={onEdit}
                                                onDelete={onDelete}
                                            />
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="mt-4 space-y-3 md:hidden">
                        {filteredAccounts.map(account => (
                            <article key={account.id} className="rounded-lg border p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <h3 className="min-w-0 break-words font-semibold">
                                        {account.projectName}
                                    </h3>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={revealedIds.has(account.id) ? text.hide : text.reveal}
                                        onClick={() => toggleSecret(account.id)}
                                    >
                                        {revealedIds.has(account.id) ? (
                                            <EyeOff className="size-4" aria-hidden="true" />
                                        ) : (
                                            <Eye className="size-4" aria-hidden="true" />
                                        )}
                                    </Button>
                                </div>
                                <p className="mt-2 font-mono text-xs text-muted-foreground">
                                    {text.secret}:{' '}
                                    {revealedIds.has(account.id)
                                        ? account.secret
                                        : maskSecret(account.secret)}
                                </p>
                                <div className="mt-3 rounded-md bg-muted/30 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-xs text-muted-foreground">
                                                {text.dynamicCode}
                                            </p>
                                            <p className="mt-1 font-mono text-2xl font-semibold tracking-wider">
                                                {codes[account.id]
                                                    ? formatTotpCode(codes[account.id])
                                                    : '--- ---'}
                                            </p>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={!codes[account.id]}
                                            onClick={() => onCopy(account)}
                                        >
                                            <Copy className="size-4" aria-hidden="true" />
                                            {text.copy}
                                        </Button>
                                    </div>
                                    <Countdown seconds={secondsRemaining} text={text} />
                                </div>
                                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                                    <span className="text-muted-foreground">
                                        {text.recentUse}: {formatRecentUse(account.lastUsedAt, text)}
                                    </span>
                                    <div className="flex gap-1">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => onEdit(account)}
                                        >
                                            {text.edit}
                                        </Button>
                                        <ConfirmationDialog
                                            title={text.deleteConfirmTitle}
                                            description={text.deleteConfirmDescription}
                                            confirmText={text.confirmDelete}
                                            cancelText={text.cancel}
                                            onConfirm={() => onDelete(account)}
                                        >
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="text-destructive"
                                            >
                                                {text.delete}
                                            </Button>
                                        </ConfirmationDialog>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                </>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{text.clockHint}</span>
                <span>{text.codesRefresh}</span>
            </div>
        </section>
    );
}

function SecretValue({
    account,
    revealed,
    text,
    onToggle,
}: {
    account: TwoFactorAccount;
    revealed: boolean;
    text: TwoFactorText;
    onToggle: () => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <code className="max-w-48 truncate text-xs">
                {revealed ? account.secret : maskSecret(account.secret)}
            </code>
            <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={revealed ? text.hide : text.reveal}
                onClick={onToggle}
            >
                {revealed ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                    <Eye className="size-4" aria-hidden="true" />
                )}
            </Button>
        </div>
    );
}

function AccountActions({
    account,
    codeReady,
    text,
    onCopy,
    onEdit,
    onDelete,
}: {
    account: TwoFactorAccount;
    codeReady: boolean;
    text: TwoFactorText;
    onCopy: (account: TwoFactorAccount) => void;
    onEdit: (account: TwoFactorAccount) => void;
    onDelete: (account: TwoFactorAccount) => void;
}) {
    return (
        <div className="flex justify-end gap-2">
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!codeReady}
                onClick={() => onCopy(account)}
            >
                <Copy className="size-4" aria-hidden="true" />
                {text.copy}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => onEdit(account)}>
                <Pencil className="size-4" aria-hidden="true" />
                {text.edit}
            </Button>
            <ConfirmationDialog
                title={text.deleteConfirmTitle}
                description={text.deleteConfirmDescription}
                confirmText={text.confirmDelete}
                cancelText={text.cancel}
                onConfirm={() => onDelete(account)}
            >
                <Button type="button" variant="outline" size="sm" className="text-destructive">
                    <Trash2 className="size-4" aria-hidden="true" />
                    {text.delete}
                </Button>
            </ConfirmationDialog>
        </div>
    );
}

function Countdown({ seconds, text }: { seconds: number; text: TwoFactorText }) {
    return (
        <div className="min-w-24">
            <span className="font-mono text-sm">
                {seconds} {text.seconds}
            </span>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${(seconds / 30) * 100}%` }}
                />
            </div>
        </div>
    );
}

function maskSecret(secret: string): string {
    if (secret.length <= 8) return '•••• ••••';
    return `${secret.slice(0, 4)} •••• •••• ${secret.slice(-4)}`;
}

function formatRecentUse(value: string | null, text: TwoFactorText): string {
    if (!value) return text.neverUsed;
    const elapsedMs = Math.max(0, Date.now() - new Date(value).getTime());
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes < 1) return text.justNow;
    if (minutes < 60) return `${minutes} ${text.minutesAgo}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${text.hoursAgo}`;
    return `${Math.floor(hours / 24)} ${text.daysAgo}`;
}
