import { useLingui } from '@lingui/react/macro';
import { useMatches } from '@tanstack/react-router';
import React, { isValidElement, ReactElement } from 'react';

/**
 * @description
 * Derives the meta title of the page based on the current route's breadcrumb
 * data from the route loader.
 */
export function usePageTitle() {
    const matches = useMatches();
    const { i18n, t } = useLingui();
    const lastMatch = matches.at(-1);
    const breadcrumb = (lastMatch?.loaderData as any)?.breadcrumb;
    const breadcrumbTitle = normalizeBreadcrumb(breadcrumb, new WeakSet(), descriptor => i18n._(descriptor));
    const localizedBreadcrumbTitle =
        breadcrumbTitle && breadcrumbTitle in i18n.messages ? i18n.t(breadcrumbTitle) : breadcrumbTitle;

    return [localizedBreadcrumbTitle, t`Commerce Admin`].filter(x => !!x).join(' • ');
}

type TranslateMessage = (descriptor: {
    id: string;
    message?: string;
    values?: Record<string, unknown>;
}) => string;

const renderNodeAsString = function (
    reactNode: React.ReactNode,
    translateMessage?: TranslateMessage,
): string {
    let string = '';
    if (typeof reactNode === 'string') {
        string = reactNode;
    } else if (typeof reactNode === 'number') {
        string = reactNode.toString();
    } else if (Array.isArray(reactNode)) {
        reactNode.forEach(function (child) {
            string += renderNodeAsString(child, translateMessage);
        });
    } else if (isValidElement(reactNode)) {
        const props = (reactNode as ReactElement<any>).props;
        if (props.children != null) {
            string += renderNodeAsString(props.children, translateMessage);
        } else if (typeof props.message === 'string') {
            // Lingui's babel macro compiles <Trans>Text</Trans> into
            // <Trans id="hash" message="Text" />, stripping children.
            string +=
                translateMessage && typeof props.id === 'string'
                    ? translateMessage({ id: props.id, message: props.message, values: props.values })
                    : props.message;
        }
    }
    return string;
};

/**
 * Recursively normalizes a breadcrumb value to a string.
 * Handles functions, arrays, objects with labels, and React nodes.
 */
export const normalizeBreadcrumb = (
    value: any,
    visited = new WeakSet(),
    translateMessage?: TranslateMessage,
): string => {
    // Handle null/undefined
    if (value == null) {
        return '';
    }

    // If it's a function, call it and normalize the result
    if (typeof value === 'function') {
        return normalizeBreadcrumb(value(), visited, translateMessage);
    }

    // If it's already a string, return it
    if (typeof value === 'string') {
        return value;
    }

    // If it's an array, normalize the last element
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '';
        }
        return normalizeBreadcrumb(value.at(-1), visited, translateMessage);
    }

    // For objects, check for circular references
    if (typeof value === 'object') {
        // Prevent circular reference infinite loops
        if (visited.has(value)) {
            return '';
        }
        visited.add(value);

        // If it's an object with a label property, normalize the label
        if ('label' in value) {
            return normalizeBreadcrumb(value.label, visited, translateMessage);
        }
    }

    // For everything else (React nodes, numbers, etc.), use renderNodeAsString
    return renderNodeAsString(value, translateMessage);
};
