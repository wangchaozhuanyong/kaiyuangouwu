import { useLingui } from '@lingui/react';
import {
    Alert,
    AlertDescription,
    AlertTitle,
    Button,
    Label,
    PasswordInput,
    Skeleton,
    api,
    toast,
    useAuth,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { KeyRound, LoaderCircle, LogOut, RefreshCw } from 'lucide-react';
import { FormEvent, ReactNode, useState } from 'react';

import {
    CompleteInitialPasswordChangeResult,
    MerchantInitialPasswordStatusResult,
    completeInitialPasswordChangeMutation,
    merchantInitialPasswordStatusQuery,
} from './merchant-store.graphql';

const statusQueryKey = ['merchant-initial-password-status'];

const zhCopy = {
    title: '设置新的登录密码',
    description: '当前账号使用的是一次性临时密码。完成修改后才能进入店铺后台。',
    password: '新密码',
    confirm: '确认新密码',
    requirement: '至少 12 位，并同时包含字母、数字和符号。',
    mismatch: '两次输入的密码不一致',
    invalid: '密码不符合安全要求',
    submit: '确认并进入后台',
    submitting: '正在更新',
    success: '登录密码已更新',
    loadError: '无法读取账号安全状态',
    retry: '重试',
    logout: '退出登录',
};

const enCopy: typeof zhCopy = {
    title: 'Set a new sign-in password',
    description: 'This account is using a one-time temporary password. Change it before continuing.',
    password: 'New password',
    confirm: 'Confirm new password',
    requirement: 'Use at least 12 characters with letters, numbers, and symbols.',
    mismatch: 'The passwords do not match',
    invalid: 'The password does not meet the security requirements',
    submit: 'Update and continue',
    submitting: 'Updating',
    success: 'Sign-in password updated',
    loadError: 'Could not read the account security status',
    retry: 'Retry',
    logout: 'Sign out',
};

export function MerchantPasswordGate({ children }: Readonly<{ children: ReactNode }>) {
    const { i18n } = useLingui();
    const text = i18n.locale.toLowerCase().startsWith('zh') ? zhCopy : enCopy;
    const { isAuthenticated, logout } = useAuth();
    const queryClient = useQueryClient();
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const statusQuery = useQuery({
        queryKey: statusQueryKey,
        queryFn: () =>
            api.query(merchantInitialPasswordStatusQuery) as Promise<MerchantInitialPasswordStatusResult>,
        enabled: isAuthenticated,
        retry: false,
    });
    const mutation = useMutation({
        mutationFn: (newPassword: string) =>
            api.mutate(completeInitialPasswordChangeMutation, {
                password: newPassword,
            }) as Promise<CompleteInitialPasswordChangeResult>,
        onSuccess: async result => {
            setPassword('');
            setConfirmation('');
            queryClient.setQueryData(statusQueryKey, {
                merchantInitialPasswordStatus: result.completeInitialPasswordChange,
            });
            toast.success(text.success);
            await queryClient.invalidateQueries({
                predicate: query => query.queryKey[0] !== statusQueryKey[0],
            });
        },
        onError: error => toast.error(errorMessage(error)),
    });

    if (!isAuthenticated) {
        return children;
    }
    if (statusQuery.isPending) {
        return (
            <div className="mx-auto max-w-xl space-y-4 px-4 py-10" aria-busy="true">
                <Skeleton className="h-8 w-64 max-w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
            </div>
        );
    }
    if (statusQuery.isError) {
        return (
            <div className="mx-auto max-w-xl px-4 py-10">
                <Alert variant="destructive">
                    <AlertTitle>{text.loadError}</AlertTitle>
                    <AlertDescription className="mt-3 flex flex-wrap gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => statusQuery.refetch()}
                        >
                            <RefreshCw className="size-4" aria-hidden="true" />
                            {text.retry}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => void logout()}>
                            <LogOut className="size-4" aria-hidden="true" />
                            {text.logout}
                        </Button>
                    </AlertDescription>
                </Alert>
            </div>
        );
    }
    if (!statusQuery.data.merchantInitialPasswordStatus.mustChangePassword) {
        return children;
    }

    const validPassword =
        password.length >= 12 &&
        /\p{L}/u.test(password) &&
        /\p{N}/u.test(password) &&
        /[\p{P}\p{S}]/u.test(password);
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (!validPassword) {
            toast.error(text.invalid);
            return;
        }
        if (password !== confirmation) {
            toast.error(text.mismatch);
            return;
        }
        mutation.mutate(password);
    };

    return (
        <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
            <div className="border-b pb-5">
                <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <KeyRound className="size-5" aria-hidden="true" />
                </div>
                <h1 className="mt-4 text-xl font-semibold">{text.title}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{text.description}</p>
            </div>
            <form className="space-y-5 pt-6" onSubmit={submit}>
                <div className="space-y-2">
                    <Label htmlFor="merchant-new-password">{text.password}</Label>
                    <PasswordInput
                        id="merchant-new-password"
                        autoComplete="new-password"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{text.requirement}</p>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="merchant-confirm-password">{text.confirm}</Label>
                    <PasswordInput
                        id="merchant-confirm-password"
                        autoComplete="new-password"
                        value={confirmation}
                        onChange={event => setConfirmation(event.target.value)}
                    />
                </div>
                <div className="flex flex-col-reverse gap-2 border-t pt-5 sm:flex-row sm:justify-between">
                    <Button type="button" variant="ghost" onClick={() => void logout()}>
                        <LogOut className="size-4" aria-hidden="true" />
                        {text.logout}
                    </Button>
                    <Button type="submit" disabled={mutation.isPending}>
                        {mutation.isPending && (
                            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                        )}
                        {mutation.isPending ? text.submitting : text.submit}
                    </Button>
                </div>
            </form>
        </main>
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
