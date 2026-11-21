import { CircleHelp, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

export function MdacFieldHelp({
    id,
    label,
    text,
    icon: Icon = CircleHelp,
}: {
    id: string;
    label: string;
    text: string;
    icon?: LucideIcon;
}) {
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const [pinned, setPinned] = useState(false);
    const open = hovered || focused || pinned;

    return (
        <span
            onPointerEnter={event => {
                if (event.pointerType === 'mouse') setHovered(true);
            }}
            onPointerLeave={() => setHovered(false)}
        >
            <button
                className="mdac-help-button"
                type="button"
                aria-label={label}
                aria-expanded={open}
                aria-controls={id}
                onFocus={event => setFocused(event.currentTarget.matches(':focus-visible'))}
                onBlur={() => setFocused(false)}
                onClick={() => setPinned(value => !value)}
                onKeyDown={event => {
                    if (event.key !== 'Escape' || !open) return;
                    event.stopPropagation();
                    setFocused(false);
                    setHovered(false);
                    setPinned(false);
                }}
            >
                <Icon size={16} aria-hidden="true" />
            </button>
            <span id={id} className="mdac-field-help type-helper" hidden={!open}>
                {text}
            </span>
        </span>
    );
}
