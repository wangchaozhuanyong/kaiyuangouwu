import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { usePageActivity } from '../hooks/use-page-activity';
import { AdminInput } from './AdminControls';

type SearchInputProps = Omit<ComponentProps<'input'>, 'value' | 'defaultValue' | 'onChange'> & {
    value: string;
    onValueChange: (value: string) => void;
    debounceMs?: number;
};

/** Keep the editable draft synchronous; URL navigation and queries only receive committed text. */
export function SearchInput({
    value,
    onValueChange,
    onCompositionStart,
    onCompositionEnd,
    onKeyDown,
    onBlur,
    debounceMs = 250,
    type = 'search',
    autoComplete = 'off',
    autoCorrect = 'off',
    spellCheck = false,
    ...props
}: SearchInputProps) {
    const [draft, setDraft] = useState(value);
    const [previousValue, setPreviousValue] = useState(value);
    const [isComposing, setIsComposing] = useState(false);
    const composing = useRef(false);
    const lastEmittedValue = useRef(value);
    const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const active = usePageActivity();
    const onValueChangeRef = useRef(onValueChange);
    useLayoutEffect(() => {
        onValueChangeRef.current = onValueChange;
    }, [onValueChange]);
    // URL navigation (including Back/Forward and clearing filters) remains authoritative.
    // Do not replace the browser's active composition when a pending navigation completes.
    if (previousValue !== value) {
        setPreviousValue(value);
        if (!isComposing) {
            setDraft(value);
        }
    }

    useEffect(() => {
        clearTimeout(pending.current);
        lastEmittedValue.current = value;
        return () => clearTimeout(pending.current);
    }, [value]);

    const commit = useCallback((next: string) => {
        clearTimeout(pending.current);
        if (lastEmittedValue.current === next) return;
        lastEmittedValue.current = next;
        onValueChangeRef.current(next);
    }, []);
    const schedule = useCallback(
        (next: string) => {
            clearTimeout(pending.current);
            if (!active) return;
            if (!next || !debounceMs) commit(next);
            else pending.current = setTimeout(() => commit(next), debounceMs);
        },
        [active, debounceMs, commit],
    );
    useEffect(() => {
        if (!active) clearTimeout(pending.current);
        else if (!isComposing && draft !== lastEmittedValue.current) schedule(draft);
        return () => clearTimeout(pending.current);
    }, [active, draft, isComposing, schedule]);

    return (
        <AdminInput
            type={type}
            autoComplete={autoComplete}
            autoCorrect={autoCorrect}
            spellCheck={spellCheck}
            data-1p-ignore="true"
            data-bwignore="true"
            data-lpignore="true"
            data-form-type="other"
            {...props}
            value={draft}
            onChange={event => {
                const next = event.currentTarget.value;
                setDraft(next);
                if (!composing.current && !(event.nativeEvent as InputEvent).isComposing) schedule(next);
            }}
            onCompositionStart={event => {
                composing.current = true;
                setIsComposing(true);
                onCompositionStart?.(event);
            }}
            onCompositionEnd={event => {
                composing.current = false;
                setIsComposing(false);
                const next = event.currentTarget.value;
                setDraft(next);
                commit(next);
                onCompositionEnd?.(event);
            }}
            onKeyDown={event => {
                onKeyDown?.(event);
                if (
                    !event.defaultPrevented &&
                    event.key === 'Enter' &&
                    !composing.current &&
                    !event.nativeEvent.isComposing
                )
                    commit(event.currentTarget.value);
            }}
            onBlur={event => {
                if (!composing.current) commit(event.currentTarget.value);
                onBlur?.(event);
            }}
        />
    );
}
