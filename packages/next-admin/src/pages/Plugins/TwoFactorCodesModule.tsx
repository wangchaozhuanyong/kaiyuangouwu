import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    CheckCircle2,
    Clipboard,
    Copy,
    Eye,
    EyeOff,
    KeyRound,
    LoaderCircle,
    LockKeyhole,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    ShieldCheck,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import {
    CLEAR_DASHBOARD_TWO_FACTOR_ACCOUNTS_MUTATION,
    CREATE_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION,
    DASHBOARD_TWO_FACTOR_ACCOUNTS_QUERY,
    DELETE_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION,
    IMPORT_DASHBOARD_TWO_FACTOR_ACCOUNTS_MUTATION,
    TOUCH_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION,
    UPDATE_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION,
    type DashboardTwoFactorAccount,
    type DashboardTwoFactorAccountsResult,
} from '../../graphql/two-factor.graphql';
import { toUserFacingError } from '../../utils/user-facing-error';
import {
    clearLegacyTwoFactorSessionStorage,
    formatTotpCode,
    generateTotp,
    getTotpSecondsRemaining,
    loadLegacyTwoFactorSessionAccounts,
    MAX_TWO_FACTOR_ACCOUNTS,
    normalizeBase32Secret,
    parseBatchImport,
    type BatchImportErrorCode,
    type ParsedBatchAccount,
} from './two-factor-utils';

interface AccountDraft {
    projectName: string;
    secret: string;
}

interface AccountDialogState {
    account: DashboardTwoFactorAccount | null;
    defaultSecret: string;
}

const EMPTY_TWO_FACTOR_ACCOUNTS: DashboardTwoFactorAccount[] = [];

