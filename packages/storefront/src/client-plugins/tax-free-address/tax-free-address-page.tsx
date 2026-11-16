import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    ArrowUpRight,
    Check,
    ChevronDown,
    Clock3,
    Copy,
    History,
    Info,
    MapPin,
    RefreshCw,
    ShieldCheck,
} from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
    formatTaxFreeAddressSummary,
    type TaxFreeAddress,
    type TaxFreeAddressClaim,
} from '../../../../storefront-content-plugin/src/tax-free-address-contract';
import { isFinalTaxAddressError, taxAddressError, type TaxFreeAddressApi } from '../../api/tax-free-address';
import { useStorefrontPageActivity } from '../../hooks/useStorefrontPageActivity';
import { storefrontQueryPresentation } from '../../loading-state';

import {
    TAX_ADDRESS_HISTORY_EVENT,
    clearAddressHistory,
    finishAddressRequest,
    historyKey,
    pendingAddressRequest,
    readAddressHistory,
    rememberAddressRequest,
    saveAddressHistory,
} from './browser-history';
import './tax-free-address.css';

type SavedClaim = TaxFreeAddressClaim & { savedLocally: boolean };
const statusKey = ['address-tool', 'availability'];
const historyScope = 'address-tool';
const billingFields = [
    { field: 'country', chinese: '国家', english: 'Country / Region' },
    { field: 'line1', chinese: '地址', english: 'Address Line 1' },
    { field: 'city', chinese: '城市', english: 'City' },
    { field: 'state', chinese: '州', english: 'State' },
    { field: 'postalCode', chinese: '邮编', english: 'ZIP Code' },
] as const;

type CopyField = 'line1' | 'city' | 'postalCode';
const copyFieldNames = {
    line1: ['地址', 'Street address'],
    city: ['城市', 'City'],
    postalCode: ['邮编', 'ZIP code'],
} as const;

export function AddressFields({
    address,
    zh,
    copied,
    onCopy,
}: {
    address: TaxFreeAddress;
    zh: boolean;
    copied?: string;
    onCopy?: (field: CopyField) => void;
}) {
    return (
        <dl className="tax-address-fields">
            {billingFields.map(({ field, chinese, english }, index) => (
                <div key={field} className={index < 2 ? 'tax-address-field-wide' : undefined}>
                    <dt className="type-label">
                        {zh ? (
                            <>
                                {chinese}（<span lang="en">{english}</span>）
                            </>
                        ) : (
                            english
                        )}
                    </dt>
                    <dd className="tax-address-field-value type-body">
                        <span lang="en">{address[field]}</span>
                        {onCopy && (field === 'line1' || field === 'city' || field === 'postalCode') && (
                            <span className="tax-address-field-copy-wrap">
                                <button
                                    type="button"
                                    className="tax-address-field-copy"
                                    aria-label={
                                        zh
                                            ? `复制${copyFieldNames[field][0]}`
                                            : `Copy ${copyFieldNames[field][1]}`
                                    }
                                    title={
                                        zh
                                            ? `复制${copyFieldNames[field][0]}`
                                            : `Copy ${copyFieldNames[field][1]}`
                                    }
                                    onClick={() => onCopy(field)}
                                >
                                    {copied === `${address.id}:${field}` ? (
                                        <Check aria-hidden="true" />
                                    ) : (
                                        <Copy aria-hidden="true" />
                                    )}
                                </button>
                                {copied === `${address.id}:${field}` && (
                                    <span className="tax-address-field-copied type-helper" aria-hidden="true">
                                        {zh ? '已复制' : 'Copied'}
                                    </span>
                                )}
                            </span>
                        )}
                    </dd>
                </div>
            ))}
        </dl>
    );
}

