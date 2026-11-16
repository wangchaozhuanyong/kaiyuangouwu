import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowRight,
    ArrowUpRight,
    BookOpen,
    CheckCircle2,
    ChevronRight,
    CircleAlert,
    ClipboardPaste,
    Clock3,
    Headphones,
    LockKeyhole,
    Search,
    ShieldCheck,
    ShoppingBag,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { LocalePreferencesSheet, LocalePreferencesTrigger } from '../../components/common/locale-preferences';
import {
    ShopAbuseChallengeControl,
    useShopAbuseChallenge,
} from '../../components/common/shop-abuse-challenge';
import { storefrontQueryPresentation } from '../../loading-state';
import { usePageLoadingState, usePageReadiness } from '../../page-readiness';
import { storefrontQueryKeys } from '../../query-client';
import { shopAbuseFailure } from '../../shop-abuse-failure';
import { StorefrontDisplayError, storefrontErrorCode, storefrontErrorMessage } from '../../storefront-errors';
import { SubHeader, SubpageBody } from '../../storefront-ui/page-shell';
import { type CollectionSummary, type StorefrontContentBlock, type StorefrontLanguage } from '../../types';

import {
    type GptRechargeClient,
    inspectRechargeSession,
    isPartnerRechargeCode,
    type RechargeCode,
    rechargePlanLabel,
    rechargePlans,
    type RechargeTask,
} from './contracts';
import { rechargeCopy } from './copy';
import { CHATGPT_SESSION_URL, GptRechargeGuide } from './gpt-recharge-guide';
import { resolveGptRechargeProductsCollection } from './gpt-recharge-navigation';
import './gpt-recharge.css';
import { RechargeProgressPanel, RechargeTaskDetails } from './recharge-progress-panel';
import { useRechargeProgress } from './use-recharge-progress';

interface RechargeLocalePreferences {
    storefrontName: string;
    currencyCode: string;
    currencyCodes: string[];
    currencyLoading: boolean;
    onToggleLanguage: () => void;
    onCurrencyChange: (currencyCode: string) => void | Promise<void>;
}

type RechargeTab = 'recharge' | 'query' | 'guide';
type RechargeOperation = 'verify' | 'submit' | 'query' | 'paste';
// Reviewed localized display copy, populated through the shared error formatter.
type RechargeFeedback = { scope: RechargeOperation; text: string; field?: 'code' | 'query' };
const redemptionCodeMaxLength = 190;