export function TwoFactorCodesModule() {
    const requestConfirmation = useConfirmDialog();
    const query = useQuery<DashboardTwoFactorAccountsResult>(DASHBOARD_TWO_FACTOR_ACCOUNTS_QUERY, {
        fetchPolicy: 'network-only',
        notifyOnNetworkStatusChange: true,
    });
    const [createAccount, createState] = useMutation<CreatedAccountResult>(
        CREATE_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION,
    );
    const [updateAccount, updateState] = useMutation<UpdatedAccountResult>(
        UPDATE_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION,
    );
    const [importAccounts, importState] = useMutation<ImportedAccountsResult>(
        IMPORT_DASHBOARD_TWO_FACTOR_ACCOUNTS_MUTATION,
    );
    const [deleteAccount, deleteState] = useMutation(DELETE_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION);
    const [clearAccounts, clearState] = useMutation(CLEAR_DASHBOARD_TWO_FACTOR_ACCOUNTS_MUTATION);
    const [touchAccount, touchState] = useMutation(TOUCH_DASHBOARD_TWO_FACTOR_ACCOUNT_MUTATION);
    const [now, setNow] = useState(() => Date.now());
    const [codes, setCodes] = useState<Record<string, string>>({});
    const [queryInput, setQueryInput] = useState('');
    const [querySecret, setQuerySecret] = useState<string | null>(null);
    const [queryCode, setQueryCode] = useState<string | null>(null);
    const [querying, setQuerying] = useState(false);
    const [notice, setNotice] = useState('');
    const [actionError, setActionError] = useState('');
    const [accountDialog, setAccountDialog] = useState<AccountDialogState | null>(null);
    const [batchDialogOpen, setBatchDialogOpen] = useState(false);
    const [migrationAttempt, setMigrationAttempt] = useState(0);
    const [migrationError, setMigrationError] = useState('');
    const [migrating, setMigrating] = useState(false);
    const migrationKeyRef = useRef('');
    const mountedRef = useRef(true);

    const accounts = query.data?.dashboardTwoFactorAccounts ?? EMPTY_TWO_FACTOR_ACCOUNTS;
    const ownerId = query.data?.me?.id ?? '';
    const refetchAccounts = query.refetch;
    const timeStep = Math.floor(now / 30_000);
    const secondsRemaining = getTotpSecondsRemaining(now);
    const mutationBusy =
        createState.loading ||
        updateState.loading ||
        importState.loading ||
        deleteState.loading ||
        clearState.loading ||
        touchState.loading;
    const storageReady = Boolean(query.data && !query.error && !migrating);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        const interval = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(interval);
    }, []);

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

    /* oxlint-disable react/set-state-in-effect -- this effect migrates obsolete external Session Storage into server state */
    useEffect(() => {
        if (!query.data || !ownerId) return;
        const migrationKey = `${ownerId}:${migrationAttempt}`;
        if (migrationKeyRef.current === migrationKey) return;
        migrationKeyRef.current = migrationKey;

        const legacy = loadLegacyTwoFactorSessionAccounts(ownerId);
        if (!legacy.found) return;
        if (!legacy.valid) {
            setMigrationError('检测到旧版浏览器 2FA 数据，但格式不完整。原数据已保留，没有自动删除。');
            return;
        }

        const existingSecrets = new Set(accounts.map(account => account.secret));
        const pendingAccounts = legacy.accounts.filter(account => !existingSecrets.has(account.secret));
        if (accounts.length + pendingAccounts.length > MAX_TWO_FACTOR_ACCOUNTS) {
            setMigrationError('旧版浏览器 2FA 数据超过 100 个账号上限，原数据已保留，请先整理当前列表。');
            return;
        }

        setMigrating(true);
        setMigrationError('');
        void (async () => {
            if (pendingAccounts.length) {
                await importAccounts({ variables: { inputs: pendingAccounts } });
            }
            clearLegacyTwoFactorSessionStorage(ownerId);
            await refetchAccounts();
            if (mountedRef.current) {
                setNotice(
                    pendingAccounts.length
                        ? `已把 ${pendingAccounts.length} 个旧版浏览器 2FA 账号安全迁移到数据库`
                        : '旧版浏览器 2FA 数据已完成核对',
                );
            }
        })()
            .catch(error => {
                if (mountedRef.current) {
                    setMigrationError(toUserFacingError(error, '旧版浏览器 2FA 数据迁移失败，原数据仍保留'));
                }
            })
            .finally(() => {
                if (mountedRef.current) setMigrating(false);
            });
    }, [accounts, importAccounts, migrationAttempt, ownerId, query.data, refetchAccounts]);
    /* oxlint-enable react/set-state-in-effect */

    const showSuccess = (message: string) => {
        setNotice(message);
        setActionError('');
    };

    const showError = (error: unknown, fallback: string) => {
        setActionError(toUserFacingError(error, fallback));
        setNotice('');
    };

    const handleQuickQuery = async () => {
        setQuerying(true);
        try {
            const secret = normalizeBase32Secret(queryInput);
            const code = await generateTotp(secret);
            setQuerySecret(secret);
            setQueryCode(code);
            setNow(Date.now());
            setActionError('');
        } catch {
            setQuerySecret(null);
            setQueryCode(null);
            setActionError('无法生成验证码，请检查 Base32 密钥是否完整');
        } finally {
            setQuerying(false);
        }
    };

    const handlePaste = async () => {
        try {
            const value = await navigator.clipboard.readText();
            if (!value.trim()) throw new Error('剪贴板为空');
            setQueryInput(value.trim());
            setQuerySecret(null);
            setQueryCode(null);
            showSuccess('已从剪贴板粘贴 2FA 密钥');
        } catch (error) {
            showError(error, '无法读取剪贴板，请手动粘贴密钥');
        }
    };

    const copyCode = async (code: string): Promise<boolean> => {
        try {
            await navigator.clipboard.writeText(code);
            showSuccess('验证码已复制');
            return true;
        } catch (error) {
            showError(error, '验证码复制失败，请手动复制');
            return false;
        }
    };

    const submitAccount = async (
        draft: AccountDraft,
        editingAccount: DashboardTwoFactorAccount | null,
    ): Promise<string | null> => {
        const projectName = draft.projectName.trim();
        if (!projectName) return '请填写项目名称';
        if (projectName.length > 80) return '项目名称不能超过 80 个字符';
        let secret: string;
        try {
            secret = normalizeBase32Secret(draft.secret);
        } catch {
            return '2FA 密钥不是有效的 Base32';
        }
        if (accounts.some(account => account.secret === secret && account.id !== editingAccount?.id)) {
            return '这个 2FA 密钥已经存在';
        }
        if (!editingAccount && accounts.length >= MAX_TWO_FACTOR_ACCOUNTS) {
            return `最多只能保存 ${MAX_TWO_FACTOR_ACCOUNTS} 个 2FA 账号`;
        }

        try {
            if (editingAccount) {
                await updateAccount({
                    variables: { input: { id: editingAccount.id, projectName, secret } },
                });
                showSuccess('2FA 账号已更新');
            } else {
                await createAccount({ variables: { input: { projectName, secret } } });
                showSuccess('2FA 账号已添加');
            }
            await query.refetch();
            return null;
        } catch (error) {
            return toUserFacingError(error, '2FA 账号保存失败，请稍后重试');
        }
    };

    const submitBatch = async (parsedAccounts: ParsedBatchAccount[]): Promise<boolean> => {
        try {
            await importAccounts({
                variables: {
                    inputs: parsedAccounts.map(({ projectName, secret }) => ({ projectName, secret })),
                },
            });
            await query.refetch();
            showSuccess(`已导入 ${parsedAccounts.length} 个 2FA 账号`);
            return true;
        } catch (error) {
            showError(error, '2FA 账号批量导入失败，请稍后重试');
            return false;
        }
    };

    const removeAccount = async (account: DashboardTwoFactorAccount) => {
        const confirmed = await requestConfirmation({
            title: '删除这个 2FA 账号？',
            description: `将永久删除“${account.projectName}”及其加密密钥，删除后无法恢复。`,
            confirmLabel: '删除账号',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            await deleteAccount({ variables: { id: account.id } });
            await query.refetch();
            showSuccess('2FA 账号已删除');
        } catch (error) {
            showError(error, '2FA 账号删除失败，请稍后重试');
        }
    };

    const clearAll = async () => {
        const confirmed = await requestConfirmation({
            title: '清空全部 2FA 账号？',
            description: '当前管理员保存在服务器数据库中的全部 2FA 账号都将被永久删除。',
            confirmLabel: '清空全部',
            tone: 'danger',
        });
        if (!confirmed) return;
        try {
            await clearAccounts();
            await query.refetch();
            setCodes({});
            showSuccess('全部 2FA 账号已清空');
        } catch (error) {
            showError(error, '2FA 账号清空失败，请稍后重试');
        }
    };

    const copyAccountCode = async (account: DashboardTwoFactorAccount) => {
        const code = codes[account.id];
        if (!code || !(await copyCode(code))) return;
        try {
            await touchAccount({ variables: { id: account.id } });
            await query.refetch();
        } catch (error) {
            showError(error, '验证码已复制，但最近使用时间更新失败');
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                            <KeyRound className="h-5 w-5 text-blue-600" aria-hidden="true" />
                            2FA 动态码
                            <FeatureHelpButton topic="plugins.two-factor" title="2FA 动态码" />
                        </h1>
                        <p className="mt-1 text-xs text-slate-500">
                            保存第三方服务的 TOTP 密钥并生成动态验证码，不用于管理账号登录验证
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => void query.refetch()}
                            disabled={query.loading || mutationBusy || migrating}
                            className={secondaryButtonClass}
                        >
                            <RefreshCw
                                className={`h-3.5 w-3.5 ${query.loading ? 'animate-spin' : ''}`}
                                aria-hidden="true"
                            />
                            刷新
                        </button>
                        <button
                            type="button"
                            onClick={() => setBatchDialogOpen(true)}
                            disabled={!storageReady || mutationBusy}
                            className={secondaryButtonClass}
                        >
                            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                            批量导入
                        </button>
                        <button
                            type="button"
                            onClick={() => setAccountDialog({ account: null, defaultSecret: '' })}
                            disabled={
                                !storageReady || mutationBusy || accounts.length >= MAX_TWO_FACTOR_ACCOUNTS
                            }
                            className={primaryButtonClass}
                        >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            添加账号
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto w-full max-w-[1400px] flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
                {notice && (
                    <Message kind="success" onClose={() => setNotice('')}>
                        {notice}
                    </Message>
                )}
                {actionError && (
                    <Message kind="error" onClose={() => setActionError('')}>
                        {actionError}
                    </Message>
                )}
                {migrationError && (
                    <Message kind="error" onClose={() => setMigrationError('')}>
                        <span>{migrationError}</span>
                        <button
                            type="button"
                            onClick={() => {
                                setMigrationError('');
                                setMigrationAttempt(value => value + 1);
                            }}
                            className="ml-2 rounded border border-rose-300 px-2 py-1 font-bold"
                        >
                            重试迁移
                        </button>
                    </Message>
                )}
                {migrating && (
                    <Message kind="info">
                        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                        正在把旧版浏览器 2FA 账号迁移到加密数据库…
                    </Message>
                )}

                <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                    <QuickQueryCard
                        input={queryInput}
                        code={queryCode}
                        secondsRemaining={secondsRemaining}
                        querying={querying}
                        saveDisabled={!storageReady || mutationBusy}
                        onInputChange={value => {
                            setQueryInput(value);
                            setQuerySecret(null);
                            setQueryCode(null);
                        }}
                        onPaste={() => void handlePaste()}
                        onQuery={() => void handleQuickQuery()}
                        onCopy={() => queryCode && void copyCode(queryCode)}
                        onSave={() =>
                            querySecret && setAccountDialog({ account: null, defaultSecret: querySecret })
                        }
                        onClear={() => {
                            setQueryInput('');
                            setQuerySecret(null);
                            setQueryCode(null);
                        }}
                    />
                    <SecurityNotice />
                </section>

                {query.loading && !query.data ? (
                    <LoadingState />
                ) : query.error && !query.data ? (
                    <ErrorState message={query.error} onRetry={() => void query.refetch()} />
                ) : (
                    <AccountList
                        accounts={accounts}
                        codes={codes}
                        secondsRemaining={secondsRemaining}
                        busy={mutationBusy}
                        onCopy={account => void copyAccountCode(account)}
                        onEdit={account => setAccountDialog({ account, defaultSecret: '' })}
                        onDelete={account => void removeAccount(account)}
                        onClearAll={() => void clearAll()}
                    />
                )}
            </main>

            {accountDialog && (
                <AccountDialog
                    value={accountDialog}
                    submitting={createState.loading || updateState.loading}
                    onClose={() => setAccountDialog(null)}
                    onSubmit={draft => submitAccount(draft, accountDialog.account)}
                />
            )}
            {batchDialogOpen && (
                <BatchImportDialog
                    existingSecrets={accounts.map(account => account.secret)}
                    submitting={importState.loading}
                    onClose={() => setBatchDialogOpen(false)}
                    onImport={submitBatch}
                />
            )}
        </div>
    );
}

