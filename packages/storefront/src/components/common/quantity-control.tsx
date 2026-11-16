import { Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import '../../styles/quantity-control.css';

export function QuantityControl({
    value,
    label,
    decreaseLabel,
    increaseLabel,
    decreaseDisabled = false,
    increaseDisabled = false,
    compact = false,
    onDecrease,
    onIncrease,
    onChange,
    inputDisabled = false,
    max,
}: {
    value: number;
    label: string;
    decreaseLabel: string;
    increaseLabel: string;
    decreaseDisabled?: boolean;
    increaseDisabled?: boolean;
    compact?: boolean;
    onDecrease: () => void;
    onIncrease: () => void;
    onChange?: (value: number) => void;
    inputDisabled?: boolean;
    max?: number;
}) {
    const [draft, setDraft] = useState<{ text: string; base: number } | null>(null);
    const cancelBlur = useRef(false);
    const editing = !inputDisabled && draft?.base === value ? draft : null;
    useEffect(() => setDraft(null), [value, inputDisabled]);
    const normalize = (text: string) => {
        if (!/^\d+$/.test(text.trim())) return null;
        const number = Number(text);
        if (!Number.isSafeInteger(number)) return null;
        return Math.max(1, Math.min(number, max ?? number));
    };
    const commit = () => {
        setDraft(null);
        if (cancelBlur.current) {
            cancelBlur.current = false;
            return;
        }
        if (!editing || !onChange || inputDisabled) return;
        const next = normalize(editing.text);
        if (next !== null && next !== value) onChange(next);
    };
    const step = (direction: number, fallback: () => void) => {
        if (!editing || !onChange) return fallback();
        const next = normalize(String((normalize(editing.text) ?? value) + direction));
        setDraft(null);
        if (next !== null && next !== value) onChange(next);
    };
    return (
        <span
            className={compact ? 'quantity-control is-compact' : 'quantity-control'}
            role="group"
            aria-label={label}
        >
            <button
                type="button"
                aria-label={decreaseLabel}
                disabled={decreaseDisabled}
                onPointerDown={event => {
                    if (editing) event.preventDefault();
                }}
                onClick={() => step(-1, onDecrease)}
            >
                <Minus aria-hidden="true" />
            </button>
            {onChange ? (
                <input
                    className="type-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    aria-label={label}
                    autoComplete="off"
                    disabled={inputDisabled}
                    value={editing?.text ?? String(value)}
                    onChange={event => setDraft({ text: event.target.value, base: value })}
                    onBlur={commit}
                    onKeyDown={event => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            event.currentTarget.blur();
                        } else if (event.key === 'Escape') {
                            event.preventDefault();
                            cancelBlur.current = true;
                            event.currentTarget.blur();
                        }
                    }}
                />
            ) : (
                <output className={compact ? 'type-meta' : 'type-body'} aria-live="polite" aria-atomic="true">
                    {value}
                </output>
            )}
            <button
                type="button"
                aria-label={increaseLabel}
                disabled={increaseDisabled}
                onPointerDown={event => {
                    if (editing) event.preventDefault();
                }}
                onClick={() => step(1, onIncrease)}
            >
                <Plus aria-hidden="true" />
            </button>
        </span>
    );
}
