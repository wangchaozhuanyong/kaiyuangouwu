import { Check, CircleHelp, Copy, X } from 'lucide-react';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
    type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import { featureHelpContent, featureHelpCopyText, type FeatureHelpTopic } from './feature-help-content';
import { calculateFeatureHelpPosition, type FeatureHelpPosition } from './feature-help-position';

const OPEN_DELAY_MS = 140;
const CLOSE_DELAY_MS = 360;
const FALLBACK_POPOVER_WIDTH = 384;
const FALLBACK_POPOVER_HEIGHT = 360;

interface FeatureHelpState {
    topic: FeatureHelpTopic;
    title: string;
    trigger: HTMLButtonElement;
    instanceId: string;
    popoverId: string;
    pinned: boolean;
}

interface FeatureHelpContextValue {
    active: FeatureHelpState | null;
    cancelClose: () => void;
    close: () => void;
    open: (
        topic: FeatureHelpTopic,
        title: string,
        trigger: HTMLButtonElement,
        instanceId: string,
        popoverId: string,
        immediate?: boolean,
    ) => void;
    scheduleClose: () => void;
    toggle: (
        topic: FeatureHelpTopic,
        title: string,
        trigger: HTMLButtonElement,
        instanceId: string,
        popoverId: string,
    ) => void;
}

const FeatureHelpContext = createContext<FeatureHelpContextValue | null>(null);

export function FeatureHelpProvider({ children }: { children: ReactNode }) {
    const [active, setActive] = useState<FeatureHelpState | null>(null);
    const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = useCallback((timerRef: RefObject<ReturnType<typeof setTimeout> | null>) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
    }, []);

    const cancelClose = useCallback(() => clearTimer(closeTimerRef), [clearTimer]);
    const close = useCallback(() => {
        clearTimer(openTimerRef);
        clearTimer(closeTimerRef);
        setActive(null);
    }, [clearTimer]);

    const open = useCallback(
        (
            topic: FeatureHelpTopic,
            title: string,
            trigger: HTMLButtonElement,
            instanceId: string,
            popoverId: string,
            immediate = false,
        ) => {
            clearTimer(openTimerRef);
            cancelClose();

            if (active?.instanceId === instanceId) return;

            const show = () => setActive({ topic, title, trigger, instanceId, popoverId, pinned: false });
            if (immediate) show();
            else openTimerRef.current = setTimeout(show, OPEN_DELAY_MS);
        },
        [active?.instanceId, cancelClose, clearTimer],
    );

    const scheduleClose = useCallback(() => {
        clearTimer(openTimerRef);
        cancelClose();
        if (active?.pinned) return;
        closeTimerRef.current = setTimeout(() => setActive(null), CLOSE_DELAY_MS);
    }, [active?.pinned, cancelClose, clearTimer]);

    const toggle = useCallback(
        (
            topic: FeatureHelpTopic,
            title: string,
            trigger: HTMLButtonElement,
            instanceId: string,
            popoverId: string,
        ) => {
            clearTimer(openTimerRef);
            cancelClose();
            setActive(current => {
                if (current?.instanceId === instanceId) {
                    return current.pinned ? null : { ...current, pinned: true };
                }
                return { topic, title, trigger, instanceId, popoverId, pinned: true };
            });
        },
        [cancelClose, clearTimer],
    );

    useEffect(
        () => () => {
            clearTimer(openTimerRef);
            clearTimer(closeTimerRef);
        },
        [clearTimer],
    );

    const value = useMemo(
        () => ({ active, cancelClose, close, open, scheduleClose, toggle }),
        [active, cancelClose, close, open, scheduleClose, toggle],
    );

    return (
        <FeatureHelpContext.Provider value={value}>
            {children}
            {active && <FeatureHelpPopover state={active} />}
        </FeatureHelpContext.Provider>
    );
}

export function FeatureHelpButton({ topic, title }: { topic: FeatureHelpTopic; title: string }) {
    const context = useContext(FeatureHelpContext);
    const instanceId = useId();
    const popoverId = useId();

    if (!context) throw new Error('FeatureHelpButton 必须在 FeatureHelpProvider 内使用');

    const isActive = context.active?.instanceId === instanceId;

    return (
        <button
            type="button"
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 text-[10px] font-semibold leading-none text-slate-500 shadow-xs transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            aria-label={`查看“${title}”功能说明`}
            aria-haspopup="dialog"
            aria-expanded={isActive}
            aria-controls={isActive ? popoverId : undefined}
            data-feature-help-trigger="true"
            onMouseEnter={event => context.open(topic, title, event.currentTarget, instanceId, popoverId)}
            onMouseLeave={context.scheduleClose}
            onFocus={event => context.open(topic, title, event.currentTarget, instanceId, popoverId, true)}
            onBlur={context.scheduleClose}
            onClick={event => context.toggle(topic, title, event.currentTarget, instanceId, popoverId)}
            onKeyDown={event => {
                if (event.key === 'Escape') {
                    event.stopPropagation();
                    context.close();
                }
            }}
        >
            <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
            说明
        </button>
    );
}

