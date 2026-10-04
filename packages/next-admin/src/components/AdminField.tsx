import type { ComponentProps, ReactNode } from 'react';

/** Short controls share a row when the field itself has enough room, including inside dialogs. */
export function AdminField({
    label,
    description,
    error,
    layout = 'auto',
    className = '',
    children,
    ...props
}: Omit<ComponentProps<'label'>, 'children'> & {
    label: ReactNode;
    description?: ReactNode;
    error?: ReactNode;
    layout?: 'auto' | 'stacked';
    children: ReactNode;
}) {
    return (
        <div className={`admin-field ${className}`} data-admin-field={layout}>
            <label {...props} className="admin-field-row">
                <span className="admin-field-label">{label}</span>
                <span className="admin-field-control">{children}</span>
                {description && (
                    <span className="admin-field-help text-[11px] font-normal leading-4 text-slate-400">
                        {description}
                    </span>
                )}
                {error && (
                    <span className="admin-field-help text-[11px] font-normal leading-4 text-rose-600">
                        {error}
                    </span>
                )}
            </label>
        </div>
    );
}
