import {
    ArrowRight,
    Check,
    CheckCheck,
    ChevronDown,
    CircleAlert,
    Copy as CopyIcon,
    Info,
    LoaderCircle,
    RotateCcw,
    ScanLine,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
    LocalePreferencesSheet,
    LocalePreferencesTrigger,
} from '../../src/components/common/locale-preferences';
import { useStorefrontBrandColors } from '../../src/hooks/useStorefrontDocument';
import { OverlayHost } from '../../src/overlay-host';
import { SubHeader, SubpageBody } from '../../src/storefront-ui/page-shell';
import '../../src/styles.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/desktop-pages.css';
import '../../src/styles/locale-preferences.css';
import '../../src/styles/subpage-content.css';
import '../../src/styles/visual-presets.css';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';

import { diagnose, type PreviewNetwork, sampleNetwork, scanFeedback } from './design-diagnostics';
import {
    checkFollowUp,
    checks,
    type Copy,
    faqs,
    type IconName,
    sampleFor,
    scenarios,
    scoreContributions,
} from './design-model';
import './design.css';
import './preview.css';

const parameters = new URLSearchParams(location.search);
const initialScenario = scenarios.find(item => item.id === parameters.get('scenario'))?.id ?? 'typical';
const sampleIp = '198.51.100.24'; // RFC 5737 documentation address, never a visitor address.
const sampleV6 = '2001:db8:1234:5678:90ab:cdef:1234:5678';
const timing = [160, 160, 160, 420, 260, 180, 180, 140, 140, 160, 140, 140];

