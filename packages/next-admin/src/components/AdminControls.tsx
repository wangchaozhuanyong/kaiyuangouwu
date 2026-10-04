import { useState, type ComponentProps } from 'react';

export const PAGE_REFRESH_EVENT = 'vendure:refresh-admin-page';
export interface PageRefreshRequest {
    page: string;
    handled?: boolean;
    work?: Promise<unknown>;
}

export function AdminButton({
    refreshPage,
    className = '',
    onClick,
    disabled,
    ...props
}: ComponentProps<'button'> & { refreshPage?: boolean }) {
    const [refreshing, setRefreshing] = useState(false);
    return (
        <button
            {...props}
            className={`admin-button ${className}`}
            aria-busy={refreshing || props['aria-busy'] || undefined}
            disabled={disabled || refreshing}
            onClick={event => {
                if (refreshPage) {
                    const page =
                        event.currentTarget.closest<HTMLElement>('[data-admin-page]')?.dataset.adminPage;
                    if (page) {
                        const detail: PageRefreshRequest = { page };
                        window.dispatchEvent(new CustomEvent(PAGE_REFRESH_EVENT, { detail }));
                        if (detail.handled) {
                            setRefreshing(true);
                            void detail.work?.finally(() => setRefreshing(false));
                            return;
                        }
                    }
                }
                onClick?.(event);
            }}
        />
    );
}

export function AdminInput({ className = '', ...props }: ComponentProps<'input'>) {
    return (
        <input
            {...props}
            className={`${['checkbox', 'radio', 'range', 'file', 'color', 'hidden'].includes(props.type ?? '') ? '' : 'admin-control'} ${className}`}
        />
    );
}
export function AdminSelect({ className = '', ...props }: ComponentProps<'select'>) {
    return <select {...props} className={`admin-control ${className}`} />;
}
export function AdminTextArea({ className = '', ...props }: ComponentProps<'textarea'>) {
    return <textarea {...props} className={`admin-control admin-textarea ${className}`} />;
}