export function GptRechargePage({
    client,
    language = 'zh',
    onBack,
    initialTab = 'recharge',
    marketKey,
    activeTab,
    onTabChange,
    localePreferences,
    onViewProducts,
    onContactSupport,
    productCollections = [],
    productContentBlocks = [],
}: {
    client: GptRechargeClient;
    marketKey: string;
    activeTab?: RechargeTab;
    onTabChange?: (tab: RechargeTab) => void;
    language?: StorefrontLanguage;
    onBack: () => void;
    initialTab?: RechargeTab;
    localePreferences?: RechargeLocalePreferences;
    onViewProducts?: (collectionId: string) => void;
    onContactSupport?: () => void;
    productCollections?: readonly CollectionSummary[];
    productContentBlocks?: readonly StorefrontContentBlock[];
}) {
    const t = rechargeCopy(language);
    const codeChallenge = useShopAbuseChallenge(client, language);
    const queryChallenge = useShopAbuseChallenge(client, language);
    const submitChallenge = useShopAbuseChallenge(client, language);
    const productsCollection = resolveGptRechargeProductsCollection(productCollections, productContentBlocks);
    const canViewProducts = Boolean(productsCollection && onViewProducts);
    const [preferencesOpen, setPreferencesOpen] = useState(false);
    const [localTab, setLocalTab] = useState(initialTab);
    const tab = activeTab ?? localTab;
    const [progressTab, setProgressTab] = useState(initialTab === 'query' ? 'query' : 'recharge');
    const setTab = (next: typeof localTab) => {
        setLocalTab(next);
        if (next !== 'guide') setProgressTab(next);
        onTabChange?.(next);
    };
    const [code, setCode] = useState('');
    const [authorizationUrl, setAuthorizationUrl] = useState<string>();
    const partnerCode = isPartnerRechargeCode(code);
    const authorizationKey = useRef<string | undefined>(undefined);
    const [pastingCode, setPastingCode] = useState(false);
    const [session, setSession] = useState('');
    const [verified, setVerified] = useState<RechargeCode | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [task, setTask] = useState<RechargeTask | null>(null);
    const [uncertain, setUncertain] = useState(false);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState<RechargeFeedback | null>(null);
    const [feedbackAttempt, setFeedbackAttempt] = useState<RechargeOperation | null>(null);
    const [queryCode, setQueryCode] = useState('');
    const [queriedCode, setQueriedCode] = useState('');
    const [pastingQuery, setPastingQuery] = useState(false);
    const lookupInput = useRef<HTMLInputElement>(null);
    const lookupVersion = useRef(0);
    const [queryResult, setQueryResult] = useState<RechargeCode | null>(null);
    const instance = useId();
    const queryClient = useQueryClient();
    const taskKey = (id: string) =>
        [...storefrontQueryKeys.privateScope(marketKey, language), 'gpt-recharge', instance, id] as const;
    const updateExistingTask = (snapshot: RechargeTask) => {
        // New queries must be created by the sensitive observer with gcTime: 0.
        // Pre-seeding an absent query would inherit ordinary cache retention.
        if (queryClient.getQueryState(taskKey(snapshot.id)))
            queryClient.setQueryData(taskKey(snapshot.id), snapshot);
    };
    const selectedTab = tab === 'guide' ? progressTab : tab;
    const trackedTask = selectedTab === 'query' ? (queryResult?.task ?? null) : task;
    const configQuery = useQuery({
        queryKey: [
            ...storefrontQueryKeys.privateScope(marketKey, language),
            'gpt-recharge',
            'config',
        ] as const,
        queryFn: ({ signal }) => client.config(signal),
        // Availability flags reuse the scoped QueryClient cache across navigation.
        staleTime: 30000,
    });
    const config = configQuery.data;
    const configPresentation = storefrontQueryPresentation(configQuery);
    const canStartRecharge = config?.enabled === true && !config.maintenance;
    const checkingService = tab === 'recharge' && configPresentation.initialLoading;
    const serviceReadKey = `${marketKey}:${language}`;
    const serviceLoading = usePageLoadingState({ pending: checkingService, key: serviceReadKey });
    usePageReadiness(
        checkingService,
        'local',
        serviceReadKey,
        tab === 'recharge' && (configPresentation.initialError || configPresentation.paused),
    );
    const {
        taskQuery,
        currentTask,
        refreshTask,
        manual,
        reconnect,
        sync: taskSync,
    } = useRechargeProgress(client, trackedTask, taskKey(trackedTask?.id ?? ''), language);
    const mounted = useRef(true);
    const sessionField = useRef<HTMLTextAreaElement>(null);
    const operation = useRef(false);
    const operationScope = useRef<RechargeOperation>('verify');
    const requestVersion = useRef(0);
    const codeInput = useRef<HTMLInputElement>(null);
    const matchedPlanCard = useRef<HTMLLIElement>(null);
    const focusLookup = useRef(false);
    const focusVerify = useRef(false);
    let account: { email: string } | null = null;
    let sessionError = '';
    if (session.trim()) {
        try {
            account = inspectRechargeSession(session, language);
        } catch (reason) {
            sessionError = (reason as Error).message;
        }
    }
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    useEffect(() => {
        const snapshot = taskQuery.data;
        if (!snapshot) return;
        // Keep the latest receipt while switching tabs or language scopes. The
        // query itself is discarded when unobserved and never persisted.
        setTask(previous =>
            previous?.id === snapshot.id && Date.parse(previous.updatedAt) < Date.parse(snapshot.updatedAt)
                ? snapshot
                : previous,
        );
        setQueryResult(previous =>
            previous?.task?.id === snapshot.id &&
            Date.parse(previous.task.updatedAt) < Date.parse(snapshot.updatedAt)
                ? { ...previous, task: snapshot }
                : previous,
        );
    }, [taskQuery.data]);

    useEffect(() => {
        if (tab !== 'query' || busy || !focusLookup.current) return;
        focusLookup.current = false;
        document.getElementById('gpt-query')?.focus();
    }, [tab, busy]);

    useEffect(() => {
        if (tab !== 'recharge' || busy || !focusVerify.current || !canStartRecharge) return;
        focusVerify.current = false;
        codeInput.current?.focus();
    }, [tab, busy, canStartRecharge]);

    useEffect(() => {
        const card = matchedPlanCard.current;
        if (!card || verified?.status !== 'available') return;
        const bounds = card.getBoundingClientRect();
        if (bounds.top < 0 || bounds.bottom > window.innerHeight)
            card.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
    }, [verified]);

    useEffect(() => {
        if (!feedbackAttempt || busy) return;
        if (tab !== (feedbackAttempt === 'query' ? 'query' : 'recharge')) return;
        const feedback = error?.scope === feedbackAttempt ? error : null;
        const section = document.querySelector(`[data-gpt-challenge="${feedbackAttempt}"]`);
        const target = feedback
            ? document.getElementById(
                  feedback.field
                      ? feedback.field === 'code'
                          ? 'gpt-code'
                          : 'gpt-query'
                      : `gpt-${feedbackAttempt}-error`,
              )
            : feedbackAttempt === 'paste'
              ? sessionField.current
              : section?.querySelector<HTMLElement>('input:not(:disabled), .shop-abuse-challenge-error');
        if (!target) return;
        target.focus({ preventScroll: true });
        const bounds = target.getBoundingClientRect();
        if (bounds.top < 0 || bounds.bottom > window.innerHeight)
            target.scrollIntoView?.({ block: 'center', behavior: 'instant' });
    }, [feedbackAttempt, busy, error, tab]);

    async function run(kind: RechargeOperation, work: () => Promise<void>) {
        if (operation.current) return;
        operation.current = true;
        operationScope.current = kind;
        setBusy(kind);
        setError(null);
        setFeedbackAttempt(null);
        try {
            await work();
        } catch (reason) {
            if (mounted.current) {
                const scope = operationScope.current;
                const errorCode = storefrontErrorCode(reason);
                if (
                    (scope === 'verify' || scope === 'query') &&
                    errorCode === 'USER_INPUT_ERROR' &&
                    reason instanceof Error &&
                    reason.message === '兑换码无效或已停用，请核对后重试'
                ) {
                    setError({
                        scope,
                        field: scope === 'verify' ? 'code' : 'query',
                        text: t(
                            '兑换码无效或已停用，请核对后重试。',
                            'This redemption code is invalid or disabled. Check the code and try again.',
                        ),
                    });
                    return;
                }
                const fallback =
                    scope === 'verify'
                        ? t(
                              '暂时无法验证兑换码，请稍后重试。',
                              'Could not verify your code. Please try again later.',
                          )
                        : t(
                              '暂时无法查询结果，请稍后重试查询。',
                              'Could not look up the result. Please try again later.',
                          );
                setError({
                    scope,
                    text:
                        errorCode === 'USER_INPUT_ERROR'
                            ? fallback
                            : storefrontErrorMessage(reason, language, fallback),
                });
            }
        } finally {
            operation.current = false;
            if (mounted.current) {
                setBusy('');
                setFeedbackAttempt(operationScope.current);
            }
        }
    }
    function changeCode(value: string) {
        codeChallenge.reset();
        submitChallenge.reset();
        requestVersion.current++;
        setCode(value);
        authorizationKey.current = undefined;
        setAuthorizationUrl(undefined);
        if (isPartnerRechargeCode(value)) setSession('');
        setVerified(null);
        setConfirmed(false);
        setError(null);
        setFeedbackAttempt(null);
    }
    function changeLookupCode(value: string) {
        if (value === queryCode) return;
        queryChallenge.reset();
        lookupVersion.current++;
        setQueryCode(value);
    }
    async function pasteCode(lookup = false) {
        const input = lookup ? lookupInput.current : codeInput.current;
        if (!input || pastingCode || pastingQuery || operation.current) return;
        const versionRef = lookup ? lookupVersion : requestVersion;
        const version = versionRef.current;
        const setPasting = lookup ? setPastingQuery : setPastingCode;
        setPasting(true);
        let value: string | undefined;
        try {
            value = (await navigator.clipboard?.readText?.())?.trim();
        } catch {
            // The browser may require manual paste for this site.
        }
        if (!mounted.current) return;
        setPasting(false);
        if (
            input !== (lookup ? lookupInput.current : codeInput.current) ||
            version !== versionRef.current ||
            operation.current
        )
            return;
        if (value && value.length <= redemptionCodeMaxLength && !/[\r\n]/.test(value)) {
            if (lookup) changeLookupCode(value);
            else changeCode(value);
            setError(null);
        } else {
            setFeedbackAttempt(null);
            setError({
                scope: lookup ? 'query' : 'verify',
                field: lookup ? 'query' : 'code',
                text:
                    value === undefined
                        ? t(
                              '无法读取剪贴板，请在输入框手动粘贴。',
                              'Clipboard access is unavailable. Paste into the code field.',
                          )
                        : t(
                              '请先复制一条兑换码，或在输入框手动填写。',
                              'Copy one redemption code first, or enter it in the code field.',
                          ),
            });
        }
        input.focus();
    }
    function changeSession(value: string) {
        setSession(value);
        setConfirmed(false);
        if (error?.scope === 'submit' || error?.scope === 'paste') setError(null);
        setFeedbackAttempt(null);
    }
    async function pasteSession() {
        await run('paste', async () => {
            const field = sessionField.current;
            let value: string;
            try {
                value = await navigator.clipboard.readText();
            } catch {
                throw new StorefrontDisplayError(
                    {
                        zh: '浏览器无法读取剪贴板，请在输入框内手动粘贴 JSON。',
                        en: 'Clipboard access is unavailable. Paste the JSON into the field manually.',
                    },
                    language,
                );
            }
            // A delayed permission response must not fill a field that the user has left.
            if (!mounted.current || !field || sessionField.current !== field) return;
            if (!value.trim())
                throw new StorefrontDisplayError(
                    {
                        zh: '剪贴板为空，请先复制完整账号资料。',
                        en: 'The clipboard is empty. Copy the complete account data first.',
                    },
                    language,
                );
            if (value.length > 256000)
                throw new StorefrontDisplayError(
                    {
                        zh: '账号资料过长，请重新复制完整 Session JSON。',
                        en: 'Account data is too long. Copy the complete session JSON again.',
                    },
                    language,
                );
            changeSession(value);
        });
    }
    async function verify() {
        if (!canStartRecharge || pastingCode) return;
        if (!code.trim()) {
            setError({
                scope: 'verify',
                field: 'code',
                text: t('请输入兑换码。', 'Enter your redemption code.'),
            });
            setFeedbackAttempt('verify');
            return;
        }
        const version = requestVersion.current;
        await run('verify', async () => {
            setVerified(null);
            setConfirmed(false);
            const checked = await codeChallenge.execute('RECHARGE_CODE', code.trim(), proof =>
                client.verify(code.trim(), ...(proof ? ([proof] as const) : [])),
            );
            if (!checked.executed) return;
            const result = checked.value;
            if (!mounted.current || version !== requestVersion.current) return;
            setVerified(result);
            if (result.status !== 'available') {
                setQueryCode(code);
                queryChallenge.reset();
                setQueryResult(result.reason === 'manual_review_required' ? result : null);
                setTab('query');
                operationScope.current = 'query';
                if (result.reason === 'manual_review_required') return;
                const current = await queryChallenge.execute('RECHARGE_CODE', code.trim(), proof =>
                    client.query(code.trim(), ...(proof ? ([proof] as const) : [])),
                );
                if (mounted.current && current.executed) {
                    if (current.value.task) updateExistingTask(current.value.task);
                    setQueryResult(current.value);
                }
            }
        });
    }
    async function submit() {
        if (
            !verified ||
            verified.status !== 'available' ||
            !account ||
            !confirmed ||
            pastingCode ||
            uncertain ||
            task ||
            !canStartRecharge
        )
            return;
        await run('submit', async () => {
            try {
                const accepted = await submitChallenge.execute('RECHARGE_SUBMIT', code.trim(), proof =>
                    client.submit(code.trim(), session, ...(proof ? ([proof] as const) : [])),
                );
                if (!accepted.executed) return;
                const next = {
                    ...accepted.value,
                    accountEmail: accepted.value.accountEmail ?? account?.email,
                };
                if (mounted.current) {
                    updateExistingTask(next);
                    setTask(next);
                    setSession('');
                    setConfirmed(false);
                }
            } catch (reason) {
                if (shopAbuseFailure(reason)) {
                    if (mounted.current)
                        setError({ scope: 'submit', text: storefrontErrorMessage(reason, language) });
                    return;
                }
                if (
                    mounted.current &&
                    (reason as { errorCode?: string })?.errorCode === 'GPT_RECHARGE_NOT_ACCEPTED'
                ) {
                    setSession('');
                    setConfirmed(false);
                    setError({
                        scope: 'submit',
                        text: t(
                            '本次提交未受理。请重新获取账号资料；如仍无法提交，请稍后再试。',
                            'Your submission was not accepted. Get fresh account data and try again later if needed.',
                        ),
                    });
                    return;
                }
                if (mounted.current) {
                    setUncertain(true);
                    setSession('');
                    setError({
                        scope: 'submit',
                        text: t(
                            '提交结果暂时无法确认，请用原兑换码查询，避免重复充值。',
                            'The submission result is uncertain. Look up the original code to avoid a duplicate recharge.',
                        ),
                    });
                }
            }
        });
    }
    async function startAuthorization() {
        const authorize = client.authorize?.bind(client);
        if (!partnerCode || !authorize || verified?.status !== 'available' || !canStartRecharge) return;
        authorizationKey.current ??= crypto.randomUUID();
        const key = authorizationKey.current;
        await run('submit', async () => {
            const response = await submitChallenge.execute('RECHARGE_SUBMIT', code.trim(), proof =>
                authorize(code.trim(), key, proof),
            );
            if (!mounted.current || !response.executed) return;
            setTask(response.value.task);
            setAuthorizationUrl(response.value.authorizationUrl ?? undefined);
        });
    }
    const query = () => {
        if (!queryCode.trim()) {
            setError({
                scope: 'query',
                field: 'query',
                text: t('请输入需要查询的兑换码。', 'Enter the code to look up.'),
            });
            setFeedbackAttempt('query');
            return;
        }
        const submittedCode = queryCode.trim();
        return run('query', async () => {
            const next = await queryChallenge.execute('RECHARGE_CODE', submittedCode, proof =>
                client.query(submittedCode, ...(proof ? ([proof] as const) : [])),
            );
            if (mounted.current && next.executed) {
                if (next.value.task) updateExistingTask(next.value.task);
                setQueryResult(next.value);
                setQueriedCode(submittedCode);
                reconnect();
            }
        });
    };
    // Keep the form mounted during the initial read and require confirmed availability for actions.
    const showServiceStatus =
        !canStartRecharge && !checkingService && !currentTask && !uncertain && busy !== 'submit';
    const serviceStatusTitle = config
        ? config.maintenance
            ? t('充值服务维护中', 'Recharge is under maintenance')
            : t('充值服务暂未开放', 'Recharge is currently unavailable')
        : configPresentation.paused
          ? t('网络连接不可用', 'You are offline')
          : t('暂时无法确认充值服务状态', 'Could not confirm recharge availability');
    const submitHelp =
        !canStartRecharge && !checkingService
            ? serviceStatusTitle
            : !verified || verified.status !== 'available'
              ? t('请先验证兑换码。', 'Verify your redemption code first.')
              : !account
                ? t('请填写有效的账号资料。', 'Enter valid account data.')
                : !confirmed
                  ? t(
                        '请核对账号与套餐，并勾选确认。',
                        'Check the account and plan, then select the confirmation checkbox.',
                    )
                  : '';
    return (
        <main className="page subpage gpt-recharge-page">
            <SubHeader
                title={t('ChatGPT自助充值', 'ChatGPT Recharge')}
                language={language}
                onBack={onBack}
                actionVisibility="mobile"
                action={
                    localePreferences && (
                        <LocalePreferencesTrigger
                            language={language}
                            currencyCode={localePreferences.currencyCode}
                            expanded={preferencesOpen}
                            onClick={() => setPreferencesOpen(true)}
                        />
                    )
                }
            />
            <SubpageBody>
                <div className="gpt-recharge-intro">
                    <ul className="gpt-recharge-trust" aria-label={t('服务特点', 'Service features')}>
                        {[
                            { Icon: ShieldCheck, label: t('安全加密', 'Encrypted') },
                            { Icon: CheckCircle2, label: t('自动处理', 'Automated') },
                            { Icon: Clock3, label: t('进度可查', 'Track progress') },
                            { Icon: LockKeyhole, label: t('套餐锁定', 'Plan protected') },
                        ].map(({ Icon, label }) => (
                            <li key={label}>
                                <Icon size={16} aria-hidden="true" />
                                <span>{label}</span>
                            </li>
                        ))}
                    </ul>
                    <div className="gpt-recharge-quick-links">
                        <button
                            type="button"
                            className="gpt-recharge-text-button"
                            onClick={() => productsCollection && onViewProducts?.(productsCollection.id)}
                            disabled={!canViewProducts}
                            title={
                                canViewProducts
                                    ? undefined
                                    : t(
                                          '商品分类暂不可用，请稍后重试',
                                          'Product category is temporarily unavailable',
                                      )
                            }
                        >
                            <ShoppingBag size={17} aria-hidden="true" />
                            {t('查看商品', 'View products')}
                        </button>
                        <button
                            type="button"
                            className="gpt-recharge-text-button"
                            onClick={onContactSupport}
                            disabled={!onContactSupport}
                        >
                            <Headphones size={17} aria-hidden="true" />
                            {t('联系客服', 'Contact support')}
                        </button>
                    </div>
                </div>
                <section className="gpt-recharge-surface">
                    <div className="gpt-recharge-workspace">
                        <div className="gpt-recharge-left">
                            <nav
                                className="gpt-recharge-tabs"
                                aria-label={t('充值功能', 'Recharge sections')}
                            >
                                {(['recharge', 'query', 'guide'] as const).map((key, index) => (
                                    <button
                                        key={key}
                                        type="button"
                                        aria-current={tab === key ? 'page' : undefined}
                                        onClick={() => {
                                            setTab(key);
                                            setError(null);
                                            setFeedbackAttempt(null);
                                        }}
                                    >
                                        {
                                            [
                                                t('自助充值', 'Recharge'),
                                                t('兑换码查询', 'Code lookup'),
                                                t('使用说明', 'How it works'),
                                            ][index]
                                        }
                                    </button>
                                ))}
                            </nav>
                            {tab === 'recharge' && showServiceStatus && (
                                <div className="gpt-recharge-result">
                                    <Clock3 size={36} aria-hidden="true" />
                                    <h2 aria-live="polite">{serviceStatusTitle}</h2>
                                    <p>
                                        {t(
                                            '已提交的充值可用原兑换码查询进度。',
                                            'Use your original code to check the progress of an existing recharge.',
                                        )}
                                    </p>
                                    <div className="gpt-recharge-service-actions">
                                        <button
                                            className="primary-action"
                                            type="button"
                                            onClick={() => {
                                                if (!queryCode && code) changeLookupCode(code);
                                                setError(null);
                                                setFeedbackAttempt(null);
                                                focusLookup.current = true;
                                                setTab('query');
                                            }}
                                        >
                                            {t('查询已有任务', 'Look up an existing task')}
                                        </button>
                                        {!configPresentation.initialLoading && (
                                            <button
                                                className="secondary-action"
                                                type="button"
                                                disabled={configQuery.isFetching}
                                                aria-busy={configQuery.isFetching}
                                                onClick={() =>
                                                    void configQuery.refetch({ cancelRefetch: false })
                                                }
                                            >
                                                {configQuery.isFetching
                                                    ? t('正在检查…', 'Checking…')
                                                    : t('重新检查服务状态', 'Check service status again')}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                            {tab === 'recharge' &&
                                !showServiceStatus &&
                                (currentTask ? (
                                    <div className="gpt-recharge-submitted">
                                        <RechargeTaskDetails task={currentTask} language={language} />
                                        {currentTask.status === 'awaiting_authorization' &&
                                            authorizationUrl && (
                                                <a
                                                    className="primary-action gpt-recharge-submit"
                                                    href={authorizationUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    referrerPolicy="no-referrer"
                                                >
                                                    {t(
                                                        '前往 ID 系统授权',
                                                        'Continue to ID account authorization',
                                                    )}{' '}
                                                    <ArrowUpRight size={18} />
                                                </a>
                                            )}
                                    </div>
                                ) : uncertain ? (
                                    <div className="gpt-recharge-result">
                                        <Clock3 size={36} />
                                        <h2>{t('正在确认提交结果', 'Confirming your submission')}</h2>
                                        <p>
                                            {t(
                                                '请查询原兑换码，我们不会自动再次提交充值。',
                                                'Look up the original code. We will not automatically resubmit.',
                                            )}
                                        </p>
                                        {error?.scope === 'submit' && (
                                            <RechargeError id="gpt-submit-error" message={error.text} />
                                        )}
                                        <button
                                            className="primary-action"
                                            onClick={() => {
                                                changeLookupCode(code);
                                                setTab('query');
                                            }}
                                        >
                                            {t('查询原任务', 'Look up original task')}
                                        </button>
                                    </div>
                                ) : (
                                    <div
                                        className="gpt-recharge-layout"
                                        aria-label={t('充值表单', 'Recharge form')}
                                    >
                                        <section className="gpt-recharge-code-section">
                                            <div className="gpt-recharge-section-title">
                                                <h2>{t('验证兑换码', 'Verify your code')}</h2>
                                            </div>
                                            <form
                                                noValidate
                                                aria-busy={busy === 'verify'}
                                                onSubmit={event => {
                                                    event.preventDefault();
                                                    if (!busy && !task && !uncertain) void verify();
                                                }}
                                            >
                                                <div className="gpt-recharge-code-row">
                                                    <input
                                                        id="gpt-code"
                                                        aria-label={t('兑换码', 'Redemption code')}
                                                        ref={codeInput}
                                                        value={code}
                                                        onChange={event => changeCode(event.target.value)}
                                                        disabled={Boolean(busy)}
                                                        maxLength={redemptionCodeMaxLength}
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        aria-invalid={
                                                            error?.scope === 'verify' &&
                                                            error.field === 'code'
                                                        }
                                                        aria-describedby={
                                                            error?.scope === 'verify' &&
                                                            error.field === 'code'
                                                                ? 'gpt-code-error'
                                                                : undefined
                                                        }
                                                        placeholder={t(
                                                            '输入购买后收到的兑换码',
                                                            'Enter your redemption code',
                                                        )}
                                                    />
                                                    <button
                                                        type="button"
                                                        className="secondary-action gpt-recharge-paste"
                                                        aria-busy={pastingCode}
                                                        disabled={pastingCode || Boolean(busy)}
                                                        onClick={() => void pasteCode()}
                                                    >
                                                        <ClipboardPaste size={16} aria-hidden="true" />
                                                        {t('粘贴', 'Paste')}
                                                    </button>
                                                </div>
                                                {error?.scope === 'verify' && error.field === 'code' && (
                                                    <RechargeError
                                                        id="gpt-code-error"
                                                        message={error.text}
                                                        field
                                                    />
                                                )}
                                                <div data-gpt-challenge="verify">
                                                    <ShopAbuseChallengeControl
                                                        challenge={codeChallenge}
                                                        language={language}
                                                        submitLabel={t('验证兑换码', 'Verify code')}
                                                    />
                                                </div>
                                                {error?.scope === 'verify' && !error.field && (
                                                    <RechargeError
                                                        id="gpt-verify-error"
                                                        message={error.text}
                                                    />
                                                )}
                                                <button
                                                    type="submit"
                                                    className={`${verified ? 'secondary-action' : 'primary-action'} gpt-recharge-verify`}
                                                    disabled={
                                                        !canStartRecharge ||
                                                        pastingCode ||
                                                        Boolean(busy) ||
                                                        codeChallenge.state?.loading
                                                    }
                                                    aria-busy={checkingService || busy === 'verify'}
                                                >
                                                    {busy === 'verify'
                                                        ? t('验证中…', 'Checking…')
                                                        : checkingService && serviceLoading?.slow
                                                          ? t('服务响应较慢，请稍候', 'Waiting for service…')
                                                          : t('验证兑换码', 'Verify code')}
                                                </button>
                                            </form>
                                            <section
                                                className="gpt-recharge-plan-panel"
                                                aria-labelledby="gpt-recharge-plan-title"
                                            >
                                                <div className="gpt-recharge-plan-heading">
                                                    <h3 id="gpt-recharge-plan-title">
                                                        {t('充值套餐', 'Recharge plan')}
                                                    </h3>
                                                    <span className="gpt-recharge-plan-status" role="status">
                                                        {verified
                                                            ? t('已匹配', 'Matched') +
                                                              ' ' +
                                                              rechargePlanLabel(verified.plan)
                                                            : busy === 'verify'
                                                              ? t('正在验证…', 'Checking…')
                                                              : t(
                                                                    '验码后自动匹配',
                                                                    'Matched after verification',
                                                                )}
                                                    </span>
                                                </div>
                                                <ul
                                                    className="gpt-recharge-plan-list"
                                                    aria-label={t('套餐类型', 'Plan types')}
                                                >
                                                    {rechargePlans.map(({ key, label }) => (
                                                        <li
                                                            key={key}
                                                            ref={
                                                                verified?.plan === key
                                                                    ? matchedPlanCard
                                                                    : undefined
                                                            }
                                                            aria-current={
                                                                verified?.plan === key ? 'true' : undefined
                                                            }
                                                        >
                                                            <span>{label}</span>
                                                            {verified?.plan === key && (
                                                                <CheckCircle2 size={16} aria-hidden="true" />
                                                            )}
                                                        </li>
                                                    ))}
                                                    <li className="gpt-recharge-plan-unavailable">
                                                        <span>Pro500</span>
                                                        <small>{t('暂未开放', 'Coming soon')}</small>
                                                    </li>
                                                </ul>
                                            </section>
                                        </section>
                                        {partnerCode ? (
                                            <section className="gpt-recharge-account-section">
                                                <h2>
                                                    {t('在 ID 系统完成授权', 'Authorize on the ID system')}
                                                </h2>
                                                <div data-gpt-challenge="submit">
                                                    <ShopAbuseChallengeControl
                                                        challenge={submitChallenge}
                                                        language={language}
                                                        submitLabel={t(
                                                            '生成授权链接',
                                                            'Create authorization link',
                                                        )}
                                                        onSubmit={() => void startAuthorization()}
                                                    />
                                                </div>
                                                {error?.scope === 'submit' && (
                                                    <RechargeError
                                                        id="gpt-submit-error"
                                                        message={error.text}
                                                    />
                                                )}
                                                <button
                                                    className="primary-action gpt-recharge-submit"
                                                    type="button"
                                                    disabled={
                                                        !client.authorize ||
                                                        verified?.status !== 'available' ||
                                                        Boolean(busy) ||
                                                        !canStartRecharge ||
                                                        submitChallenge.state?.loading
                                                    }
                                                    onClick={() => void startAuthorization()}
                                                >
                                                    {busy === 'submit'
                                                        ? t('生成中…', 'Creating…')
                                                        : t('生成授权链接', 'Create authorization link')}
                                                </button>
                                            </section>
                                        ) : (
                                            <section className="gpt-recharge-account-section">
                                                <div className="gpt-recharge-section-title gpt-recharge-account-heading">
                                                    <h2>{t('填写账号并提交', 'Enter account and submit')}</h2>
                                                    <div className="gpt-recharge-field-actions">
                                                        <a
                                                            className="secondary-action gpt-recharge-session-link"
                                                            href={CHATGPT_SESSION_URL}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                        >
                                                            {t('前往获取 JSON', 'Get JSON')}
                                                            <ArrowUpRight size={16} aria-hidden="true" />
                                                        </a>
                                                        <button
                                                            className="secondary-action gpt-recharge-session-link"
                                                            type="button"
                                                            disabled={Boolean(busy)}
                                                            aria-busy={busy === 'paste'}
                                                            aria-controls="gpt-session"
                                                            onClick={() => void pasteSession()}
                                                        >
                                                            <ClipboardPaste size={16} aria-hidden="true" />
                                                            {busy === 'paste'
                                                                ? t('粘贴中…', 'Pasting…')
                                                                : t('一键粘贴', 'Paste JSON')}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="gpt-recharge-field">
                                                    <textarea
                                                        id="gpt-session"
                                                        aria-label={t(
                                                            '账号资料（JSON）',
                                                            'Account data (JSON)',
                                                        )}
                                                        ref={sessionField}
                                                        value={session}
                                                        onChange={event => changeSession(event.target.value)}
                                                        disabled={Boolean(busy)}
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        maxLength={256000}
                                                        placeholder={t(
                                                            '在此粘贴完整账号资料（JSON）',
                                                            'Paste the complete account data (JSON) here',
                                                        )}
                                                        aria-invalid={Boolean(sessionError)}
                                                        aria-describedby={
                                                            error?.scope === 'paste'
                                                                ? 'gpt-paste-error'
                                                                : sessionError
                                                                  ? 'gpt-session-error'
                                                                  : 'gpt-session-help'
                                                        }
                                                    />
                                                </div>
                                                {sessionError && (
                                                    <RechargeError
                                                        id="gpt-session-error"
                                                        message={sessionError}
                                                        field
                                                    />
                                                )}
                                                {error?.scope === 'paste' && (
                                                    <RechargeError
                                                        id="gpt-paste-error"
                                                        message={error.text}
                                                    />
                                                )}
                                                <dl className="gpt-recharge-summary">
                                                    <div>
                                                        <dt>{t('目标账号', 'Account')}</dt>
                                                        <dd>
                                                            {account?.email ??
                                                                t('填写后显示', 'Shown after validation')}
                                                        </dd>
                                                    </div>
                                                    <div>
                                                        <dt>{t('充值套餐', 'Plan')}</dt>
                                                        <dd>
                                                            {verified
                                                                ? rechargePlanLabel(verified.plan)
                                                                : t('验码后确认', 'Confirmed by code')}
                                                        </dd>
                                                    </div>
                                                </dl>
                                                <label className="gpt-recharge-confirm">
                                                    <input
                                                        type="checkbox"
                                                        checked={confirmed}
                                                        disabled={!verified || !account || Boolean(busy)}
                                                        onChange={event => setConfirmed(event.target.checked)}
                                                    />
                                                    <span>
                                                        {t(
                                                            '我已核对账号与套餐',
                                                            'I have checked the account and plan',
                                                        )}
                                                    </span>
                                                </label>
                                                <div data-gpt-challenge="submit">
                                                    <ShopAbuseChallengeControl
                                                        challenge={submitChallenge}
                                                        language={language}
                                                        submitLabel={t('充值提交', 'Submit recharge')}
                                                        onSubmit={() => void submit()}
                                                    />
                                                </div>
                                                {error?.scope === 'submit' && (
                                                    <RechargeError
                                                        id="gpt-submit-error"
                                                        message={error.text}
                                                    />
                                                )}
                                                {submitHelp && (
                                                    <p
                                                        id="gpt-submit-help"
                                                        className="gpt-recharge-helper"
                                                        role="status"
                                                    >
                                                        {submitHelp}
                                                    </p>
                                                )}
                                                <button
                                                    className="primary-action gpt-recharge-submit"
                                                    type="button"
                                                    aria-describedby={
                                                        submitHelp ? 'gpt-submit-help' : undefined
                                                    }
                                                    disabled={
                                                        !confirmed ||
                                                        !verified ||
                                                        !account ||
                                                        pastingCode ||
                                                        Boolean(busy) ||
                                                        !canStartRecharge ||
                                                        submitChallenge.state?.loading
                                                    }
                                                    onClick={() => void submit()}
                                                >
                                                    {busy === 'submit'
                                                        ? t('正在提交…', 'Submitting…')
                                                        : t('充值提交', 'Submit recharge')}
                                                    <ArrowRight size={18} />
                                                </button>
                                                <p id="gpt-session-help" className="gpt-recharge-privacy">
                                                    <ShieldCheck size={16} />
                                                    {t(
                                                        '账号资料仅用于充值，请勿转发给他人。',
                                                        'Account data is used for recharge only. Do not share it.',
                                                    )}
                                                </p>
                                            </section>
                                        )}
                                    </div>
                                ))}
                            {tab === 'query' && (
                                <div className="gpt-recharge-query">
                                    <div className="gpt-recharge-query-input">
                                        <h2 className="gpt-recharge-query-title">
                                            <Search size={20} aria-hidden="true" />
                                            {t('兑换码查询', 'Code lookup')}
                                        </h2>
                                        <p>
                                            {t(
                                                '输入原兑换码，查看套餐与充值进度。',
                                                'Enter your original code to check its plan and progress.',
                                            )}
                                        </p>
                                        <form
                                            noValidate
                                            onSubmit={event => {
                                                event.preventDefault();
                                                if (!busy) void query();
                                            }}
                                        >
                                            <label className="gpt-recharge-field" htmlFor="gpt-query">
                                                <span>{t('兑换码', 'Redemption code')}</span>
                                                <span className="gpt-recharge-code-row">
                                                    <input
                                                        id="gpt-query"
                                                        ref={lookupInput}
                                                        spellCheck={false}
                                                        value={queryCode}
                                                        onChange={event => {
                                                            changeLookupCode(event.target.value);
                                                            setError(null);
                                                            setFeedbackAttempt(null);
                                                        }}
                                                        maxLength={redemptionCodeMaxLength}
                                                        disabled={Boolean(busy)}
                                                        autoComplete="off"
                                                        aria-invalid={
                                                            error?.scope === 'query' &&
                                                            error.field === 'query'
                                                        }
                                                        aria-describedby={
                                                            error?.scope === 'query'
                                                                ? 'gpt-query-error'
                                                                : undefined
                                                        }
                                                        placeholder={t(
                                                            '输入需要查询的兑换码',
                                                            'Enter the code to look up',
                                                        )}
                                                    />
                                                    <button
                                                        type="button"
                                                        className="secondary-action gpt-recharge-paste"
                                                        disabled={pastingQuery || Boolean(busy)}
                                                        aria-busy={pastingQuery}
                                                        onClick={() => void pasteCode(true)}
                                                    >
                                                        <ClipboardPaste size={16} aria-hidden="true" />
                                                        {t('粘贴', 'Paste')}
                                                    </button>
                                                </span>
                                            </label>
                                            {error?.scope === 'query' && error.field && (
                                                <RechargeError
                                                    id="gpt-query-error"
                                                    message={error.text}
                                                    field
                                                />
                                            )}
                                            <div data-gpt-challenge="query">
                                                <ShopAbuseChallengeControl
                                                    challenge={queryChallenge}
                                                    language={language}
                                                    submitLabel={t('查询进度', 'Check progress')}
                                                />
                                            </div>
                                            {error?.scope === 'query' && !error.field && (
                                                <RechargeError id="gpt-query-error" message={error.text} />
                                            )}
                                            <button
                                                className="primary-action"
                                                disabled={Boolean(busy) || queryChallenge.state?.loading}
                                            >
                                                {busy === 'query'
                                                    ? t('正在查询…', 'Looking up…')
                                                    : t('查询进度', 'Check progress')}
                                            </button>
                                        </form>
                                        <p className="gpt-recharge-query-note">
                                            <ShieldCheck size={16} aria-hidden="true" />
                                            {t(
                                                '查询不会重复提交充值。',
                                                'Looking up a code will not submit another recharge.',
                                            )}
                                        </p>
                                    </div>
                                    {currentTask && (
                                        <RechargeTaskDetails task={currentTask} language={language} />
                                    )}
                                </div>
                            )}
                            {tab === 'guide' && (
                                <GptRechargeGuide
                                    language={language}
                                    onRecharge={() => setTab('recharge')}
                                    onQuery={() => setTab('query')}
                                />
                            )}
                        </div>
                        <aside
                            className="gpt-recharge-progress-rail"
                            aria-label={t('充值进度', 'Recharge progress')}
                        >
                            {selectedTab === 'query' && queriedCode && queryCode.trim() !== queriedCode && (
                                <p className="gpt-recharge-helper">
                                    {t(
                                        '当前显示上次查询结果。输入已修改，请点击查询更新。',
                                        'Showing the previous result. Check the edited code to update it.',
                                    )}
                                </p>
                            )}
                            <RechargeProgressPanel
                                task={currentTask}
                                language={language}
                                sync={taskSync}
                                manual={manual}
                                onRefresh={() => void refreshTask()}
                                onContactSupport={onContactSupport}
                                code={selectedTab === 'query' ? queryResult : null}
                                onRetry={
                                    currentTask?.status === 'expired'
                                        ? () => {
                                              setTask(null);
                                              setQueryResult(null);
                                              setVerified(null);
                                              setAuthorizationUrl(undefined);
                                              authorizationKey.current = undefined;
                                              setTab('recharge');
                                          }
                                        : selectedTab === 'query' &&
                                            queryResult?.reason === 'verified_retry_available' &&
                                            currentTask?.status === 'failed' &&
                                            canStartRecharge &&
                                            !busy
                                          ? () => {
                                                changeCode(queriedCode);
                                                setSession('');
                                                setTask(null);
                                                setQueryResult(null);
                                                setUncertain(false);
                                                focusVerify.current = true;
                                                setTab('recharge');
                                            }
                                          : undefined
                                }
                            />
                        </aside>
                    </div>
                </section>
                {tab === 'recharge' && !showServiceStatus && (
                    <div className="gpt-recharge-help-links">
                        <button className="gpt-recharge-text-button" onClick={() => setTab('guide')}>
                            <BookOpen size={16} />
                            {t('查看使用说明', 'View instructions')}
                            <ChevronRight size={16} />
                        </button>
                        <button
                            className="gpt-recharge-text-button"
                            onClick={() => {
                                changeLookupCode(code);
                                setTab('query');
                            }}
                        >
                            {t('已有任务？查询进度', 'Already submitted? Check status')}
                            <ChevronRight size={16} />
                        </button>
                    </div>
                )}
            </SubpageBody>
            {preferencesOpen && localePreferences && (
                <LocalePreferencesSheet
                    storefrontLabel={localePreferences.storefrontName}
                    language={language}
                    currencyCodes={
                        localePreferences.currencyCodes.length
                            ? localePreferences.currencyCodes
                            : [localePreferences.currencyCode]
                    }
                    selectedCurrencyCode={localePreferences.currencyCode}
                    currencyLoading={localePreferences.currencyLoading}
                    onToggleLanguage={localePreferences.onToggleLanguage}
                    onSelectCurrency={localePreferences.onCurrencyChange}
                    onClose={() => setPreferencesOpen(false)}
                />
            )}
        </main>
    );
}

function RechargeError({ id, message, field = false }: { id: string; message: string; field?: boolean }) {
    return (
        <p
            id={id}
            className={`gpt-recharge-alert ${field ? 'gpt-recharge-field-error' : 'gpt-recharge-action-error'}`}
            role="alert"
            tabIndex={-1}
        >
            <CircleAlert size={18} aria-hidden="true" />
            <span>{message}</span>
        </p>
    );
}
