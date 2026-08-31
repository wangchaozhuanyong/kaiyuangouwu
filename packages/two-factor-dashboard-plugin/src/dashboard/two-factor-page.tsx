import { useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    api,
    Badge,
    Button,
    Page,
    PageActionBar,
    PageActionBarRight,
    PageBlock,
    PageLayout,
    PageTitle,
    Skeleton,
    toast,
    useAuth,
} from '@vendure/dashboard';
import { LockKeyhole, Plus, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AccountDialog, AccountDraft } from './account-dialog';
import { AccountList } from './account-list';
import { BatchImportDialog } from './batch-import-dialog';
import { ParsedBatchAccount } from './batch-parser';
import {
    clearLegacyTwoFactorSessionStorage,
    loadLegacyTwoFactorSessionAccounts,
} from './legacy-session-cleanup';
import { messages, TwoFactorText } from './messages';
import { PrivacyNotice } from './privacy-notice';
import { QuickQueryCard } from './quick-query-card';
import { generateTotp, getTotpSecondsRemaining, normalizeBase32Secret } from './totp';
import {
    clearDashboardTwoFactorAccountsMutation,
    createDashboardTwoFactorAccountMutation,
    dashboardTwoFactorAccountsQuery,
    deleteDashboardTwoFactorAccountMutation,
    importDashboardTwoFactorAccountsMutation,
    touchDashboardTwoFactorAccountMutation,
    updateDashboardTwoFactorAccountMutation,
} from './two-factor.graphql';
import { MAX_TWO_FACTOR_ACCOUNTS, TwoFactorAccount } from './types';

