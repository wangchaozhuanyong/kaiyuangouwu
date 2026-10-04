/* eslint-disable import/order, max-len -- Bilingual copy and clean relative types are intentional. */
import { ChevronDown, Clipboard, Clock3, Search, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { SubHeader } from '../../storefront-ui/page-shell';

import type { IcloudQueryResult, ShopApi } from '../../api';
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
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [countdown, setCountdown] = useState(10);
    const [filterVirtualId, setFilterVirtualId] = useState('');
    const [copiedOtp, setCopiedOtp] = useState<string | null>(null);
    const [expandedMails, setExpandedMails] = useState<Set<string>>(new Set());

    const inputRef = useRef<HTMLInputElement>(null);
    const activeRequestRef = useRef<AbortController | null>(null);
    const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
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

            // Stop auto-refresh and abort pending requests
            if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
            }
            setAutoRefresh(false);
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

    const handleRefresh = useCallback(async () => {
        if (!currentQueryCode || activeRequestRef.current || refreshing) return;

        const controller = new AbortController();
        activeRequestRef.current = controller;
        setRefreshing(true);
        setRefreshError('');

        try {
            const data = await api.queryMails(currentQueryCode, controller.signal);
            if (controller.signal.aborted) return;

            if (data.success) {
                setResult(data);
                setRefreshError('');
            } else {
                setAutoRefresh(false);
                setRefreshError(data.message || (isZh ? '邮件查询未成功，请稍后重试。' : 'Refresh failed'));
            }
        } catch (err: unknown) {
            if (controller.signal.aborted) return;
            setAutoRefresh(false);
            const errMessage =
                err instanceof Error
                    ? err.message
                    : isZh
                      ? '网络连接失败，请检查网络后重试。'
                      : 'Network error';
            setRefreshError(
                `${errMessage} ${isZh ? '当前保留上次查询结果。' : 'Retaining previous results.'}`,
            );
        } finally {
            if (activeRequestRef.current === controller) {
                activeRequestRef.current = null;
                setRefreshing(false);
            }
        }
    }, [api, currentQueryCode, isZh, refreshing]);

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
        if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
        }
        setAutoRefresh(false);
        if (activeRequestRef.current) {
            activeRequestRef.current.abort();
        }
        setResult(null);
        setCurrentQueryCode('');
        setRefreshError('');
    }, []);

    // Auto-refresh timer effect
    useEffect(() => {
        if (!autoRefresh || !result) {
            if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
            }
            return;
        }

        setCountdown(10);
        countdownTimerRef.current = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    void handleRefresh();
                    return 10;
                }
                return prev - 1;
            });
        }, 1000);

        return () => {
            if (countdownTimerRef.current) {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
            }
        };
    }, [autoRefresh, handleRefresh, result]);

    // Initial mount query (initialCode or URL params)
    useEffect(() => {
        let code = initialCode;
        if (!code && typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search);
            code = urlParams.get('code') || urlParams.get('q') || undefined;
        }
        if (code) {
            const cleaned = cleanCode(code);
            if (cleaned) {
                setInputCode(cleaned);
                void executeQuery(cleaned);
            }
        }
    }, [executeQuery, initialCode]);

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
                                <div className="auto-refresh-box">
                                    <span>{isZh ? '自动刷新' : 'Auto Refresh'}</span>
                                    <label className="switch-toggle">
                                        <input
                                            type="checkbox"
                                            id="autoRefreshToggle"
                                            checked={autoRefresh}
                                            onChange={e => setAutoRefresh(e.target.checked)}
                                        />
                                        <span className="slider"></span>
                                    </label>
                                    <span
                                        id="countdownText"
                                        style={{
                                            fontSize: 'var(--type-meta-size)',
                                            lineHeight: 'var(--type-meta-leading)',
                                            color: 'var(--primary)',
                                            minWidth: 24,
                                        }}
                                    >
                                        {autoRefresh ? `${countdown}s` : ''}
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
                                            void handleRefresh();
                                        }}
                                    >
                                        <span>🔄</span>{' '}
                                        {refreshing
                                            ? isZh
                                                ? '正在刷新...'
                                                : 'Refreshing...'
                                            : isZh
                                              ? '立即刷新'
                                              : 'Refresh'}
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
                                                ? '请稍后刷新；如确认邮箱已有邮件，请联系商家核对同步与邮件归属。'
                                                : 'Please refresh shortly. If you are sure mails were sent, contact support.'}
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
                                                    void handleRefresh();
                                                }}
                                            >
                                                🔄 {isZh ? '检查新邮件' : 'Check New Mails'}
                                            </button>
                                            {!autoRefresh ? (
                                                <button
                                                    type="button"
                                                    className="empty-autorefresh-btn"
                                                    id="emptyAutoRefreshBtn"
                                                    onClick={() => setAutoRefresh(true)}
                                                >
                                                    ⚡ {isZh ? '开启自动刷新' : 'Enable Auto Refresh'}
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
                                    ? '邮件到达并同步后即可查看。查询后可使用“立即刷新”或开启自动刷新。'
                                    : 'Emails appear after delivery and synchronization. Refresh the results manually or turn on auto refresh.'}
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
