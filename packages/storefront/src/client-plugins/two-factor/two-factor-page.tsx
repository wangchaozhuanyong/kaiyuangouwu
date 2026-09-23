/* eslint-disable import/order, max-len -- Bilingual copy and organizer-owned type imports are intentional. */
import {
    Check,
    ChevronDown,
    ClipboardPaste,
    Clock3,
    Copy,
    Eye,
    EyeOff,
    KeyRound,
    LockKeyhole,
    MoreHorizontal,
    Pencil,
    Plus,
    Search,
    ShieldCheck,
    Trash2,
    Upload,
} from 'lucide-react';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActiveCustomer, StorefrontLanguage } from '../../types';
import type { BatchImportErrorCode } from './batch-parser';
import type { TwoFactorAccount } from './types';

import { Sheet, Subpage } from '../../storefront-ui/page-shell';

import { getAnonymousTwoFactorOwnerId } from './anonymous-owner';
import { MAX_BATCH_CHARACTERS, parseBatchImport } from './batch-parser';
import { formatTotpCode, generateTotp, getTotpSecondsRemaining, normalizeBase32Secret } from './totp';
import { MAX_TWO_FACTOR_ACCOUNTS } from './types';
import { useBrowserVault } from './use-browser-vault';
import { VaultControls } from './vault-controls';

interface TwoFactorPageProps {
    customer: ActiveCustomer | null;
    language: StorefrontLanguage;
    onBack: () => void;
    onSignIn: () => void;
    onNotify: (message: string) => void;
}

export function TwoFactorPage(props: Readonly<TwoFactorPageProps>) {
    return <TwoFactorPageSession key={props.customer?.id ?? 'anonymous'} {...props} />;
}

