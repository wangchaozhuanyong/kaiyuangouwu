import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Copy, MapPin, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
    formatTaxFreeAddress,
    formatTaxFreeAddressSummary,
    type TaxFreeAddress,
    type TaxFreeAddressClaim,
} from '../../../../storefront-content-plugin/src/tax-free-address-contract';
import { taxAddressError, type TaxFreeAddressApi } from '../../api/tax-free-address';
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
const isFinalClaimError = (error: unknown) =>
    error instanceof Error &&
    /TAX_ADDRESS_(COOLDOWN|RESULT_EXPIRED|BROWSER_REQUIRED|EXHAUSTED|CAPACITY)/.test(error.message);
export function AddressFields({ address, zh }: { address: TaxFreeAddress; zh: boolean }) {
    const fields = [
        [zh ? '国家（英语）' : 'Country', address.country],
        [zh ? '地址（英语）' : 'Address', address.line1],
        [zh ? '城市（英语）' : 'City', address.city],
        [zh ? '州（英语）' : 'State', address.state],
        [zh ? '邮编（英语）' : 'ZIP code', address.postalCode],
    ];
    return (
        <dl className="tax-address-fields">
            {fields.map(([label, value]) => (
                <div key={label}>
                    <dt className="type-label">{label}</dt>
                    <dd className="type-body" lang="en">
                        {value}
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
            if (isFinalClaimError(error)) finishAddressRequest(historyScope, requestId);
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
        latest?.status === 'error' && typeof latest.variables === 'string' && !isFinalClaimError(latest.error)
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
    async function copy(address: TaxFreeAddress) {
        try {
            await navigator.clipboard.writeText(formatTaxFreeAddress(address));
            setCopied(address.id);
            setMessage(t('地址已复制', 'Address copied'));
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
                {onBack && (
                    <div>
                        <button type="button" className="secondary-action tax-address-back" onClick={onBack}>
                            <ArrowLeft aria-hidden="true" />
                            {t('返回上一页', 'Go back')}
                        </button>
                    </div>
                )}
                <section className="tax-address-intro">
                    <MapPin aria-hidden="true" />
                    <div>
                        <h1 className="type-page">{t('免税地址提取', 'Tax-free address templates')}</h1>
                        <p className="type-body">
                            {t(
                                '无需登录，每个浏览器每 5 分钟可提取一次。',
                                'No login needed. One address every five minutes per browser.',
                            )}
                        </p>
                        <p className="type-helper">
                            {t(
                                '美国地址模板，使用前请核对。提取记录仅保存在当前浏览器，最多保留最近 1000 条。',
                                'US address templates; verify before use. Up to 1,000 recent records stay in this browser only.',
                            )}
                        </p>
                    </div>
                </section>
                <div className="tax-address-toolbar">
                    <button
                        type="button"
                        className="primary-action"
                        disabled={busy || (remaining > 0 && !recovering) || !status.data || !active}
                        aria-busy={busy}
                        onClick={submit}
                    >
                        {busy
                            ? t('正在提取…', 'Getting address…')
                            : remaining && !recovering
                              ? t(`下次可提取 ${timer}`, `Available in ${timer}`)
                              : recovering
                                ? t('核对原提取请求', 'Check previous request')
                                : t('提取地址', 'Get address')}
                    </button>
                    <button
                        type="button"
                        className="secondary-action"
                        disabled={status.isFetching || busy || !active}
                        onClick={() => void status.refetch({ cancelRefetch: false })}
                    >
                        <RefreshCw aria-hidden="true" />
                        {t('刷新状态', 'Refresh status')}
                    </button>
                </div>
                {presentation.initialLoading && (
                    <p className="type-body" role="status">
                        {t('正在读取提取状态…', 'Loading availability…')}
                    </p>
                )}
                {(presentation.initialError || presentation.paused) && (
                    <p className="type-body" role="alert">
                        {t(
                            '状态读取失败或网络不可用，请恢复网络后刷新状态。',
                            'Availability could not be loaded. Reconnect and refresh status.',
                        )}
                    </p>
                )}
                {presentation.refreshError && (
                    <p className="type-body" role="alert">
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
                            '浏览器记录未能完整保存或读取，请复制并自行保存本次地址。',
                            'Browser history could not be saved or read completely. Copy and keep this address yourself.',
                        )}
                    </p>
                )}
                {message && (
                    <p className="type-body" role="status">
                        {message}
                    </p>
                )}
                <section className="tax-address-result" aria-label={t('本次提取', 'Latest address')}>
                    <div className="tax-address-heading">
                        <h2 className="type-section">{t('本次提取', 'Latest address')}</h2>
                        {current && (
                            <button
                                type="button"
                                className="secondary-action"
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
                    {current ? (
                        <AddressFields address={current} zh={zh} />
                    ) : (
                        <p className="type-body">
                            {t(
                                '点击“提取地址”，获取一条新的地址模板。',
                                'Choose “Get address” to receive a new address template.',
                            )}
                        </p>
                    )}
                </section>
                <section aria-label={t('提取记录', 'Local history')}>
                    <div className="tax-address-heading">
                        <h2 className="type-section">
                            {t('提取记录', 'Local history')}{' '}
                            <span className="type-meta">({history.records.length})</span>
                        </h2>
                        <button
                            type="button"
                            className="secondary-action"
                            disabled={!history.records.length || busy}
                            onClick={() => setConfirmClear(true)}
                        >
                            {t('清空记录', 'Clear history')}
                        </button>
                    </div>
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
                        <p className="type-body">
                            {t(
                                '暂无本机提取记录。清除浏览器站点数据或更换浏览器后无法恢复。',
                                'No local history. Clearing site data or changing browsers removes these records.',
                            )}
                        </p>
                    )}
                    {history.records.slice((historyPage - 1) * 20, historyPage * 20).map(row => (
                        <details className="tax-address-history-row" key={row.requestId}>
                            <summary>
                                <time className="type-meta">
                                    {new Date(row.address.usedAt ?? '').toLocaleString(
                                        zh ? 'zh-CN' : 'en-US',
                                    )}
                                </time>
                                <span className="type-body" lang="en">
                                    {formatTaxFreeAddressSummary(row.address)}
                                </span>
                            </summary>
                            <AddressFields address={row.address} zh={zh} />
                            <button
                                type="button"
                                className="secondary-action"
                                onClick={() => void copy(row.address)}
                            >
                                {t('复制地址', 'Copy address')}
                            </button>
                        </details>
                    ))}
                    {history.records.length > 20 && (
                        <div className="tax-address-toolbar">
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
                </section>
            </div>
        </main>
    );
}
