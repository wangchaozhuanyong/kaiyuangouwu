import { useEffect, useRef, useState, type ComponentProps } from 'react';

type SearchInputProps = Omit<ComponentProps<'input'>, 'value' | 'defaultValue' | 'onChange'> & {
    value: string;
    onValueChange: (value: string) => void;
};

/** Keep the editable draft synchronous; URL navigation and queries only receive committed text. */
export function SearchInput({
    value,
    onValueChange,
    onCompositionStart,
    onCompositionEnd,
    ...props
}: SearchInputProps) {
    const [draft, setDraft] = useState(value);
    const [previousValue, setPreviousValue] = useState(value);
    const [isComposing, setIsComposing] = useState(false);
    const composing = useRef(false);
    const lastEmittedValue = useRef(value);

    // URL navigation (including Back/Forward and clearing filters) remains authoritative.
    // Do not replace the browser's active composition when a pending navigation completes.
    if (previousValue !== value) {
        setPreviousValue(value);
        if (!isComposing) {
            setDraft(value);
        }
    }

    useEffect(() => {
        lastEmittedValue.current = value;
    }, [value]);

    const commit = (next: string) => {
        if (lastEmittedValue.current === next) return;
        lastEmittedValue.current = next;
        onValueChange(next);
    };

    return (
        <input
            {...props}
            value={draft}
            onChange={event => {
                const next = event.currentTarget.value;
                setDraft(next);
                if (!composing.current && !(event.nativeEvent as InputEvent).isComposing) commit(next);
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
        />
    );
}
