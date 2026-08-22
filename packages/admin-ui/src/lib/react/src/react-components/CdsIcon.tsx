import { ClarityIcons } from '@cds/core/icon';
import React, { DOMAttributes, ReactNode, useEffect } from 'react';

export type IconShapeTuple = Parameters<typeof ClarityIcons.addIcons>[0];

type CustomElement<T> = Partial<T & DOMAttributes<T> & { children: ReactNode }>;

export interface CdsIconProps {
    shape: string;
    size: string | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
    direction: 'up' | 'down' | 'left' | 'right';
    flip: 'horizontal' | 'vertical';
    solid: boolean;
    status: 'info' | 'success' | 'warning' | 'danger';
    inverse: boolean;
    badge: 'info' | 'success' | 'warning' | 'danger';
}

declare module 'react' {
    // Namespace syntax is required to augment React's JSX intrinsic element declarations.
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX {
        interface IntrinsicElements {
            ['cds-icon']: CustomElement<CdsIconProps>;
        }
    }
}

export function registerCdsIcon(icon: IconShapeTuple) {
    ClarityIcons.addIcons(icon);
}

/**
 * @description
 * A React wrapper for the Clarity UI icon component.
 *
 * @example
 * ```ts
 * import { userIcon } from '@cds/core/icon';
 * import { CdsIcon } from '@vendure/admin-ui/react';
 *
 * registerCdsIcon(userIcon);
 * export function MyComponent() {
 *    return <CdsIcon icon={userIcon} badge="warning" solid size="lg"></CdsIcon>;
 * }
 * ```
 *
 * @docsCategory react-components
 */
export function CdsIcon(props: { icon: IconShapeTuple; className?: string } & Partial<CdsIconProps>) {
    const { icon, ...rest } = props;
    useEffect(() => {
        ClarityIcons.addIcons(icon);
    }, [icon]);
    return <cds-icon {...rest} shape={icon[0]}></cds-icon>;
}
