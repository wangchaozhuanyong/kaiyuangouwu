import { ArrowLeft } from 'lucide-react';
import { type AnchorHTMLAttributes } from 'react';

import './page-back-button.css';

/** Native return navigation shares the page return action's geometry and focus treatment. */
export function PageBackLink({
    label,
    ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { label: string }) {
    return (
        <a {...props} className="page-back-button" aria-label={label}>
            <ArrowLeft className="page-back-icon" viewBox="4 0 24 24" aria-hidden="true" />
        </a>
    );
}
