import { useState } from 'react';
import type { useBrowserVault } from './use-browser-vault';

import { MAX_VAULT_BYTES } from './browser-storage';

export function VaultControls({
    vault,
    isZh,
}: Readonly<{
    vault: ReturnType<typeof useBrowserVault>;
    isZh: boolean;
}>) {
    const [showSetup, setShowSetup] = useState(false);
    const [passphrase, setPassphrase] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [backup, setBackup] = useState<string>();
    const [error, setError] = useState(false);
    const text = (zh: string, en: string) => (isZh ? zh : en);
    const inputClass = 'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm';
    const buttonClass =
        'min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold disabled:opacity-50';
    const exportBackup = () => {
        try {
            const serialized = vault.backup();
            if (!serialized) return;
            const url = URL.createObjectURL(new Blob([serialized], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'two-factor-encrypted-backup.json';
            link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
            setError(true);
        }
    };
    return (
        <div
            className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
            data-vault-state={vault.unlocked ? 'unlocked' : vault.exists ? 'locked' : 'temporary'}
        >
            <strong>
                {vault.unlocked
                    ? text('加密保存已解锁', 'Encrypted storage unlocked')
                    : vault.exists
                      ? text('已保存的账号已锁定', 'Saved accounts locked')
                      : text('当前为临时模式', 'Temporary mode')}
            </strong>
            <p className="my-2 text-sm text-slate-600">
                {text(
                    '闲置 5 分钟、离开页面或退出登录后清除当前解锁状态。临时账号不会保留；加密账号下次需口令解锁。',
                    'Locks after 5 minutes idle, leaving or signing out. Temporary entries are lost; saved entries need your passphrase.',
                )}
            </p>
            {vault.legacy && (
                <p className="text-sm text-amber-800" role="status">
                    {text(
                        '发现旧版未加密数据。设置口令后会一并迁移；验证成功前保留旧数据。请先关闭其他打开此工具的页面。',
                        'Legacy plaintext was found. Close other tool tabs, then set a passphrase. Old data stays until migration is verified.',
                    )}
                </p>
            )}
            {vault.unlocked ? (
                <div className="flex flex-wrap gap-2">
                    {vault.legacy && (
                        <button
                            type="button"
                            className={buttonClass}
                            disabled={vault.busy}
                            onClick={() => void vault.migrateLegacy()}
                        >
                            {text('重试迁移剩余旧数据', 'Retry remaining legacy migration')}
                        </button>
                    )}
                    <button
                        type="button"
                        className={buttonClass}
                        disabled={vault.busy}
                        onClick={exportBackup}
                    >
                        {text('下载加密备份', 'Download encrypted backup')}
                    </button>
                    <button type="button" className={buttonClass} onClick={vault.lock}>
                        {text('立即锁定', 'Lock now')}
                    </button>
                </div>
            ) : vault.available && !vault.exists && !showSetup ? (
                <button type="button" className={buttonClass} onClick={() => setShowSetup(true)}>
                    {text(
                        vault.legacy ? '加密迁移旧账号' : '启用加密保存',
                        vault.legacy ? 'Encrypt legacy accounts' : 'Enable encrypted saving',
                    )}
                </button>
            ) : vault.available ? (
                <form
                    className="grid gap-3"
                    onSubmit={event => {
                        event.preventDefault();
                        if (
                            (!vault.exists && !backup && passphrase !== confirmation) ||
                            passphrase.length < 12
                        ) {
                            setError(true);
                            return;
                        }
                        const supplied = passphrase;
                        setPassphrase('');
                        setConfirmation('');
                        setError(false);
                        void vault.open(supplied, backup).then(success => {
                            if (success) setBackup(undefined);
                        });
                    }}
                >
                    <p className="m-0 text-xs text-slate-600">
                        {text(
                            '使用至少 12 个字符的独立口令，不要使用商城登录密码。忘记口令无法解密，商城不能代为重置。加密备份只能用原口令恢复到同一商城账号。',
                            'Use a separate 12+ character passphrase. It cannot be reset. Backups need the original passphrase and store account.',
                        )}
                    </p>
                    <label className="grid gap-1 text-sm">
                        {text('解锁口令', 'Unlock passphrase')}
                        <input
                            className={inputClass}
                            type="password"
                            autoComplete={vault.exists || backup ? 'current-password' : 'new-password'}
                            minLength={12}
                            maxLength={1024}
                            required
                            value={passphrase}
                            onChange={event => setPassphrase(event.target.value)}
                        />
                    </label>
                    {!vault.exists && !backup && (
                        <label className="grid gap-1 text-sm">
                            {text('再次输入口令', 'Confirm passphrase')}
                            <input
                                className={inputClass}
                                type="password"
                                autoComplete="new-password"
                                minLength={12}
                                maxLength={1024}
                                required
                                value={confirmation}
                                onChange={event => setConfirmation(event.target.value)}
                            />
                        </label>
                    )}
                    <button type="submit" className={buttonClass} disabled={vault.busy}>
                        {vault.busy
                            ? text('处理中…', 'Working…')
                            : vault.exists
                              ? text('解锁账号', 'Unlock accounts')
                              : backup
                                ? text('恢复加密备份', 'Restore encrypted backup')
                                : text(
                                      '启用加密保存并迁移旧数据',
                                      'Enable encrypted saving and migrate legacy data',
                                  )}
                    </button>
                    {!vault.exists && !vault.busy && (
                        <label className="grid gap-1 text-xs">
                            {text(
                                '选择加密备份恢复（不会上传）',
                                'Restore an encrypted backup (never uploaded)',
                            )}
                            <input
                                type="file"
                                accept=".json,application/json"
                                onChange={event => {
                                    const file = event.target.files?.[0];
                                    event.target.value = '';
                                    if (!file) return;
                                    if (file.size > MAX_VAULT_BYTES) {
                                        setError(true);
                                        return;
                                    }
                                    void file
                                        .text()
                                        .then(value => {
                                            setBackup(value);
                                            setError(false);
                                        })
                                        .catch(() => setError(true));
                                }}
                            />
                            {backup && (
                                <button
                                    type="button"
                                    className={buttonClass}
                                    onClick={() => setBackup(undefined)}
                                >
                                    {text('取消恢复备份', 'Cancel backup restore')}
                                </button>
                            )}
                        </label>
                    )}
                </form>
            ) : (
                <p className="text-sm text-amber-800">
                    {text(
                        '此浏览器不支持安全保存，仍可临时使用。旧数据不会被删除。',
                        'Secure saving is unavailable in this browser. Temporary use remains available; existing data is preserved.',
                    )}
                </p>
            )}
            {(error || vault.error) && (
                <p role="alert" className="text-sm text-red-700">
                    {text(
                        '操作未完成。请检查口令、备份或浏览器存储；原有数据未被主动清空。',
                        'Operation did not complete. Check the passphrase, backup or browser storage; existing data was not cleared.',
                    )}
                </p>
            )}
        </div>
    );
}
