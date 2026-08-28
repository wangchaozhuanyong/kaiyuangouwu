import { useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    toast,
    useAuth,
} from '@vendure/dashboard';
import { LockKeyhole, Plus, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AccountDialog, AccountDraft } from './account-dialog';
import { AccountList } from './account-list';
import { BatchImportDialog } from './batch-import-dialog';
import { ParsedBatchAccount } from './batch-parser';
import { messages, TwoFactorText } from './messages';
import { PrivacyNotice } from './privacy-notice';
import { QuickQueryCard } from './quick-query-card';
import { clearSessionAccounts, loadSessionAccounts, saveSessionAccounts } from './session-storage';
import { generateTotp, getTotpSecondsRemaining, normalizeBase32Secret } from './totp';
import { MAX_TWO_FACTOR_ACCOUNTS, TwoFactorAccount } from './types';

export function TwoFactorPage() {
    const { t } = useLingui();
    const text = useMemo(() => translateMessages(t), [t]);
    const { user } = useAuth();
    const ownerId = user?.id ?? '';
    const loadedOwnerId = useRef('');
    const [accounts, setAccounts] = useState<TwoFactorAccount[]>([]);
    const [storageAvailable, setStorageAvailable] = useState(true);
    const [now, setNow] = useState(() => Date.now());
    const [codes, setCodes] = useState<Record<string, string>>({});
    const [queryInput, setQueryInput] = useState('');
    const [querySecret, setQuerySecret] = useState<string | null>(null);
    const [queryCode, setQueryCode] = useState<string | null>(null);
    const [querying, setQuerying] = useState(false);
    const [accountDialogOpen, setAccountDialogOpen] = useState(false);
    const [editingAccount, setEditingAccount] = useState<TwoFactorAccount | null>(null);
    const [accountDefaultSecret, setAccountDefaultSecret] = useState('');
    const [batchDialogOpen, setBatchDialogOpen] = useState(false);
    const timeStep = Math.floor(now / 30_000);
    const secondsRemaining = getTotpSecondsRemaining(now);

    useEffect(() => {
        const interval = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!ownerId || loadedOwnerId.current === ownerId) return;
        const stored = loadSessionAccounts(ownerId);
        loadedOwnerId.current = ownerId;
        setAccounts(stored.accounts);
        setStorageAvailable(stored.available);
    }, [ownerId]);

    useEffect(() => {
        let active = true;
        void Promise.all(
            accounts.map(
                async account => [account.id, await generateTotp(account.secret, timeStep * 30_000)] as const,
            ),
        )
            .then(entries => {
                if (active) setCodes(Object.fromEntries(entries));
            })
            .catch(() => {
                if (active) setCodes({});
            });
        return () => {
            active = false;
        };
    }, [accounts, timeStep]);

    useEffect(() => {
        if (!querySecret) return;
        let active = true;
        void generateTotp(querySecret, timeStep * 30_000)
            .then(code => {
                if (active) setQueryCode(code);
            })
            .catch(() => {
                if (active) setQueryCode(null);
            });
        return () => {
            active = false;
        };
    }, [querySecret, timeStep]);

    const persistAccounts = useCallback(
        (nextAccounts: TwoFactorAccount[]): boolean => {
            if (!ownerId || !storageAvailable || !saveSessionAccounts(ownerId, nextAccounts)) {
                setStorageAvailable(false);
                toast.error(text.storageUnavailable);
                return false;
            }
            setAccounts(nextAccounts);
            return true;
        },
        [ownerId, storageAvailable, text.storageUnavailable],
    );

    const handleQuery = async () => {
        setQuerying(true);
        try {
            const secret = normalizeBase32Secret(queryInput);
            const code = await generateTotp(secret);
            setQuerySecret(secret);
            setQueryCode(code);
            setNow(Date.now());
        } catch {
            setQuerySecret(null);
            setQueryCode(null);
            toast.error(text.queryFailed);
        } finally {
            setQuerying(false);
        }
    };

    const handlePaste = async () => {
        try {
            const value = await navigator.clipboard.readText();
            if (!value.trim()) {
                toast.error(text.clipboardEmpty);
                return;
            }
            setQueryInput(value.trim());
            setQuerySecret(null);
            setQueryCode(null);
            toast.success(text.pasted);
        } catch {
            toast.error(text.clipboardDenied);
        }
    };

    const copyCode = async (code: string): Promise<boolean> => {
        try {
            await navigator.clipboard.writeText(code);
            toast.success(text.copied);
            return true;
        } catch {
            toast.error(text.copyFailed);
            return false;
        }
    };

    const handleAccountSubmit = (draft: AccountDraft): string | null => {
        const projectName = draft.projectName.trim();
        if (!projectName) return text.projectRequired;
        if (projectName.length > 80) return text.projectTooLong;
        let secret: string;
        try {
            secret = normalizeBase32Secret(draft.secret);
        } catch {
            return text.invalidSecret;
        }
        if (accounts.some(account => account.secret === secret && account.id !== editingAccount?.id)) {
            return text.duplicateSecret;
        }
        if (!editingAccount && accounts.length >= MAX_TWO_FACTOR_ACCOUNTS) return text.accountLimit;

        const nextAccounts = editingAccount
            ? accounts.map(account =>
                  account.id === editingAccount.id ? { ...account, projectName, secret } : account,
              )
            : [
                  ...accounts,
                  {
                      id: createAccountId(),
                      projectName,
                      secret,
                      createdAt: new Date().toISOString(),
                      lastUsedAt: null,
                  },
              ];
        if (!persistAccounts(nextAccounts)) return text.storageUnavailable;
        toast.success(editingAccount ? text.accountUpdated : text.accountAdded);
        return null;
    };

    const openAddDialog = (defaultSecret = '') => {
        setEditingAccount(null);
        setAccountDefaultSecret(defaultSecret);
        setAccountDialogOpen(true);
    };

    const importAccounts = (parsedAccounts: ParsedBatchAccount[]) => {
        const createdAt = new Date().toISOString();
        const nextAccounts = [
            ...accounts,
            ...parsedAccounts.map(account => ({
                id: createAccountId(),
                projectName: account.projectName,
                secret: account.secret,
                createdAt,
                lastUsedAt: null,
            })),
        ];
        if (persistAccounts(nextAccounts)) toast.success(text.accountsImported);
    };

    const deleteAccount = (account: TwoFactorAccount) => {
        if (persistAccounts(accounts.filter(item => item.id !== account.id))) {
            toast.success(text.accountDeleted);
        }
    };

    const clearAllAccounts = () => {
        clearSessionAccounts(ownerId);
        setAccounts([]);
        setCodes({});
        toast.success(text.accountsCleared);
    };

    const copyAccountCode = async (account: TwoFactorAccount) => {
        const code = codes[account.id];
        if (!code || !(await copyCode(code))) return;
        const lastUsedAt = new Date().toISOString();
        persistAccounts(accounts.map(item => (item.id === account.id ? { ...item, lastUsedAt } : item)));
    };

    return (
        <Page pageId="two-factor-codes">
            <PageTitle>{text.title}</PageTitle>
            <PageActionBar>
                <PageActionBarRight>
                    <div className="flex flex-wrap justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={!storageAvailable}
                            onClick={() => setBatchDialogOpen(true)}
                        >
                            <Upload className="size-4" aria-hidden="true" />
                            {text.batchImport}
                        </Button>
                        <Button type="button" disabled={!storageAvailable} onClick={() => openAddDialog()}>
                            <Plus className="size-4" aria-hidden="true" />
                            {text.addAccount}
                        </Button>
                        <Badge variant="outline" className="hidden sm:flex">
                            <LockKeyhole className="size-3.5" aria-hidden="true" />
                            {text.loggedInOnly}
                        </Badge>
                    </div>
                </PageActionBarRight>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="side" blockId="two-factor-privacy">
                    <PrivacyNotice text={text} />
                </PageBlock>
                <PageBlock column="main" blockId="two-factor-quick-query" description={text.description}>
                    <QuickQueryCard
                        text={text}
                        input={queryInput}
                        code={queryCode}
                        secondsRemaining={secondsRemaining}
                        querying={querying}
                        onInputChange={value => {
                            setQueryInput(value);
                            setQuerySecret(null);
                            setQueryCode(null);
                        }}
                        onPaste={() => void handlePaste()}
                        onQuery={() => void handleQuery()}
                        onCopy={() => queryCode && void copyCode(queryCode)}
                        onClear={() => {
                            setQueryInput('');
                            setQuerySecret(null);
                            setQueryCode(null);
                        }}
                        onSave={() => querySecret && openAddDialog(querySecret)}
                    />
                </PageBlock>
            </PageLayout>
            <PageLayout>
                <PageBlock column="full" blockId="two-factor-account-list">
                    {!storageAvailable && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertDescription>{text.storageUnavailable}</AlertDescription>
                        </Alert>
                    )}
                    <AccountList
                        text={text}
                        accounts={accounts}
                        codes={codes}
                        secondsRemaining={secondsRemaining}
                        onCopy={account => void copyAccountCode(account)}
                        onEdit={account => {
                            setEditingAccount(account);
                            setAccountDefaultSecret('');
                            setAccountDialogOpen(true);
                        }}
                        onDelete={deleteAccount}
                        onClearAll={clearAllAccounts}
                    />
                </PageBlock>
            </PageLayout>

            <AccountDialog
                text={text}
                open={accountDialogOpen}
                account={editingAccount}
                defaultSecret={accountDefaultSecret}
                onOpenChange={setAccountDialogOpen}
                onSubmit={handleAccountSubmit}
            />
            <BatchImportDialog
                text={text}
                open={batchDialogOpen}
                existingSecrets={accounts.map(account => account.secret)}
                onOpenChange={setBatchDialogOpen}
                onImport={importAccounts}
            />
        </Page>
    );
}

function translateMessages(t: ReturnType<typeof useLingui>['t']): TwoFactorText {
    return Object.fromEntries(
        Object.entries(messages).map(([key, descriptor]) => [key, t(descriptor)]),
    ) as TwoFactorText;
}

function createAccountId(): string {
    return (
        globalThis.crypto?.randomUUID?.() ?? `two-factor-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
}
