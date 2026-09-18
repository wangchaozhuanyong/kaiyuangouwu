import { Check, CircleAlert, Copy, KeyRound, Mail, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import './mail-query.css';

import { type IcloudMailItem, type IcloudQueryResult, type ShopApi } from '../../api';
import { EmptyState, Subpage } from '../../storefront-ui/page-shell';
import { type StorefrontLanguage } from '../../types';

interface MailQueryPageProps {
    api: ShopApi;
    language: StorefrontLanguage;
    onBack: () => void;
    onNotify: (message: string) => void;
}

const RECENT_KEY = 'icloud_recent_queries';
const COUNTDOWN_INITIAL = 15;

export function MailQueryPage({ api, language, onBack, onNotify }: Readonly<MailQueryPageProps>) {
    const isZh = language === 'zh';
    const [queryCode, setQueryCode] = useState(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            return (params.get('code') || '').trim().toUpperCase();
        }
        return '';
    });
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState<IcloudQueryResult | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [countdown, setCountdown] = useState(COUNTDOWN_INITIAL);
    const [expandedMails, setExpandedMails] = useState<Set<string>>(() => new Set());
    const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const activeRequestRef = useRef<AbortController | null>(null);

    const executeQuery = useCallback(
        async (code: string, isRefresh = false) => {
            const trimmed = code.trim().toUpperCase();
            if (!trimmed) {
                setError(isZh ? '请输入买家专属查询码' : 'Please enter your query code');
                return;
            }
            setError('');
            if (isRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            if (activeRequestRef.current) {
                activeRequestRef.current.abort();
            }
            const controller = new AbortController();
            activeRequestRef.current = controller;

            try {
                const res = await api.queryMails(trimmed, controller.signal);
                if (!res.success) {
                    setError(res.message || (isZh ? '查询未完成，请检查查询码是否正确' : 'Query failed'));
                    setResult(null);
                } else {
                    setResult(res);
                    // Save to localStorage history
                    try {
                        const stored = localStorage.getItem(RECENT_KEY);
                        const list = stored ? JSON.parse(stored) : [];
                        const filtered = list.filter((item: any) => item.code !== trimmed);
                        filtered.unshift({
                            code: trimmed,
                            aliasEmail: res.aliasEmail || res.primaryEmail || '',
                            totalEmails: res.totalEmails,
                            updatedAt: Date.now(),
                        });
                        localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, 10)));
                    } catch {
                        // Ignore storage error
                    }
                }
            } catch (err: any) {
                if (!controller.signal.aborted) {
                    setError(err?.message || (isZh ? '网络请求失败，请稍后重试' : 'Network error'));
                }
            } finally {
                if (activeRequestRef.current === controller) {
                    activeRequestRef.current = null;
                }
                setLoading(false);
                setRefreshing(false);
            }
        },
        [api, isZh],
    );

    // Initial query on mount if queryCode was in URL
    useEffect(() => {
        if (queryCode) {
            void executeQuery(queryCode);
        }
    }, []);

    // Auto-refresh countdown
    useEffect(() => {
        if (!autoRefresh || !result?.success || !queryCode) {
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
            return;
        }
        setCountdown(COUNTDOWN_INITIAL);
        countdownTimerRef.current = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    void executeQuery(queryCode, true);
                    return COUNTDOWN_INITIAL;
                }
                return prev - 1;
            });
        }, 1000);

        return () => {
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        };
    }, [autoRefresh, result?.success, queryCode, executeQuery]);

    const handleCopy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            onNotify(isZh ? '验证码已复制到剪贴板' : 'Code copied to clipboard');
            setTimeout(() => setCopiedId(null), 2000);
        } catch {
            onNotify(isZh ? '复制失败，请长按手动复制' : 'Copy failed, please copy manually');
        }
    };

    const toggleExpand = (id: string) => {
        setExpandedMails(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <Subpage title={isZh ? '邮件验证码查询' : 'Mail Verification'} language={language} onBack={onBack}>
            <div className="mail-query-shell">
                {/* Search Bar */}
                <div className="mail-query-search-card">
                    <label htmlFor="mail-query-input" className="mail-query-search-label">
                        {isZh ? '买家专属查询码' : 'Buyer Query Code'}
                    </label>
                    <div className="mail-query-input-wrap">
                        <input
                            id="mail-query-input"
                            type="text"
                            className="mail-query-input"
                            placeholder={isZh ? '输入 6-32 位专属查询码' : 'Enter 6-32 char query code'}
                            value={queryCode}
                            maxLength={32}
                            autoCapitalize="characters"
                            autoCorrect="off"
                            spellCheck={false}
                            onChange={e => {
                                setQueryCode(e.target.value.toUpperCase());
                                setError('');
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void executeQuery(queryCode);
                                }
                            }}
                        />
                        {queryCode ? (
                            <button
                                type="button"
                                className="mail-query-clear-btn"
                                aria-label={isZh ? '清空输入' : 'Clear'}
                                onClick={() => {
                                    setQueryCode('');
                                    setResult(null);
                                    setError('');
                                }}
                            >
                                <X size={16} />
                            </button>
                        ) : null}
                    </div>

                    <div className="mail-query-actions">
                        <button
                            type="button"
                            className="mail-query-btn"
                            disabled={loading || !queryCode.trim()}
                            onClick={() => void executeQuery(queryCode)}
                        >
                            {loading ? (
                                <>
                                    <RefreshCw className="animate-spin" size={16} />
                                    <span>{isZh ? '正在查询…' : 'Querying…'}</span>
                                </>
                            ) : (
                                <>
                                    <Search size={16} />
                                    <span>{isZh ? '查询邮件与验证码' : 'Search Mails'}</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {/* Error Banner */}
                {error ? (
                    <EmptyState
                        icon={<CircleAlert />}
                        title={isZh ? '查询未完成' : 'Query Failed'}
                        detail={error}
                        action={isZh ? '重新查询' : 'Retry'}
                        onAction={() => void executeQuery(queryCode)}
                    />
                ) : null}

                {/* Result Section */}
                {result && result.success ? (
                    <>
                        <div className="mail-query-info-card">
                            <div className="mail-query-info-header">
                                <span>{result.aliasEmail || result.primaryEmail}</span>
                                <span className="mail-query-info-badge">
                                    <ShieldCheck size={14} style={{ marginRight: 4 }} />
                                    {result.targetType === 'VIRTUAL'
                                        ? isZh
                                            ? '专属虚拟邮箱'
                                            : 'Virtual Mailbox'
                                        : isZh
                                          ? '中继主邮箱'
                                          : 'Primary Mailbox'}
                                </span>
                            </div>
                            <div>
                                {isZh
                                    ? `有效期限：剩余 ${result.remainingDays ?? 0} 天 · 共接收 ${result.totalEmails} 封邮件`
                                    : `Expires in ${result.remainingDays ?? 0} days · ${result.totalEmails} mails received`}
                            </div>

                            <div className="mail-query-controls">
                                <label className="mail-query-refresh-toggle">
                                    <input
                                        type="checkbox"
                                        checked={autoRefresh}
                                        onChange={e => setAutoRefresh(e.target.checked)}
                                    />
                                    <span>
                                        {isZh ? '自动刷新' : 'Auto refresh'}
                                        {autoRefresh ? ` (${countdown}s)` : ''}
                                    </span>
                                </label>
                                <button
                                    type="button"
                                    className="mail-query-refresh-btn"
                                    disabled={refreshing}
                                    onClick={() => void executeQuery(queryCode, true)}
                                >
                                    <RefreshCw className={refreshing ? 'animate-spin' : ''} size={14} />
                                    <span>
                                        {refreshing
                                            ? isZh
                                                ? '刷新中'
                                                : 'Refreshing'
                                            : isZh
                                              ? '立即刷新'
                                              : 'Refresh'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* Mail List */}
                        {result.items.length === 0 ? (
                            <EmptyState
                                icon={<Mail />}
                                title={isZh ? '暂未收到邮件' : 'No Mails Yet'}
                                detail={
                                    isZh
                                        ? '邮件发送后通常在 10-60 秒内到达，请开启自动刷新或稍后重试。'
                                        : 'Mails usually arrive within 10-60 seconds. Enable auto refresh or check back soon.'
                                }
                            />
                        ) : (
                            result.items.map((mail: IcloudMailItem) => {
                                const isExpanded = expandedMails.has(mail.id);
                                return (
                                    <div key={mail.id} className="mail-item-card">
                                        <div className="mail-item-top">
                                            <span className="mail-item-from">
                                                {mail.fromName || mail.fromAddress}
                                            </span>
                                            <span className="mail-item-date">
                                                {new Date(mail.receivedAt).toLocaleTimeString(undefined, {
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    second: '2-digit',
                                                })}
                                            </span>
                                        </div>

                                        <div className="mail-item-subject">
                                            {mail.subject || (isZh ? '(无主题)' : '(No subject)')}
                                        </div>

                                        {/* OTP Highlight Box */}
                                        {mail.extractedCode ? (
                                            <div className="mail-item-code-box">
                                                <div className="mail-item-code-label">
                                                    <KeyRound size={16} />
                                                    <span>
                                                        {isZh ? '提取到的验证码' : 'Verification Code'}
                                                    </span>
                                                </div>
                                                <div className="mail-item-code-value">
                                                    {mail.extractedCode}
                                                </div>
                                                <button
                                                    type="button"
                                                    className="mail-item-copy-btn"
                                                    onClick={() =>
                                                        void handleCopy(mail.extractedCode || '', mail.id)
                                                    }
                                                >
                                                    {copiedId === mail.id ? (
                                                        <Check size={14} />
                                                    ) : (
                                                        <Copy size={14} />
                                                    )}
                                                    <span>
                                                        {copiedId === mail.id
                                                            ? isZh
                                                                ? '已复制'
                                                                : 'Copied'
                                                            : isZh
                                                              ? '复制'
                                                              : 'Copy'}
                                                    </span>
                                                </button>
                                            </div>
                                        ) : null}

                                        {/* Expandable Body */}
                                        {mail.bodyText ? (
                                            <>
                                                <button
                                                    type="button"
                                                    style={{
                                                        alignSelf: 'flex-start',
                                                        background: 'none',
                                                        border: 'none',
                                                        color: 'var(--text-secondary, #64748b)',
                                                        fontSize: 12,
                                                        cursor: 'pointer',
                                                        padding: 0,
                                                        textDecoration: 'underline',
                                                    }}
                                                    onClick={() => toggleExpand(mail.id)}
                                                >
                                                    {isExpanded
                                                        ? isZh
                                                            ? '收起邮件正文'
                                                            : 'Hide mail content'
                                                        : isZh
                                                          ? '查看邮件正文'
                                                          : 'Show mail content'}
                                                </button>
                                                {isExpanded ? (
                                                    <div className="mail-item-body">{mail.bodyText}</div>
                                                ) : null}
                                            </>
                                        ) : null}
                                    </div>
                                );
                            })
                        )}
                    </>
                ) : !error && !loading ? (
                    <EmptyState
                        icon={<Mail />}
                        title={isZh ? '实时查询接收的验证码' : 'Realtime Verification Codes'}
                        detail={
                            isZh
                                ? '输入商家或平台为您分配的专属查询码，即可实时接收验证码与邮件。'
                                : 'Enter the query code provided by the store to view your incoming verification codes and emails.'
                        }
                    />
                ) : null}
            </div>
        </Subpage>
    );
}