function QuickQueryCard({
    input,
    code,
    secondsRemaining,
    querying,
    saveDisabled,
    onInputChange,
    onPaste,
    onQuery,
    onCopy,
    onSave,
    onClear,
}: {
    input: string;
    code: string | null;
    secondsRemaining: number;
    querying: boolean;
    saveDisabled: boolean;
    onInputChange: (value: string) => void;
    onPaste: () => void;
    onQuery: () => void;
    onCopy: () => void;
    onSave: () => void;
    onClear: () => void;
}) {
    return (
        <section
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
            aria-labelledby="quick-query-title"
        >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2
                        id="quick-query-title"
                        className="flex items-center gap-2 text-sm font-bold text-slate-900"
                    >
                        单独查询验证码
                        <FeatureHelpButton topic="plugins.two-factor" title="单独查询验证码" />
                    </h2>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">
                        输入一次性 Base32 密钥即可本机生成验证码；只有点击“保存账号”才会写入数据库。
                    </p>
                </div>
                <span className="self-start rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-blue-700">
                    每 30 秒刷新
                </span>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={input}
                    onChange={event => onInputChange(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            onQuery();
                        }
                    }}
                    placeholder="输入或粘贴 Base32 密钥"
                    aria-label="2FA Base32 密钥"
                    className={`${inputClass} min-w-0 flex-1 font-mono`}
                />
                <button type="button" onClick={onPaste} className={secondaryButtonClass}>
                    <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
                    粘贴
                </button>
                <button
                    type="button"
                    onClick={onQuery}
                    disabled={!input.trim() || querying}
                    className={primaryButtonClass}
                >
                    {querying ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <KeyRound className="h-3.5 w-3.5" />
                    )}
                    查询验证码
                </button>
            </div>
            {code && (
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4" aria-live="polite">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                                当前验证码
                            </p>
                            <p className="mt-1 font-mono text-3xl font-bold tracking-[0.16em] text-slate-950">
                                {formatTotpCode(code)}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={onCopy} className={primaryButtonClass}>
                                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                                复制验证码
                            </button>
                            <button
                                type="button"
                                onClick={onSave}
                                disabled={saveDisabled}
                                className={secondaryButtonClass}
                            >
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                保存账号
                            </button>
                            <button type="button" onClick={onClear} className={secondaryButtonClass}>
                                清除
                            </button>
                        </div>
                    </div>
                    <Countdown secondsRemaining={secondsRemaining} />
                </div>
            )}
        </section>
    );
}