export function TwoFactorPage() {
    const { t } = useLingui();
    const text = useMemo(() => translateMessages(t), [t]);
    const { user } = useAuth();
    const ownerId = user?.id ?? '';
    const [accounts, setAccounts] = useState<TwoFactorAccount[]>([]);
    const [loadingAccounts, setLoadingAccounts] = useState(true);
    const [loadError, setLoadError] = useState('');
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
    const persistenceReady = Boolean(ownerId && !loadingAccounts && !loadError);

    useEffect(() => {
        const interval = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        let active = true;
        setAccounts([]);
        setLoadError('');
        if (!ownerId) {
            setLoadingAccounts(false);
            return () => {
                active = false;
            };
        }
        setLoadingAccounts(true);
        void loadPersistedAccounts(ownerId, text)
            .then(loadedAccounts => {
                if (active) setAccounts(loadedAccounts);
            })
            .catch(error => {
                if (active) setLoadError(errorMessage(error, text.storageUnavailable));
            })
            .finally(() => {
                if (active) setLoadingAccounts(false);
            });
        return () => {
            active = false;
        };
    }, [ownerId, text.storageUnavailable]);

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

    const handleAccountSubmit = async (draft: AccountDraft): Promise<string | null> => {
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

        try {
            if (editingAccount) {
                const result = await api.mutate<{
                    updateDashboardTwoFactorAccount: TwoFactorAccount;
                }>(updateDashboardTwoFactorAccountMutation, {
                    input: { id: editingAccount.id, projectName, secret },
                });
                setAccounts(current =>
                    current.map(account =>
                        account.id === editingAccount.id ? result.updateDashboardTwoFactorAccount : account,
                    ),
                );
                toast.success(text.accountUpdated);
            } else {
                const result = await api.mutate<{
                    createDashboardTwoFactorAccount: TwoFactorAccount;
                }>(createDashboardTwoFactorAccountMutation, { input: { projectName, secret } });
                setAccounts(current => [...current, result.createDashboardTwoFactorAccount]);
                toast.success(text.accountAdded);
            }
            return null;
        } catch (error) {
            return errorMessage(error, text.storageUnavailable);
        }
    };

    const openAddDialog = (defaultSecret = '') => {
        setEditingAccount(null);
        setAccountDefaultSecret(defaultSecret);
        setAccountDialogOpen(true);
    };

    const importAccounts = async (parsedAccounts: ParsedBatchAccount[]): Promise<boolean> => {
        try {
            const result = await api.mutate<{
                importDashboardTwoFactorAccounts: TwoFactorAccount[];
            }>(importDashboardTwoFactorAccountsMutation, {
                inputs: parsedAccounts.map(({ projectName, secret }) => ({ projectName, secret })),
            });
            setAccounts(result.importDashboardTwoFactorAccounts);
            toast.success(text.accountsImported);
            return true;
        } catch (error) {
            toast.error(errorMessage(error, text.storageUnavailable));
            return false;
        }
    };

    const deleteAccount = async (account: TwoFactorAccount) => {
        try {
            await api.mutate(deleteDashboardTwoFactorAccountMutation, { id: account.id });
            setAccounts(current => current.filter(item => item.id !== account.id));
            toast.success(text.accountDeleted);
        } catch (error) {
            toast.error(errorMessage(error, text.storageUnavailable));
        }
    };

    const clearAllAccounts = async () => {
        try {
            await api.mutate(clearDashboardTwoFactorAccountsMutation, {});
            setAccounts([]);
            setCodes({});
            toast.success(text.accountsCleared);
        } catch (error) {
            toast.error(errorMessage(error, text.storageUnavailable));
        }
    };

    const copyAccountCode = async (account: TwoFactorAccount) => {
        const code = codes[account.id];
        if (!code || !(await copyCode(code))) return;
        try {
            const result = await api.mutate<{
                touchDashboardTwoFactorAccount: TwoFactorAccount;
            }>(touchDashboardTwoFactorAccountMutation, { id: account.id });
            setAccounts(current =>
                current.map(item => (item.id === account.id ? result.touchDashboardTwoFactorAccount : item)),
            );
        } catch (error) {
            toast.error(errorMessage(error, text.storageUnavailable));
        }
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
                            disabled={!persistenceReady}
                            onClick={() => setBatchDialogOpen(true)}
                        >
                            <Upload className="size-4" aria-hidden="true" />
                            {text.batchImport}
                        </Button>
                        <Button type="button" disabled={!persistenceReady} onClick={() => openAddDialog()}>
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
                        saveDisabled={!persistenceReady}
                    />
                </PageBlock>
            </PageLayout>
            <PageLayout>
                <PageBlock column="full" blockId="two-factor-account-list">
                    {loadError && (
                        <Alert variant="destructive" className="mb-4">
                            <AlertDescription>{loadError}</AlertDescription>
                        </Alert>
                    )}
                    {loadingAccounts ? (
                        <div className="space-y-3" aria-busy="true">
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-32 w-full" />
                        </div>
                    ) : (
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
                            onDelete={account => void deleteAccount(account)}
                            onClearAll={() => void clearAllAccounts()}
                        />
                    )}
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

async function loadPersistedAccounts(ownerId: string, text: TwoFactorText): Promise<TwoFactorAccount[]> {
    const result = await api.query<{ dashboardTwoFactorAccounts: TwoFactorAccount[] }>(
        dashboardTwoFactorAccountsQuery,
    );
    const persistedAccounts = result.dashboardTwoFactorAccounts;
    const legacy = loadLegacyTwoFactorSessionAccounts(ownerId);
    if (!legacy.found) return persistedAccounts;
    if (!legacy.valid) throw new Error(text.legacyMigrationFailed);

    const persistedSecrets = new Set(persistedAccounts.map(account => account.secret));
    const accountsToMigrate = legacy.accounts.filter(account => !persistedSecrets.has(account.secret));
    if (persistedAccounts.length + accountsToMigrate.length > MAX_TWO_FACTOR_ACCOUNTS) {
        throw new Error(text.legacyMigrationLimit);
    }

    let migratedAccounts = persistedAccounts;
    if (accountsToMigrate.length > 0) {
        const importResult = await api.mutate<{
            importDashboardTwoFactorAccounts: TwoFactorAccount[];
        }>(importDashboardTwoFactorAccountsMutation, { inputs: accountsToMigrate });
        migratedAccounts = importResult.importDashboardTwoFactorAccounts;
    }
    clearLegacyTwoFactorSessionStorage(ownerId);
    return migratedAccounts;
}

function translateMessages(t: ReturnType<typeof useLingui>['t']): TwoFactorText {
    return Object.fromEntries(
        Object.entries(messages).map(([key, descriptor]) => [key, t(descriptor)]),
    ) as TwoFactorText;
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}
