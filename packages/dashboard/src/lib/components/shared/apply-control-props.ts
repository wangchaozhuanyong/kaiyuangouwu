import React from 'react';

/**
 * Injects `id` and `aria-invalid` props onto the rendered element via cloneElement.
 * Used by FormFieldWrapper and TranslatableFormFieldWrapper to wire up
 * accessibility attributes without requiring the consumer to do it manually.
 */
export function applyControlProps(element: React.ReactNode, props: Record<string, unknown>) {
    if (!React.isValidElement(element)) return element;
    const control = element as React.ReactElement<Record<string, unknown>>;
    const mergedProps = { ...props };
    for (const attribute of ['aria-describedby', 'aria-labelledby'] as const) {
        const existingValue = control.props[attribute];
        const injectedValue = props[attribute];
        if (existingValue && injectedValue) {
            mergedProps[attribute] = `${existingValue} ${injectedValue}`;
        }
    }
    return React.cloneElement(control, mergedProps);
}