function SecurityNotice() {
    return (
        <aside className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-xs leading-5 text-emerald-900">
            <div className="flex items-center gap-2 font-bold">
                <ShieldCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                密钥安全说明
            </div>
            <ul className="mt-3 space-y-2">
                <li>• 账号仅属于当前登录管理员，其他员工无法读取。</li>
                <li>• 密钥由后端使用 AES-256-GCM 加密保存。</li>
                <li>• 动态码在当前浏览器通过 Web Crypto 生成。</li>
                <li>• 本工具不改变管理账号的登录或密码策略。</li>
            </ul>
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 font-bold text-emerald-800">
                <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                仅登录管理员可用
            </div>
        </aside>
    );
}

function AccountList({
    accounts,
    codes,
    secondsRemaining,
    busy,
    onCopy,
    onEdit,
    onDelete,
    onClearAll,
}: {
    accounts: DashboardTwoFactorAccount[];
    codes: Record<string, string>;
    secondsRemaining: number;
    busy: boolean;
    onCopy: (account: DashboardTwoFactorAccount) => void;
    onEdit: (account: DashboardTwoFactorAccount) => void;
    onDelete: (account: DashboardTwoFactorAccount) => void;
    onClearAll: () => void;
}) {
    const [search, setSearch] = useState('');
    const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set());
    const filteredAccounts = useMemo(() => {
        const value = search.trim().toLocaleLowerCase();
        return value
            ? accounts.filter(account => account.projectName.toLocaleLowerCase().includes(value))
            : accounts;
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
        <section
            className="rounded-xl border border-slate-200 bg-white shadow-2xs"
            aria-labelledby="account-list-title"
        >
            <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                    <div>
                        <h2
                            id="account-list-title"
                            className="flex items-center gap-2 text-sm font-bold text-slate-900"
                        >
                            2FA 账号列表
                            <FeatureHelpButton topic="plugins.two-factor" title="2FA 账号列表" />
                        </h2>
                        <p className="mt-1 text-[11px] text-slate-400">每个管理员最多保存 100 个账号</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                        {accounts.length} / {MAX_TWO_FACTOR_ACCOUNTS}
                    </span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <label className="relative min-w-0 sm:w-72">
                        <span className="sr-only">搜索项目名称</span>
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <input
                            type="search"
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            placeholder="搜索项目名称"
                            className={`${inputClass} pl-9`}
                        />
                    </label>
                    {accounts.length > 0 && (
                        <button
                            type="button"
                            onClick={onClearAll}
                            disabled={busy}
                            className={dangerGhostButtonClass}
                        >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            清空全部
                        </button>
                    )}
                </div>
            </div>

            {!accounts.length ? (
                <div className="flex min-h-64 flex-col items-center justify-center p-8 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                        <KeyRound className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <h3 className="mt-4 text-sm font-bold text-slate-800">还没有保存 2FA 账号</h3>
                    <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
                        可以先在上方单独查询验证码，确认密钥正确后再保存；也可以批量导入。
                    </p>
                </div>
            ) : !filteredAccounts.length ? (
                <div className="flex min-h-48 flex-col items-center justify-center p-8 text-center">
                    <Search className="h-7 w-7 text-slate-300" aria-hidden="true" />
                    <h3 className="mt-3 text-sm font-bold text-slate-700">没有匹配的项目</h3>
                    <button
                        type="button"
                        onClick={() => setSearch('')}
                        className="mt-3 text-xs font-bold text-blue-600"
                    >
                        清除搜索条件
                    </button>
                </div>
            ) : (
                <>
                    <div className="hidden overflow-x-auto md:block">
                        <table className="w-full min-w-[920px] text-left text-xs">
                            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                <tr>
                                    <th className="px-5 py-3">项目名称</th>
                                    <th className="px-5 py-3">动态验证码</th>
                                    <th className="px-5 py-3">加密密钥</th>
                                    <th className="px-5 py-3">最近使用</th>
                                    <th className="px-5 py-3 text-right">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredAccounts.map(account => (
                                    <tr key={account.id} className="hover:bg-slate-50/80">
                                        <td className="px-5 py-4 font-bold text-slate-800">
                                            {account.projectName}
                                        </td>
                                        <td className="px-5 py-4">
                                            <div
                                                className="font-mono text-lg font-bold tracking-[0.12em] text-slate-950"
                                                aria-live="polite"
                                            >
                                                {codes[account.id]
                                                    ? formatTotpCode(codes[account.id])
                                                    : '••• •••'}
                                            </div>
                                            <Countdown secondsRemaining={secondsRemaining} compact />
                                        </td>
                                        <td className="px-5 py-4">
                                            <SecretValue
                                                account={account}
                                                revealed={revealedIds.has(account.id)}
                                                onToggle={() => toggleSecret(account.id)}
                                            />
                                        </td>
                                        <td className="px-5 py-4 text-slate-500">
                                            {formatLastUsed(account.lastUsedAt)}
                                        </td>
                                        <td className="px-5 py-4">
                                            <div className="flex justify-end gap-1">
                                                <IconButton
                                                    label="复制验证码"
                                                    disabled={busy || !codes[account.id]}
                                                    onClick={() => onCopy(account)}
                                                >
                                                    <Copy className="h-4 w-4" />
                                                </IconButton>
                                                <IconButton
                                                    label="编辑账号"
                                                    disabled={busy}
                                                    onClick={() => onEdit(account)}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </IconButton>
                                                <IconButton
                                                    label="删除账号"
                                                    danger
                                                    disabled={busy}
                                                    onClick={() => onDelete(account)}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </IconButton>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="divide-y divide-slate-100 md:hidden">
                        {filteredAccounts.map(account => (
                            <article key={account.id} className="space-y-4 p-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <h3 className="text-sm font-bold text-slate-900">
                                            {account.projectName}
                                        </h3>
                                        <p className="mt-1 text-[10px] text-slate-400">
                                            {formatLastUsed(account.lastUsedAt)}
                                        </p>
                                    </div>
                                    <div className="flex gap-1">
                                        <IconButton
                                            label="编辑账号"
                                            disabled={busy}
                                            onClick={() => onEdit(account)}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </IconButton>
                                        <IconButton
                                            label="删除账号"
                                            danger
                                            disabled={busy}
                                            onClick={() => onDelete(account)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </IconButton>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onCopy(account)}
                                    disabled={busy || !codes[account.id]}
                                    className="w-full rounded-xl border border-blue-200 bg-blue-50 p-4 text-left disabled:opacity-50"
                                >
                                    <span className="text-[10px] font-bold text-blue-600">
                                        点击复制验证码
                                    </span>
                                    <span className="mt-1 flex items-center justify-between gap-3">
                                        <span className="font-mono text-2xl font-bold tracking-[0.14em] text-slate-950">
                                            {codes[account.id]
                                                ? formatTotpCode(codes[account.id])
                                                : '••• •••'}
                                        </span>
                                        <Copy className="h-4 w-4 text-blue-600" aria-hidden="true" />
                                    </span>
                                    <Countdown secondsRemaining={secondsRemaining} compact />
                                </button>
                                <SecretValue
                                    account={account}
                                    revealed={revealedIds.has(account.id)}
                                    onToggle={() => toggleSecret(account.id)}
                                />
                            </article>
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}

function SecretValue({
    account,
    revealed,
    onToggle,
}: {
    account: DashboardTwoFactorAccount;
    revealed: boolean;
    onToggle: () => void;
}) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            <code className="max-w-56 truncate rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-600">
                {revealed ? account.secret : '••••••••••••••••'}
            </code>
            <button
                type="button"
                onClick={onToggle}
                aria-label={revealed ? '隐藏 2FA 密钥' : '显示 2FA 密钥'}
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
        </div>
    );
}

function AccountDialog({
    value,
    submitting,
    onClose,
    onSubmit,
}: {
    value: AccountDialogState;
    submitting: boolean;
    onClose: () => void;
    onSubmit: (draft: AccountDraft) => Promise<string | null>;
}) {
    const [projectName, setProjectName] = useState(value.account?.projectName ?? '');
    const [secret, setSecret] = useState(value.account?.secret ?? value.defaultSecret);
    const [revealed, setRevealed] = useState(false);
    const [error, setError] = useState('');

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError('');
        const nextError = await onSubmit({ projectName, secret });
        if (nextError) setError(nextError);
        else onClose();
    };

    return (
        <DialogBackdrop onRequestClose={onClose}>
            <AccessibleDialogSurface
                accessibleName={value.account ? '修改 2FA 账号' : '添加 2FA 账号'}
                onRequestClose={onClose}
                className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-base font-bold text-slate-900">
                            {value.account ? '修改 2FA 账号' : '添加 2FA 账号'}
                        </h2>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                            密钥保存后由服务器加密存储，验证码仍在当前浏览器生成。
                        </p>
                    </div>
                    <CloseButton onClick={onClose} />
                </div>
                <form onSubmit={event => void submit(event)} className="mt-5 space-y-4">
                    <Field label="项目名称 *" htmlFor="two-factor-project-name">
                        <input
                            id="two-factor-project-name"
                            autoFocus
                            maxLength={80}
                            value={projectName}
                            onChange={event => setProjectName(event.target.value)}
                            placeholder="例如：客服账号、广告平台"
                            className={inputClass}
                        />
                    </Field>
                    <Field label="2FA Base32 密钥 *" htmlFor="two-factor-account-secret">
                        <div className="flex gap-2">
                            <input
                                id="two-factor-account-secret"
                                type={revealed ? 'text' : 'password'}
                                autoComplete="off"
                                spellCheck={false}
                                value={secret}
                                onChange={event => setSecret(event.target.value)}
                                placeholder="输入 Base32 密钥"
                                className={`${inputClass} min-w-0 flex-1 font-mono`}
                            />
                            <button
                                type="button"
                                onClick={() => setRevealed(value => !value)}
                                aria-label={revealed ? '隐藏 2FA 密钥' : '显示 2FA 密钥'}
                                className={`${secondaryButtonClass} px-3`}
                            >
                                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                    </Field>
                    {error && (
                        <p className="text-xs font-medium text-rose-600" role="alert">
                            {error}
                        </p>
                    )}
                    <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className={secondaryButtonClass}
                        >
                            取消
                        </button>
                        <button type="submit" disabled={submitting} className={primaryButtonClass}>
                            {submitting && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                            {value.account ? '保存修改' : '添加账号'}
                        </button>
                    </div>
                </form>
            </AccessibleDialogSurface>
        </DialogBackdrop>
    );
}

function BatchImportDialog({
    existingSecrets,
    submitting,
    onClose,
    onImport,
}: {
    existingSecrets: string[];
    submitting: boolean;
    onClose: () => void;
    onImport: (accounts: ParsedBatchAccount[]) => Promise<boolean>;
}) {
    const [input, setInput] = useState('');
    const [validated, setValidated] = useState(false);
    const result = useMemo(() => parseBatchImport(input, existingSecrets), [existingSecrets, input]);

    const submit = async () => {
        setValidated(true);
        if (result.errors.length || !result.accounts.length) return;
        if (await onImport(result.accounts)) onClose();
    };

    return (
        <DialogBackdrop onRequestClose={onClose}>
            <AccessibleDialogSurface
                accessibleName="批量导入 2FA 账号"
                onRequestClose={onClose}
                className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                            批量导入 2FA 账号
                            <FeatureHelpButton topic="plugins.two-factor" title="批量导入 2FA 账号" />
                        </h2>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                            格式为“项目名称 | 2FA 密钥”；也可以一行只放一个密钥，系统会自动命名。
                        </p>
                    </div>
                    <CloseButton onClick={onClose} />
                </div>
                <label className="mt-5 block text-xs font-bold text-slate-700">
                    导入内容
                    <textarea
                        rows={10}
                        value={input}
                        onChange={event => {
                            setInput(event.target.value);
                            setValidated(false);
                        }}
                        autoFocus
                        spellCheck={false}
                        placeholder={'客服账号 | JBSWY3DPEHPK3PXP\nGEZDGNBVGY3TQOJQ'}
                        className={`${inputClass} mt-2 resize-y font-mono leading-5`}
                    />
                </label>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold">
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                        有效 {result.accounts.length} 行
                    </span>
                    <span
                        className={`rounded-full px-2.5 py-1 ${validated && result.errors.length ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}
                    >
                        无效 {result.errors.length} 行
                    </span>
                </div>
                {validated && result.errors.length > 0 && (
                    <div className="mt-3 max-h-36 overflow-y-auto rounded-lg border border-rose-200 bg-rose-50 p-3">
                        <ul className="space-y-1 text-xs text-rose-700">
                            {result.errors.map(error => (
                                <li key={`${error.lineNumber}-${error.code}`}>
                                    第 {error.lineNumber} 行：{batchErrorLabel(error.code)}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className={secondaryButtonClass}
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={() => void submit()}
                        disabled={!input.trim() || submitting}
                        className={primaryButtonClass}
                    >
                        {submitting && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                        导入账号
                    </button>
                </div>
            </AccessibleDialogSurface>
        </DialogBackdrop>
    );
}

function DialogBackdrop({ children, onRequestClose }: { children: ReactNode; onRequestClose: () => void }) {
    return (
        <div
            className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-xs"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onRequestClose();
            }}
        >
            {children}
        </div>
    );
}

function CloseButton({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label="关闭"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
            <X className="h-4 w-4" />
        </button>
    );
}

function Countdown({ secondsRemaining, compact = false }: { secondsRemaining: number; compact?: boolean }) {
    return (
        <div className={compact ? 'mt-1.5 w-32' : 'mt-3'}>
            <div className="flex items-center justify-between gap-2 text-[9px] font-bold text-slate-500">
                <span>自动刷新</span>
                <span className={secondsRemaining <= 5 ? 'text-rose-600' : ''}>{secondsRemaining} 秒</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                <div
                    className={`h-full rounded-full transition-[width] duration-1000 ${secondsRemaining <= 5 ? 'bg-rose-500' : 'bg-blue-600'}`}
                    style={{ width: `${(secondsRemaining / 30) * 100}%` }}
                />
            </div>
        </div>
    );
}

function IconButton({
    label,
    danger = false,
    disabled,
    onClick,
    children,
}: {
    label: string;
    danger?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
            className={`rounded-lg p-2 disabled:opacity-40 ${danger ? 'text-rose-500 hover:bg-rose-50' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'}`}
        >
            {children}
        </button>
    );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
    return (
        <label htmlFor={htmlFor} className="block text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            {children}
        </label>
    );
}

function LoadingState() {
    return (
        <div className="flex min-h-72 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs text-slate-500">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            正在读取 2FA 账号…
        </div>
    );
}

function ErrorState({ message, onRetry }: { message: unknown; onRetry: () => void }) {
    return (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-rose-200 bg-white p-6 text-center">
            <AlertCircle className="h-8 w-8 text-rose-500" aria-hidden="true" />
            <h2 className="mt-3 text-sm font-bold text-slate-800">2FA 账号加载失败</h2>
            <p className="mt-1 max-w-lg text-xs text-rose-600">
                {toUserFacingError(message, '暂时无法读取 2FA 账号，请稍后重试')}
            </p>
            <button type="button" onClick={onRetry} className={`${secondaryButtonClass} mt-4`}>
                重试
            </button>
        </div>
    );
}

function Message({
    kind,
    onClose,
    children,
}: {
    kind: 'success' | 'error' | 'info';
    onClose?: () => void;
    children: ReactNode;
}) {
    const styles =
        kind === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : kind === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-blue-200 bg-blue-50 text-blue-800';
    const Icon = kind === 'success' ? CheckCircle2 : kind === 'error' ? AlertCircle : ShieldCheck;
    return (
        <div
            className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${styles}`}
            role={kind === 'error' ? 'alert' : 'status'}
        >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex flex-1 flex-wrap items-center">{children}</span>
            {onClose && (
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="关闭提示"
                    className="rounded p-1 hover:bg-black/5"
                >
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
    );
}

function batchErrorLabel(code: BatchImportErrorCode): string {
    const labels: Record<BatchImportErrorCode, string> = {
        MISSING_NAME: '项目名称为空或超过 80 个字符',
        MISSING_SECRET: '缺少 2FA 密钥',
        INVALID_SECRET: '密钥不是有效的 Base32',
        DUPLICATE_SECRET: '密钥重复或已经保存',
        LIMIT_REACHED: '超过 100 个账号上限',
    };
    return labels[code];
}

function formatLastUsed(value: string | null): string {
    if (!value) return '尚未复制';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '时间未知';
    return `最近 ${new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date)}`;
}

interface CreatedAccountResult {
    createDashboardTwoFactorAccount: DashboardTwoFactorAccount;
}

interface UpdatedAccountResult {
    updateDashboardTwoFactorAccount: DashboardTwoFactorAccount;
}

interface ImportedAccountsResult {
    importDashboardTwoFactorAccounts: DashboardTwoFactorAccount[];
}

const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs font-normal text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100';
const primaryButtonClass =
    'flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
    'flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100 disabled:cursor-not-allowed disabled:opacity-50';
const dangerGhostButtonClass =
    'flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50';
