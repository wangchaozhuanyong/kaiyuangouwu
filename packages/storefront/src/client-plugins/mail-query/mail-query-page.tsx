/* eslint-disable import/order, max-len -- Bilingual copy and clean relative types are intentional. */
import { ChevronDown, Clipboard, Clock3, Search, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { SubHeader } from '../../storefront-ui/page-shell';

import type { IcloudQueryResult, ShopApi } from '../../api';
import type { MailStreamStatus } from '../../api/mail-events';
import type { RouteState } from '../../storefront-router';
import type { StorefrontLanguage } from '../../types';

import './mail-query.css';

const STORAGE_KEY = 'icloud_relay_recent_queries';
const storageKeyForIdentity = (marketCode: string, customerId?: string | null) =>
    `${STORAGE_KEY}:${encodeURIComponent(marketCode)}:${customerId ? `customer:${encodeURIComponent(customerId)}` : 'guest'}`;

export interface RecentQueryRecord {
    code: string;
    targetType?: string;
    aliasEmail?: string;
    totalEmails?: number;
    updatedAt: number;
}

export function cleanCode(str: string): string {
    if (!str) return '';
    const match = str.match(/(?:BUY|MSTR)-[A-Za-z0-9]{3,8}-[A-Za-z0-9]{3,8}/i);
    if (match) return match[0].toUpperCase();
    return str
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '');
}

function loadRecentQueries(storageKey: string): RecentQueryRecord[] {
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        void e;
        return [];
    }
}

function saveRecentQueries(storageKey: string, records: RecentQueryRecord[]): void {
    try {
        localStorage.setItem(storageKey, JSON.stringify(records.slice(0, 6)));
    } catch (e) {
        void e;
    }
}

