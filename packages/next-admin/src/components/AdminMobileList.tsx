import type { ReactNode } from 'react';

import { AdminButton, AdminSelect } from './AdminControls';
import { AdminField } from './AdminField';

/** Presentation only: callers retain their existing query, selection and action owners. */
export function AdminMobileList({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
    return (
        <div className="admin-mobile-list" role="list" aria-label={ariaLabel}>
            {children}
        </div>
    );
}

export function AdminMobileRecord({
    title,
    status,
    selection,
    children,
    actions,
}: {
    title: ReactNode;
    status?: ReactNode;
    selection?: ReactNode;
    children: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <article className="admin-mobile-record" role="listitem">
            <div className="admin-mobile-record-heading">
                {selection && <label className="admin-mobile-record-selection">{selection}</label>}
                <div className="admin-mobile-record-title">{title}</div>
                {status && <div className="admin-mobile-record-status">{status}</div>}
            </div>
            <dl className="admin-mobile-record-fields">{children}</dl>
            {actions && <div className="admin-mobile-record-actions">{actions}</div>}
        </article>
    );
}

export function AdminMobileField({
    label,
    children,
    fullWidth = false,
}: {
    label: ReactNode;
    children: ReactNode;
    fullWidth?: boolean;
}) {
    return (
        <div className="admin-mobile-record-field" data-full-width={fullWidth || undefined}>
            <dt>{label}</dt>
            <dd>{children}</dd>
        </div>
    );
}

/** Mobile sorting is the same URL-backed sorting operation as the desktop header. */
export function AdminMobileSort<T extends string>({
    fields,
    sortField,
    sortDirection,
    onSort,
    label = '排序',
}: {
    fields: ReadonlyArray<{ value: T; label: string }>;
    sortField: T;
    sortDirection: 'ASC' | 'DESC';
    onSort: (field: T, direction: 'ASC' | 'DESC') => void;
    label?: string;
}) {
    return (
        <div className="admin-mobile-sort">
            <AdminField label={label}>
                <AdminSelect
                    value={sortField}
                    onChange={event => onSort(event.target.value as T, sortDirection)}
                    aria-label={label}
                    className="rounded-lg border border-slate-300 px-3 py-2"
                >
                    {fields.map(field => (
                        <option key={field.value} value={field.value}>
                            {field.label}
                        </option>
                    ))}
                </AdminSelect>
            </AdminField>
            <AdminButton
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2"
                aria-label={`${label}方向：${sortDirection === 'ASC' ? '升序' : '降序'}，点击切换`}
                onClick={() => onSort(sortField, sortDirection === 'ASC' ? 'DESC' : 'ASC')}
            >
                {sortDirection === 'ASC' ? '升序 ↑' : '降序 ↓'}
            </AdminButton>
        </div>
    );
}
