import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { SensitiveAction, sensitiveCopy } from './promotion-model';
import { FormInput, Modal, ModalFooter } from './promotion-ui';

export function SensitiveDialog({
    action,
    pending,
    error,
    onClose,
    onConfirm,
}: {
    action: SensitiveAction;
    pending: boolean;
    error?: string;
    onClose: () => void;
    onConfirm: (password: string, reason: string) => Promise<void>;
}) {
    const [password, setPassword] = useState('');
    const [reason, setReason] = useState('');
    const copy = sensitiveCopy(action);
    return (
        <Modal title={copy.title} description={copy.description} onClose={onClose} width="max-w-md">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <strong>{action.name}</strong>
                <p className="mt-1">{copy.impact}</p>
            </div>
            {error && (
                <div
                    className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800"
                    role="alert"
                    aria-live="assertive"
                >
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                        <strong>操作未完成</strong>
                        <p>{error}</p>
                    </div>
                </div>
            )}
            {action.kind === 'REVOKE' && (
                <label className="mt-4 block text-xs font-bold text-slate-700">
                    作废原因
                    <textarea
                        value={reason}
                        onChange={event => setReason(event.target.value)}
                        rows={2}
                        maxLength={500}
                        className="mt-1 w-full rounded-lg border border-slate-300 p-2.5 font-normal"
                        placeholder="会写入优惠券审计流水"
                    />
                </label>
            )}
            <label className="mt-4 block text-xs font-bold text-slate-700">
                管理员密码确认 *
                <input
                    type="password"
                    name="promotion-sensitive-action-confirmation"
                    autoComplete="off"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
                />
            </label>
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void onConfirm(password, reason)}
                pending={pending}
                disabled={!password}
                confirmLabel={copy.confirmLabel}
                danger
            />
        </Modal>
    );
}

export function NameDialog({
    value,
    pending,
    onClose,
    onConfirm,
}: {
    value: string;
    pending: boolean;
    onClose: () => void;
    onConfirm: (value: string) => Promise<void>;
}) {
    const [name, setName] = useState(value);
    return (
        <Modal title="修改活动名称" onClose={onClose} width="max-w-md">
            <FormInput label="活动名称 *" value={name} onChange={setName} />
            <ModalFooter
                onCancel={onClose}
                onConfirm={() => void onConfirm(name)}
                pending={pending}
                disabled={!name.trim()}
                confirmLabel="保存名称"
            />
        </Modal>
    );
}
