import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client';
import {
  AlertCircle,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { prepareAuthSession, setInitialActiveChannel } from '../../apollo';

const LOGIN_MUTATION = gql`
  mutation Login($username: String!, $password: String!, $rememberMe: Boolean) {
    login(username: $username, password: $password, rememberMe: $rememberMe) {
      __typename
      ... on CurrentUser {
        id
        identifier
        channels {
          id
          code
          token
        }
      }
      ... on InvalidCredentialsError {
        errorCode
        message
      }
    }
  }
`;

interface LoginMutationData {
  login:
    | {
        __typename: 'CurrentUser';
        id: string;
        identifier: string;
        channels: Array<{ id: string; code: string; token: string }>;
      }
    | { __typename: 'InvalidCredentialsError'; errorCode: string; message: string }
    | { __typename: 'NativeAuthStrategyError' };
}

interface LoginMutationVariables {
  username: string;
  password: string;
  rememberMe: boolean;
}

export function LoginModule() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [login, { loading }] = useMutation<LoginMutationData, LoginMutationVariables>(LOGIN_MUTATION, {
    onCompleted: data => {
      const result = data.login;
      if (result.__typename === 'CurrentUser') {
        if (result.channels.length === 1) setInitialActiveChannel(result.channels[0].token);
        navigate('/dashboard', { replace: true });
        return;
      }

      setLoginError(
        result.__typename === 'InvalidCredentialsError'
          ? '管理员账号或密码不正确，请重新输入'
          : '暂时无法完成登录，请稍后重试',
      );
    },
    onError: () => {
      setLoginError('无法连接管理服务，请稍后重试或联系系统管理员');
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    setLoginError('');
    prepareAuthSession(rememberMe);
    void login({
      variables: {
        username: username.trim(),
        password,
        rememberMe,
      },
    });
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 sm:px-6 lg:flex lg:items-center lg:py-12">
      <div className="mx-auto grid w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="flex flex-col justify-between bg-slate-950 px-7 py-8 text-white sm:px-10 lg:min-h-[590px] lg:py-10">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-black">
                V
              </div>
              <div>
                <p className="text-lg font-bold tracking-tight">Vendure 商家后台</p>
                <p className="text-xs text-slate-400">Merchant Administration</p>
              </div>
            </div>

            <div className="mt-12 hidden lg:block">
              <p className="text-sm font-semibold text-blue-400">统一经营管理</p>
              <h1 className="mt-3 text-2xl font-bold leading-snug tracking-tight">
                商品、订单、客户与店铺
                <br />
                统一管理
              </h1>
              <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
                面向日常运营人员的简洁工作台，减少层级跳转，让常用操作更快完成。
              </p>
            </div>
          </div>

          <div className="mt-8 hidden items-center gap-2 text-xs text-slate-500 lg:flex">
            <ShieldCheck className="h-4 w-4" />
            请仅在可信设备上登录管理后台
          </div>
        </section>

        <section className="px-6 py-8 sm:px-12 sm:py-12 lg:flex lg:flex-col lg:justify-center">
          <div className="mx-auto w-full max-w-sm">
            <div className="mb-8">
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">管理员登录</h2>
              <p className="mt-2 text-sm text-slate-500">请输入管理员账号和密码进入后台</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {loginError && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-700"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <div>
                <label htmlFor="admin-username" className="mb-2 block text-sm font-semibold text-slate-700">
                  管理员账号
                </label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    id="admin-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={event => {
                      setUsername(event.target.value);
                      if (loginError) setLoginError('');
                    }}
                    disabled={loading}
                    className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                    placeholder="请输入管理员账号"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="admin-password" className="mb-2 block text-sm font-semibold text-slate-700">
                  登录密码
                </label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    id="admin-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={event => {
                      setPassword(event.target.value);
                      if (loginError) setLoginError('');
                    }}
                    disabled={loading}
                    className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-11 pr-12 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50"
                    placeholder="请输入登录密码"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(current => !current)}
                    disabled={loading}
                    className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={event => setRememberMe(event.target.checked)}
                    disabled={loading}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  在此设备上保持登录
                </label>
                <span className="text-xs text-slate-400">忘记密码请联系系统管理员</span>
              </div>

              <button
                type="submit"
                disabled={loading}
                aria-busy={loading}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-wait disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" /> 正在登录
                  </>
                ) : (
                  <>
                    进入管理后台 <ChevronRight className="h-5 w-5" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-8 border-t border-slate-100 pt-6 text-center text-xs text-slate-400">
              Powered by Vendure
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