function ColorIcon({ name, small = false }: { name: IconName; small?: boolean }) {
    const paths: Record<IconName, ReactNode> = {
        globe: (
            <>
                <circle cx="12" cy="12" r="9" fill="currentColor" opacity=".12" />
                <circle cx="12" cy="12" r="9" />
                <ellipse cx="12" cy="12" rx="4" ry="9" />
                <path d="M3 12h18M5 7h14M5 17h14" />
            </>
        ),
        location: (
            <>
                <path fill="currentColor" opacity=".15" d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 0 1 14 0Z" />
                <path d="M19 9c0 5-7 12-7 12S5 14 5 9a7 7 0 0 1 14 0Z" />
                <circle cx="12" cy="9" r="2.5" />
            </>
        ),
        clock: (
            <>
                <circle cx="12" cy="12" r="9" fill="currentColor" opacity=".14" />
                <circle cx="12" cy="12" r="9" />
                <path d="M12 6v6l4 2M8 2h8" />
            </>
        ),
        language: (
            <>
                <rect x="2" y="4" width="13" height="13" rx="3" fill="currentColor" opacity=".13" />
                <path d="M3 5h12M9 2v3M6 8c1 4 3 6 7 8M12 5c0 5-3 9-8 12M14 21l4-10 4 10M15.5 18h5" />
            </>
        ),
        font: (
            <>
                <rect x="2" y="3" width="20" height="18" rx="3" fill="currentColor" opacity=".12" />
                <path d="M4 17 8 7l4 10M5.5 14h5M16 11c6-2 6 8 0 6-3-1-1-4 5-4M21 11v7" />
            </>
        ),
        device: (
            <>
                <rect x="3" y="3" width="18" height="13" rx="2" fill="currentColor" opacity=".16" />
                <rect x="3" y="3" width="18" height="13" rx="2" />
                <path d="M8 21h8M12 16v5M8 7h8M8 10h4" />
            </>
        ),
        browser: (
            <>
                <rect x="2" y="3" width="20" height="18" rx="3" fill="currentColor" opacity=".12" />
                <rect x="2" y="3" width="20" height="18" rx="3" />
                <path d="M2 9h20M6 6h.01M10 6h.01M9 13l-3 3 3 2M15 13l3 3-3 2" />
            </>
        ),
        sparkle: (
            <>
                <path fill="currentColor" opacity=".18" d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />
                <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />
            </>
        ),
        shield: (
            <>
                <path fill="currentColor" opacity=".13" d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z" />
                <path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z" />
                <path d="m8 12 3 3 5-6" />
            </>
        ),
        network: (
            <>
                <rect x="7" y="2" width="10" height="6" rx="2" fill="currentColor" opacity=".18" />
                <rect x="7" y="2" width="10" height="6" rx="2" />
                <path d="M12 8v5M4 17v-4h16v4" />
                <rect x="1" y="17" width="6" height="5" rx="1" />
                <rect x="9" y="17" width="6" height="5" rx="1" />
                <rect x="17" y="17" width="6" height="5" rx="1" />
            </>
        ),
    };
    return (
        <svg
            className={`design-color-icon tone-${name}${small ? ' is-small' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {paths[name]}
        </svg>
    );
}

function delay(milliseconds: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        signal.throwIfAborted();
        const abort = () => {
            clearTimeout(timer);
            reject(new DOMException('Cancelled', 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
        }, milliseconds);
        signal.addEventListener('abort', abort, { once: true });
    });
}

function DesignPreview() {
    const [language, setLanguage] = useState<'zh' | 'en'>(parameters.get('lang') === 'en' ? 'en' : 'zh');
    const zh = language === 'zh';
    const t = (cn: string, en: string) => (zh ? cn : en);
    const copy = (value: Copy) => value[zh ? 0 : 1];
    const scenario = initialScenario;
    const preset = parameters.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
    useStorefrontBrandColors(undefined, preset);
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [retryingCheck, setRetryingCheck] = useState<number | null>(null);
    const [completed, setCompleted] = useState(0);
    const [report, setReport] = useState<ReturnType<typeof sampleFor> | null>(null);
    const [networkState, setNetworkState] = useState<'idle' | 'pending' | 'ready' | 'error'>('idle');
    const [networkReport, setNetworkReport] = useState<PreviewNetwork | null>(null);
    const [feedback, setFeedback] = useState<Copy | null>(null);
    const previousScore = useRef<number | null>(null);
    const [checkedAt, setCheckedAt] = useState<Date | null>(null);
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [copied, setCopied] = useState(false);
    const [copyError, setCopyError] = useState(false);
    const lock = useRef(false);
    const controller = useRef<AbortController | null>(null);
    const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sample = sampleFor(scenario);
    const networkBusy = networkState === 'pending';
    const running = busy || networkBusy || retryingCheck !== null;
    const score = report?.score ?? null;
    const level = score === null ? 'idle' : score <= 30 ? 'low' : score <= 60 ? 'medium' : 'high';
    const failureReason = scenario === 'quota' ? 'quota' : 'timeout';
    const findings = diagnose(report, networkState, networkReport, failureReason);
    const networkFindings = findings.filter(finding => finding.scope === 'network');
    const networkDone = networkState === 'ready' || networkState === 'error';
    const percent = retryingCheck !== null ? 0 : Math.round(((completed + Number(networkDone)) / 13) * 100);
    const current = checks[retryingCheck ?? Math.min(completed, 11)];
    const formattedTime = (value: Date) =>
        value.toLocaleTimeString(zh ? 'zh-CN' : 'en-GB', { hour12: false });
    const ip = parameters.has('ipv6') ? sampleV6 : sampleIp;
    const networkHigh = (networkReport?.score ?? 0) >= 70;
    const networkLow = networkReport?.low ?? false;
    const netScore = networkReport?.score ?? null;

    useEffect(() => applyStorefrontVisualPreset(document.documentElement, preset), [preset]);
    useEffect(() => {
        document.documentElement.lang = zh ? 'zh-CN' : 'en';
        document.title = t('环境监测 · 交互设计预览', 'Environment monitor · Interactive design preview');
    }, [language]);
    useEffect(
        () => () => {
            controller.current?.abort();
            if (copyTimer.current) clearTimeout(copyTimer.current);
        },
        [],
    );

    const lookupNetwork = async (request: AbortController, retry = false) => {
        setNetworkState('pending');
        await delay(scenario === 'slow' ? 6500 : 1750, request.signal);
        if ((scenario === 'partial' || scenario === 'quota') && !retry) {
            setNetworkState('error');
            return { state: 'error' as const, report: networkReport };
        } else {
            const next = sampleNetwork(scenario);
            setNetworkReport(next);
            setNetworkState('ready');
            return { state: 'ready' as const, report: next };
        }
    };
    const start = async () => {
        if (lock.current) return;
        lock.current = true;
        const request = new AbortController();
        controller.current = request;
        previousScore.current = report?.score ?? null;
        const earlierFindings = report ? findings : null;
        setBusy(true);
        setFeedback(null);
        setCompleted(0);
        try {
            const local = async () => {
                // Explicitly simulated task durations for reviewing the design, never a real detector.
                for (let index = 0; index < checks.length; index++) {
                    await delay(timing[index], request.signal);
                    setCompleted(index + 1);
                }
                setReport(sample);
                return sample;
            };
            const [nextLocal, nextNetwork] = await Promise.all([local(), lookupNetwork(request)]);
            request.signal.throwIfAborted();
            setCheckedAt(new Date());
            setFeedback(
                scanFeedback(
                    earlierFindings,
                    diagnose(nextLocal, nextNetwork.state, nextNetwork.report, failureReason),
                ),
            );
        } catch (error) {
            if (!request.signal.aborted) setNetworkState('error');
        } finally {
            if (!request.signal.aborted) {
                lock.current = false;
                setBusy(false);
            }
        }
    };
    const retryNetwork = async () => {
        if (lock.current) return;
        lock.current = true;
        const request = new AbortController();
        controller.current = request;
        try {
            const next = await lookupNetwork(request, true);
            request.signal.throwIfAborted();
            setFeedback(scanFeedback(findings, diagnose(report, next.state, next.report, failureReason)));
        } catch {
            if (!request.signal.aborted) setNetworkState('error');
        } finally {
            if (!request.signal.aborted) lock.current = false;
        }
    };
    const retrySignal = async (index: number) => {
        if (lock.current || !report) return;
        lock.current = true;
        const request = new AbortController();
        controller.current = request;
        setRetryingCheck(index);
        try {
            await delay(800, request.signal);
            const recovered = sampleFor('typical');
            setReport(previous => {
                if (!previous) return previous;
                const ratios = [...previous.ratios];
                const values = [...previous.values];
                ratios[index] = recovered.ratios[index];
                values[index] = recovered.values[index];
                return { ...previous, values, ratios, ...scoreContributions(ratios) };
            });
            setFeedback([
                `${checks[index].title[0]}读取已更新，请核对本项采集值；其他结果保留。`,
                `${checks[index].title[1]} reading updated. Review its observed value; other results are retained.`,
            ]);
        } catch {
            if (!request.signal.aborted)
                setFeedback([
                    '此项仍无法读取，请查看本项建议后再试。',
                    'This item is still unavailable. Review its guidance before retrying.',
                ]);
            // Keep the unavailable value if the preview is cancelled or the retry fails.
        } finally {
            if (!request.signal.aborted) {
                lock.current = false;
                setRetryingCheck(null);
            }
        }
    };
    const copyIp = async () => {
        setCopyError(false);
        try {
            await navigator.clipboard.writeText(ip);
            setCopied(true);
            if (copyTimer.current) clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopyError(true);
        }
    };
    const statusLabel = (index: number) => {
        if (retryingCheck === index) return t('检查中', 'Checking');
        if (busy && index === completed) return t('检查中', 'Checking');
        if (busy && index > completed)
            return report ? t('等待更新', 'Waiting to update') : t('等待检查', 'Waiting');
        if (!report && completed <= index) return t('待检测', 'Not checked');
        const ratio = (busy ? sample : (report ?? sample)).ratios[index];
        if (ratio === null) return t('无法读取', 'Unavailable');
        if (!checks[index].weight) return t('信息项', 'Information');
        const finding = findings.find(item => item.related.includes(checks[index].id));
        if (finding)
            return finding.kind === 'optimization'
                ? t('建议优化', 'Review options')
                : t('按需检查', 'Check if needed');
        return ratio > 0 ? t('区域线索', 'Regional signal') : t('未检出', 'No match');
    };
    const checkState = (index: number) => {
        if (retryingCheck === index) return 'checking';
        if (busy && completed === index) return 'checking';
        if ((!report && completed <= index) || (busy && index > completed)) return 'waiting';
        const ratio = (busy ? sample : (report ?? sample)).ratios[index];
        if (ratio === null) return 'unavailable';
        if (!checks[index].weight) return 'info';
        if (findings.some(finding => finding.related.includes(checks[index].id))) return 'note';
        return ratio > 0 ? 'info' : 'pass';
    };
    const networkValue = (value: ReactNode) =>
        networkReport ? (
            value
        ) : (
            <span className={networkBusy ? 'design-placeholder is-loading' : 'design-placeholder'}>
                {networkBusy
                    ? t('查询中', 'Looking up')
                    : networkState === 'error'
                      ? t('暂不可用', 'Unavailable')
                      : t('尚未检测', 'Not checked')}
            </span>
        );
    const dataRows: Array<{ icon: IconName; label: string; value: ReactNode }> = [
        {
            icon: 'location',
            label: t('网络位置', 'Location'),
            value: (
                <>
                    {networkLow ? '🇺🇸' : '🇲🇾'}{' '}
                    {networkLow
                        ? t('美国 · 纽约', 'United States · New York')
                        : t('马来西亚 · 吉隆坡', 'Malaysia · Kuala Lumpur')}
                </>
            ),
        },
        {
            icon: 'network',
            label: t('IP 地址', 'IP address'),
            value: (
                <span className="design-ip-value">
                    <code>{ip}</code>
                    <button
                        type="button"
                        className="design-copy"
                        aria-label={t('复制完整 IP 地址', 'Copy full IP address')}
                        onClick={() => void copyIp()}
                    >
                        {copied ? <CheckCheck /> : <CopyIcon />}
                    </button>
                </span>
            ),
        },
        {
            icon: 'network',
            label: t('运营商', 'Network operator'),
            value: t('示例宽带运营商', 'Example Broadband Network'),
        },
        { icon: 'browser', label: t('网络编号', 'ASN'), value: <code>AS64500</code> },
        {
            icon: 'clock',
            label: t('IP 时区', 'IP timezone'),
            value: <code>{networkReport?.timezone ?? t('未知', 'Unknown')}</code>,
        },
        {
            icon: 'clock',
            label: t('当地时间', 'Local time'),
            value: (
                <>
                    {networkReport?.utcOffset == null
                        ? t('未知', 'Unknown')
                        : networkLow
                          ? '09:30 (UTC−4)'
                          : '13:30 (UTC+8)'}
                </>
            ),
        },
        {
            icon: 'location',
            label: t('邮政编码', 'Postal code'),
            value: <code>{networkLow ? '10001' : '50000'}</code>,
        },
        {
            icon: 'globe',
            label: t('近似坐标', 'Approx. coordinates'),
            value: <code>{networkLow ? '40.713, −74.006' : '3.139, 101.687'}</code>,
        },
        {
            icon: 'language',
            label: t('浏览器语言', 'Browser language'),
            value: networkLow
                ? t('英语（en-US）', 'English (en-US)')
                : t('简体中文（zh-CN）', 'Simplified Chinese (zh-CN)'),
        },
    ];
    return (
        <OverlayHost ownerKey="environment-monitor-design">
            <div className="storefront-app desktop-store-layout">
                <div className="desktop-shell-frame">
                    <div id="storefront-content">
                        <details className="environment-test-notice type-meta">
                            <summary>{t('设计预览 · 示例数据', 'Design preview · Sample data')}</summary>
                            <p>
                                {t(
                                    '全部检测值均为示例，不查询公网 IP 或修改设备设置。',
                                    'All values are samples. This preview does not query a public IP or change device settings.',
                                )}
                            </p>
                        </details>
                        <main
                            className="page subpage design-monitor"
                            data-scenario={scenario}
                            data-running={running}
                        >
                            <SubHeader
                                title={t('环境监测', 'Environment monitor')}
                                language={language}
                                backLabel={t('返回上一层', 'Back')}
                                onBack={() => {
                                    location.href = '/e2e/environment-monitor/';
                                }}
                                action={
                                    <LocalePreferencesTrigger
                                        language={language}
                                        currencyCode="MYR"
                                        expanded={preferencesOpen}
                                        onClick={() => setPreferencesOpen(true)}
                                    />
                                }
                            />
                            <SubpageBody className="design-body">
                                <section
                                    className="design-overview"
                                    aria-label={t('环境检测总览', 'Environment check overview')}
                                >
                                    <section
                                        className={`design-scan level-${level}`}
                                        aria-labelledby="design-scan-title"
                                        aria-busy={running}
                                    >
                                        <div className="design-scan-heading">
                                            <h2 id="design-scan-title" className="type-section">
                                                <ColorIcon name="shield" />
                                                {t('环境检测报告', 'Environment report')}
                                            </h2>
                                            <span className="type-meta">
                                                {t('12 项信号 · 10 项评分', '12 signals · 10 scored')}
                                            </span>
                                        </div>
                                        <div className={`design-gauge${running ? ' is-running' : ''}`}>
                                            <svg viewBox="0 0 200 200" aria-hidden="true">
                                                <circle
                                                    className="design-gauge-track"
                                                    cx="100"
                                                    cy="100"
                                                    r="86"
                                                />
                                                <circle
                                                    className="design-gauge-fill"
                                                    cx="100"
                                                    cy="100"
                                                    r="86"
                                                    pathLength="100"
                                                    strokeDasharray={`${running ? percent : (score ?? 0)} 100`}
                                                />
                                            </svg>
                                            <div className="design-gauge-value">
                                                <span className="type-helper">
                                                    {running
                                                        ? t('检测进度', 'Progress')
                                                        : t(
                                                              '环境风险参考分',
                                                              'Environment risk reference score',
                                                          )}
                                                </span>
                                                <strong className="environment-metric">
                                                    {running ? percent : (score ?? '—')}
                                                    <small className="type-helper">
                                                        {running ? '%' : score !== null ? '/ 100' : ''}
                                                    </small>
                                                </strong>
                                                <span
                                                    className={`design-gauge-status type-helper ${running ? 'is-pending' : 'is-signal'}`}
                                                >
                                                    {running ? (
                                                        <LoaderCircle className="design-spinner" />
                                                    ) : score !== null ? (
                                                        <CheckCheck />
                                                    ) : null}
                                                    {running
                                                        ? t('检查中', 'Checking')
                                                        : score === null
                                                          ? report
                                                              ? t('信号不完整', 'Incomplete signals')
                                                              : t('等待开始', 'Ready when you are')
                                                          : level === 'low'
                                                            ? t('区域特征较少', 'Fewer regional signals')
                                                            : level === 'medium'
                                                              ? t('区域特征中等', 'Some regional signals')
                                                              : t('区域特征较多', 'More regional signals')}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="design-scan-message" aria-live="polite">
                                            <p className="type-body">
                                                {running
                                                    ? retryingCheck !== null || completed < 12
                                                        ? `${t('正在检查：', 'Checking: ')}${copy(current.title)}`
                                                        : t(
                                                              '本地检测已完成，正在查询网络信息',
                                                              'Local checks complete. Waiting for network details.',
                                                          )
                                                    : report
                                                      ? feedback
                                                          ? copy(feedback)
                                                          : t(
                                                                '检测结果已更新，请查看各项采集值。',
                                                                'Results updated. Review the observed values.',
                                                            )
                                                      : t(
                                                            '检查浏览器信号，同时了解当前网络',
                                                            'Check browser signals and your network together',
                                                        )}
                                            </p>
                                            <span className="type-helper">
                                                {running
                                                    ? retryingCheck !== null
                                                        ? t(
                                                              '仅重试当前评分项，其他检测结果保留',
                                                              'Retrying this signal only; all other results are retained',
                                                          )
                                                        : '' +
                                                          String(t('本地检测', 'Local checks')) +
                                                          ' ' +
                                                          String(completed) +
                                                          ' / 12 · ' +
                                                          String(
                                                              networkState === 'ready'
                                                                  ? t('网络查询已完成', 'Network ready')
                                                                  : networkState === 'error'
                                                                    ? t('网络查询失败', 'Network unavailable')
                                                                    : t(
                                                                          '网络查询中',
                                                                          'Network lookup in progress',
                                                                      ),
                                                          )
                                                    : checkedAt
                                                      ? '' +
                                                        String(
                                                            networkState === 'error' ||
                                                                score === null ||
                                                                findings.some(
                                                                    finding => finding.tone === 'unknown',
                                                                )
                                                                ? t('部分完成', 'Partially complete')
                                                                : t('检测完成', 'Complete'),
                                                        ) +
                                                        ' · ' +
                                                        String(formattedTime(checkedAt))
                                                      : t(
                                                            '无需安装，手动开始，结果逐项呈现',
                                                            'No installation. Start manually and review each result.',
                                                        )}
                                            </span>
                                        </div>
                                        <div
                                            className="design-progress-track"
                                            role="progressbar"
                                            aria-label={t('环境检测进度', 'Environment check progress')}
                                            aria-valuemin={0}
                                            aria-valuemax={100}
                                            aria-valuenow={percent}
                                        >
                                            <span style={{ transform: `scaleX(${percent / 100})` }} />
                                        </div>
                                        <div className="design-scan-actions">
                                            <button
                                                type="button"
                                                className="design-primary type-action"
                                                onClick={() => void start()}
                                                disabled={running}
                                            >
                                                {running ? (
                                                    <LoaderCircle className="design-spinner" />
                                                ) : report ? (
                                                    <RotateCcw />
                                                ) : (
                                                    <ScanLine />
                                                )}
                                                {running
                                                    ? t('正在检测', 'Checking')
                                                    : report
                                                      ? t('重新检测', 'Check again')
                                                      : t('开始检测', 'Start check')}
                                                {!running && <ArrowRight />}
                                            </button>
                                        </div>
                                        {report && !running && (
                                            <p className="design-next-step type-helper">
                                                {t(
                                                    '展开对应建议，按需调整后点击“重新检测”；同时确认原来的使用问题是否恢复。',
                                                    'Open the related guidance, make any needed changes, then check again. Also verify whe' +
                                                        'ther the original operation works.',
                                                )}
                                            </p>
                                        )}
                                        <p className="design-scan-disclosure type-meta">
                                            <ColorIcon name="shield" small />
                                            {t(
                                                '本地信号留在浏览器；正式网络查询仅发送公网 IP。',
                                                'Local signals stay in your browser. Production network lookups send only the public IP.',
                                            )}
                                        </p>
                                        {report && running && (
                                            <p className="design-previous type-meta">
                                                {t(
                                                    `上次环境风险参考分 ${previousScore.current ?? '—'} / 100；正在更新，旧结果保留在明细中。`,
                                                    'Previous environment risk reference score: ' +
                                                        String(previousScore.current ?? '—') +
                                                        ' / 100. Earlier values remain in the details while updating.',
                                                )}
                                            </p>
                                        )}
                                    </section>
                                    <section
                                        className="design-network"
                                        aria-labelledby="design-network-title"
                                        aria-busy={networkBusy}
                                    >
                                        <div className="design-section-heading">
                                            <h2 id="design-network-title" className="type-section">
                                                <ColorIcon name="globe" />
                                                {t('你的网络环境', 'Your network environment')}
                                            </h2>
                                            <span
                                                className={
                                                    'design-state type-meta ' +
                                                    String(
                                                        networkBusy
                                                            ? 'is-pending'
                                                            : networkState === 'ready'
                                                              ? 'is-pass'
                                                              : networkState === 'error'
                                                                ? 'is-note'
                                                                : '',
                                                    )
                                                }
                                            >
                                                {networkBusy ? (
                                                    <LoaderCircle className="design-spinner" />
                                                ) : networkState === 'ready' ? (
                                                    <Check />
                                                ) : null}
                                                {networkBusy
                                                    ? t('查询中', 'Checking')
                                                    : networkState === 'ready'
                                                      ? t('已检测', 'Checked')
                                                      : networkState === 'error'
                                                        ? t('查询失败', 'Lookup failed')
                                                        : t('待检测', 'Not checked')}
                                            </span>
                                        </div>
                                        <dl className="design-network-rows">
                                            {dataRows.map(row => (
                                                <div className="design-network-row" key={row.label}>
                                                    <dt className="type-helper">
                                                        <ColorIcon name={row.icon} small />
                                                        {row.label}
                                                    </dt>
                                                    <dd className="type-body">{networkValue(row.value)}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                        <span className="design-copy-feedback type-meta" aria-live="polite">
                                            {copied
                                                ? t('完整 IP 已复制', 'Full IP copied')
                                                : copyError
                                                  ? t(
                                                        '复制失败，请手动选择 IP 地址',
                                                        'Copy failed. Select the IP address manually.',
                                                    )
                                                  : '\u00a0'}
                                        </span>
                                        <div
                                            className={
                                                'design-network-assessment' +
                                                String(
                                                    networkHigh
                                                        ? ' is-high-risk'
                                                        : netScore !== null && netScore >= 40
                                                          ? ' is-medium-risk'
                                                          : '',
                                                )
                                            }
                                        >
                                            <div className="design-network-type">
                                                <span className="type-helper">
                                                    {t('IP 类型', 'IP type')}
                                                    {networkReport?.type === 'unknown'
                                                        ? t(' · 未知', ' · Unknown')
                                                        : ''}
                                                </span>
                                                <div className="design-type-chips">
                                                    {[
                                                        [
                                                            t('住宅', 'Residential'),
                                                            '🏠',
                                                            !!networkReport &&
                                                                networkReport.type === 'residential',
                                                        ],
                                                        [
                                                            t('数据中心', 'Datacenter'),
                                                            '🏢',
                                                            !!networkReport &&
                                                                networkReport.type === 'datacenter',
                                                        ],
                                                        [
                                                            t('代理', 'Proxy'),
                                                            '📡',
                                                            networkReport?.proxy === true,
                                                        ],
                                                    ].map(([label, icon, active]) => (
                                                        <span
                                                            className={`design-type-chip type-meta${active ? ' is-active' : ''}`}
                                                            key={String(label)}
                                                        >
                                                            {icon} {label}
                                                            {active && (
                                                                <Check aria-label={t('已识别', 'Detected')} />
                                                            )}
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                            <div className="design-network-score-line">
                                                <span className="type-helper">
                                                    <ColorIcon name="shield" small />
                                                    {t('IP 风险分', 'IP risk score')}
                                                </span>
                                                <span>
                                                    <strong className="environment-metric">
                                                        {netScore ?? '—'}
                                                    </strong>
                                                    <small className="type-meta"> / 100</small>
                                                    {networkReport && (
                                                        <b
                                                            className={
                                                                'design-state type-meta ' +
                                                                String(
                                                                    netScore === null ||
                                                                        (netScore >= 40 && netScore < 70)
                                                                        ? 'is-note'
                                                                        : networkHigh
                                                                          ? 'is-review'
                                                                          : 'is-pass',
                                                                )
                                                            }
                                                        >
                                                            {netScore === null
                                                                ? t('未知', 'Unknown')
                                                                : netScore >= 70
                                                                  ? t('风险较高', 'Higher risk')
                                                                  : netScore >= 40
                                                                    ? t('一般', 'Moderate')
                                                                    : t('风险较低', 'Lower risk')}
                                                        </b>
                                                    )}
                                                </span>
                                            </div>
                                            <div className="design-risk-scale" aria-hidden="true">
                                                {netScore !== null && (
                                                    <span style={{ left: `${netScore}%` }} />
                                                )}
                                            </div>
                                            <div className="design-scale-labels type-meta">
                                                <span>{t('0 较低', '0 Lower')}</span>
                                                <span>{t('40 一般', '40 Moderate')}</span>
                                                <span>{t('70+ 较高', '70+ Higher')}</span>
                                            </div>
                                        </div>
                                        {networkState === 'error' ? (
                                            <div className="design-network-error" role="alert">
                                                <CircleAlert />
                                                <div>
                                                    <strong className="type-label">
                                                        {scenario === 'quota'
                                                            ? t(
                                                                  '今日检测次数额度已用完',
                                                                  'Today’s detection quota is used up',
                                                              )
                                                            : t(
                                                                  '网络查询暂时失败',
                                                                  'Network lookup is unavailable',
                                                              )}
                                                    </strong>
                                                    <p className="type-helper">
                                                        {t(
                                                            '本地检测结果仍可查看，无需重新检查全部项目。',
                                                            'Local results remain available. You can retry the network separately.',
                                                        )}
                                                    </p>
                                                    {networkFindings[0] && (
                                                        <ol className="design-inline-steps type-helper">
                                                            {networkFindings[0].steps.map((step, index) => (
                                                                <li key={index}>{copy(step)}</li>
                                                            ))}
                                                        </ol>
                                                    )}
                                                    {networkReport && (
                                                        <p className="type-meta">
                                                            {t(
                                                                '以上为上次网络资料，时间：',
                                                                'Earlier network details, checked at: ',
                                                            )}
                                                            {formattedTime(networkReport.checkedAt)}
                                                            {t(
                                                                '；本次网络结果无法确认。',
                                                                '. The current network result is unconfirmed.',
                                                            )}
                                                        </p>
                                                    )}
                                                    <button
                                                        className="design-text-button type-label"
                                                        type="button"
                                                        onClick={() => void retryNetwork()}
                                                        disabled={running}
                                                    >
                                                        <RotateCcw />
                                                        {t('仅重试网络', 'Retry network only')}
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="design-network-caption type-meta">
                                                {networkReport
                                                    ? '' +
                                                      String(t('示例网络数据', 'Sample network data')) +
                                                      ' · ' +
                                                      String(formattedTime(networkReport.checkedAt)) +
                                                      String(
                                                          networkBusy
                                                              ? t(
                                                                    ' · 上次结果，正在更新',
                                                                    ' · Previous result, updating',
                                                                )
                                                              : '',
                                                      )
                                                    : t(
                                                          '点击开始检测后，网络资料将在此处同步更新。',
                                                          'Network details update here after you start a check.',
                                                      )}
                                            </p>
                                        )}
                                        {networkState === 'ready' && networkReport && (
                                            <details className="design-advice design-network-guidance">
                                                <summary className="type-helper">
                                                    <span>
                                                        {networkFindings.length
                                                            ? t('查看网络建议', 'View network advice')
                                                            : t('当前无需处理', 'No action needed')}
                                                    </span>
                                                    <ChevronDown />
                                                </summary>
                                                <div
                                                    className={`design-advice-body${networkFindings.length ? ' needs-attention' : ''}`}
                                                >
                                                    {networkFindings.length ? (
                                                        networkFindings.map(finding => (
                                                            <div key={finding.id}>
                                                                <p className="type-label">
                                                                    <strong>{copy(finding.title)}</strong>
                                                                </p>
                                                                <ol className="design-inline-steps type-body">
                                                                    {finding.steps.map((step, index) => (
                                                                        <li key={index}>{copy(step)}</li>
                                                                    ))}
                                                                </ol>
                                                                <p className="design-follow-up type-helper">
                                                                    {finding
                                                                        ? t(
                                                                              '处理后确认：',
                                                                              'Verify afterward: ',
                                                                          )
                                                                        : t('如需确认：', 'Optional check: ')}
                                                                    {copy(finding.verify)}
                                                                </p>
                                                            </div>
                                                        ))
                                                    ) : (
                                                        <>
                                                            <p className="type-body">
                                                                {t(
                                                                    '当前数据源未返回需要处理的网络提示。使用正常时保持当前网络即可；数据中心类型本身不代表异常。',
                                                                    'The provider returned no actionable network flags. Retain a working connection; a dat' +
                                                                        'a center type alone is not a fault.',
                                                                )}
                                                            </p>
                                                            <p className="design-follow-up type-helper">
                                                                {t(
                                                                    '如果原有连接问题仍在，请按实际报错继续排查；分数不能代替实际访问测试。',
                                                                    'If connection problems persist, troubleshoot the actual error. A score does not repla' +
                                                                        'ce testing access.',
                                                                )}
                                                            </p>
                                                        </>
                                                    )}
                                                </div>
                                            </details>
                                        )}
                                    </section>
                                </section>

                                <section
                                    className="design-detail-section"
                                    aria-labelledby="design-details-title"
                                >
                                    <div className="design-detail-heading">
                                        <h2 id="design-details-title" tabIndex={-1} className="type-section">
                                            {t('检测哪些信号', 'What we check')}
                                        </h2>
                                        <a
                                            className="design-detail-help type-label"
                                            href="#design-usage-guidance"
                                            onClick={() => {
                                                const guidance =
                                                    document.getElementById('design-usage-guidance');
                                                if (guidance instanceof HTMLDetailsElement)
                                                    guidance.open = true;
                                            }}
                                        >
                                            {t(
                                                '使用 Claude 前，如何检查环境？',
                                                'How should I check my environment before using Claude?',
                                            )}
                                        </a>
                                        <p className="type-body">
                                            {t(
                                                '适合在使用 Claude 等在线服务或订阅、续费前，检查本地浏览器与系统区域特征，查看 0–100 的环境风险参考分及各项检查建议。',
                                                'Before using online services such as Claude, or subscribing or renewing, review your ' +
                                                    'browser and system regional signals, the 0–100 environment risk reference score and t' +
                                                    'he guidance for each check.',
                                            )}
                                        </p>
                                    </div>
                                    <div id="design-check-list" className="design-check-list">
                                        {checks.map((check, index) => {
                                            const state = checkState(index);
                                            const available = completed > index || !!report;
                                            const itemReport = busy && completed > index ? sample : report;
                                            const value = itemReport?.values[index];
                                            const contribution = itemReport?.contributions[index];
                                            const finding = findings.find(item =>
                                                item.related.includes(check.id),
                                            );
                                            return (
                                                <article
                                                    key={check.id}
                                                    id={`design-check-${check.id}`}
                                                    tabIndex={-1}
                                                    className={`design-check-card state-${state}`}
                                                    data-check-id={check.id}
                                                    aria-busy={state === 'checking'}
                                                >
                                                    <div className="design-check-top">
                                                        <ColorIcon name={check.icon} />
                                                        <div className="design-check-name">
                                                            <h3 className="type-card">{copy(check.title)}</h3>
                                                            <span className="design-weight type-meta">
                                                                {check.weight
                                                                    ? t(
                                                                          `权重 ${check.weight}`,
                                                                          `Weight ${check.weight}`,
                                                                      )
                                                                    : t('不计分', 'Not scored')}
                                                            </span>
                                                            <span
                                                                className={
                                                                    'design-state type-meta is-' +
                                                                    String(
                                                                        state === 'pass'
                                                                            ? 'pass'
                                                                            : state === 'note' ||
                                                                                state === 'unavailable'
                                                                              ? 'note'
                                                                              : state === 'checking'
                                                                                ? 'pending'
                                                                                : 'neutral',
                                                                    )
                                                                }
                                                            >
                                                                {state === 'checking' ? (
                                                                    <LoaderCircle className="design-spinner" />
                                                                ) : state === 'pass' || state === 'info' ? (
                                                                    <Check />
                                                                ) : state === 'note' ||
                                                                  state === 'unavailable' ? (
                                                                    <CircleAlert />
                                                                ) : null}
                                                                {statusLabel(index)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <p className="design-check-description type-body">
                                                        {copy(check.description)}
                                                    </p>
                                                    <dl className="design-observed">
                                                        <div>
                                                            <dt className="type-meta">
                                                                {t('采集结果', 'Observed value')}
                                                                {busy && report && completed <= index
                                                                    ? t(' · 上次结果', ' · Previous value')
                                                                    : ''}
                                                            </dt>
                                                            <dd className="type-body">
                                                                {available && value
                                                                    ? copy(value)
                                                                    : state === 'checking'
                                                                      ? t(
                                                                            '正在读取此项信息…',
                                                                            'Reading this signal…',
                                                                        )
                                                                      : t('尚未检测', 'Not checked')}
                                                            </dd>
                                                        </div>
                                                        <div className="design-contribution">
                                                            <dt className="type-meta">
                                                                {t('风险加分', 'Risk points')}
                                                            </dt>
                                                            <dd className="type-label">
                                                                {available && contribution != null
                                                                    ? check.weight
                                                                        ? t(
                                                                              `+${contribution} 分`,
                                                                              `+${contribution} pts`,
                                                                          )
                                                                        : t('不计分', 'Not scored')
                                                                    : '—'}
                                                                {available && check.weight > 0 && (
                                                                    <small className="type-meta">
                                                                        {t(
                                                                            ` · 最高 ${check.weight} 分`,
                                                                            ` · Max ${check.weight} pts`,
                                                                        )}
                                                                    </small>
                                                                )}
                                                            </dd>
                                                        </div>
                                                    </dl>
                                                    {(state === 'unavailable' || retryingCheck === index) && (
                                                        <button
                                                            type="button"
                                                            className="design-text-button type-label"
                                                            disabled={running}
                                                            onClick={() => void retrySignal(index)}
                                                        >
                                                            {retryingCheck === index ? (
                                                                <LoaderCircle className="design-spinner" />
                                                            ) : (
                                                                <RotateCcw />
                                                            )}
                                                            {retryingCheck === index
                                                                ? t('正在重试此项', 'Retrying this signal')
                                                                : t('重试此项', 'Retry this signal')}
                                                        </button>
                                                    )}
                                                    <details
                                                        className="design-advice"
                                                        open={open.has(check.id)}
                                                        onToggle={event => {
                                                            const expanded = event.currentTarget.open;
                                                            setOpen(previous => {
                                                                if (previous.has(check.id) === expanded)
                                                                    return previous;
                                                                const next = new Set(previous);
                                                                if (expanded) next.add(check.id);
                                                                else next.delete(check.id);
                                                                return next;
                                                            });
                                                        }}
                                                    >
                                                        <summary
                                                            className={
                                                                'type-helper' +
                                                                String(
                                                                    available
                                                                        ? finding
                                                                            ? finding.tone === 'review'
                                                                                ? ' is-review'
                                                                                : ' is-note'
                                                                            : ' is-pass'
                                                                        : '',
                                                                )
                                                            }
                                                        >
                                                            <span>
                                                                {!available
                                                                    ? t('查看说明', 'Details')
                                                                    : finding
                                                                      ? t(
                                                                            `${finding.steps.length} 项建议`,
                                                                            `${finding.steps.length} tips`,
                                                                        )
                                                                      : t('无需处理', 'No action needed')}
                                                            </span>
                                                            <ChevronDown />
                                                        </summary>
                                                        <div
                                                            className={`design-advice-body${finding ? ' needs-attention' : ''}`}
                                                        >
                                                            <p className="type-label">
                                                                <Info aria-hidden="true" />
                                                                <strong>
                                                                    {!available
                                                                        ? t('检测说明', 'About this check')
                                                                        : finding
                                                                          ? finding.kind === 'optimization'
                                                                              ? t(
                                                                                    '建议优化',
                                                                                    'Optimization guidance',
                                                                                )
                                                                              : t(
                                                                                    '处理建议',
                                                                                    'Suggested steps',
                                                                                )
                                                                          : t(
                                                                                '当前无需处理',
                                                                                'No action needed',
                                                                            )}
                                                                </strong>
                                                            </p>
                                                            {available && finding ? (
                                                                <>
                                                                    <p className="type-helper">
                                                                        {finding.kind !== 'optimization' && (
                                                                            <>{copy(finding.evidence)} </>
                                                                        )}
                                                                        {copy(finding.explanation)}
                                                                    </p>
                                                                    <ol className="design-inline-steps type-body">
                                                                        {finding.steps.map(
                                                                            (step, stepIndex) => (
                                                                                <li key={stepIndex}>
                                                                                    {copy(step)}
                                                                                </li>
                                                                            ),
                                                                        )}
                                                                    </ol>
                                                                </>
                                                            ) : (
                                                                <p className="type-body">
                                                                    <span>
                                                                        {copy(
                                                                            available
                                                                                ? check.advice
                                                                                : check.explanation,
                                                                        )}
                                                                    </span>
                                                                </p>
                                                            )}
                                                            {available && (
                                                                <p className="design-follow-up type-helper">
                                                                    {finding
                                                                        ? t(
                                                                              '处理后确认：',
                                                                              'Verify afterward: ',
                                                                          )
                                                                        : t('如需确认：', 'Optional check: ')}
                                                                    {copy(
                                                                        finding
                                                                            ? finding.verify
                                                                            : checkFollowUp[check.id],
                                                                    )}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </details>
                                                </article>
                                            );
                                        })}
                                    </div>
                                </section>

                                <div className="design-help-layout">
                                    <section className="design-method" aria-labelledby="design-method-title">
                                        <div className="design-section-heading">
                                            <h2 id="design-method-title" className="type-section">
                                                <ColorIcon name="shield" />
                                                {t('检测原理与评分', 'How checks and scoring work')}
                                            </h2>
                                        </div>
                                        <p className="type-body">
                                            {t(
                                                '浏览器读取时间、语言与设备标记；字体通过有限候选的排版宽度比较识别。网络信息则来自独立 IP 数据源。',
                                                'Browser APIs provide time, language and device markers. Fonts are inferred by compari' +
                                                    'ng a limited set of text widths. Network details come from a separate IP data source.',
                                            )}
                                        </p>
                                        <div className="design-formula type-label">
                                            <span>{t('逐项识别', 'Read signals')}</span>
                                            <ArrowRight />
                                            <span>{t('按权重折算', 'Apply weights')}</span>
                                            <ArrowRight />
                                            <span>{t('汇总至 100 分', 'Cap total at 100')}</span>
                                        </div>
                                        <p className="type-helper">
                                            {t(
                                                '每项风险加分 = 权重 × 命中比例，四舍五入后相加。2 个信息项不计分；评分项无法读取时，不把它当作零分。',
                                                'Risk points = weight × signal ratio, rounded per item and added together. Two informa' +
                                                    'tional items are unscored. An unreadable scoring input is never treated as zero.',
                                            )}
                                        </p>
                                        <details className="design-advice design-score-explanation">
                                            <summary className="type-helper">
                                                <span>{t('详细评分说明', 'More about scoring')}</span>
                                                <ChevronDown />
                                            </summary>
                                            <div className="design-advice-body">
                                                {' '}
                                                <p className="type-helper">
                                                    {t(
                                                        '参考规则权重合计 112，原始加分相加后封顶 100。语言、区域格式以及时区、偏移存在相关性，属于经验规则，未按账号风险校准；原始分超过 100 时，部分变化不会改变仪表分数。',
                                                        'Reference weights total 112 and the summed risk points are capped at 100. Language, l' +
                                                            'ocale, timezone and offset overlap. These heuristics are not calibrated for account r' +
                                                            'isk; changes above the cap may leave the displayed score unchanged.',
                                                    )}
                                                </p>
                                            </div>
                                        </details>
                                        <dl className="design-level-definitions">
                                            <div>
                                                <dt className="type-label is-pass">0–30</dt>
                                                <dd className="type-helper">
                                                    {t('较少中文区域线索', 'Fewer Chinese regional signals')}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt className="type-label is-note">31–60</dt>
                                                <dd className="type-helper">
                                                    {t('部分中文区域线索', 'Some Chinese regional signals')}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt className="type-label is-review">61–100</dt>
                                                <dd className="type-helper">
                                                    {t('较多中文区域线索', 'More Chinese regional signals')}
                                                </dd>
                                            </div>
                                        </dl>
                                        <p className="design-method-note type-helper">
                                            <Info />
                                            {t(
                                                '分数越高，代表按本工具规则识别到的需关注信号越多。这不是 Claude 官方判定，也不是封号概率。IP 风险分独立展示，不计入环境风险参考分。',
                                                'A higher score means more signals flagged for attention under this tool’s reference r' +
                                                    'ules. It is not an official Claude assessment or an account-ban probability. The IP r' +
                                                    'isk score is separate and excluded from this total.',
                                            )}
                                        </p>
                                    </section>
                                    <section className="design-faq" aria-labelledby="design-faq-title">
                                        <h2 id="design-faq-title" className="type-section">
                                            {t('你可能还想了解', 'Good to know')}
                                        </h2>
                                        {faqs.map((faq, index) => (
                                            <details
                                                key={index}
                                                id={index === 4 ? 'design-usage-guidance' : undefined}
                                            >
                                                <summary className="type-body">
                                                    {copy(faq.question)}
                                                    <ChevronDown />
                                                </summary>
                                                <p className="type-body">{copy(faq.answer)}</p>
                                            </details>
                                        ))}
                                    </section>
                                </div>
                                <footer className="design-footer">
                                    <ColorIcon name="shield" small />
                                    <p className="type-helper">
                                        {t(
                                            '本页为独立交互设计稿。所有检测值、位置、IP 类型与分数均为示例，不会读取你的真实公网 IP，也不会上传设备信息。',
                                            'This is an independent interactive design preview. All values, locations, network typ' +
                                                'es and scores are samples. It does not read your public IP or upload device informati' +
                                                'on.',
                                        )}
                                    </p>
                                    <span className="type-meta">
                                        {t('环境监测', 'Environment monitor')} ·{' '}
                                        {t('设计预览', 'Design preview')}
                                    </span>
                                </footer>
                            </SubpageBody>
                            {preferencesOpen && (
                                <LocalePreferencesSheet
                                    language={language}
                                    currencyCodes={['MYR']}
                                    selectedCurrencyCode="MYR"
                                    currencyLoading={false}
                                    storefrontLabel={t(
                                        '环境监测 · 设计预览',
                                        'Environment monitor · Design preview',
                                    )}
                                    onToggleLanguage={() =>
                                        setLanguage(value => (value === 'zh' ? 'en' : 'zh'))
                                    }
                                    onSelectCurrency={() => undefined}
                                    onClose={() => setPreferencesOpen(false)}
                                />
                            )}
                        </main>
                    </div>
                </div>
            </div>
        </OverlayHost>
    );
}

const previewRoot = createRoot(requiredValue(document.getElementById('root')));
previewRoot.render(<DesignPreview />);
// The isolated Vite entry must release its React root and pending sample tasks on hot updates.
import.meta.hot?.dispose(() => previewRoot.unmount());

function requiredValue<T>(value: T | null | undefined): T {
    if (value == null) throw new Error('Expected a value in environment monitor verification');
    return value;
}
