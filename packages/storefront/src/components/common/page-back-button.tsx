import { ArrowLeft } from 'lucide-react';
import { type ButtonHTMLAttributes } from 'react';

import './page-back-button.css';

type PageBackButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'type'> & {
    label: string;
};

/** A page return action: align the painted arrow with content, keep its touch target generous. */
export function PageBackButton({ label, className, children, ...props }: PageBackButtonProps) {
    return (
        <button
            {...props}
            type="button"
            aria-label={label}
            className={`page-back-button${children ? ' has-label' : ''}${className ? ` ${className}` : ''}`}
        >
            {/* ArrowLeft's stroke begins at x=4. Remove its built-in leading whitespace. */}
            <ArrowLeft className="page-back-icon" viewBox="4 0 24 24" aria-hidden="true" />
            {children}
        </button>
    );
}
