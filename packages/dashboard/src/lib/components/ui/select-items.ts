import * as React from 'react';

/**
 * Builds the value-to-label map required by Base UI's Select.Value.
 *
 * Base UI otherwise renders the controlled value verbatim, which exposes
 * implementation values such as `BEST_SELLERS` instead of the localized
 * SelectItem label. Explicit `items` passed to Select still take precedence.
 */
export function inferSelectItemLabels(
    children: React.ReactNode,
    selectItemComponent: React.ElementType,
): Record<string, React.ReactNode> {
    const labels: Record<string, React.ReactNode> = {};

    const visit = (nodes: React.ReactNode): void => {
        React.Children.forEach(nodes, child => {
            if (!React.isValidElement(child)) return;

            const props = child.props as { children?: React.ReactNode; value?: unknown };
            if (
                child.type === selectItemComponent &&
                (typeof props.value === 'string' || typeof props.value === 'number')
            ) {
                labels[String(props.value)] = props.children ?? String(props.value);
                return;
            }

            visit(props.children);
        });
    };

    visit(children);
    return labels;
}
