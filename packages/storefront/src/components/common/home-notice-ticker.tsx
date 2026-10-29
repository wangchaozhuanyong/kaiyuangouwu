import { useEffect, useRef, useState } from 'react';

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

/** Stationary previews rotate as whole notices; pauses preserve the current notice's hold. */
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
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const text = useRef<HTMLSpanElement>(null);
    const region = useRef<HTMLDivElement>(null);
    const animation = useRef<Animation | null>(null);
    const keyboardInput = useRef(true);
    const shouldPause = paused || hovered || focused;
    const pauseRef = useRef(shouldPause);
    pauseRef.current = shouldPause;
    const item = items[index % Math.max(1, items.length)];
    const isZh = language === 'zh';
    const title = item?.title || (isZh ? '公告' : 'Notice');
    const content = item?.content.replace(/\s+/gu, ' ').trim() || '';

    // Dialog cleanup restores focus during React's commit, before synthetic focus resumes.
    useEffect(() => {
        const focus = () => {
            setFocused(Boolean(keyboardInput.current && region.current?.contains(document.activeElement)));
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

    useEffect(() => {
        const line = text.current;
        if (!line || reducedMotion || items.length < 2) return;
        const playback = line.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(0)' }], {
            duration: holdSeconds * 1000,
            fill: 'forwards',
        });
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
    }, [item?.id, title, content, language, holdSeconds, items.length, reducedMotion, cycle]);

    useEffect(() => {
        const playback = animation.current;
        if (!playback || playback.playState === 'finished') return;
        if (shouldPause) playback.pause();
        else playback.play();
    }, [shouldPause]);

    if (!item) return null;
    return (
        <div
            ref={region}
            className="notice-strip"
            style={{ order }}
            role="region"
            aria-label={isZh ? '系统公告' : 'Announcements'}
            onPointerEnter={event => {
                if (event.pointerType === 'mouse') setHovered(true);
            }}
            onPointerLeave={() => setHovered(false)}
        >
            <button
                className="notice-strip-open"
                type="button"
                aria-haspopup="dialog"
                aria-label={isZh ? `查看公告全文：${title}` : `Read full notice: ${title}`}
                onClick={() => onOpen(item.id)}
            >
                <span className="notice-strip-content">
                    <span ref={text} className="notice-strip-track">
                        <strong className="notice-strip-title">{title}</strong>
                        {content && ` · ${content}`}
                    </span>
                </span>
            </button>
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
