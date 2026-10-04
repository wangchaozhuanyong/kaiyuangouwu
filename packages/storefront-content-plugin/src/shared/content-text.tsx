import { type HTMLAttributes } from 'react';

import './content-text.css';

declare const sanitizedContent: unique symbol;

/** Only HTML returned by the storefront sanitizer can cross the rendering boundary. */
export type SanitizedContentHtml = string & { readonly [sanitizedContent]: true };

type ContentTextProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'dangerouslySetInnerHTML'> &
    (
        | {
              as?: 'p' | 'div' | 'span' | 'small';
              children: string | null | undefined;
              html?: never;
          }
        | { as?: 'div'; children?: never; html: SanitizedContentHtml }
    );

/** Shared by client content and Admin previews. Plain text always stays literal. */
export function ContentText({ as, className, children, html, ...props }: ContentTextProps) {
    const rich = html !== undefined;
    const Tag = as ?? (rich ? 'div' : 'p');
    return (
        <Tag
            {...props}
            className={['content-text', className].filter(Boolean).join(' ')}
            data-content-format={rich ? 'rich' : 'plain'}
            {...(rich ? { dangerouslySetInnerHTML: { __html: html } } : { children })}
        />
    );
}