export function TaxFreeAddressPage({
    api,
    language = 'zh',
    onBack,
}: {
    api: TaxFreeAddressApi;
    language?: 'zh' | 'en';
    onBack?: () => void;
}) {
    const zh = language === 'zh';
    const t = (cn: string, en: string) => (zh ? cn : en);
    const client = useQueryClient();
    const mutations = client.getMutationCache();
    const active = useStorefrontPageActivity();
    // Write ownership excludes account and language: switching either must not unlock an anonymous claim.
    const mutationKey = ['tax-free-address-claim', historyScope];
    const status = useQuery({
        queryKey: statusKey,
        queryFn: async ({ signal }) => ({ ...(await api.status(signal)), receivedAt: Date.now() }),
        enabled: active,
        staleTime: 15_000,
        retry: false,
    });
    const [history, setHistory] = useState(() => readAddressHistory(historyScope));
    const [message, setMessage] = useState('');
    const [copied, setCopied] = useState('');
    const [confirmClear, setConfirmClear] = useState(false);
    const [clock, setClock] = useState(Date.now());
    const [historyPage, setHistoryPage] = useState(1);
    async function persistRequest(requestId: string): Promise<SavedClaim> {
        rememberAddressRequest(historyScope, requestId);
        try {
            const result = await api.claim(requestId);
            const savedLocally = saveAddressHistory(historyScope, result);
            finishAddressRequest(historyScope, requestId);
            // Complete in the root owner even after the page unmounts.
            await client.invalidateQueries({
                queryKey: statusKey,
            });
            return { ...result, savedLocally };
        } catch (error) {
            if (isFinalTaxAddressError(error)) finishAddressRequest(historyScope, requestId);
            void client.invalidateQueries({
                queryKey: statusKey,
            });
            throw error;
        }
    }
    // Follow the existing studio tool: the root MutationCache owns writes across navigation.
    // Subscribe to its immutable state rather than adding another mutation observer to the shell bundle.
    const subscribe = useCallback((notify: () => void) => mutations.subscribe(notify), [mutations]);
    const snapshot = useCallback(
        () => mutations.findAll({ mutationKey: ['tax-free-address-claim', historyScope] }).at(-1)?.state,
        [mutations, historyScope],
    );
    const latest = useSyncExternalStore(subscribe, snapshot, () => undefined);
    const busy = !!mutations.find({ mutationKey, status: 'pending' });
    const receipt = mutations.findAll({ mutationKey, status: 'success' }).at(-1)?.state.data as
        SavedClaim | undefined;
    const storedAddress = history.records[0]?.address;
    const current =
        receipt?.address &&
        (!storedAddress || Date.parse(receipt.address.usedAt ?? '') >= Date.parse(storedAddress.usedAt ?? ''))
            ? receipt.address
            : storedAddress;
    // Recover in memory if browser persistence is blocked or another tab changed it.
    const retryRequestId =
        latest?.status === 'error' &&
        typeof latest.variables === 'string' &&
        !isFinalTaxAddressError(latest.error)
            ? latest.variables
            : pendingAddressRequest(historyScope);
    const recovering = Boolean(retryRequestId);
    const nextAllowedAt = status.data?.nextAllowedAt;
    const deadline =
        nextAllowedAt && status.data
            ? status.data.receivedAt +
              Math.max(0, Date.parse(nextAllowedAt) - Date.parse(status.data.serverNow))
            : 0;
    const remaining = Math.max(0, Math.ceil((deadline - clock) / 1000));
    const timer = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    const presentation = storefrontQueryPresentation(status);
    useEffect(() => {
        const sync = (event: Event) => {
            if (event instanceof StorageEvent && event.key !== historyKey(historyScope) && event.key !== null)
                return;
            if (event instanceof CustomEvent && event.detail !== historyScope) return;
            setHistory(readAddressHistory(historyScope));
            void client.invalidateQueries({ queryKey: statusKey });
        };
        setHistory(readAddressHistory(historyScope));
        window.addEventListener('storage', sync);
        window.addEventListener(TAX_ADDRESS_HISTORY_EVENT, sync);
        return () => {
            window.removeEventListener('storage', sync);
            window.removeEventListener(TAX_ADDRESS_HISTORY_EVENT, sync);
        };
    }, [client]);
    // Local visual clock only; reaching zero never submits an extraction.
    useEffect(() => {
        if (!active) return;
        let timerId: ReturnType<typeof setTimeout>;
        const tick = () => {
            setClock(Date.now());
            if (deadline > Date.now()) timerId = setTimeout(tick, 1000);
        };
        tick();
        return () => clearTimeout(timerId);
    }, [deadline, active]);
    useEffect(() => {
        if (!copied) return;
        const timeout = setTimeout(() => setCopied(''), 2500);
        return () => clearTimeout(timeout);
    }, [copied]);
    async function copy(address: TaxFreeAddress, selectedField?: CopyField) {
        setCopied('');
        setMessage('');
        try {
            const text = selectedField
                ? address[selectedField]
                : billingFields
                      .map(({ field, chinese, english }) => `${chinese}（${english}）：${address[field]}`)
                      .join('\n');
            await navigator.clipboard.writeText(text);
            setCopied(selectedField ? `${address.id}:${selectedField}` : address.id);
            setMessage(
                selectedField
                    ? t(
                          `${copyFieldNames[selectedField][0]}已复制`,
                          `${copyFieldNames[selectedField][1]} copied`,
                      )
                    : t('地址已复制', 'Address copied'),
            );
        } catch {
            setMessage(
                t(
                    '复制失败，请选中上方地址手动复制。',
                    'Copy failed. Select the address text to copy manually.',
                ),
            );
        }
    }
    const submit = () => {
        if (
            mutations.find({ mutationKey, status: 'pending' }) ||
            (remaining && !recovering) ||
            !status.data ||
            !active
        )
            return;
        setMessage('');
        const mutation = mutations.build<SavedClaim, Error, string, unknown>(client, {
            mutationKey,
            mutationFn: persistRequest,
            retry: false,
            gcTime: 30 * 60_000,
        });
        // Failure is rendered from the root cache; the same request ID remains available for explicit retry.
        void mutation.execute(retryRequestId ?? crypto.randomUUID()).catch(() => undefined);
    };
    return (
        <main className="tax-address-page">
            <div className="tax-address-body">
                <header className="tax-address-masthead">
                    <div className="tax-address-identity">
                        <span className="tax-address-mark">
                            <MapPin aria-hidden="true" />
                        </span>
                        <h1 className="type-page">{t('免税地址提取', 'Tax-free address templates')}</h1>
                    </div>
                    {onBack && (
                        <button type="button" className="tax-address-quiet tax-address-back" onClick={onBack}>
                            <ArrowLeft aria-hidden="true" />
                            {t('返回上一页', 'Go back')}
                        </button>
                    )}
                </header>
                <div className="tax-address-workspace">
                    <div className="tax-address-main">
                        <section className="tax-address-result" aria-label={t('本次提取', 'Latest address')}>
                            <div className="tax-address-heading">
                                <div className="tax-address-section-title">
                                    <MapPin aria-hidden="true" />
                                    <h2 className="type-section">{t('本次提取', 'Latest address')}</h2>
                                </div>
                                <span className="tax-address-badge type-meta">
                                    {current ? (
                                        <Check aria-hidden="true" />
                                    ) : (
                                        <ShieldCheck aria-hidden="true" />
                                    )}
                                    {current ? t('已提取', 'Retrieved') : t('无需登录', 'No login needed')}
                                </span>
                            </div>
                            <div className="tax-address-result-content">
                                {current ? (
                                    <AddressFields
                                        address={current}
                                        zh={zh}
                                        copied={copied}
                                        onCopy={field => void copy(current, field)}
                                    />
                                ) : (
                                    <div className="tax-address-empty">
                                        <span className="tax-address-empty-icon">
                                            <MapPin aria-hidden="true" />
                                        </span>
                                        <h3 className="type-card">
                                            {t('准备好你的下一条地址', 'Your next address starts here')}
                                        </h3>
                                        <p className="type-body">
                                            {t(
                                                '提取后，国家、街道、城市、州和邮编会显示在这里。',
                                                'Country, street, city, state and ZIP code will appear here.',
                                            )}
                                        </p>
                                    </div>
                                )}
                            </div>
                            <div className="tax-address-actions">
                                <div className="tax-address-availability">
                                    <p className="type-helper">
                                        <Clock3 aria-hidden="true" />
                                        {t('每 5 分钟可提取一次', 'One address every five minutes')}
                                    </p>
                                    <button
                                        type="button"
                                        className="tax-address-quiet"
                                        disabled={status.isFetching || busy || !active}
                                        aria-busy={status.isFetching}
                                        onClick={() => void status.refetch({ cancelRefetch: false })}
                                    >
                                        <RefreshCw aria-hidden="true" />
                                        {t('刷新状态', 'Refresh status')}
                                    </button>
                                </div>
                                <div className="tax-address-toolbar">
                                    <button
                                        type="button"
                                        className="primary-action tax-address-extract"
                                        disabled={
                                            busy || (remaining > 0 && !recovering) || !status.data || !active
                                        }
                                        aria-busy={busy}
                                        onClick={submit}
                                    >
                                        {remaining && !recovering ? (
                                            <Clock3 aria-hidden="true" />
                                        ) : (
                                            <ArrowUpRight aria-hidden="true" />
                                        )}
                                        {busy
                                            ? t('正在提取…', 'Getting address…')
                                            : remaining && !recovering
                                              ? t('下次可提取 ', 'Available in ')
                                              : recovering
                                                ? t('核对原提取请求', 'Check previous request')
                                                : t('提取地址', 'Get address')}
                                        {!busy && remaining > 0 && !recovering && (
                                            <span className="tax-address-timer">{timer}</span>
                                        )}
                                    </button>
                                    {current && (
                                        <button
                                            type="button"
                                            className={
                                                remaining > 0 && !recovering
                                                    ? 'primary-action'
                                                    : 'secondary-action'
                                            }
                                            onClick={() => void copy(current)}
                                        >
                                            {copied === current.id ? (
                                                <Check aria-hidden="true" />
                                            ) : (
                                                <Copy aria-hidden="true" />
                                            )}
                                            {t('一键复制', 'Copy address')}
                                        </button>
                                    )}
                                </div>
                                <div className="tax-address-copy-feedback" role="status" aria-live="polite">
                                    {message && <span className="type-helper">{message}</span>}
                                </div>
                                {presentation.initialLoading && (
                                    <p className="tax-address-feedback type-body" role="status">
                                        {t('正在读取提取状态…', 'Loading availability…')}
                                    </p>
                                )}
                                {(presentation.initialError || presentation.paused) && (
                                    <p className="tax-address-notice type-body" role="alert">
                                        {t(
                                            '状态读取失败或网络不可用，请恢复网络后刷新状态。',
                                            'Availability could not be loaded. Reconnect and refresh status.',
                                        )}
                                    </p>
                                )}
                                {presentation.refreshError && (
                                    <p className="tax-address-notice type-body" role="alert">
                                        {t(
                                            '状态刷新失败，已保留当前地址和记录。',
                                            'Could not refresh availability. Your address and history are still available.',
                                        )}
                                    </p>
                                )}
                                {latest?.status === 'error' && (
                                    <p className="tax-address-notice type-body" role="alert">
                                        {taxAddressError(latest.error, zh)}
                                    </p>
                                )}
                                {(history.unavailable || receipt?.savedLocally === false) && (
                                    <p className="tax-address-notice type-body" role="alert">
                                        {t(
                                            '浏览器记录未能完整保存或读取，请及时复制本次地址。',
                                            'Browser history could not be saved or read in full. Copy this address now.',
                                        )}
                                    </p>
                                )}
                            </div>
                        </section>
                        <p className="tax-address-footnote type-helper">
                            <Info aria-hidden="true" />
                            {t(
                                '美国地址模板，使用前请核对。一键复制将保留完整的五行格式。',
                                'US address templates; verify before use. Copy includes all five address fields.',
                            )}
                        </p>
                    </div>
                    <section className="tax-address-history" aria-label={t('提取记录', 'Local history')}>
                        <div className="tax-address-heading">
                            <div className="tax-address-section-title">
                                <History aria-hidden="true" />
                                <h2 className="type-section">{t('提取记录', 'Local history')}</h2>
                                <span className="tax-address-count type-meta">{history.records.length}</span>
                            </div>
                            <button
                                type="button"
                                className="tax-address-quiet"
                                disabled={!history.records.length || busy}
                                onClick={() => setConfirmClear(true)}
                            >
                                {t('清空记录', 'Clear history')}
                            </button>
                        </div>
                        <p className="tax-address-history-description type-helper">
                            {t(
                                '仅保存在当前浏览器，最多保留最近 1000 条。',
                                'Saved in this browser only, up to 1,000 recent records.',
                            )}
                        </p>
                        {confirmClear && (
                            <div className="tax-address-notice">
                                <p className="type-body">
                                    {t(
                                        '清空当前浏览器的提取记录？此操作不会重置 5 分钟限制。',
                                        'Clear local history? This does not reset the five-minute limit.',
                                    )}
                                </p>
                                <div className="tax-address-toolbar">
                                    <button
                                        type="button"
                                        className="secondary-action"
                                        onClick={() => setConfirmClear(false)}
                                    >
                                        {t('取消', 'Cancel')}
                                    </button>
                                    <button
                                        type="button"
                                        className="primary-action"
                                        onClick={() => {
                                            if (!clearAddressHistory(historyScope))
                                                setMessage(
                                                    t(
                                                        '清空失败，请检查浏览器存储权限。',
                                                        'Could not clear browser history.',
                                                    ),
                                                );
                                            setConfirmClear(false);
                                            setHistoryPage(1);
                                        }}
                                    >
                                        {t('确认清空', 'Confirm clear')}
                                    </button>
                                </div>
                            </div>
                        )}
                        {!history.records.length && (
                            <div className="tax-address-history-empty">
                                <History aria-hidden="true" />
                                <p className="type-card">{t('暂无提取记录', 'No local history yet')}</p>
                                <p className="type-helper">
                                    {t(
                                        '提取后会自动保存在这里，随时展开查看和复制。',
                                        'Your retrieved addresses will appear here. Expand a record to view or copy it.',
                                    )}
                                </p>
                            </div>
                        )}
                        <div className="tax-address-history-list">
                            {history.records.slice((historyPage - 1) * 20, historyPage * 20).map(row => (
                                <details className="tax-address-history-row" key={row.requestId}>
                                    <summary>
                                        <span className="tax-address-record">
                                            <span className="type-body" lang="en">
                                                {formatTaxFreeAddressSummary(row.address)}
                                            </span>
                                            <time
                                                className="type-meta"
                                                dateTime={row.address.usedAt ?? undefined}
                                            >
                                                {new Date(row.address.usedAt ?? '').toLocaleString(
                                                    zh ? 'zh-CN' : 'en-US',
                                                )}
                                            </time>
                                        </span>
                                        <ChevronDown aria-hidden="true" />
                                    </summary>
                                    <div className="tax-address-record-detail">
                                        <AddressFields
                                            address={row.address}
                                            zh={zh}
                                            copied={copied}
                                            onCopy={field => void copy(row.address, field)}
                                        />
                                        <button
                                            type="button"
                                            className="secondary-action"
                                            onClick={() => void copy(row.address)}
                                        >
                                            {copied === row.address.id ? (
                                                <Check aria-hidden="true" />
                                            ) : (
                                                <Copy aria-hidden="true" />
                                            )}
                                            {t('复制地址', 'Copy address')}
                                        </button>
                                    </div>
                                </details>
                            ))}
                        </div>
                        {history.records.length > 20 && (
                            <div className="tax-address-toolbar tax-address-pagination">
                                <button
                                    type="button"
                                    className="secondary-action"
                                    disabled={historyPage <= 1}
                                    onClick={() => setHistoryPage(value => value - 1)}
                                >
                                    {t('上一页', 'Previous')}
                                </button>
                                <span className="type-meta">
                                    {historyPage} / {Math.ceil(history.records.length / 20)}
                                </span>
                                <button
                                    type="button"
                                    className="secondary-action"
                                    disabled={historyPage * 20 >= history.records.length}
                                    onClick={() => setHistoryPage(value => value + 1)}
                                >
                                    {t('下一页', 'Next')}
                                </button>
                            </div>
                        )}
                        <p className="tax-address-history-note type-helper">
                            <ShieldCheck aria-hidden="true" />
                            {t(
                                '清除站点数据或更换浏览器后，记录无法恢复。',
                                'Clearing site data or changing browsers removes this history.',
                            )}
                        </p>
                    </section>
                </div>
            </div>
        </main>
    );
}
