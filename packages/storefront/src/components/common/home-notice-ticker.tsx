import { Bell, Pause, Play } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { type HomeNoticeItem } from '../../pages/home-page';
import { type StorefrontLanguage } from '../../types';

interface HomeNoticeTickerProps {
    items: HomeNoticeItem[];
    language: StorefrontLanguage;
    order: number;
    holdSeconds: number;
    paused: boolean;
    reducedMotion: boolean;
    onOpen: (id: string) => void;
    onAll: () => void;
}

/** One measured pass per notice; pauses preserve the current reading position. */
export function HomeNoticeTicker({
    items,
    language,
    order,
    holdSeconds,
    paused,
    reducedMotion,
    onOpen,
    onAll,
}: HomeNoticeTickerProps) {
    const [index, setIndex] = useState(0);
    const [cycle, setCycle] = useState(0);
    const [distance, setDistance] = useState<number | null>(null);
    const [stopped, setStopped] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const viewport = useRef<HTMLSpanElement>(null);
    const text = useRef<HTMLSpanElement>(null);
    const reader = useRef<HTMLButtonElement>(null);
    const animation = useRef<Animation | null>(null);
    const keyboardInput = useRef(true);
    const shouldPause = paused || stopped || hovered || focused;
    const pauseRef = useRef(shouldPause);
    pauseRef.current = shouldPause;
    const item = items[index % Math.max(1, items.length)];
    const isZh = language === 'zh';
    const title = item?.title || (isZh ? '公告' : 'Notice');
    const content = item?.content.replace(/\s+/gu, ' ').trim() || '';

    // Dialog cleanup restores focus during React's commit, before synthetic focus resumes.
    useEffect(() => {
        const focus = () => {
            setFocused(Boolean(keyboardInput.current && reader.current?.contains(document.activeElement)));
        };
        const keyboard = () => {
            keyboardInput.current = true;
            focus();
        };
        const pointer = () => {
            keyboardInput.current = false;
            focus();
        };
        document.addEventListener('keydown', keyboard, true);
        document.addEventListener('pointerdown', pointer, true);
        document.addEventListener('focusin', focus, true);
        document.addEventListener('focusout', focus, true);
        return () => {
            document.removeEventListener('keydown', keyboard, true);
            document.removeEventListener('pointerdown', pointer, true);
            document.removeEventListener('focusin', focus, true);
            document.removeEventListener('focusout', focus, true);
        };
    }, []);

    useLayoutEffect(() => {
        const frame = viewport.current;
        const line = text.current;
        if (!frame || !line) {
            setDistance(0);
            return;
        }
        let active = true;
        const measure = () => {
            if (active) setDistance(Math.max(0, line.scrollWidth - frame.clientWidth));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(frame);
        observer.observe(line);
        void document.fonts?.ready.then(measure);
        return () => {
            active = false;
            observer.disconnect();
        };
    }, [item?.id, title, content, language]);

    useEffect(() => {
        const line = text.current;
        if (!line || distance === null || reducedMotion || (!distance && items.length < 2)) return;
        const duration = distance > 0 ? 1500 + (distance / 28) * 1000 + 2000 : holdSeconds * 1000;
        const end = `translateX(${-distance}px)`;
        const playback = line.animate(
            distance > 0
                ? [
                      { transform: 'translateX(0)', offset: 0 },
                      { transform: 'translateX(0)', offset: 1500 / duration },
                      { transform: end, offset: 1 - 2000 / duration },
                      { transform: end, offset: 1 },
                  ]
                : [{ transform: 'translateX(0)' }, { transform: 'translateX(0)' }],
            { duration, easing: 'linear', fill: 'forwards' },
        );
        animation.current = playback;
        if (pauseRef.current) playback.pause();
        playback.onfinish = () => {
            setIndex(current => (current + 1) % items.length);
            setCycle(current => current + 1);
        };
        return () => {
            playback.onfinish = null;
            playback.cancel();
            animation.current = null;
        };
    }, [item?.id, content, language, distance, holdSeconds, items.length, reducedMotion, cycle]);

    useEffect(() => {
        const playback = animation.current;
        if (!playback || playback.playState === 'finished') return;
        if (shouldPause) playback.pause();
        else playback.play();
    }, [shouldPause]);

    if (!item) return null;
    const canPlay = !reducedMotion && (items.length > 1 || Boolean(distance));
    return (
        <div
            className="notice-strip"
            style={{ order }}
            role="region"
            aria-label={isZh ? '系统公告' : 'Announcements'}
            onPointerEnter={event => {
                if (event.pointerType === 'mouse') setHovered(true);
            }}
            onPointerLeave={() => setHovered(false)}
        >
            <Bell aria-hidden="true" />
            <button
                ref={reader}
                className="notice-strip-open"
                type="button"
                aria-haspopup="dialog"
                aria-label={isZh ? `查看公告全文：${title}` : `Read full notice: ${title}`}
                onClick={() => onOpen(item.id)}
            >
                <span className={`notice-strip-copy${content ? '' : ' is-title-only'}`}>
                    <strong className="notice-strip-title">{title}</strong>
                    <span ref={viewport} className="notice-strip-content">
                        <span ref={text} className="notice-strip-track">
                            {content}
                        </span>
                    </span>
                </span>
            </button>
            {canPlay ? (
                <button
                    className="notice-strip-control"
                    type="button"
                    aria-label={
                        stopped
                            ? isZh
                                ? '继续播放公告'
                                : 'Resume announcements'
                            : isZh
                              ? '暂停公告播放'
                              : 'Pause announcements'
                    }
                    aria-pressed={stopped}
                    onClick={() => setStopped(value => !value)}
                >
                    {stopped ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                </button>
            ) : null}
            <button
                className="notice-strip-all"
                type="button"
                onClick={onAll}
                aria-label={isZh ? '查看全部公告' : 'View all announcements'}
            >
                {isZh ? '全部' : 'All'}
            </button>
        </div>
    );
}