function TwoFactorPageSession({ customer, language, onBack, onNotify }: Readonly<TwoFactorPageProps>) {
    const isZh = language === 'zh';
    const [anonymousOwnerId] = useState(getAnonymousTwoFactorOwnerId);
    const ownerId = customer?.id ?? anonymousOwnerId;
    const sensitiveRevision = useRef(0);
    const [now, setNow] = useState(() => Date.now());
    const [codes, setCodes] = useState<Record<string, string>>({});
    const [quickInput, setQuickInput] = useState('');
    const [quickSecret, setQuickSecret] = useState<string | null>(null);
    const [quickCode, setQuickCode] = useState<string | null>(null);
    const [quickError, setQuickError] = useState('');
    const [querying, setQuerying] = useState(false);
    const [showQuickDescription, setShowQuickDescription] = useState(false);
    const [showPrivacyDetails, setShowPrivacyDetails] = useState(false);
    const [showAccountForm, setShowAccountForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [projectName, setProjectName] = useState('');
    const [accountSecret, setAccountSecret] = useState('');
    const [accountError, setAccountError] = useState('');
    const [showBatchImport, setShowBatchImport] = useState(false);
    const [batchInput, setBatchInput] = useState('');
    const [batchValidated, setBatchValidated] = useState(false);
    const [search, setSearch] = useState('');
    const [revealedIds, setRevealedIds] = useState<Set<string>>(() => new Set());
    const [deletion, setDeletion] = useState<{ id: string; projectName: string } | 'all' | null>(null);
    const [deletionError, setDeletionError] = useState(false);
    const deletionPending = useRef(false);
    const clearSensitiveState = useCallback(() => {
        sensitiveRevision.current++;
        setCodes({});
        setQuickInput('');
        setQuickSecret(null);
        setQuickCode(null);
        setQuickError('');
        setQuerying(false);
        setAccountSecret('');
        setProjectName('');
        setBatchInput('');
        setShowBatchImport(false);
        setShowAccountForm(false);
        setEditingId(null);
        setRevealedIds(new Set());
        setSearch('');
        setDeletion(null);
        setDeletionError(false);
    }, []);
    const vault = useBrowserVault(ownerId, clearSensitiveState);
    const { accounts, canWrite: storageAvailable } = vault;
    const persistAccounts = vault.save;
    useEffect(
        () => () => {
            sensitiveRevision.current++;
        },
        [],
    );
    const secondsRemaining = getTotpSecondsRemaining(now);
    const timeStep = Math.floor(now / 30_000);
    const copy = copyFor(language);
    const batchResult = useMemo(
        () =>
            parseBatchImport(
                batchInput,
                accounts.map(account => account.secret),
                MAX_TWO_FACTOR_ACCOUNTS,
                isZh ? '未命名' : 'Untitled',
            ),
        [accounts, batchInput, isZh],
    );
    const visibleAccounts = useMemo(() => {
        const query = search.trim().toLocaleLowerCase();
        return query
            ? accounts.filter(account => account.projectName.toLocaleLowerCase().includes(query))
            : accounts;
    }, [accounts, search]);

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
        if (!quickSecret) return;
        let active = true;
        void generateTotp(quickSecret, timeStep * 30_000)
            .then(code => {
                if (active) setQuickCode(code);
            })
            .catch(() => {
                if (active) setQuickCode(null);
            });
        return () => {
            active = false;
        };
    }, [quickSecret, timeStep]);

    const queryCode = async (event: FormEvent) => {
        event.preventDefault();
        const epoch = sensitiveRevision.current;
        setQuerying(true);
        setQuickError('');
        try {
            const secret = normalizeBase32Secret(quickInput);
            setQuickSecret(secret);
            const code = await generateTotp(secret);
            if (sensitiveRevision.current !== epoch) return;
            setQuickCode(code);
            setNow(Date.now());
        } catch {
            if (sensitiveRevision.current !== epoch) return;
            setQuickSecret(null);
            setQuickCode(null);
            setQuickError(copy.invalidSecret);
        } finally {
            if (sensitiveRevision.current === epoch) setQuerying(false);
        }
    };

    const pasteSecret = async () => {
        const epoch = sensitiveRevision.current;
        try {
            const value = await navigator.clipboard.readText();
            if (sensitiveRevision.current !== epoch) return;
            if (value.length > 1024) throw new Error('too large');
            if (!value.trim()) throw new Error('empty');
            setQuickInput(value.trim());
            setQuickSecret(null);
            setQuickCode(null);
            setQuickError('');
        } catch {
            onNotify(copy.pasteFailed);
        }
    };

    const copyCode = async (code: string): Promise<boolean> => {
        try {
            await navigator.clipboard.writeText(code);
            onNotify(copy.copied);
            return true;
        } catch {
            onNotify(copy.copyFailed);
            return false;
        }
    };

    const openAccountForm = (account?: TwoFactorAccount, defaultSecret = '') => {
        setEditingId(account?.id ?? null);
        setProjectName(account?.projectName ?? '');
        setAccountSecret(account?.secret ?? defaultSecret);
        setAccountError('');
        setShowAccountForm(true);
    };

    const saveAccount = async (event: FormEvent) => {
        event.preventDefault();
        const name = projectName.trim();
        if (!name) {
            setAccountError(copy.projectRequired);
            return;
        }
        if (name.length > 80) {
            setAccountError(copy.projectTooLong);
            return;
        }
        let secret: string;
        try {
            secret = normalizeBase32Secret(accountSecret);
        } catch {
            setAccountError(copy.invalidSecret);
            return;
        }
        if (accounts.some(account => account.secret === secret && account.id !== editingId)) {
            setAccountError(copy.duplicateSecret);
            return;
        }
        if (!editingId && accounts.length >= MAX_TWO_FACTOR_ACCOUNTS) {
            setAccountError(copy.accountLimit);
            return;
        }
        const nextAccounts = editingId
            ? accounts.map(account =>
                  account.id === editingId ? { ...account, projectName: name, secret } : account,
              )
            : [
                  ...accounts,
                  {
                      id: createAccountId(),
                      projectName: name,
                      secret,
                      createdAt: new Date().toISOString(),
                      lastUsedAt: null,
                  },
              ];
        if (!(await persistAccounts(nextAccounts))) return;
        setShowAccountForm(false);
        setAccountSecret('');
        setProjectName('');
        setEditingId(null);
        onNotify(editingId ? copy.accountUpdated : copy.accountAdded);
    };

    const importAccounts = async () => {
        setBatchValidated(true);
        if (batchResult.errors.length || !batchResult.accounts.length) return;
        const createdAt = new Date().toISOString();
        const nextAccounts = [
            ...accounts,
            ...batchResult.accounts.map(account => ({
                id: createAccountId(),
                projectName: account.projectName,
                secret: account.secret,
                createdAt,
                lastUsedAt: null,
            })),
        ];
        if (!(await persistAccounts(nextAccounts))) return;
        setBatchInput('');
        setBatchValidated(false);
        setShowBatchImport(false);
        onNotify(copy.accountsImported);
    };

    const confirmDeletion = async () => {
        if (!deletion || !storageAvailable || deletionPending.current) return;
        const epoch = sensitiveRevision.current;
        deletionPending.current = true;
        setDeletionError(false);
        try {
            const next = deletion === 'all' ? [] : accounts.filter(item => item.id !== deletion.id);
            if (!(await persistAccounts(next))) {
                if (sensitiveRevision.current === epoch) setDeletionError(true);
                return;
            }
            if (sensitiveRevision.current !== epoch) return;
            setDeletion(null);
            setCodes({});
            setRevealedIds(new Set());
            onNotify(deletion === 'all' ? copy.accountsCleared : copy.accountDeleted);
        } finally {
            deletionPending.current = false;
        }
    };

    const copyAccountCode = async (account: TwoFactorAccount) => {
        const epoch = sensitiveRevision.current;
        const code = codes[account.id];
        if (!code || !(await copyCode(code))) return;
        if (sensitiveRevision.current !== epoch) return;
        await persistAccounts(
            accounts.map(item =>
                item.id === account.id ? { ...item, lastUsedAt: new Date().toISOString() } : item,
            ),
        );
    };

    return (
        <Subpage title={copy.title} language={language} onBack={onBack}>
            <div className="desktop-two-factor-content mx-auto grid w-full max-w-6xl gap-4 px-3 pb-10 pt-3 lg:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:px-6">
                <section className="two-factor-query min-w-0 rounded-[var(--skin-card-radius,16px)] border-0 bg-[var(--surface)] p-4 lg:col-start-1 lg:row-start-1 lg:p-7">
                    <VaultControls
                        key={`${ownerId}-${vault.unlocked}-${vault.exists}-${sensitiveRevision.current}`}
                        vault={vault}
                        isZh={isZh}
                    />
                    <div className="flex items-start gap-3">
                        <span className="grid size-11 shrink-0 place-items-center rounded-[var(--skin-control-radius,10px)] bg-[var(--accent-soft)] text-[var(--accent-ink)]">
                            <KeyRound className="size-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <h1 className="m-0 text-xl font-black text-[var(--text)]">
                                    {copy.quickQuery}
                                </h1>
                                <button
                                    className={descriptionToggleClass}
                                    type="button"
                                    aria-expanded={showQuickDescription}
                                    aria-controls="storefront-two-factor-query-description"
                                    onClick={() => setShowQuickDescription(value => !value)}
                                >
                                    {showQuickDescription ? copy.hideDescription : copy.viewDescription}
                                    <ChevronDown
                                        className={`size-4 transition-transform ${showQuickDescription ? 'rotate-180' : ''}`}
                                        aria-hidden="true"
                                    />
                                </button>
                            </div>
                            {showQuickDescription ? (
                                <p
                                    id="storefront-two-factor-query-description"
                                    className="mb-0 mt-2 text-sm leading-6 text-[var(--muted)]"
                                >
                                    {copy.description}
                                </p>
                            ) : null}
                        </div>
                    </div>
                    <form className="mt-5 grid gap-3" onSubmit={event => void queryCode(event)}>
                        <label className="sr-only" htmlFor="storefront-two-factor-secret">
                            {copy.secret}
                        </label>
                        <input
                            id="storefront-two-factor-secret"
                            className="min-h-12 w-full rounded-[var(--skin-control-radius,10px)] border border-[var(--line)] bg-[var(--surface)] px-3 font-mono text-sm outline-none transition focus:border-[var(--focus)] focus:ring-4 focus:ring-[var(--accent-soft)]"
                            type="password"
                            maxLength={1024}
                            autoComplete="off"
                            spellCheck={false}
                            value={quickInput}
                            placeholder={copy.secretPlaceholder}
                            onChange={event => {
                                setQuickInput(event.target.value);
                                setQuickSecret(null);
                                setQuickCode(null);
                                setQuickError('');
                            }}
                        />
                        {quickError ? (
                            <p className="m-0 text-sm font-semibold text-[var(--danger)]" role="alert">
                                {quickError}
                            </p>
                        ) : null}
                        <div className="grid grid-cols-2 gap-2 sm:flex">
                            <button
                                className={secondaryButtonClass}
                                type="button"
                                onClick={() => void pasteSecret()}
                            >
                                <ClipboardPaste className="size-4" aria-hidden="true" />
                                {copy.paste}
                            </button>
                            <button
                                className={primaryButtonClass}
                                type="submit"
                                disabled={!quickInput.trim() || querying}
                            >
                                <Search className="size-4" aria-hidden="true" />
                                {querying ? copy.querying : copy.query}
                            </button>
                        </div>
                    </form>

                    {quickCode ? (
                        <div className="two-factor-query-result mt-6" aria-live="polite">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <small className="font-bold text-[var(--muted)]">
                                        {copy.currentCode}
                                    </small>
                                    <p className="mb-0 mt-1 font-mono text-3xl font-black tracking-[0.16em] text-[var(--text)] sm:text-4xl">
                                        {formatTotpCode(quickCode)}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        className={secondaryButtonClass}
                                        type="button"
                                        onClick={() => void copyCode(quickCode)}
                                    >
                                        <Copy className="size-4" aria-hidden="true" />
                                        {copy.copy}
                                    </button>
                                    <button
                                        className={secondaryButtonClass}
                                        type="button"
                                        disabled={!storageAvailable}
                                        onClick={() => quickSecret && openAccountForm(undefined, quickSecret)}
                                    >
                                        <Plus className="size-4" aria-hidden="true" />
                                        {copy.save}
                                    </button>
                                </div>
                            </div>
                            <Countdown seconds={secondsRemaining} label={copy.seconds} />
                        </div>
                    ) : null}
                </section>

                <aside className="two-factor-privacy min-w-0 px-4 lg:col-start-1 lg:row-start-2 lg:px-7">
                    <button
                        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[var(--skin-control-radius,10px)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
                        type="button"
                        aria-expanded={showPrivacyDetails}
                        aria-controls="storefront-two-factor-privacy-details"
                        onClick={() => setShowPrivacyDetails(value => !value)}
                    >
                        <span className="flex items-center gap-2">
                            <ShieldCheck className="size-5 text-[var(--success)]" aria-hidden="true" />
                            <span className="text-base font-black text-[var(--text)]">
                                {copy.privacyTitle}
                            </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-sm font-extrabold text-[var(--success)]">
                            {showPrivacyDetails ? copy.collapse : copy.expand}
                            <ChevronDown
                                className={`size-4 transition-transform ${showPrivacyDetails ? 'rotate-180' : ''}`}
                                aria-hidden="true"
                            />
                        </span>
                    </button>
                    {showPrivacyDetails ? (
                        <div id="storefront-two-factor-privacy-details">
                            <ul className="mb-0 mt-4 grid gap-3 p-0 text-sm leading-5 text-[var(--muted)]">
                                {[
                                    copy.noDatabase,
                                    copy.noUpload,
                                    copy.localGeneration,
                                    vault.exists
                                        ? isZh
                                            ? '已启用本地加密保存（AES-GCM）'
                                            : 'Encrypted saving is active (AES-GCM)'
                                        : copy.persistentLocal,
                                ].map(item => (
                                    <li className="flex list-none items-start gap-2" key={item}>
                                        <Check
                                            className="mt-0.5 size-4 shrink-0 text-[var(--success)]"
                                            aria-hidden="true"
                                        />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                            <p className="mb-0 mt-4 text-xs leading-5 text-[var(--warning)]">
                                <LockKeyhole
                                    className="mr-1 inline size-4 align-text-bottom"
                                    aria-hidden="true"
                                />
                                {vault.exists
                                    ? isZh
                                        ? '已启用加密保存，锁定或离开页面后需口令解锁。请下载加密备份防丢。解锁期间仍应防范恶意脚本和浏览器扩展，仅在可信设备上使用。'
                                        : 'Encrypted saving is active. Passphrase is required after idle or leaving. Download an encrypted backup. Malicious scripts or extensions can still read data while unlocked. Use a trusted device.'
                                    : copy.publicDevice}
                            </p>
                        </div>
                    ) : null}
                    {!storageAvailable ? (
                        <p className="mb-0 mt-3 text-sm font-semibold text-[var(--danger)]" role="alert">
                            {copy.storageUnavailable}
                        </p>
                    ) : null}
                </aside>

                <section className="two-factor-accounts min-w-0 p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:p-7">
                    <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                        <div className="min-w-0">
                            <h2 className="m-0 text-base sm:text-lg max-[350px]:text-sm font-black text-[var(--text)] whitespace-nowrap">
                                {copy.accountList}
                            </h2>
                            <p className="mb-0 mt-0.5 sm:mt-1 text-xs font-semibold text-[var(--muted)] whitespace-nowrap">
                                {accounts.length} / {MAX_TWO_FACTOR_ACCOUNTS}
                            </p>
                        </div>
                        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
                            <button
                                className={headerSecondaryButtonClass}
                                type="button"
                                disabled={!storageAvailable}
                                onClick={() => setShowBatchImport(value => !value)}
                            >
                                <Upload className="size-3.5 sm:size-4 shrink-0" aria-hidden="true" />
                                {copy.batchImport}
                            </button>
                            <button
                                className={headerPrimaryButtonClass}
                                type="button"
                                disabled={!storageAvailable}
                                onClick={() => openAccountForm()}
                            >
                                <Plus className="size-3.5 sm:size-4 shrink-0" aria-hidden="true" />
                                {copy.addAccount}
                            </button>
                        </div>
                    </div>

                    {showAccountForm ? (
                        <form
                            className="two-factor-account-form mt-6 grid gap-3 md:grid-cols-2"
                            onSubmit={event => void saveAccount(event)}
                        >
                            <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
                                {copy.projectName}
                                <input
                                    className={inputClass}
                                    maxLength={80}
                                    value={projectName}
                                    onChange={event => setProjectName(event.target.value)}
                                />
                            </label>
                            <label className="grid gap-1.5 text-sm font-bold text-[var(--text)]">
                                {copy.secret}
                                <input
                                    className={`${inputClass} font-mono`}
                                    type="password"
                                    maxLength={1024}
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={accountSecret}
                                    onChange={event => setAccountSecret(event.target.value)}
                                />
                            </label>
                            {accountError ? (
                                <p
                                    className="m-0 text-sm font-semibold text-[var(--danger)] md:col-span-2"
                                    role="alert"
                                >
                                    {accountError}
                                </p>
                            ) : null}
                            <div className="flex flex-wrap gap-2 md:col-span-2">
                                <button className={primaryButtonClass} type="submit">
                                    {editingId ? copy.update : copy.addAccount}
                                </button>
                                <button
                                    className={secondaryButtonClass}
                                    type="button"
                                    onClick={() => {
                                        setShowAccountForm(false);
                                        setAccountSecret('');
                                        setProjectName('');
                                    }}
                                >
                                    {copy.cancel}
                                </button>
                            </div>
                        </form>
                    ) : null}

                    {showBatchImport ? (
                        <div className="two-factor-batch-form mt-6">
                            <label
                                className="grid gap-1.5 text-sm font-bold text-[var(--text)]"
                                htmlFor="storefront-two-factor-batch"
                            >
                                {copy.batchFormat}
                                <textarea
                                    id="storefront-two-factor-batch"
                                    className={`${inputClass} min-h-36 resize-y font-mono`}
                                    maxLength={MAX_BATCH_CHARACTERS}
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={batchInput}
                                    placeholder={copy.batchPlaceholder}
                                    onChange={event => {
                                        setBatchInput(event.target.value);
                                        setBatchValidated(false);
                                    }}
                                />
                            </label>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
                                <span className="text-[var(--success)]">
                                    {copy.validRows}: {batchResult.accounts.length}
                                </span>
                                <span className="text-[var(--danger)]">
                                    {copy.invalidRows}: {batchResult.errors.length}
                                </span>
                            </div>
                            {batchValidated && batchResult.errors.length ? (
                                <ul
                                    className="mb-0 mt-3 max-h-36 overflow-y-auto pl-5 text-sm text-[var(--danger)]"
                                    role="alert"
                                >
                                    {batchResult.errors.map(error => (
                                        <li key={`${error.lineNumber}-${error.code}`}>
                                            {copy.line} {error.lineNumber}:{' '}
                                            {batchErrorLabel(error.code, copy)}
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    className={primaryButtonClass}
                                    type="button"
                                    disabled={!batchInput.trim()}
                                    onClick={() => void importAccounts()}
                                >
                                    {copy.importAccounts}
                                </button>
                                <button
                                    className={secondaryButtonClass}
                                    type="button"
                                    onClick={() => {
                                        setShowBatchImport(false);
                                        setBatchInput('');
                                    }}
                                >
                                    {copy.cancel}
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {accounts.length ? (
                        <div className="mt-5 flex flex-wrap items-center gap-2">
                            <label className="relative min-w-0 flex-1" aria-label={copy.search}>
                                <Search
                                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]"
                                    aria-hidden="true"
                                />
                                <input
                                    className={`${inputClass} pl-9`}
                                    value={search}
                                    placeholder={copy.search}
                                    onChange={event => setSearch(event.target.value)}
                                />
                            </label>
                            <button
                                className={`${secondaryButtonClass} text-[var(--danger)]`}
                                type="button"
                                disabled={!storageAvailable}
                                onClick={() => {
                                    setDeletionError(false);
                                    setDeletion('all');
                                }}
                            >
                                <Trash2 className="size-4" />
                                {copy.clearAll}
                            </button>
                        </div>
                    ) : null}

                    {!accounts.length ? (
                        <div className="two-factor-empty mt-5 grid min-h-48 place-items-center py-6 text-center">
                            <div>
                                <KeyRound className="mx-auto size-8 text-[var(--muted)]" aria-hidden="true" />
                                <strong className="mt-3 block text-[var(--text)]">{copy.emptyTitle}</strong>
                                <p className="mb-0 mt-1 text-sm text-[var(--muted)]">
                                    {copy.emptyDescription}
                                </p>
                            </div>
                        </div>
                    ) : !visibleAccounts.length ? (
                        <p className="two-factor-empty mt-5 py-8 text-center text-sm text-[var(--muted)]">
                            {copy.noSearchResults}
                        </p>
                    ) : (
                        <div className="two-factor-account-grid mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
                            {visibleAccounts.map(account => {
                                const revealed = revealedIds.has(account.id);
                                const code = codes[account.id];
                                return (
                                    <article
                                        className="two-factor-account rounded-[var(--skin-card-radius,16px)] bg-[var(--surface)] p-4"
                                        key={account.id}
                                    >
                                        <div className="flex min-h-9 items-center gap-2">
                                            <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
                                                <h3
                                                    className="m-0 max-w-[45%] shrink-0 truncate text-sm font-black text-[var(--text)]"
                                                    title={account.projectName}
                                                >
                                                    {account.projectName}
                                                </h3>
                                                <code className="min-w-0 truncate text-[11px] text-[var(--muted)]">
                                                    {maskSecret(account.secret)}
                                                </code>
                                            </div>
                                            <AccountMoreMenu
                                                account={account}
                                                copy={copy}
                                                now={now}
                                                revealed={revealed}
                                                onToggleSecret={() =>
                                                    setRevealedIds(current =>
                                                        toggleSetValue(current, account.id),
                                                    )
                                                }
                                                onEdit={() => openAccountForm(account)}
                                                onDelete={() => {
                                                    setDeletionError(false);
                                                    setDeletion({
                                                        id: account.id,
                                                        projectName: account.projectName,
                                                    });
                                                }}
                                            />
                                        </div>
                                        <div className="two-factor-account-code mt-2 flex min-h-12 items-center gap-2">
                                            <div className="min-w-[6.9rem] shrink-0">
                                                <span className="sr-only">{copy.dynamicCode}</span>
                                                <p className="m-0 whitespace-nowrap font-mono text-[1.35rem] font-black leading-none tracking-[0.12em] text-[var(--text)] tabular-nums">
                                                    {code ? formatTotpCode(code) : '--- ---'}
                                                </p>
                                            </div>
                                            <CompactCountdown
                                                seconds={secondsRemaining}
                                                label={copy.seconds}
                                            />
                                            <button
                                                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-[var(--skin-control-radius,10px)] bg-[var(--control-surface,var(--soft))] px-2 text-xs font-bold text-[var(--text)] transition-colors hover:bg-[var(--control-surface-hover,var(--accent-soft))] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
                                                type="button"
                                                disabled={!code}
                                                onClick={() => void copyAccountCode(account)}
                                            >
                                                <Copy className="size-4" aria-hidden="true" />
                                                {copy.copy}
                                            </button>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>
            {deletion ? (
                <Sheet
                    title={deletion === 'all' ? copy.clearAll : copy.delete}
                    language={language}
                    initialFocus="dialog"
                    onClose={() => {
                        if (!deletionPending.current) setDeletion(null);
                    }}
                >
                    <div className="p-4">
                        <p>{deletion === 'all' ? copy.clearConfirm : copy.deleteConfirm}</p>
                        {deletion !== 'all' && (
                            <p className="break-words font-bold">{deletion.projectName}</p>
                        )}
                        {deletionError && (
                            <p role="alert" className="text-sm text-[var(--danger)]">
                                {copy.deleteFailed}
                            </p>
                        )}
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                className={secondaryButtonClass}
                                disabled={vault.busy}
                                onClick={() => setDeletion(null)}
                            >
                                {copy.cancel}
                            </button>
                            <button
                                type="button"
                                className={`${secondaryButtonClass} text-[var(--danger)]`}
                                disabled={!storageAvailable}
                                onClick={() => void confirmDeletion()}
                            >
                                {vault.busy ? copy.deleting : copy.confirmDelete}
                            </button>
                        </div>
                    </div>
                </Sheet>
            ) : null}
        </Subpage>
    );
}

const inputClass =
    'min-h-11 w-full rounded-[var(--skin-control-radius,10px)] border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none transition focus:border-[var(--focus)] focus:ring-4 focus:ring-[var(--accent-soft)]';
const primaryButtonClass =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--skin-control-radius,10px)] bg-[var(--accent)] px-4 text-sm font-extrabold text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]';
const secondaryButtonClass =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--skin-control-radius,10px)] border-0 bg-[var(--control-surface,var(--soft))] px-3 text-sm font-extrabold text-[var(--text)] transition-colors hover:bg-[var(--control-surface-hover,var(--accent-soft))] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]';
const headerPrimaryButtonClass =
    'inline-flex min-h-11 items-center justify-center gap-1 sm:gap-1.5 rounded-[var(--skin-control-radius,10px)] bg-[var(--accent-soft)] px-2.5 sm:px-3.5 max-[350px]:px-2 text-xs sm:text-sm max-[350px]:text-[11px] font-extrabold text-[var(--accent-ink)] transition-colors hover:bg-[var(--control-surface-hover,var(--accent-soft))] shrink-0 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]';
const headerSecondaryButtonClass =
    'inline-flex min-h-11 items-center justify-center gap-1 sm:gap-1.5 rounded-[var(--skin-control-radius,10px)] border-0 bg-transparent px-2.5 sm:px-3 max-[350px]:px-2 text-xs sm:text-sm max-[350px]:text-[11px] font-extrabold text-[var(--muted)] transition-colors hover:bg-[var(--control-surface-hover,var(--accent-soft))] shrink-0 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]';
const iconButtonClass =
    'inline-grid size-10 shrink-0 place-items-center rounded-[var(--skin-control-radius,10px)] border border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] transition hover:bg-[var(--soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] focus-visible:ring-offset-1';
const descriptionToggleClass =
    'inline-flex min-h-11 shrink-0 items-center gap-1 rounded-[var(--skin-control-radius,10px)] px-2 py-1 text-sm font-extrabold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]';

function Countdown({ seconds, label }: Readonly<{ seconds: number; label: string }>) {
    return (
        <div className="mt-3 flex items-center gap-2 text-xs font-bold text-[var(--muted)]">
            <Clock3 className="size-4" aria-hidden="true" />
            <span className="min-w-10 font-mono">
                {seconds} {label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--skin-divider,var(--line))]">
                <div
                    className="h-full rounded-full bg-[var(--success)] transition-[width] duration-300"
                    style={{ width: `${(seconds / 30) * 100}%` }}
                />
            </div>
        </div>
    );
}

function CompactCountdown({ seconds, label }: Readonly<{ seconds: number; label: string }>) {
    return (
        <div className="min-w-0 flex-1" aria-label={`${seconds} ${label}`}>
            <div className="flex items-center gap-1 text-[11px] font-bold text-[var(--muted)]">
                <Clock3 className="size-3.5" aria-hidden="true" />
                <span className="whitespace-nowrap font-mono tabular-nums">
                    {seconds} {label}
                </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--skin-divider,var(--line))]">
                <div
                    className="h-full rounded-full bg-[var(--success)] transition-[width] duration-300"
                    style={{ width: `${(seconds / 30) * 100}%` }}
                />
            </div>
        </div>
    );
}

interface AccountMoreMenuProps {
    account: TwoFactorAccount;
    copy: Copy;
    now: number;
    revealed: boolean;
    onToggleSecret: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

function AccountMoreMenu({
    account,
    copy,
    now,
    revealed,
    onToggleSecret,
    onEdit,
    onDelete,
}: Readonly<AccountMoreMenuProps>) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const closeOnOutsideClick = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setOpen(false);
            triggerRef.current?.focus();
        };
        document.addEventListener('pointerdown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    return (
        <div className={`relative shrink-0 ${open ? 'z-[30]' : ''}`} ref={containerRef}>
            <button
                ref={triggerRef}
                className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-[var(--skin-control-radius,10px)] px-2 text-xs font-extrabold text-[var(--muted)] transition hover:bg-[var(--soft)] hover:text-[var(--text)] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]"
                type="button"
                aria-label={`${account.projectName} ${copy.moreActions}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
            >
                <MoreHorizontal className="size-4" aria-hidden="true" />
                {copy.more}
            </button>
            {open ? (
                <div
                    className="two-factor-account-menu absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-3.5rem)] overflow-hidden rounded-[var(--skin-control-radius,10px)] bg-[var(--surface)] text-left text-[var(--text)] shadow-[var(--skin-card-shadow)]"
                    role="dialog"
                    aria-label={`${account.projectName} ${copy.moreActions}`}
                >
                    <div className="p-3">
                        <span className="text-[11px] font-bold text-[var(--muted)]">{copy.secret}</span>
                        <code
                            className="mt-1 block break-all py-1.5 text-xs text-[var(--text)]"
                            aria-live="polite"
                        >
                            {revealed ? account.secret : maskSecret(account.secret)}
                        </code>
                        <p className="mb-0 mt-2 text-xs text-[var(--muted)]">
                            {copy.recentUse}: {formatRecentUse(account.lastUsedAt, now, copy)}
                        </p>
                    </div>
                    <div className="grid gap-1 p-1.5">
                        <button className={moreMenuButtonClass} type="button" onClick={onToggleSecret}>
                            {revealed ? (
                                <EyeOff className="size-4" aria-hidden="true" />
                            ) : (
                                <Eye className="size-4" aria-hidden="true" />
                            )}
                            {revealed ? copy.hide : copy.reveal}
                        </button>
                        <button
                            className={moreMenuButtonClass}
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                onEdit();
                            }}
                        >
                            <Pencil className="size-4" aria-hidden="true" />
                            {copy.edit}
                        </button>
                        <button
                            className={`${moreMenuButtonClass} text-[var(--danger)]`}
                            type="button"
                            onClick={() => {
                                setOpen(false);
                                onDelete();
                            }}
                        >
                            <Trash2 className="size-4" aria-hidden="true" />
                            {copy.delete}
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

const moreMenuButtonClass = [
    'flex min-h-11 w-full items-center gap-2 rounded-[var(--skin-control-radius,10px)] px-3 text-left text-sm font-bold',
    'transition hover:bg-[var(--soft)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--focus)]',
].join(' ');

function toggleSetValue(current: Set<string>, value: string): Set<string> {
    const next = new Set(current);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
}

function createAccountId(): string {
    return (
        globalThis.crypto?.randomUUID?.() ?? `two-factor-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
}

function maskSecret(secret: string): string {
    return secret.length <= 8 ? '•••• ••••' : `${secret.slice(0, 4)} •••• •••• ${secret.slice(-4)}`;
}

type Copy = ReturnType<typeof copyFor>;

function formatRecentUse(value: string | null, now: number, copy: Copy): string {
    if (!value) return copy.neverUsed;
    const minutes = Math.floor(Math.max(0, now - new Date(value).getTime()) / 60_000);
    if (minutes < 1) return copy.justNow;
    if (minutes < 60) return `${minutes} ${copy.minutesAgo}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${copy.hoursAgo}`;
    return `${Math.floor(hours / 24)} ${copy.daysAgo}`;
}

function batchErrorLabel(code: BatchImportErrorCode, copy: Copy): string {
    return {
        MISSING_NAME: copy.projectRequired,
        MISSING_SECRET: copy.secretRequired,
        INVALID_SECRET: copy.invalidSecret,
        DUPLICATE_SECRET: copy.duplicateSecret,
        LIMIT_REACHED: copy.accountLimit,
        INPUT_TOO_LARGE: copy.inputTooLarge,
    }[code];
}

function copyFor(language: StorefrontLanguage) {
    const isZh = language === 'zh';
    return {
        title: isZh ? '2FA 动态码' : '2FA codes',
        quickQuery: isZh ? '查询 2FA 动态码' : 'Query a 2FA code',
        description: isZh
            ? '粘贴 Base32 密钥即可在本机生成验证码，密钥不会上传到服务器。'
            : 'Paste a Base32 secret to generate a code locally. The secret is never uploaded.',
        viewDescription: isZh ? '查看说明' : 'View details',
        hideDescription: isZh ? '收起说明' : 'Hide details',
        secret: isZh ? '2FA 密钥' : '2FA secret',
        secretPlaceholder: isZh ? '粘贴 Base32 密钥' : 'Paste a Base32 secret',
        paste: isZh ? '粘贴' : 'Paste',
        query: isZh ? '查询动态码' : 'Generate code',
        querying: isZh ? '生成中' : 'Generating',
        currentCode: isZh ? '当前动态码' : 'Current code',
        copy: isZh ? '复制' : 'Copy',
        save: isZh ? '保存到列表' : 'Save to list',
        seconds: isZh ? '秒' : 'sec',
        privacyTitle: isZh ? '数据与隐私' : 'Data and privacy',
        noDatabase: isZh ? '不写入服务器数据库' : 'Not written to the server database',
        noUpload: isZh ? '密钥不会上传到服务器' : 'Secrets are never uploaded',
        localGeneration: isZh ? '验证码只在当前浏览器生成' : 'Codes are generated in this browser',
        persistentLocal: isZh
            ? '默认临时使用；主动启用后才加密保存'
            : 'Temporary by default; encrypted saving is opt-in',
        expand: isZh ? '展开' : 'Expand',
        collapse: isZh ? '收起' : 'Collapse',
        publicDevice: isZh
            ? '临时账号在锁定或离开页面后清除。加密保存需要独立口令；请下载加密备份。解锁期间仍应防范恶意脚本和浏览器扩展，仅在可信设备上使用。'
            : 'Temporary accounts clear when locked or leaving the page. Encrypted saving requires a separate passphrase; download an encrypted backup. Malicious scripts or extensions can still read data while unlocked. Use a trusted device.',
        storageUnavailable: isZh
            ? '请先解锁已保存的账号；仍可临时查询验证码。'
            : 'Unlock saved accounts first. Temporary code queries remain available.',
        accountList: isZh ? '2FA 账号列表' : '2FA account list',
        batchImport: isZh ? '批量导入' : 'Bulk import',
        addAccount: isZh ? '添加账号' : 'Add account',
        projectName: isZh ? '项目名称' : 'Project name',
        update: isZh ? '保存修改' : 'Save changes',
        cancel: isZh ? '取消' : 'Cancel',
        batchFormat: isZh
            ? '每行格式：项目名称 | 2FA 密钥，也可每行只填一个密钥'
            : 'One per line: project name | 2FA secret, or one secret per line',
        batchPlaceholder: isZh
            ? '客服账号 01 | JBSWY3DPEHPK3PXP\nGEZDGNBVGY3TQOJQ'
            : 'Support account 01 | JBSWY3DPEHPK3PXP\nGEZDGNBVGY3TQOJQ',
        validRows: isZh ? '有效' : 'Valid',
        invalidRows: isZh ? '无效' : 'Invalid',
        line: isZh ? '第行' : 'Line',
        importAccounts: isZh ? '导入账号' : 'Import accounts',
        search: isZh ? '搜索项目名称' : 'Search project name',
        clearAll: isZh ? '清空全部' : 'Clear all',
        emptyTitle: isZh ? '还没有保存账号' : 'No saved accounts',
        emptyDescription: isZh
            ? '添加一个账号或批量导入密钥后，动态码会自动刷新。'
            : 'Add an account or import secrets to start generating codes.',
        noSearchResults: isZh ? '没有找到匹配的账号' : 'No matching accounts',
        dynamicCode: isZh ? '动态码' : 'Dynamic code',
        recentUse: isZh ? '最近使用' : 'Last used',
        reveal: isZh ? '显示密钥' : 'Show secret',
        hide: isZh ? '隐藏密钥' : 'Hide secret',
        more: isZh ? '更多' : 'More',
        moreActions: isZh ? '账号详情与操作' : 'Account details and actions',
        edit: isZh ? '编辑' : 'Edit',
        delete: isZh ? '删除' : 'Delete',
        neverUsed: isZh ? '尚未使用' : 'Not used yet',
        justNow: isZh ? '刚刚' : 'Just now',
        minutesAgo: isZh ? '分钟前' : 'minutes ago',
        hoursAgo: isZh ? '小时前' : 'hours ago',
        daysAgo: isZh ? '天前' : 'days ago',
        invalidSecret: isZh ? '请输入有效的 Base32 密钥' : 'Enter a valid Base32 secret',
        secretRequired: isZh ? '请输入 2FA 密钥' : 'Enter a 2FA secret',
        projectRequired: isZh ? '请输入项目名称' : 'Enter a project name',
        projectTooLong: isZh ? '项目名称不能超过 80 个字符' : 'Project name cannot exceed 80 characters',
        duplicateSecret: isZh ? '该 2FA 密钥已存在' : 'This 2FA secret already exists',
        inputTooLarge: isZh
            ? '输入过大：最多 64K 字符、200 行，每行最多 1024 字符'
            : 'Input too large: maximum 64K characters, 200 lines, 1024 characters per line',
        accountLimit: isZh ? '最多可保存 100 个账号' : 'You can save up to 100 accounts',
        pasteFailed: isZh ? '无法读取剪贴板，请手动粘贴' : 'Could not read the clipboard. Paste manually.',
        copied: isZh ? '动态码已复制' : 'Code copied',
        copyFailed: isZh ? '复制失败，请手动复制' : 'Could not copy the code',
        accountAdded: isZh ? '账号已添加' : 'Account added',
        accountUpdated: isZh ? '账号已更新' : 'Account updated',
        accountDeleted: isZh ? '账号已删除' : 'Account deleted',
        accountsImported: isZh ? '账号已导入' : 'Accounts imported',
        accountsCleared: isZh ? '所有账号已清空' : 'All accounts cleared',
        deleteConfirm: isZh ? '确定删除这个 2FA 账号吗？' : 'Delete this 2FA account?',
        confirmDelete: isZh ? '确认删除' : 'Confirm deletion',
        deleting: isZh ? '删除中…' : 'Deleting…',
        deleteFailed: isZh
            ? '删除未完成，请确认账号已解锁后重试。'
            : 'Deletion failed. Make sure the accounts are unlocked and retry.',
        clearConfirm: isZh
            ? '确定清空当前身份在此浏览器中保存的所有 2FA 账号吗？此操作不能撤销。'
            : 'Clear all 2FA accounts for the current identity in this browser? This cannot be undone.',
    } as const;
}