function formatTime(isoOrTimestamp: string | number, isZh: boolean): string {
    if (!isoOrTimestamp) return '';
    const d = new Date(isoOrTimestamp);
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 30) return isZh ? '刚刚' : 'Just now';
    if (diff < 60) return isZh ? `${diff}秒前` : `${diff}s ago`;
    if (diff < 3600) return isZh ? `${Math.floor(diff / 60)}分钟前` : `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return isZh ? `${Math.floor(diff / 3600)}小时前` : `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return isZh ? `${Math.floor(diff / 86400)}天前` : `${Math.floor(diff / 86400)}d ago`;
    return (
        d.toLocaleDateString(isZh ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit' }) +
        ' ' +
        d.toLocaleTimeString(isZh ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    );
}

interface ToastState {
    type: 'error' | 'warning' | 'success' | 'info';
    title: string;
    message: string;
    action?: 'paste' | 'clear' | 'retry';
}

export interface MailQueryPageProps {
    api: ShopApi;
    marketCode: string;
    customerId?: string | null;
    brandingName?: string;
    language?: StorefrontLanguage;
    onBack?: () => void;
    onNavigate?: (route: RouteState) => void;
    onNotify?: (message: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
    initialCode?: string;
}

export function MailQueryPage({
    api,
    marketCode,
    customerId,
    language = 'zh',
    onBack,
    onNavigate,
    initialCode,
}: Readonly<MailQueryPageProps>) {
    const isZh = language === 'zh';
    const storageKey = storageKeyForIdentity(marketCode, customerId);

    const [inputCode, setInputCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [shakeInput, setShakeInput] = useState(false);
    const [toast, setToast] = useState<ToastState | null>(null);
    const [recentQueries, setRecentQueries] = useState<RecentQueryRecord[]>(() =>
        loadRecentQueries(storageKey),
    );

    const [result, setResult] = useState<IcloudQueryResult | null>(null);
    const [currentQueryCode, setCurrentQueryCode] = useState('');
    const [refreshError, setRefreshError] = useState('');
    const [liveEnabled, setLiveEnabled] = useState(false);
    const [streamStatus, setStreamStatus] = useState<MailStreamStatus>('paused');
    const [filterVirtualId, setFilterVirtualId] = useState('');
    const [copiedOtp, setCopiedOtp] = useState<string | null>(null);
    const [expandedMails, setExpandedMails] = useState<Set<string>>(new Set());

    const inputRef = useRef<HTMLInputElement>(null);
    const activeRequestRef = useRef<AbortController | null>(null);
    const streamRef = useRef<AbortController | null>(null);
    const refreshPromiseRef = useRef<Promise<void> | null>(null);
    const refreshPendingRef = useRef(false);
    const generationRef = useRef(0);
    const initialQueryRef = useRef('');
    const identityRef = useRef(storageKey);
    const isZhRef = useRef(isZh);
    isZhRef.current = isZh;
    const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const reactId = useId();

    const triggerShake = useCallback(() => {
        setShakeInput(false);
        if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
        shakeTimeoutRef.current = setTimeout(() => setShakeInput(true), 10);
    }, []);

    useEffect(() => {
        return () => {
            if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
            if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
            if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
            generationRef.current++;
            streamRef.current?.abort();
            if (activeRequestRef.current) activeRequestRef.current.abort();
        };
    }, []);

    const showToast = useCallback(
        (type: ToastState['type'], title: string, message: string, action?: ToastState['action']) => {
            setToast({ type, title, message, action });
            if (type === 'error' || type === 'warning') {
                triggerShake();
            }
        },
        [triggerShake],
    );

    const handleBackClick = useCallback(() => {
        if (onBack) {
            onBack();
        } else if (onNavigate) {
            onNavigate({ name: 'services' });
        } else {
            window.location.href = '/services';
        }
    }, [onBack, onNavigate]);

    const handleClear = useCallback(() => {
        setInputCode('');
        setToast(null);
        if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
        setShakeInput(false);
        inputRef.current?.focus();
    }, []);

    const executeQuery = useCallback(
        async (rawCode: string) => {
            const code = cleanCode(rawCode);
            if (!code) {
                showToast(
                    'error',
                    isZh ? '⚠️ 请输入专属查询码' : '⚠️ Enter Query Code',
                    isZh
                        ? '请输入专属查询码。查询码通常由商家在商品发货卡密中提供（例如 BUY-XXXX-XXXX）。若已复制，可直接点击下方粘贴。'
                        : 'Please enter your query code (e.g. BUY-XXXX-XXXX). You can paste from clipboard directly.',
                    'paste',
                );
                inputRef.current?.focus();
                return;
            }

            if (code.length < 5) {
                showToast(
                    'warning',
                    isZh ? '⚠️ 查询码格式似乎不完整' : '⚠️ Code Incomplete',
                    isZh
                        ? `您输入的查询码字符较短（仅 ${code.length} 位）。完整查询码通常形如 BUY-A1B2-C3D4，请确认是否复制完整。`
                        : `Code is too short (${code.length} chars). Valid format is usually BUY-A1B2-C3D4.`,
                    'paste',
                );
                inputRef.current?.focus();
                return;
            }

            generationRef.current++;
            streamRef.current?.abort();
            refreshPendingRef.current = false;
            refreshPromiseRef.current = null;
            setLiveEnabled(false);
            setRefreshing(false);
            if (activeRequestRef.current) {
                activeRequestRef.current.abort();
            }

            const controller = new AbortController();
            activeRequestRef.current = controller;
            setLoading(true);
            setToast(null);
            if (shakeTimeoutRef.current) clearTimeout(shakeTimeoutRef.current);
            setShakeInput(false);
            setRefreshError('');
            setInputCode(code);

            try {
                const data = await api.queryMails(code, controller.signal);
                if (controller.signal.aborted) return;

                if (!data.success) {
                    showToast(
                        'error',
                        isZh ? '查询未完成' : 'Query Failed',
                        data.message ||
                            (isZh ? '邮件查询未成功，请稍后重试。' : 'Mail query failed, please try again.'),
                        'retry',
                    );
                    return;
                }

                setCurrentQueryCode(code);
                setResult(data);
                setFilterVirtualId('');
                setExpandedMails(new Set());
                setLiveEnabled(true);

                // Update recent queries
                const newRecord: RecentQueryRecord = {
                    code,
                    targetType: data.targetType,
                    aliasEmail: data.aliasEmail || data.primaryEmail || '',
                    totalEmails: data.totalEmails || 0,
                    updatedAt: Date.now(),
                };
                setRecentQueries(prev => {
                    const next = [newRecord, ...prev.filter(item => item.code !== code)].slice(0, 6);
                    saveRecentQueries(storageKey, next);
                    return next;
                });
            } catch (err: unknown) {
                if (controller.signal.aborted) return;
                const errMessage =
                    err instanceof Error
                        ? err.message
                        : isZh
                          ? '网络连接失败，请检查网络后重试。'
                          : 'Network error';
                showToast('error', isZh ? '查询未完成' : 'Query Failed', errMessage, 'retry');
            } finally {
                if (activeRequestRef.current === controller) {
                    activeRequestRef.current = null;
                    setLoading(false);
                }
            }
        },
        [api, isZh, showToast, storageKey],
    );

    // Manual and event reads share one request. Events arriving during a read cause
    // one follow-up read; they never reset the user's filters or expanded messages.
    const handleRefresh = useCallback(
        (fromEvent = false): Promise<void> => {
            if (!currentQueryCode) return Promise.resolve();
            if (refreshPromiseRef.current) {
                if (fromEvent) refreshPendingRef.current = true;
                return refreshPromiseRef.current;
            }
            if (activeRequestRef.current) return Promise.resolve();
            const generation = generationRef.current;
            const controller = new AbortController();
            activeRequestRef.current = controller;
            setRefreshing(true);
            setRefreshError('');
            const work = (async () => {
                try {
                    do {
                        refreshPendingRef.current = false;
                        const data = await api.queryMails(currentQueryCode, controller.signal);
                        if (controller.signal.aborted || generation !== generationRef.current) return;
                        if (!data.success) {
                            setLiveEnabled(false);
                            setStreamStatus('denied');
                            setResult(null);
                            setCurrentQueryCode('');
                            showToast(
                                'error',
                                isZh ? '查询授权已失效' : 'Mail access expired',
                                data.message ||
                                    (isZh
                                        ? '请使用有效查询码重新查询。'
                                        : 'Please enter a valid query code.'),
                            );
                            return;
                        }
                        setResult(data);
                        setRefreshError('');
                    } while (refreshPendingRef.current && !controller.signal.aborted);
                } catch (err: unknown) {
                    if (controller.signal.aborted || generation !== generationRef.current) return;
                    const message =
                        err instanceof Error ? err.message : isZh ? '网络连接失败' : 'Network error';
                    setRefreshError(
                        `${message} ${isZh ? '当前保留上次查询结果。' : 'Retaining previous results.'}`,
                    );
                    // The stream reconnects with backoff and reconciles again after a failed read.
                    throw err;
                } finally {
                    if (activeRequestRef.current === controller) {
                        activeRequestRef.current = null;
                        refreshPromiseRef.current = null;
                        setRefreshing(false);
                    }
                }
            })();
            refreshPromiseRef.current = work;
            return work;
        },
        [api, currentQueryCode, isZh, showToast],
    );
    const refreshRef = useRef(handleRefresh);
    refreshRef.current = handleRefresh;

    const handlePaste = useCallback(async () => {
        try {
            if (!navigator.clipboard || !navigator.clipboard.readText) {
                inputRef.current?.focus();
                showToast(
                    'info',
                    isZh ? '请手动粘贴' : 'Paste manually',
                    isZh
                        ? '浏览器无法读取剪贴板，请在查询码输入框中粘贴。'
                        : 'Clipboard access is unavailable. Paste into the query code field.',
                );
                return;
            }

            const text = await navigator.clipboard.readText();
            if (!text || !text.trim()) {
                showToast(
                    'info',
                    isZh ? 'ℹ️ 剪贴板为空' : 'ℹ️ Clipboard Empty',
                    isZh
                        ? '剪贴板中未找到文本内容，请先复制查询码'
                        : 'No text in clipboard. Please copy your query code first.',
                );
                return;
            }

            const cleaned = cleanCode(text);
            if (!cleaned) {
                showToast(
                    'warning',
                    isZh ? '⚠️ 未识别到查询码' : '⚠️ No Code Found',
                    isZh
                        ? '剪贴板内容中未识别到有效查询码'
                        : 'Could not identify a valid query code from clipboard.',
                );
                return;
            }

            setInputCode(cleaned);
            showToast(
                'success',
                isZh ? '✓ 粘贴成功' : '✓ Pasted',
                isZh ? '已成功粘贴查询码 ✓' : 'Query code pasted successfully ✓',
            );
            if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
            toastTimeoutRef.current = setTimeout(() => {
                setToast(null);
            }, 2000);
        } catch {
            inputRef.current?.focus();
            showToast(
                'info',
                isZh ? '请手动粘贴' : 'Paste manually',
                isZh
                    ? '剪贴板读取未获允许，请在查询码输入框中粘贴。'
                    : 'Clipboard access was denied. Paste into the query code field.',
            );
        }
    }, [isZh, showToast]);

    const handleCopyOtp = useCallback(async (code: string) => {
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(code);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = code;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            setCopiedOtp(code);
            if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
            copiedTimeoutRef.current = setTimeout(() => setCopiedOtp(null), 2000);
        } catch {
            setCopiedOtp(code);
            if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
            copiedTimeoutRef.current = setTimeout(() => setCopiedOtp(null), 2000);
        }
    }, []);

    const toggleExpandMail = useCallback((id: string) => {
        setExpandedMails(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleDeleteRecent = useCallback(
        (e: React.MouseEvent, code: string) => {
            e.stopPropagation();
            setRecentQueries(prev => {
                const next = prev.filter(item => item.code !== code);
                saveRecentQueries(storageKey, next);
                return next;
            });
        },
        [storageKey],
    );

    const handleClearAllHistory = useCallback(() => {
        try {
            localStorage.removeItem(storageKey);
        } catch (e) {
            void e;
        }
        setRecentQueries([]);
    }, [storageKey]);

    const handleBackToQueryForm = useCallback(() => {
        generationRef.current++;
        streamRef.current?.abort();
        activeRequestRef.current?.abort();
        activeRequestRef.current = null;
        refreshPromiseRef.current = null;
        refreshPendingRef.current = false;
        setLiveEnabled(false);
        setLoading(false);
        setRefreshing(false);
        setResult(null);
        setCurrentQueryCode('');
        setRefreshError('');
    }, []);

    useEffect(() => {
        if (identityRef.current === storageKey) return;
        identityRef.current = storageKey;
        handleBackToQueryForm();
        setInputCode('');
        setRecentQueries(loadRecentQueries(storageKey));
    }, [storageKey, handleBackToQueryForm]);

    useEffect(() => {
        if (!liveEnabled || !currentQueryCode) {
            setStreamStatus(status => (status === 'denied' ? status : 'paused'));
            return;
        }
        const controller = new AbortController();
        streamRef.current = controller;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let waiting: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
        // Coalesce only notifications already received. No fixed refresh timer exists.
        const changed = () =>
            new Promise<void>((resolve, reject) => {
                if (controller.signal.aborted) {
                    resolve();
                    return;
                }
                waiting.push({ resolve, reject });
                if (timer) return;
                timer = setTimeout(() => {
                    timer = undefined;
                    const batch = waiting;
                    waiting = [];
                    if (controller.signal.aborted) {
                        batch.forEach(item => item.resolve());
                        return;
                    }
                    void refreshRef.current(true).then(
                        () => batch.forEach(item => item.resolve()),
                        error => batch.forEach(item => item.reject(error)),
                    );
                }, 100);
            });
        if (typeof api.watchMailEvents !== 'function') {
            setStreamStatus('unavailable');
            return;
        }
        void api
            .watchMailEvents(
                currentQueryCode,
                {
                    onChange: changed,
                    onStatus: status => {
                        if (controller.signal.aborted) return;
                        setStreamStatus(status);
                        if (status === 'denied') {
                            handleBackToQueryForm();
                            showToast(
                                'error',
                                isZhRef.current ? '查询授权已失效' : 'Mail access expired',
                                isZhRef.current
                                    ? '请使用有效查询码重新查询。'
                                    : 'Please enter a valid query code.',
                            );
                        }
                    },
                },
                controller.signal,
            )
            .catch(() => {
                if (!controller.signal.aborted) setStreamStatus('unavailable');
            });
        return () => {
            controller.abort();
            if (timer) clearTimeout(timer);
            waiting.forEach(item => item.resolve());
            if (streamRef.current === controller) streamRef.current = null;
        };
    }, [api, currentQueryCode, liveEnabled, storageKey, handleBackToQueryForm, showToast]);

    // Initial mount query (initialCode or URL params)
    useEffect(() => {
        let code = initialCode;
        if (!code && typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            code = urlParams.get('code') || urlParams.get('q') || undefined;
        }
        if (code) {
            const cleaned = cleanCode(code);
            const key = `${storageKey}:${cleaned}`;
            if (cleaned && initialQueryRef.current !== key) {
                initialQueryRef.current = key;
                setInputCode(cleaned);
                void executeQuery(cleaned);
            }
        }
    }, [executeQuery, initialCode, storageKey]);

    // Mails list filtering
    const mails = result?.items ?? [];
    const virtualList = result?.virtualEmailsList ?? [];
    const filteredMails = filterVirtualId
        ? mails.filter(m => String(m.virtualEmailId) === filterVirtualId)
        : mails;

    return (
        <main className="page subpage mail-query-page" aria-label={isZh ? '邮箱查询服务' : 'Email lookup'}>
            <SubHeader
                title={isZh ? '邮箱查询服务' : 'Email lookup'}
                language={language}
                onBack={handleBackClick}
            />
            <div className="subpage-body mail-query-layout">
                <div className="mail-query-workspace">
                    {/* Query Form Card */}
                    {!result ? (
                        <>
                            <div className="query-card" id="queryCard">
                                <label className="card-label" htmlFor="codeInput">
                                    {isZh ? '专属查询码' : 'Query code'}
                                </label>
                                <p className="query-description" id="queryDescription">
                                    {isZh
                                        ? '输入查询码，查看邮件和验证码。'
                                        : 'Enter your query code to view emails and verification codes.'}
                                </p>
                                <div className="mail-query-controls">
                                    <div
                                        className={`input-wrapper ${shakeInput ? 'has-error' : ''}`}
                                        id="inputWrapper"
                                    >
                                        <Search className="input-icon" aria-hidden="true" />
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            id="codeInput"
                                            className="code-input"
                                            placeholder={isZh ? '输入或粘贴查询码' : 'Enter query code'}
                                            aria-describedby="queryDescription"
                                            aria-invalid={toast?.type === 'error' || undefined}
                                            maxLength={25}
                                            autoComplete="off"
                                            spellCheck={false}
                                            value={inputCode}
                                            readOnly={loading}
                                            onChange={e => {
                                                setInputCode(cleanCode(e.target.value));
                                                setToast(null);
                                                setShakeInput(false);
                                            }}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    void executeQuery(inputCode);
                                                }
                                            }}
                                        />
                                        <div className="input-actions">
                                            <button
                                                type="button"
                                                className="paste-btn"
                                                id="pasteBtn"
                                                title={isZh ? '从剪贴板粘贴' : 'Paste from clipboard'}
                                                onClick={() => {
                                                    void handlePaste();
                                                }}
                                            >
                                                <Clipboard aria-hidden="true" />
                                                <span>{isZh ? '粘贴' : 'Paste'}</span>
                                            </button>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="query-btn"
                                        id="queryBtn"
                                        disabled={loading}
                                        onClick={() => {
                                            void executeQuery(inputCode);
                                        }}
                                    >
                                        {loading ? (
                                            <>
                                                <span className="btn-spinner"></span>
                                                <span>{isZh ? '正在查询邮件...' : 'Querying mails...'}</span>
                                            </>
                                        ) : (
                                            <span>{isZh ? '查询邮件' : 'Look up emails'}</span>
                                        )}
                                    </button>
                                </div>
                                {/* Toast Message */}
                                {toast ? (
                                    <div className={`toast-msg ${toast.type}`} id="msgBox" role="status">
                                        <div className="msg-header">{toast.title}</div>
                                        <div className="msg-body">{toast.message}</div>
                                        {toast.action ? (
                                            <div className="msg-actions">
                                                {toast.action === 'paste' ? (
                                                    <button
                                                        type="button"
                                                        className="msg-action-btn btn-secondary"
                                                        onClick={() => {
                                                            void handlePaste();
                                                        }}
                                                    >
                                                        📋 {isZh ? '从剪贴板粘贴' : 'Paste from clipboard'}
                                                    </button>
                                                ) : null}
                                                {toast.action === 'clear' ? (
                                                    <button
                                                        type="button"
                                                        className="msg-action-btn btn-secondary"
                                                        onClick={handleClear}
                                                    >
                                                        {isZh ? '清空重输' : 'Clear'}
                                                    </button>
                                                ) : null}
                                                {toast.action === 'retry' ? (
                                                    <button
                                                        type="button"
                                                        className="msg-action-btn btn-secondary"
                                                        onClick={() => {
                                                            void executeQuery(inputCode);
                                                        }}
                                                    >
                                                        🔄 {isZh ? '立即重试' : 'Retry'}
                                                    </button>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>

                            {/* Recent Queries Section */}
                            {recentQueries.length > 0 ? (
                                <section className="recent-section" id="recentSection">
                                    <div className="mail-query-section-header">
                                        <div className="mail-query-section-title">
                                            <Clock3 aria-hidden="true" />{' '}
                                            {isZh ? '最近查询记录' : 'Recent Queries'}
                                        </div>
                                        <button
                                            type="button"
                                            className="clear-all-link"
                                            id="clearAllHistoryBtn"
                                            onClick={handleClearAllHistory}
                                        >
                                            {isZh ? '清空记录' : 'Clear all'}
                                        </button>
                                    </div>
                                    <div className="recent-list" id="recentList">
                                        {recentQueries.map(item => (
                                            <div
                                                key={item.code}
                                                className="recent-item"
                                                data-code={item.code}
                                            >
                                                <button
                                                    type="button"
                                                    className="recent-open"
                                                    disabled={loading}
                                                    onClick={() => {
                                                        setInputCode(item.code);
                                                        void executeQuery(item.code);
                                                    }}
                                                >
                                                    <span className="recent-code">{item.code}</span>
                                                    <span className="recent-meta">
                                                        {item.aliasEmail ? (
                                                            <span className="recent-alias">
                                                                {item.aliasEmail}
                                                            </span>
                                                        ) : null}
                                                        <span className="recent-time">
                                                            {formatTime(item.updatedAt, isZh)}
                                                        </span>
                                                    </span>
                                                </button>
                                                <button
                                                    type="button"
                                                    className="recent-del-btn"
                                                    aria-label={isZh ? '删除记录' : 'Delete record'}
                                                    onClick={e => handleDeleteRecent(e, item.code)}
                                                >
                                                    <X aria-hidden="true" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            ) : null}
                        </>
                    ) : (
                        /* Results View */
                        <section className="result-section" id="resultSection">
                            <div className="result-nav-bar">
                                <button
                                    type="button"
                                    className="back-query-btn"
                                    id="backQueryBtn"
                                    onClick={handleBackToQueryForm}
                                >
                                    <span>←</span> {isZh ? '重新查询' : 'New Query'}
                                </button>
                                <div className="mail-live-controls">
                                    <span>{isZh ? '实时收信' : 'Live updates'}</span>
                                    <label className="switch-toggle">
                                        <input
                                            type="checkbox"
                                            id="liveUpdatesToggle"
                                            aria-label={isZh ? '实时收信' : 'Live updates'}
                                            checked={liveEnabled}
                                            onChange={e => setLiveEnabled(e.target.checked)}
                                        />
                                        <span className="slider"></span>
                                    </label>
                                    <span className="mail-stream-status type-meta" role="status">
                                        {streamStatus === 'live'
                                            ? isZh
                                                ? '已连接'
                                                : 'Connected'
                                            : streamStatus === 'connecting'
                                              ? isZh
                                                  ? '连接中'
                                                  : 'Connecting'
                                              : streamStatus === 'reconnecting'
                                                ? isZh
                                                    ? '正在重连'
                                                    : 'Reconnecting'
                                                : streamStatus === 'unavailable'
                                                  ? isZh
                                                      ? '实时收信不可用，请手动刷新结果'
                                                      : 'Live updates unavailable. Refresh results manually.'
                                                  : streamStatus === 'denied'
                                                    ? isZh
                                                        ? '授权已失效'
                                                        : 'Access expired'
                                                    : isZh
                                                      ? '已暂停'
                                                      : 'Paused'}
                                    </span>
                                </div>
                            </div>

                            {/* Summary Card */}
                            <div className="result-summary-card">
                                <div className="summary-header">
                                    <div className="summary-email" id="summaryEmail">
                                        <span>
                                            {result.aliasEmail ||
                                                result.primaryEmail ||
                                                (isZh ? 'iCloud 邮箱' : 'iCloud Mail')}
                                        </span>
                                        {result.targetType === 'PRIMARY' ? (
                                            <span className="code-type-pill pill-master">
                                                {isZh ? '主管理码' : 'Master'}
                                            </span>
                                        ) : (
                                            <span className="code-type-pill pill-buyer">
                                                {isZh ? '买家专属' : 'Buyer'}
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        className="refresh-now-btn"
                                        id="refreshNowBtn"
                                        disabled={refreshing}
                                        onClick={() => {
                                            void handleRefresh().catch(() => undefined);
                                        }}
                                    >
                                        <span>🔄</span>{' '}
                                        {refreshing
                                            ? isZh
                                                ? '正在刷新...'
                                                : 'Refreshing...'
                                            : isZh
                                              ? '刷新收件结果'
                                              : 'Refresh results'}
                                    </button>
                                </div>
                                <div className="summary-stats">
                                    <div className="summary-stat-item">
                                        <span>📧</span>
                                        <span id="totalMailCount">
                                            {result.targetType === 'PRIMARY'
                                                ? isZh
                                                    ? `共 ${result.totalEmails || 0} 封邮件`
                                                    : `Total ${result.totalEmails || 0} mails`
                                                : isZh
                                                  ? `最近 ${result.totalEmails || 0} 封邮件，最多显示 5 封`
                                                  : `Recent ${result.totalEmails || 0} mails (up to 5)`}
                                        </span>
                                    </div>
                                    {mails.length > 0 ? (
                                        <div className="summary-stat-item">
                                            <Clock3 size={14} aria-hidden="true" />
                                            <span>
                                                {isZh ? '最新收件：' : 'Latest received: '}
                                                {formatTime(
                                                    mails.reduce(
                                                        (latest, mail) =>
                                                            new Date(mail.receivedAt) > new Date(latest)
                                                                ? mail.receivedAt
                                                                : latest,
                                                        mails[0].receivedAt,
                                                    ),
                                                    isZh,
                                                )}
                                            </span>
                                        </div>
                                    ) : null}
                                    {result.remainingDays != null ? (
                                        <div className="summary-stat-item" id="remainingDaysBox">
                                            <span>⏳</span>
                                            <span id="remainingDaysText">
                                                {isZh
                                                    ? `有效期剩余 ${result.remainingDays} 天`
                                                    : `${result.remainingDays} days remaining`}
                                            </span>
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            {/* Refresh Error Banner */}
                            {refreshError ? (
                                <div
                                    id="refreshStatus"
                                    className="toast-msg error"
                                    role="status"
                                    aria-live="polite"
                                    style={{ marginBottom: 16 }}
                                >
                                    {refreshError}
                                </div>
                            ) : null}

                            {/* Filter Bar (Master query mode) */}
                            {virtualList.length > 0 ? (
                                <div className="filter-wrapper" id="filterWrapper">
                                    <select
                                        id="filterSelect"
                                        className="filter-select"
                                        value={filterVirtualId}
                                        onChange={e => setFilterVirtualId(e.target.value)}
                                    >
                                        <option value="">
                                            {isZh
                                                ? `全部虚拟邮箱 (${mails.length} 封邮件)`
                                                : `All Virtual Mails (${mails.length})`}
                                        </option>
                                        {virtualList.map(v => (
                                            <option key={v.id} value={String(v.id)}>
                                                {v.aliasEmail} {v.note ? `(${v.note})` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ) : null}

                            {/* Mail Cards List */}
                            <div className="mail-list" id="mailList">
                                {filteredMails.length === 0 ? (
                                    <div className="empty-mail-box">
                                        <div className="empty-icon">📭</div>
                                        <div className="empty-title">
                                            {isZh
                                                ? '暂未查询到此邮箱的邮件'
                                                : 'No mails found for this address'}
                                        </div>
                                        <div className="empty-desc">
                                            {isZh
                                                ? '实时收信连接后，新邮件会自动显示。手动刷新仅更新已同步的收件结果。'
                                                : 'New mail appears when live updates are connected. Manual refresh reads already synced results.'}
                                        </div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                justifyContent: 'center',
                                                gap: 10,
                                                marginTop: 16,
                                                flexWrap: 'wrap',
                                            }}
                                        >
                                            <button
                                                type="button"
                                                className="refresh-now-btn"
                                                id="emptyRefreshBtn"
                                                style={{ margin: 0 }}
                                                onClick={() => {
                                                    void handleRefresh().catch(() => undefined);
                                                }}
                                            >
                                                🔄 {isZh ? '刷新收件结果' : 'Refresh results'}
                                            </button>
                                            {!liveEnabled ? (
                                                <button
                                                    type="button"
                                                    className="empty-autorefresh-btn"
                                                    id="emptyAutoRefreshBtn"
                                                    onClick={() => setLiveEnabled(true)}
                                                >
                                                    ⚡ {isZh ? '开启实时收信' : 'Enable live updates'}
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                ) : (
                                    filteredMails.map((mail, idx) => {
                                        const isExpanded = expandedMails.has(mail.id);
                                        return (
                                            <div
                                                key={mail.id}
                                                className={`mail-card ${isExpanded ? 'open' : ''}`}
                                                id={`mailCard_${idx}`}
                                            >
                                                {mail.extractedCode ? (
                                                    <div className="otp-banner">
                                                        <div className="otp-info">
                                                            <span className="otp-title">
                                                                🔑{' '}
                                                                {isZh
                                                                    ? '提取到的验证码'
                                                                    : 'Verification Code'}
                                                            </span>
                                                            <span className="otp-code-text">
                                                                {mail.extractedCode}
                                                            </span>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            className={`otp-copy-btn ${copiedOtp === mail.extractedCode ? 'copied' : ''}`}
                                                            onClick={() => {
                                                                void handleCopyOtp(mail.extractedCode || '');
                                                            }}
                                                        >
                                                            {copiedOtp === mail.extractedCode
                                                                ? isZh
                                                                    ? '已复制 ✓'
                                                                    : 'Copied ✓'
                                                                : isZh
                                                                  ? '一键复制'
                                                                  : 'Copy'}
                                                        </button>
                                                    </div>
                                                ) : null}

                                                <div className="mail-meta-row">
                                                    <span className="mail-from">
                                                        📤{' '}
                                                        {mail.fromName ||
                                                            mail.fromAddress ||
                                                            (isZh ? '未知发件人' : 'Unknown Sender')}
                                                    </span>
                                                    <span>{formatTime(mail.receivedAt, isZh)}</span>
                                                </div>
                                                <div className="mail-subject">
                                                    {mail.subject || (isZh ? '(无主题)' : '(No subject)')}
                                                </div>

                                                <button
                                                    type="button"
                                                    className="toggle-body-btn"
                                                    onClick={() => toggleExpandMail(mail.id)}
                                                >
                                                    <span>
                                                        {isExpanded
                                                            ? isZh
                                                                ? '收起正文 ▲'
                                                                : 'Hide content ▲'
                                                            : isZh
                                                              ? '查看邮件正文 ▼'
                                                              : 'View mail content ▼'}
                                                    </span>
                                                </button>

                                                {isExpanded ? (
                                                    <div className="mail-body-content" id={`mailBody_${idx}`}>
                                                        {mail.bodyHtml ? (
                                                            <iframe
                                                                title={`mail-body-${mail.id}-${reactId}`}
                                                                className="mail-iframe"
                                                                srcDoc={mail.bodyHtml}
                                                                sandbox="allow-same-origin"
                                                            />
                                                        ) : (
                                                            <pre>
                                                                {mail.bodyText ||
                                                                    (isZh
                                                                        ? '(此邮件无正文内容)'
                                                                        : '(No content)')}
                                                            </pre>
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </section>
                    )}
                </div>
                <aside className="faq-section" aria-labelledby="mailQueryHelpTitle">
                    <h2 className="mail-query-section-title" id="mailQueryHelpTitle">
                        {isZh ? '查询帮助' : 'Lookup help'}
                    </h2>
                    <div className="faq-list">
                        <details className="faq-item">
                            <summary className="faq-q">
                                {isZh ? '查询码在哪里？' : 'Where is my query code?'}
                                <ChevronDown aria-hidden="true" />
                            </summary>
                            <p className="faq-a">
                                {isZh
                                    ? '可在订单详情、发货卡密或商家发送的凭据中找到，支持买家查询码和主查询码。'
                                    : 'Find it in your order details or delivery message. Buyer and master query codes are supported.'}
                            </p>
                        </details>
                        <details className="faq-item">
                            <summary className="faq-q">
                                {isZh ? '多久能收到邮件？' : 'When will emails arrive?'}
                                <ChevronDown aria-hidden="true" />
                            </summary>
                            <p className="faq-a">
                                {isZh
                                    ? '邮件同步后会通过实时收信自动显示。“刷新收件结果”只更新已同步的邮件。'
                                    : 'Live updates show newly synced mail automatically. Refresh results reads already synced mail.'}
                            </p>
                        </details>
                        <details className="faq-item">
                            <summary className="faq-q">
                                {isZh ? '没有收到邮件怎么办？' : 'What if no email arrives?'}
                                <ChevronDown aria-hidden="true" />
                            </summary>
                            <p className="faq-a">
                                {isZh
                                    ? '确认收件邮箱与查询码绑定的邮箱一致，等待 1–2 分钟后刷新。仍未收到时可联系客服。'
                                    : 'Check that the recipient matches the email linked to your code, then wait 1–2 minutes and refresh. Contact support if needed.'}
                            </p>
                        </details>
                    </div>
                    <a
                        className="mail-query-support"
                        href="/support"
                        onClick={e => {
                            if (onNavigate) {
                                e.preventDefault();
                                onNavigate({ name: 'support' });
                            }
                        }}
                    >
                        {isZh ? '联系客服' : 'Contact support'}
                    </a>
                </aside>
            </div>
        </main>
    );
}
