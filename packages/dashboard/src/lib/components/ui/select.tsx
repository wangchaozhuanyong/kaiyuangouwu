import {
    Select as OriginalSelect,
    SelectContent as OriginalSelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectScrollDownButton,
    SelectScrollUpButton,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '@vendure-io/ui/components/ui/select';
import * as React from 'react';

import { inferSelectItemLabels } from './select-items.js';

/**
 * Base UI requires an `items` value-to-label map to render the selected
 * option's display label. Infer that map from SelectItem children so every
 * dashboard select consistently shows its localized label rather than a raw
 * enum, ID, or code. Callers can still pass `items` explicitly for dynamic or
 * object-valued options.
 */
const Select = (({ children, items, ...props }: React.ComponentProps<typeof OriginalSelect>) => {
    const resolvedItems = React.useMemo(
        () => items ?? inferSelectItemLabels(children, SelectItem),
        [children, items],
    );

    return (
        <OriginalSelect {...props} items={resolvedItems}>
            {children}
        </OriginalSelect>
    );
}) as typeof OriginalSelect;

/**
 * Wrapper around the upstream SelectContent that forces a remount when
 * children change. This works around a Base UI Select issue where the
 * internal item registry doesn't update when items change dynamically
 * while the controlled value stays the same (e.g., value="" fire-and-forget
 * pattern used for state transitions).
 *
 * Deriving a key from children values causes unmount/remount of the popup,
 * which forces items to re-register in Base UI's collection.
 *
 * NOTE: Only inspects top-level children. If SelectItems are nested
 * inside SelectGroup or fragments, the key may not update correctly.
 */
function SelectContent({ children, ...props }: React.ComponentProps<typeof OriginalSelectContent>) {
    const childrenKey = React.useMemo(
        () =>
            React.Children.toArray(children)
                .map(c => (React.isValidElement(c) ? ((c.props as any)?.value ?? c.key) : ''))
                .join('|'),
        [children],
    );

    return (
        <OriginalSelectContent key={childrenKey} {...props}>
            {children}
        </OriginalSelectContent>
    );
}

export {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectScrollDownButton,
    SelectScrollUpButton,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
};
