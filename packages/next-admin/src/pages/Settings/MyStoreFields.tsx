import { AdminInput, AdminTextArea } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { inputClass } from './settings-ui';
export function FieldInput({
    label,
    value,
    onChange,
    type = 'text',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    type?: string;
}) {
    return (
        <AdminField
            className="text-xs font-bold text-slate-700"
            label={
                <>
                    <span className="mb-1.5 block">{label}</span>
                </>
            }
        >
            <AdminInput
                type={type}
                value={value}
                onChange={event => onChange(event.target.value)}
                className={inputClass}
            />
        </AdminField>
    );
}

export function FieldArea({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="text-xs font-bold text-slate-700">
            <span className="mb-1.5 block">{label}</span>
            <AdminTextArea
                value={value}
                onChange={event => onChange(event.target.value)}
                rows={4}
                className={inputClass}
            />
        </label>
    );
}
