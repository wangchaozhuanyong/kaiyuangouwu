import { CircleAlert, Download, Send, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { StorefrontLanguage } from '../../types';
import type { Fields } from './model';

import { storefrontErrorMessage } from '../../storefront-errors';

import {
    isTerminalSubmission,
    officialSubmissionInput,
    readSubmissionRecord,
    saveSubmissionRecord,
    type MdacSubmissionService,
    type MdacSubmissionView,
} from './mdac-submission';

interface SubmittedTraveler {
    name: string;
    view: MdacSubmissionView;
}

const pollInterval = 4000;
const pollBudget = 5 * 60_000;

export function MdacSubmitPanel({
    language,
    service,
    travelers,
    shared,
    scope,
    disabled,
}: {
    language: StorefrontLanguage;
    service?: MdacSubmissionService;
    travelers: Fields[];
    shared: Fields;
    scope: string;
    disabled: boolean;
}) {
    const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState('');
    const [message, setMessage] = useState('');
    const [results, setResults] = useState<SubmittedTraveler[]>([]);
    const [recovering, setRecovering] = useState(false);
    const mounted = useRef(true);
    const pending = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    // Restore the pointers this browser kept, then re-read authoritative status.
    useEffect(() => {
        if (!service) return;
        const known = readSubmissionRecord()[scope];
        if (!known?.length) return;
        const signal = new AbortController();
        setRecovering(true);
        void Promise.all(known.map(entry => service.status(entry.id, signal.signal).catch(() => null)))
            .then(views => {
                if (!mounted.current) return;
                setResults(
                    known
                        .map((entry, index) => {
                            const view = views[index];
                            return view ? { name: view.travelerName || entry.name, view } : null;
                        })
                        .filter((item): item is SubmittedTraveler => Boolean(item)),
                );
            })
            .finally(() => {
                if (mounted.current) setRecovering(false);
            });
        return () => signal.abort();
    }, [service, scope]);

    const waitForTerminal = useCallback(
        async (id: string, signal: AbortSignal): Promise<MdacSubmissionView | null> => {
            if (!service) return null;
            const deadline = Date.now() + pollBudget;
            let latest: MdacSubmissionView | null = null;
            while (Date.now() < deadline && !signal.aborted) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                if (signal.aborted) return latest;
                if (document.visibilityState === 'hidden') continue;
                latest = await service.status(id, signal).catch(() => latest);
                if (!mounted.current) return latest;
                if (latest) {
                    const settled = latest;
                    setResults(previous =>
                        previous.map(item =>
                            item.view.id === settled.id ? { ...item, view: settled } : item,
                        ),
                    );
                    if (isTerminalSubmission(settled.status)) return settled;
                }
            }
            return latest;
        },
        [service],
    );

    const submit = async () => {
        if (!service || disabled || pending.current) return;
        pending.current = true;
        setBusy(true);
        setMessage('');
        const controller = new AbortController();
        const collected: SubmittedTraveler[] = [];
        try {
            const people = travelers.filter(person => person.name?.trim());
            for (const [index, person] of people.entries()) {
                setProgress(
                    t(
                        `正在提交旅客 ${index + 1}/${people.length}：${person.name}`,
                        `Submitting traveler ${index + 1}/${people.length}: ${person.name}`,
                    ),
                );
                const created = await service.create(officialSubmissionInput(person, shared));
                collected.push({ name: created.travelerName || person.name || '', view: created });
                setResults([...collected]);
                saveSubmissionRecord(
                    scope,
                    collected.map(item => ({ id: item.view.id, name: item.name })),
                );
                const final = await waitForTerminal(created.id, controller.signal);
                if (final) {
                    const updated = { name: created.travelerName || person.name || '', view: final };
                    const position = collected.findIndex(item => item.view.id === final.id);
                    if (position >= 0) collected[position] = updated;
                    setResults([...collected]);
                }
            }
            setMessage(
                t(
                    '资料已交给本站提交服务，官方回执号见下方。未出现回执的旅客仍在处理中。',
                    'Details handed to the submission service. Reference numbers appear below; travelers without one are still processing.',
                ),
            );
        } catch (error) {
            // Reviewed local copy only; the server message is used as a signal, never shown raw.
            const serviceDisabled = error instanceof Error && /尚?未启用|not enabled/iu.test(error.message);
            setMessage(
                serviceDisabled
                    ? t(
                          '自动提交服务尚未启用，请使用官方入口完成提交。',
                          'Automatic submission is not enabled. Use the official form below.',
                      )
                    : storefrontErrorMessage(error, language),
            );
        } finally {
            pending.current = false;
            if (mounted.current) {
                setBusy(false);
                setProgress('');
            }
        }
    };

    const download = async (id: string) => {
        if (!service) return;
        try {
            const receipt = await service.receipt(id);
            if (!receipt) {
                setMessage(t('回执尚未生成，请稍后重试。', 'No receipt yet. Try again shortly.'));
                return;
            }
            const bytes = Uint8Array.from(atob(receipt.base64), char => char.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([bytes], { type: receipt.mimeType }));
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = receipt.fileName;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (error) {
            setMessage(storefrontErrorMessage(error, language));
        }
    };

    const statusLabel = (view: MdacSubmissionView) => {
        if (view.status === 'DONE') return t('已提交', 'Submitted');
        if (view.status === 'QUEUED')
            return view.waitingForWindow
                ? t('等待开放窗口', 'Waiting for the window')
                : t('排队中', 'Queued');
        if (view.status === 'RUNNING') return t('提交中', 'Submitting');
        if (view.status === 'MANUAL') return t('需人工确认', 'Needs a manual check');
        return t('未成功', 'Not submitted');
    };

    if (!service)
        return (
            <p className="mdac-message type-helper" role="status">
                {t(
                    '当前环境未启用自动提交，请使用下方官方入口。',
                    'Automatic submission is off in this environment. Use the official link below.',
                )}
            </p>
        );

    return (
        <div className="mdac-submit">
            <p className="type-helper">
                {t(
                    '确认后由本站服务按你填写的资料向马来西亚移民局提交入境卡，并取回回执。每份入境卡对应一位旅客。',
                    'Once confirmed, our service submits each traveler’s card to Malaysian Immigration and returns the receipt.',
                )}
            </p>
            <div className="mdac-actions">
                <button
                    type="button"
                    className="mdac-primary type-action"
                    disabled={disabled || busy || recovering}
                    onClick={() => void submit()}
                >
                    <Send size={16} aria-hidden="true" />
                    {busy ? t('提交中…', 'Submitting…') : t('提交入境卡', 'Submit arrival cards')}
                </button>
            </div>
            {progress && (
                <p className="mdac-message type-helper" role="status">
                    {progress}
                </p>
            )}
            {message && (
                <p className="mdac-message type-helper" role="status">
                    <CircleAlert size={14} aria-hidden="true" /> {message}
                </p>
            )}
            {results.length > 0 && (
                <ul className="mdac-submit-list">
                    {results.map(item => (
                        <li key={item.view.id} className="mdac-submit-row">
                            <span className="type-label">{item.name || item.view.travelerName}</span>
                            <span className="mdac-submit-state type-helper">
                                {statusLabel(item.view)}
                                {item.view.referenceNo ? ` · ${item.view.referenceNo}` : ''}
                            </span>
                            {item.view.status === 'DONE' && item.view.receiptAvailable && (
                                <button
                                    type="button"
                                    className="mdac-link type-action"
                                    onClick={() => void download(item.view.id)}
                                >
                                    <Download size={14} aria-hidden="true" />
                                    {t('下载回执', 'Receipt')}
                                </button>
                            )}
                            {item.view.lastError && item.view.status !== 'DONE' && (
                                <span className="mdac-submit-error type-helper">{item.view.lastError}</span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            <p className="mdac-submit-note type-helper">
                <ShieldCheck size={14} aria-hidden="true" />
                {t(
                    '官方只接受抵达前三天内的申报；在此之前的资料会保留，到窗口自动提交。',
                    'Immigration accepts a card from three days before arrival; earlier details wait and submit automatically.',
                )}
            </p>
        </div>
    );
}
