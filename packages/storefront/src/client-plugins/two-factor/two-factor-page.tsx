/* eslint-disable max-len -- Bilingual customer-facing copy is intentionally kept next to the UI. */
import type { BatchImportErrorCode } from './batch-parser';
import type { TwoFactorAccount } from './types';
import type { ActiveCustomer, StorefrontLanguage } from '../../types';
import {
    Check,
    ClipboardPaste,
    Clock3,
    Copy,
    Eye,
    EyeOff,
    KeyRound,
    LockKeyhole,
    Pencil,
    Plus,
    Search,
    ShieldCheck,
    Trash2,
    Upload,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EmptyState, Subpage } from '../../storefront-ui/page-shell';

import { parseBatchImport } from './batch-parser';
import { clearSessionAccounts, loadSessionAccounts, saveSessionAccounts } from './session-storage';
import { formatTotpCode, generateTotp, getTotpSecondsRemaining, normalizeBase32Secret } from './totp';
import { MAX_TWO_FACTOR_ACCOUNTS } from './types';

interface TwoFactorPageProps {
    customer: ActiveCustomer | null;
    language: StorefrontLanguage;
    onBack: () => void;
    onSignIn: () => void;
    onNotify: (message: string) => void;
}

export function TwoFactorPage({
    customer,
    language,
    onBack,
    onSignIn,
    onNotify,
}: Readonly<TwoFactorPageProps>) {
    const isZh = language === 'zh';
    const ownerId = customer?.id ?? '';
    const loadedOwnerId = useRef('');
    const [now, setNow] = useState(() => Date.now());
    const [accounts, setAccounts] = useState<TwoFactorAccount[]>([]);
    const [codes, setCodes] = useState<Record<string, string>>({});
    const [storageAvailable, setStorageAvailable] = useState(true);
    const [quickInput, setQuickInput] = useState('');
    const [quickSecret, setQuickSecret] = useState<string | null>(null);
    const [quickCode, setQuickCode] = useState<string | null>(null);
    const [quickError, setQuickError] = useState('');
    const [querying, setQuerying] = useState(false);
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
        if (!ownerId) {
            loadedOwnerId.current = '';
            setAccounts([]);
            setCodes({});
            return;
        }
        if (loadedOwnerId.current === ownerId) return;
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

    const persistAccounts = useCallback(
        (nextAccounts: TwoFactorAccount[]): boolean => {
            if (!ownerId || !storageAvailable || !saveSessionAccounts(ownerId, nextAccounts)) {
                setStorageAvailable(false);
                onNotify(copy.storageUnavailable);
                return false;
            }
            setAccounts(nextAccounts);
            return true;
        },
        [copy.storageUnavailable, onNotify, ownerId, storageAvailable],
    );

    if (!customer) {
        return (
            <Subpage title={copy.title} language={language} onBack={onBack}>
                <EmptyState
                    icon={<KeyRound />}
                    title={copy.signInTitle}
                    detail={copy.signInDescription}
                    action={copy.signIn}
                    onAction={onSignIn}
                />
            </Subpage>
        );
    }

    const queryCode = async (event: FormEvent) => {
        event.preventDefault();
        setQuerying(true);
        setQuickError('');
        try {
            const secret = normalizeBase32Secret(quickInput);
            setQuickSecret(secret);
            setQuickCode(await generateTotp(secret));
            setNow(Date.now());
        } catch {
            setQuickSecret(null);
            setQuickCode(null);
            setQuickError(copy.invalidSecret);
        } finally {
            setQuerying(false);
        }
    };

    const pasteSecret = async () => {
        try {
            const value = await navigator.clipboard.readText();
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

    const saveAccount = (event: FormEvent) => {
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
        if (!persistAccounts(nextAccounts)) return;
        setShowAccountForm(false);
        setEditingId(null);
        onNotify(editingId ? copy.accountUpdated : copy.accountAdded);
    };

    const importAccounts = () => {
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
        if (!persistAccounts(nextAccounts)) return;
        setBatchInput('');
        setBatchValidated(false);
        setShowBatchImport(false);
        onNotify(copy.accountsImported);
    };

    const deleteAccount = (account: TwoFactorAccount) => {
        if (!window.confirm(copy.deleteConfirm)) return;
        if (persistAccounts(accounts.filter(item => item.id !== account.id))) onNotify(copy.accountDeleted);
    };

    const clearAll = () => {
        if (!window.confirm(copy.clearConfirm)) return;
        clearSessionAccounts(ownerId);
        setAccounts([]);
        setCodes({});
        onNotify(copy.accountsCleared);
    };

    const copyAccountCode = async (account: TwoFactorAccount) => {
        const code = codes[account.id];
        if (!code || !(await copyCode(code))) return;
        persistAccounts(
            accounts.map(item =>
                item.id === account.id ? { ...item, lastUsedAt: new Date().toISOString() } : item,
            ),
        );
    };

    return (
        <Subpage title={copy.title} language={language} onBack={onBack}>
            <div className="mx-auto grid w-full max-w-6xl gap-4 px-3 pb-10 pt-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.5fr)] lg:px-6">
                <section className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-cyan-50 p-4 shadow-sm lg:p-5">
                    <div className="flex items-start gap-3">
                        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-emerald-600 text-white">
                            <KeyRound className="size-5" aria-hidden="true" />
                        </span>
                        <div>
                            <h1 className="m-0 text-xl font-black text-slate-950">{copy.quickQuery}</h1>
                            <p className="mb-0 mt-1 text-sm leading-6 text-slate-600">{copy.description}</p>
                        </div>
                    </div>
                    <form className="mt-5 grid gap-3" onSubmit={event => void queryCode(event)}>
                        <label
                            className="grid gap-1.5 text-sm font-bold text-slate-800"
                            htmlFor="storefront-two-factor-secret"
                        >
                            {copy.secret}
                            <input
                                id="storefront-two-factor-secret"
                                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                                type="password"
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
                        </label>
                        {quickError ? (
                            <p className="m-0 text-sm font-semibold text-red-600" role="alert">
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
                        <div
                            className="mt-5 rounded-2xl border border-emerald-200 bg-white p-4"
                            aria-live="polite"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-4">
                                <div>
                                    <small className="font-bold text-slate-500">{copy.currentCode}</small>
                                    <p className="mb-0 mt-1 font-mono text-3xl font-black tracking-[0.16em] text-slate-950 sm:text-4xl">
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

                <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:p-5">
                    <div className="flex items-center gap-2">
                        <ShieldCheck className="size-5 text-emerald-600" aria-hidden="true" />
                        <h2 className="m-0 text-base font-black text-slate-950">{copy.privacyTitle}</h2>
                    </div>
                    <ul className="mb-0 mt-4 grid gap-3 p-0 text-sm leading-5 text-slate-600">
                        {[copy.noDatabase, copy.noUpload, copy.localGeneration, copy.sessionOnly].map(
                            item => (
                                <li className="flex list-none items-start gap-2" key={item}>
                                    <Check
                                        className="mt-0.5 size-4 shrink-0 text-emerald-600"
                                        aria-hidden="true"
                                    />
                                    {item}
                                </li>
                            ),
                        )}
                    </ul>
                    <p className="mb-0 mt-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                        <LockKeyhole className="mr-1 inline size-4 align-text-bottom" aria-hidden="true" />
                        {copy.publicDevice}
                    </p>
                    {!storageAvailable ? (
                        <p className="mb-0 mt-3 text-sm font-semibold text-red-600" role="alert">
                            {copy.storageUnavailable}
                        </p>
                    ) : null}
                </aside>

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2 lg:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <h2 className="m-0 text-lg font-black text-slate-950">{copy.accountList}</h2>
                            <p className="mb-0 mt-1 text-xs font-semibold text-slate-500">
                                {accounts.length} / {MAX_TWO_FACTOR_ACCOUNTS}
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button
                                className={secondaryButtonClass}
                                type="button"
                                disabled={!storageAvailable}
                                onClick={() => setShowBatchImport(value => !value)}
                            >
                                <Upload className="size-4" aria-hidden="true" />
                                {copy.batchImport}
                            </button>
                            <button
                                className={primaryButtonClass}
                                type="button"
                                disabled={!storageAvailable}
                                onClick={() => openAccountForm()}
                            >
                                <Plus className="size-4" aria-hidden="true" />
                                {copy.addAccount}
                            </button>
                        </div>
                    </div>

                    {showAccountForm ? (
                        <form
                            className="mt-4 grid gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 md:grid-cols-2"
                            onSubmit={saveAccount}
                        >
                            <label className="grid gap-1.5 text-sm font-bold text-slate-800">
                                {copy.projectName}
                                <input
                                    className={inputClass}
                                    maxLength={80}
                                    value={projectName}
                                    onChange={event => setProjectName(event.target.value)}
                                />
                            </label>
                            <label className="grid gap-1.5 text-sm font-bold text-slate-800">
                                {copy.secret}
                                <input
                                    className={`${inputClass} font-mono`}
                                    type="password"
                                    autoComplete="off"
                                    spellCheck={false}
                                    value={accountSecret}
                                    onChange={event => setAccountSecret(event.target.value)}
                                />
                            </label>
                            {accountError ? (
                                <p
                                    className="m-0 text-sm font-semibold text-red-600 md:col-span-2"
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
                                    onClick={() => setShowAccountForm(false)}
                                >
                                    {copy.cancel}
                                </button>
                            </div>
                        </form>
                    ) : null}

                    {showBatchImport ? (
                        <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50/50 p-4">
                            <label
                                className="grid gap-1.5 text-sm font-bold text-slate-800"
                                htmlFor="storefront-two-factor-batch"
                            >
                                {copy.batchFormat}
                                <textarea
                                    id="storefront-two-factor-batch"
                                    className={`${inputClass} min-h-36 resize-y font-mono`}
                                    value={batchInput}
                                    placeholder={copy.batchPlaceholder}
                                    onChange={event => {
                                        setBatchInput(event.target.value);
                                        setBatchValidated(false);
                                    }}
                                />
                            </label>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
                                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">
                                    {copy.validRows}: {batchResult.accounts.length}
                                </span>
                                <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-800">
                                    {copy.invalidRows}: {batchResult.errors.length}
                                </span>
                            </div>
                            {batchValidated && batchResult.errors.length ? (
                                <ul
                                    className="mb-0 mt-3 max-h-36 overflow-y-auto rounded-xl bg-red-50 p-3 text-sm text-red-700"
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
                                    onClick={importAccounts}
                                >
                                    {copy.importAccounts}
                                </button>
                                <button
                                    className={secondaryButtonClass}
                                    type="button"
                                    onClick={() => setShowBatchImport(false)}
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
                                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
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
                                className={`${secondaryButtonClass} text-red-600`}
                                type="button"
                                onClick={clearAll}
                            >
                                <Trash2 className="size-4" />
                                {copy.clearAll}
                            </button>
                        </div>
                    ) : null}

                    {!accounts.length ? (
                        <div className="mt-5 grid min-h-48 place-items-center rounded-2xl border border-dashed border-slate-300 p-6 text-center">
                            <div>
                                <KeyRound className="mx-auto size-8 text-slate-400" aria-hidden="true" />
                                <strong className="mt-3 block text-slate-900">{copy.emptyTitle}</strong>
                                <p className="mb-0 mt-1 text-sm text-slate-500">{copy.emptyDescription}</p>
                            </div>
                        </div>
                    ) : !visibleAccounts.length ? (
                        <p className="mt-5 rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">
                            {copy.noSearchResults}
                        </p>
                    ) : (
                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                            {visibleAccounts.map(account => {
                                const revealed = revealedIds.has(account.id);
                                const code = codes[account.id];
                                return (
                                    <article
                                        className="rounded-2xl border border-slate-200 p-4"
                                        key={account.id}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <h3 className="m-0 break-words text-base font-black text-slate-950">
                                                    {account.projectName}
                                                </h3>
                                                <code className="mt-1 block truncate text-xs text-slate-500">
                                                    {revealed ? account.secret : maskSecret(account.secret)}
                                                </code>
                                            </div>
                                            <button
                                                className={iconButtonClass}
                                                type="button"
                                                aria-label={revealed ? copy.hide : copy.reveal}
                                                onClick={() =>
                                                    setRevealedIds(current =>
                                                        toggleSetValue(current, account.id),
                                                    )
                                                }
                                            >
                                                {revealed ? (
                                                    <EyeOff className="size-4" />
                                                ) : (
                                                    <Eye className="size-4" />
                                                )}
                                            </button>
                                        </div>
                                        <div className="mt-4 rounded-xl bg-slate-50 p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <small className="font-bold text-slate-500">
                                                        {copy.dynamicCode}
                                                    </small>
                                                    <p className="mb-0 mt-1 font-mono text-2xl font-black tracking-[0.14em] text-slate-950">
                                                        {code ? formatTotpCode(code) : '--- ---'}
                                                    </p>
                                                </div>
                                                <button
                                                    className={secondaryButtonClass}
                                                    type="button"
                                                    disabled={!code}
                                                    onClick={() => void copyAccountCode(account)}
                                                >
                                                    <Copy className="size-4" />
                                                    {copy.copy}
                                                </button>
                                            </div>
                                            <Countdown seconds={secondsRemaining} label={copy.seconds} />
                                        </div>
                                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-xs text-slate-500">
                                                {copy.recentUse}:{' '}
                                                {formatRecentUse(account.lastUsedAt, now, copy)}
                                            </span>
                                            <div className="flex gap-1">
                                                <button
                                                    className={iconButtonClass}
                                                    type="button"
                                                    aria-label={copy.edit}
                                                    onClick={() => openAccountForm(account)}
                                                >
                                                    <Pencil className="size-4" />
                                                </button>
                                                <button
                                                    className={`${iconButtonClass} text-red-600`}
                                                    type="button"
                                                    aria-label={copy.delete}
                                                    onClick={() => deleteAccount(account)}
                                                >
                                                    <Trash2 className="size-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    )}
                </section>
            </div>
        </Subpage>
    );
}

const inputClass =
    'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100';
const primaryButtonClass =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';
const secondaryButtonClass =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-extrabold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const iconButtonClass =
    'inline-grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50';

function Countdown({ seconds, label }: Readonly<{ seconds: number; label: string }>) {
    return (
        <div className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-500">
            <Clock3 className="size-4" aria-hidden="true" />
            <span className="min-w-10 font-mono">
                {seconds} {label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                    style={{ width: `${(seconds / 30) * 100}%` }}
                />
            </div>
        </div>
    );
}

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
    }[code];
}

function copyFor(language: StorefrontLanguage) {
    const isZh = language === 'zh';
    return {
        title: isZh ? '2FA 动态码' : '2FA codes',
        signInTitle: isZh ? '登录后使用 2FA 工具' : 'Sign in to use the 2FA tool',
        signInDescription: isZh
            ? '登录后可在当前浏览器会话中查询和管理动态码。'
            : 'Sign in to query and manage codes in this browser session.',
        signIn: isZh ? '去登录' : 'Sign in',
        quickQuery: isZh ? '查询 2FA 动态码' : 'Query a 2FA code',
        description: isZh
            ? '粘贴 Base32 密钥即可在本机生成验证码，密钥不会上传到服务器。'
            : 'Paste a Base32 secret to generate a code locally. The secret is never uploaded.',
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
        sessionOnly: isZh ? '关闭标签页或退出登录后清除' : 'Cleared after closing the tab or signing out',
        publicDevice: isZh
            ? 'Session Storage 不额外加密密钥，请勿在公共或共享设备上使用。'
            : 'Session Storage does not add encryption. Do not use this tool on a public or shared device.',
        storageUnavailable: isZh
            ? '当前浏览器无法使用 Session Storage，仍可临时查询，但无法保存账号。'
            : 'Session Storage is unavailable. You can query a code but cannot save accounts.',
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
        clearConfirm: isZh
            ? '确定清空当前会话中的所有 2FA 账号吗？'
            : 'Clear all 2FA accounts in this session?',
    } as const;
}
