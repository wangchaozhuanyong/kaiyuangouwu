import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { logoutAdministrator } from '../../apollo';
import {
  COMPLETE_INITIAL_PASSWORD_CHANGE_MUTATION,
  type CompleteInitialPasswordChangeData,
} from '../../graphql/auth.graphql';
import { isStrongAdministratorPassword, PASSWORD_REQUIREMENT } from '../../utils/password';
import { toUserFacingError } from '../../utils/user-facing-error';

interface CompleteInitialPasswordChangeVariables {
  password: string;
}

interface InitialPasswordChangeModuleProps {
  onCompleted: () => Promise<unknown>;
}

export function InitialPasswordChangeModule({ onCompleted }: InitialPasswordChangeModuleProps) {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [completePasswordChange, { loading }] = useMutation<
    CompleteInitialPasswordChangeData,
    CompleteInitialPasswordChangeVariables
  >(COMPLETE_INITIAL_PASSWORD_CHANGE_MUTATION);

  const busy = loading || loggingOut;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    setError('');
    if (!isStrongAdministratorPassword(newPassword)) {
      setError(`${PASSWORD_REQUIREMENT}，且不能包含换行符`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    try {
      const result = await completePasswordChange({ variables: { password: newPassword } });
      if (result.data?.completeInitialPasswordChange.mustChangePassword !== false) {
        setError('密码已提交，但账号安全状态没有更新，请重试');
        return;
      }
      setNewPassword('');
      setConfirmPassword('');
      await onCompleted();
    } catch (mutationError) {
      setError(toUserFacingError(mutationError, '首次密码修改失败，请稍后重试'));
    }
  };

  const handleLogout = async () => {
    if (busy) return;
    setLoggingOut(true);
    setError('');
    try {
      await logoutAdministrator();
    } finally {
      navigate('/login', { replace: true });
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 lg:flex lg:items-center lg:py-12">
      <div className="mx-auto grid w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="flex flex-col justify-between bg-slate-950 px-7 py-8 text-white sm:px-10 lg:min-h-[590px] lg:py-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-black">V</div>
              <div>
                <p className="text-lg font-bold tracking-tight">Vendure 商家后台</p>
                <p className="text-xs text-slate-400">首次登录安全验证</p>
              </div>
            </div>
            <div className="mt-12 hidden lg:block">
              <ShieldCheck className="h-9 w-9 text-blue-400" aria-hidden="true" />
              <h1 className="mt-5 text-2xl font-bold leading-snug tracking-tight">
                临时密码仅用于首次登录
                <br />
                设置新密码后才能进入后台
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
                此步骤用于保护店铺数据和管理权限，完成后新密码将立即生效。
              </p>
            </div>
          </div>
          <div className="mt-8 hidden items-center gap-2 text-xs text-slate-500 lg:flex">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            请勿使用临时密码或与其他网站相同的密码
          </div>
        </section>

        <section className="px-6 py-8 sm:px-12 sm:py-12 lg:flex lg:flex-col lg:justify-center">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-7">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">设置新的登录密码</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                当前账号正在使用一次性临时密码，完成修改后才能进入管理后台。
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div role="alert" aria-live="assertive" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm leading-5 text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <PasswordField
                id="initial-new-password"
                label="新密码"
                value={newPassword}
                disabled={busy}
                onChange={value => {
                  setNewPassword(value);
                  if (error) setError('');
                }}
              />
              <PasswordField
                id="initial-confirm-password"
                label="确认新密码"
                value={confirmPassword}
                disabled={busy}
                onChange={value => {
                  setConfirmPassword(value);
                  if (error) setError('');
                }}
              />

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold text-slate-700">密码要求</p>
                <ul className="mt-2 space-y-1.5 text-xs text-slate-500">
                  <Requirement met={newPassword.length >= 8}>至少 8 位字符</Requirement>
                  <Requirement met={/\p{L}/u.test(newPassword)}>包含字母</Requirement>
                  <Requirement met={/\p{N}/u.test(newPassword)}>包含数字</Requirement>
                  <Requirement met={/[\p{P}\p{S}]/u.test(newPassword)}>包含符号</Requirement>
                </ul>
              </div>

              <button type="submit" disabled={busy} aria-busy={loading} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-wait disabled:opacity-70">
                {loading ? <><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />正在更新密码</> : <>确认并进入后台</>}
              </button>
              <button type="button" disabled={busy} onClick={() => void handleLogout()} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-50">
                {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
                退出登录
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

function PasswordField({ id, label, value, disabled, onChange }: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-semibold text-slate-700">{label}</label>
      <input
        id={id}
        type="password"
        autoComplete="new-password"
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
        required
        className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none transition hover:border-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50"
      />
    </div>
  );
}

function Requirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${met ? 'text-emerald-700' : ''}`}>
      <CheckCircle2 className={`h-3.5 w-3.5 ${met ? 'text-emerald-600' : 'text-slate-300'}`} aria-hidden="true" />
      {children}
    </li>
  );
}