function FeatureHelpPopover({ state }: { state: FeatureHelpState }) {
    const context = useContext(FeatureHelpContext)!;
    const cardRef = useRef<HTMLElement>(null);
    const titleId = `${state.popoverId}-title`;
    const [position, setPosition] = useState<FeatureHelpPosition>(() =>
        calculateFeatureHelpPosition(
            state.trigger.getBoundingClientRect(),
            { width: window.innerWidth, height: window.innerHeight },
            { width: FALLBACK_POPOVER_WIDTH, height: FALLBACK_POPOVER_HEIGHT },
        ),
    );
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
    const content = featureHelpContent[state.topic];

    const updatePosition = useCallback(() => {
        const cardRect = cardRef.current?.getBoundingClientRect();
        setPosition(
            calculateFeatureHelpPosition(
                state.trigger.getBoundingClientRect(),
                { width: window.innerWidth, height: window.innerHeight },
                {
                    width: cardRect?.width || FALLBACK_POPOVER_WIDTH,
                    height: cardRect?.height || FALLBACK_POPOVER_HEIGHT,
                },
            ),
        );
    }, [state.trigger]);

    useLayoutEffect(updatePosition, [updatePosition]);

    useEffect(() => {
        const reposition = () => updatePosition();
        window.addEventListener('resize', reposition);
        window.addEventListener('scroll', reposition, true);
        return () => {
            window.removeEventListener('resize', reposition);
            window.removeEventListener('scroll', reposition, true);
        };
    }, [updatePosition]);

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (cardRef.current?.contains(target) || state.trigger.contains(target)) return;
            context.close();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                context.close();
                state.trigger.focus();
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [context, state.trigger]);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(featureHelpCopyText(state.title, content));
            setCopyState('copied');
            window.setTimeout(() => setCopyState('idle'), 1600);
        } catch {
            setCopyState('failed');
        }
    };

    const style: CSSProperties = { left: position.left, top: position.top };

    return createPortal(
        <section
            ref={cardRef}
            role="dialog"
            id={state.popoverId}
            aria-labelledby={titleId}
            data-feature-help-card="true"
            data-placement={position.placement}
            style={style}
            className="fixed z-[90] w-[min(24rem,calc(100vw-1.5rem))] select-text rounded-xl border border-slate-200 bg-white p-4 text-left shadow-2xl"
            onMouseEnter={context.cancelClose}
            onMouseLeave={context.scheduleClose}
            onPointerDown={context.cancelClose}
            onFocus={context.cancelClose}
            onBlur={context.scheduleClose}
        >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">
                        功能说明
                    </p>
                    <h2 id={titleId} className="mt-1 text-sm font-bold text-slate-900">
                        {state.title}
                    </h2>
                </div>
                <button
                    type="button"
                    onClick={context.close}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label="关闭功能说明"
                >
                    <X className="h-4 w-4" aria-hidden="true" />
                </button>
            </div>

            <div className="max-h-[min(28rem,calc(100vh-7rem))] space-y-3 overflow-y-auto py-3 pr-1 text-xs leading-5 text-slate-600">
                <HelpSection label="这个功能做什么">{content.purpose}</HelpSection>
                <HelpSection label="使用要求">
                    <ul className="list-disc space-y-1 pl-4">
                        {content.requirements.map(requirement => (
                            <li key={requirement}>{requirement}</li>
                        ))}
                    </ul>
                </HelpSection>
                <HelpSection label="举例">{content.example}</HelpSection>
                {content.impact && <HelpSection label="影响范围">{content.impact}</HelpSection>}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <p className="text-[10px] text-slate-400">
                    {state.pinned ? '已固定，点按钮或关闭图标收起' : '可选中说明文字复制'}
                </p>
                <button
                    type="button"
                    onClick={() => void copy()}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] font-bold text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    {copyState === 'copied' ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '请手动复制' : '复制说明'}
                </button>
            </div>
        </section>,
        document.body,
    );
}

function HelpSection({ label, children }: { label: string; children: ReactNode }) {
    return (
        <section>
            <h3 className="text-[11px] font-bold text-slate-900">{label}</h3>
            <div className="mt-1 text-slate-600">{children}</div>
        </section>
    );
}
