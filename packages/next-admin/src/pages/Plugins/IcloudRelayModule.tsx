import { useMutation, useQuery } from '@apollo/client/react';
import {
    AlertCircle,
    Check,
    CheckCircle2,
    Copy,
    Mail,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    UploadCloud,
    X,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { AccessibleDialogSurface } from '../../components/AccessibleDialogSurface';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useConfirmDialog } from '../../components/confirm-dialog-context';
import {
    BATCH_CREATE_ICLOUD_VIRTUAL_EMAILS_MUTATION,
    CREATE_ICLOUD_PRIMARY_ACCOUNT_MUTATION,
    CREATE_ICLOUD_VIRTUAL_EMAIL_MUTATION,
    DELETE_ICLOUD_PRIMARY_ACCOUNT_MUTATION,
    DELETE_ICLOUD_VIRTUAL_EMAIL_MUTATION,
    ICLOUD_PRIMARY_ACCOUNTS_QUERY,
    ICLOUD_RECEIVED_MAILS_QUERY,
    ICLOUD_VIRTUAL_EMAILS_QUERY,
    RESET_ICLOUD_MASTER_CODE_MUTATION,
    RESET_ICLOUD_VIRTUAL_EMAIL_CODE_MUTATION,
    SYNC_ICLOUD_ACCOUNT_MUTATION,
    TEST_ICLOUD_CONNECTION_MUTATION,
    UPDATE_ICLOUD_PRIMARY_ACCOUNT_MUTATION,
    UPDATE_ICLOUD_VIRTUAL_EMAIL_MUTATION,
    type IcloudPrimaryAccount,
    type IcloudPrimaryAccountsResult,
    type IcloudReceivedMail,
    type IcloudReceivedMailsResult,
    type IcloudVirtualEmail,
    type IcloudVirtualEmailsResult,
} from '../../graphql/icloud-relay.graphql';
import { copyAdminText } from '../../utils/admin-clipboard';
import { toUserFacingError } from '../../utils/user-facing-error';

type ActiveTab = 'primary' | 'virtual' | 'mails';

export function IcloudRelayModule() {
    const requestConfirmation = useConfirmDialog();
    const [tab, setTab] = useState<ActiveTab>('primary');
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    // Primary Accounts Queries
    const primaryQuery = useQuery<IcloudPrimaryAccountsResult>(ICLOUD_PRIMARY_ACCOUNTS_QUERY, {
        fetchPolicy: 'cache-and-network',
    });

    // Virtual Emails Queries
    const [filterPrimaryId, setFilterPrimaryId] = useState<string>('');
    const [virtualSearch, setVirtualSearch] = useState('');
    const virtualQuery = useQuery<IcloudVirtualEmailsResult>(ICLOUD_VIRTUAL_EMAILS_QUERY, {
        variables: { primaryAccountId: filterPrimaryId || undefined },
        fetchPolicy: 'cache-and-network',
    });

    // Received Mails Queries
    const [mailSearch, setMailSearch] = useState('');
    const mailsQuery = useQuery<IcloudReceivedMailsResult>(ICLOUD_RECEIVED_MAILS_QUERY, {
        variables: { limit: 100 },
        fetchPolicy: 'cache-and-network',
    });

    // Mutations
    const [createPrimary, createPrimaryState] = useMutation<{
        createIcloudPrimaryAccount: IcloudPrimaryAccount;
    }>(CREATE_ICLOUD_PRIMARY_ACCOUNT_MUTATION);
    const [updatePrimary, updatePrimaryState] = useMutation<{
        updateIcloudPrimaryAccount: IcloudPrimaryAccount;
    }>(UPDATE_ICLOUD_PRIMARY_ACCOUNT_MUTATION);
    const [deletePrimary] = useMutation<{ deleteIcloudPrimaryAccount: boolean }>(
        DELETE_ICLOUD_PRIMARY_ACCOUNT_MUTATION,
    );
    const [testConnection, testConnectionState] = useMutation<{
        testIcloudConnection: { success: boolean; message?: string | null };
    }>(TEST_ICLOUD_CONNECTION_MUTATION);
    const [syncAccount, syncAccountState] = useMutation<{
        syncIcloudAccount: { success: boolean; syncedCount: number; error?: string | null };
    }>(SYNC_ICLOUD_ACCOUNT_MUTATION);
    const [resetMasterCode] = useMutation<{ resetIcloudMasterCode: IcloudPrimaryAccount }>(
        RESET_ICLOUD_MASTER_CODE_MUTATION,
    );

    const [createVirtual, createVirtualState] = useMutation<{
        createIcloudVirtualEmail: IcloudVirtualEmail;
    }>(CREATE_ICLOUD_VIRTUAL_EMAIL_MUTATION);
    const [batchCreateVirtual, batchCreateState] = useMutation<{
        batchCreateIcloudVirtualEmails: { createdCount: number; skippedCount: number; errors: string[] };
    }>(BATCH_CREATE_ICLOUD_VIRTUAL_EMAILS_MUTATION);
    const [updateVirtual] = useMutation<{ updateIcloudVirtualEmail: IcloudVirtualEmail }>(
        UPDATE_ICLOUD_VIRTUAL_EMAIL_MUTATION,
    );
    const [deleteVirtual] = useMutation<{ deleteIcloudVirtualEmail: boolean }>(
        DELETE_ICLOUD_VIRTUAL_EMAIL_MUTATION,
    );
    const [resetVirtualCode] = useMutation<{ resetIcloudVirtualEmailCode: IcloudVirtualEmail }>(
        RESET_ICLOUD_VIRTUAL_EMAIL_CODE_MUTATION,
    );

    // Dialog States
    const [primaryDialog, setPrimaryDialog] = useState<{
        open: boolean;
        editing: IcloudPrimaryAccount | null;
        email: string;
        appPassword: string;
        note: string;
        codeResetIntervalDays: number;
    }>({
        open: false,
        editing: null,
        email: '',
        appPassword: '',
        note: '',
        codeResetIntervalDays: 30,
    });

    const [virtualDialog, setVirtualDialog] = useState<{
        open: boolean;
        editing: IcloudVirtualEmail | null;
        primaryAccountId: string;
        aliasEmail: string;
        note: string;
    }>({
        open: false,
        editing: null,
        primaryAccountId: '',
        aliasEmail: '',
        note: '',
    });

    const [batchDialog, setBatchDialog] = useState<{
        open: boolean;
        primaryAccountId: string;
        emailsText: string;
    }>({
        open: false,
        primaryAccountId: '',
        emailsText: '',
    });

    const [mailDetailDialog, setMailDetailDialog] = useState<IcloudReceivedMail | null>(null);

    const primaryAccounts = useMemo(
        () => primaryQuery.data?.icloudPrimaryAccounts ?? [],
        [primaryQuery.data?.icloudPrimaryAccounts],
    );
    const virtualEmails = useMemo(
        () => virtualQuery.data?.icloudVirtualEmails ?? [],
        [virtualQuery.data?.icloudVirtualEmails],
    );
    const receivedMails = useMemo(
        () => mailsQuery.data?.icloudReceivedMails ?? [],
        [mailsQuery.data?.icloudReceivedMails],
    );

    const filteredVirtualEmails = useMemo(() => {
        if (!virtualSearch.trim()) return virtualEmails;
        const q = virtualSearch.toLowerCase().trim();
        return virtualEmails.filter(
            v =>
                v.aliasEmail.toLowerCase().includes(q) ||
                (v.note && v.note.toLowerCase().includes(q)) ||
                v.buyerQueryCode.toLowerCase().includes(q) ||
                (v.primaryAccountEmail && v.primaryAccountEmail.toLowerCase().includes(q)),
        );
    }, [virtualEmails, virtualSearch]);

    const filteredReceivedMails = useMemo(() => {
        if (!mailSearch.trim()) return receivedMails;
        const q = mailSearch.toLowerCase().trim();
        return receivedMails.filter(
            m =>
                m.subject.toLowerCase().includes(q) ||
                m.fromAddress.toLowerCase().includes(q) ||
                (m.fromName && m.fromName.toLowerCase().includes(q)) ||
                (m.extractedCode && m.extractedCode.toLowerCase().includes(q)) ||
                (m.bodyText && m.bodyText.toLowerCase().includes(q)),
        );
    }, [receivedMails, mailSearch]);

    const handleCopy = (text: string, key: string) => {
        void copyAdminText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
    };

    // Primary Account Actions
    const handleSavePrimary = async () => {
        setError('');
        setNotice('');
        try {
            if (primaryDialog.editing) {
                await updatePrimary({
                    variables: {
                        id: primaryDialog.editing.id,
                        input: {
                            email: primaryDialog.email.trim(),
                            appPassword: primaryDialog.appPassword.trim() || undefined,
                            note: primaryDialog.note.trim() || undefined,
                            codeResetIntervalDays: Number(primaryDialog.codeResetIntervalDays) || 30,
                        },
                    },
                });
                setNotice('主邮箱信息已更新');
            } else {
                if (!primaryDialog.email.trim() || !primaryDialog.appPassword.trim()) {
                    setError('请填写完整的邮箱地址与 App 专用密码');
                    return;
                }
                await createPrimary({
                    variables: {
                        input: {
                            email: primaryDialog.email.trim(),
                            appPassword: primaryDialog.appPassword.trim(),
                            note: primaryDialog.note.trim() || undefined,
                            codeResetIntervalDays: Number(primaryDialog.codeResetIntervalDays) || 30,
                        },
                    },
                });
                setNotice('成功添加主邮箱');
            }
            setPrimaryDialog({
                open: false,
                editing: null,
                email: '',
                appPassword: '',
                note: '',
                codeResetIntervalDays: 30,
            });
            void primaryQuery.refetch();
        } catch (e) {
            setError(toUserFacingError(e, '保存主邮箱失败'));
        }
    };

    const handleTestConnection = async (id: string, email: string) => {
        setError('');
        setNotice(`正在测试连接 ${email}...`);
        try {
            const res = await testConnection({ variables: { id } });
            if (res.data?.testIcloudConnection.success) {
                setNotice(`✅ 连接成功：${res.data.testIcloudConnection.message || 'IMAP 服务连接正常'}`);
            } else {
                setError(`❌ 连接失败：${res.data?.testIcloudConnection.message || '请检查密码与配置'}`);
            }
            void primaryQuery.refetch();
        } catch (e) {
            setError(toUserFacingError(e, '测试连接发生异常'));
        }
    };

    const handleSync = async (id: string, email: string) => {
        setError('');
        setNotice(`正在同步 ${email} 邮件...`);
        try {
            const res = await syncAccount({ variables: { id } });
            if (res.data?.syncIcloudAccount.success) {
                setNotice(`✅ 同步完成，已拉取并更新 ${res.data.syncIcloudAccount.syncedCount} 封新邮件`);
                void primaryQuery.refetch();
                void virtualQuery.refetch();
                void mailsQuery.refetch();
            } else {
                setError(`❌ 同步失败：${res.data?.syncIcloudAccount.error || '未知错误'}`);
            }
        } catch (e) {
            setError(toUserFacingError(e, '同步邮件失败'));
        }
    };

    const handleResetMasterCode = async (id: string, email: string) => {
        const ok = await requestConfirmation({
            title: '重置主查询码',
            description: `确定要重置 ${email} 的主查询码吗？旧主查询码将立即失效。`,
            confirmLabel: '确定重置',
            tone: 'warning',
        });
        if (!ok) return;

        try {
            await resetMasterCode({ variables: { id } });
            setNotice('主查询码已重置');
            void primaryQuery.refetch();
        } catch (e) {
            setError(toUserFacingError(e, '重置主查询码失败'));
        }
    };

    const handleDeletePrimary = async (id: string, email: string) => {
        const ok = await requestConfirmation({
            title: '删除主邮箱',
            description: `确定要删除主邮箱 ${email} 吗？将同时解除其下虚拟邮箱的关联。`,
            confirmLabel: '删除',
            tone: 'danger',
        });
        if (!ok) return;

        try {
            await deletePrimary({ variables: { id } });
            setNotice('主邮箱已删除');
            void primaryQuery.refetch();
        } catch (e) {
            setError(toUserFacingError(e, '删除主邮箱失败'));
        }
    };

    // Virtual Email Actions
    const handleSaveVirtual = async () => {
        setError('');
        setNotice('');
        try {
            if (virtualDialog.editing) {
                await updateVirtual({
                    variables: {
                        id: virtualDialog.editing.id,
                        input: {
                            note: virtualDialog.note.trim() || undefined,
                        },
                    },
                });
                setNotice('虚拟邮箱备注已更新');
            } else {
                if (!virtualDialog.primaryAccountId || !virtualDialog.aliasEmail.trim()) {
                    setError('请选择所属主邮箱并填写虚拟邮箱地址');
                    return;
                }
                await createVirtual({
                    variables: {
                        input: {
                            primaryAccountId: virtualDialog.primaryAccountId,
                            aliasEmail: virtualDialog.aliasEmail.trim(),
                            note: virtualDialog.note.trim() || undefined,
                        },
                    },
                });
                setNotice('成功添加虚拟邮箱');
            }
            setVirtualDialog({ open: false, editing: null, primaryAccountId: '', aliasEmail: '', note: '' });
            void virtualQuery.refetch();
            void primaryQuery.refetch();
        } catch (e) {
            setError(toUserFacingError(e, '保存虚拟邮箱失败'));
        }
    };

    const handleBatchImportVirtual = async () => {
        setError('');
        setNotice('');
        if (!batchDialog.primaryAccountId) {
            setError('请选择所属主邮箱');
            return;
        }
        const lines = batchDialog.emailsText
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        if (!lines.length) {
            setError('请输入至少一个邮箱地址');
            return;
        }

        const items = lines.map(line => {
            const parts = line.split(/[,\t\s]+/);
            return {
                aliasEmail: parts[0],
                note: parts.slice(1).join(' ') || undefined,
            };
        });

        try {
            const res = await batchCreateVirtual({
                variables: {
                    input: {
                        primaryAccountId: batchDialog.primaryAccountId,
                        items,
                    },
                },
            });
            const result = res.data?.batchCreateIcloudVirtualEmails;
            setNotice(
                `批量导入完成：成功创建 ${result?.createdCount ?? 0} 个，跳过 ${result?.skippedCount ?? 0} 个重复项`,
            );
            setBatchDialog({ open: false, primaryAccountId: '', emailsText: '' });
            void virtualQuery.refetch();
            void primaryQuery.refetch();
        } catch (e) {
            setError(toUserFacingError(e, '批量导入失败'));
        }
    };

    const handleResetVirtualCode = async (id: string, aliasEmail: string) => {
        const ok = await requestConfirmation({
            title: '重置买家查询码',
            description: `确定要重置 ${aliasEmail} 的买家查询码吗？旧码将立即失效。`,
            confirmLabel: '重置',
            tone: 'warning',
        });
        if (!ok) return;

        try {
            await resetVirtualCode({ variables: { id } });
            setNotice('买家查询码已重置');
            void virtualQuery.refetch();
        } catch (e) {
            setError(toUserFacingError(e, '重置买家查询码失败'));
        }
    };

    const handleDeleteVirtual = async (id: string, aliasEmail: string) => {
        const ok = await requestConfirmation({
            title: '删除虚拟邮箱',
            description: `确定要删除虚拟邮箱 ${aliasEmail} 吗？对应收信记录将一并删除。`,
            confirmLabel: '删除',
            tone: 'danger',
        });
        if (!ok) return;

        try {
            await deleteVirtual({ variables: { id } });
            setNotice('虚拟邮箱已删除');
            void virtualQuery.refetch();
            void primaryQuery.refetch();
        } catch (e) {
            setError(toUserFacingError(e, '删除虚拟邮箱失败'));
        }
    };

    return (
        <div className="flex h-full flex-col bg-slate-50">
            {/* Header */}
            <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
                <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
                                <Mail className="h-5 w-5 text-blue-600" aria-hidden="true" />
                                邮件验证码查询设置
                                <FeatureHelpButton topic="plugins.icloud-relay" title="邮件验证码中继管理" />
                            </h1>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                            管理 iCloud
                            主邮箱与虚拟邮箱中继，分配买家专属查询码，实时自动提取验证码供买家自主查收
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                void primaryQuery.refetch();
                                void virtualQuery.refetch();
                                void mailsQuery.refetch();
                                setNotice('数据已刷新');
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                            <RefreshCw
                                className={`h-3.5 w-3.5 ${primaryQuery.loading || virtualQuery.loading || mailsQuery.loading ? 'animate-spin' : ''}`}
                            />
                            刷新
                        </button>
                    </div>
                </div>
            </header>

            {/* Main Area */}
            <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
                {/* Notice / Error banners */}
                {notice && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                            <span>{notice}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setNotice('')}
                            className="text-emerald-600 hover:opacity-80"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}
                {error && (
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                            <span>{error}</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setError('')}
                            className="text-rose-600 hover:opacity-80"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                )}

                {/* Tabs */}
                <div className="flex gap-2 border-b border-slate-200 pb-px">
                    <button
                        type="button"
                        onClick={() => setTab('primary')}
                        className={`rounded-t-lg border-b-2 px-4 py-2.5 text-xs font-bold transition-colors -mb-px ${
                            tab === 'primary'
                                ? 'border-blue-600 bg-white text-blue-600 shadow-2xs'
                                : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        主邮箱管理 ({primaryAccounts.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab('virtual')}
                        className={`rounded-t-lg border-b-2 px-4 py-2.5 text-xs font-bold transition-colors -mb-px ${
                            tab === 'virtual'
                                ? 'border-blue-600 bg-white text-blue-600 shadow-2xs'
                                : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        虚拟邮箱管理 ({virtualEmails.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setTab('mails')}
                        className={`rounded-t-lg border-b-2 px-4 py-2.5 text-xs font-bold transition-colors -mb-px ${
                            tab === 'mails'
                                ? 'border-blue-600 bg-white text-blue-600 shadow-2xs'
                                : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                    >
                        收信记录 ({receivedMails.length})
                    </button>
                </div>

                {/* TAB 1: 主邮箱管理 */}
                {tab === 'primary' && (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs text-slate-500">
                                配置 iCloud 账户及 App 专用密码，系统将自动连接 IMAP 服务器收信并提取验证码。
                            </p>
                            <button
                                type="button"
                                onClick={() =>
                                    setPrimaryDialog({
                                        open: true,
                                        editing: null,
                                        email: '',
                                        appPassword: '',
                                        note: '',
                                        codeResetIntervalDays: 30,
                                    })
                                }
                                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 transition-colors shadow-2xs"
                            >
                                <Plus className="h-3.5 w-3.5" />
                                新增主邮箱
                            </button>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[800px] text-left text-xs">
                                    <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                        <tr>
                                            <th className="p-3.5">主邮箱地址</th>
                                            <th className="p-3.5">备注</th>
                                            <th className="p-3.5">虚拟邮箱</th>
                                            <th className="p-3.5">状态</th>
                                            <th className="p-3.5">主查询码</th>
                                            <th className="p-3.5">有效期</th>
                                            <th className="p-3.5">最近同步</th>
                                            <th className="p-3.5 text-right">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-slate-700">
                                        {primaryAccounts.length === 0 ? (
                                            <tr>
                                                <td colSpan={8} className="p-8 text-center text-slate-400">
                                                    暂无主邮箱配置，请点击右上角「新增主邮箱」开始配置。
                                                </td>
                                            </tr>
                                        ) : (
                                            primaryAccounts.map(account => (
                                                <tr
                                                    key={account.id}
                                                    className="hover:bg-slate-50/80 transition-colors"
                                                >
                                                    <td className="p-3.5 font-bold text-slate-900">
                                                        <div className="flex items-center gap-2">
                                                            <Mail className="h-4 w-4 text-blue-600 shrink-0" />
                                                            <span>{account.email}</span>
                                                        </div>
                                                    </td>
                                                    <td className="p-3.5 text-slate-500">
                                                        {account.note || '—'}
                                                    </td>
                                                    <td className="p-3.5">
                                                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                                                            {account.virtualEmailCount} 个
                                                        </span>
                                                    </td>
                                                    <td className="p-3.5">
                                                        {account.status === 'ACTIVE' ? (
                                                            <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                                正常
                                                            </span>
                                                        ) : account.status === 'AUTH_ERROR' ? (
                                                            <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                                                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                                                                密码错误
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold bg-slate-100 text-slate-600">
                                                                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                                                {account.status}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="p-3.5">
                                                        {account.masterQueryCode ? (
                                                            <div className="flex items-center gap-1.5 font-mono text-[11px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 w-fit">
                                                                <span>{account.masterQueryCode}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        handleCopy(
                                                                            account.masterQueryCode!,
                                                                            `master-${account.id}`,
                                                                        )
                                                                    }
                                                                    className="text-amber-600 hover:opacity-80"
                                                                    title="复制查询码"
                                                                >
                                                                    {copiedKey === `master-${account.id}` ? (
                                                                        <Check className="h-3 w-3 text-emerald-600" />
                                                                    ) : (
                                                                        <Copy className="h-3 w-3" />
                                                                    )}
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            '—'
                                                        )}
                                                    </td>
                                                    <td className="p-3.5 text-slate-500">
                                                        {account.remainingDays != null
                                                            ? `剩 ${account.remainingDays} 天`
                                                            : '—'}
                                                    </td>
                                                    <td className="p-3.5 text-slate-500">
                                                        {account.lastSyncedAt
                                                            ? new Date(account.lastSyncedAt).toLocaleString(
                                                                  'zh-CN',
                                                                  {
                                                                      month: '2-digit',
                                                                      day: '2-digit',
                                                                      hour: '2-digit',
                                                                      minute: '2-digit',
                                                                  },
                                                              )
                                                            : '未同步'}
                                                    </td>
                                                    <td className="p-3.5 text-right">
                                                        <div className="inline-flex items-center gap-1">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleTestConnection(
                                                                        account.id,
                                                                        account.email,
                                                                    )
                                                                }
                                                                disabled={testConnectionState.loading}
                                                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                                                title="测试 IMAP 连接"
                                                            >
                                                                测试
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleSync(account.id, account.email)
                                                                }
                                                                disabled={syncAccountState.loading}
                                                                className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                                                                title="立即同步邮件"
                                                            >
                                                                同步
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleResetMasterCode(
                                                                        account.id,
                                                                        account.email,
                                                                    )
                                                                }
                                                                className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-200 transition-colors"
                                                                title="重置主查询码"
                                                            >
                                                                重置码
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    setPrimaryDialog({
                                                                        open: true,
                                                                        editing: account,
                                                                        email: account.email,
                                                                        appPassword: '',
                                                                        note: account.note || '',
                                                                        codeResetIntervalDays:
                                                                            account.codeResetIntervalDays ||
                                                                            30,
                                                                    })
                                                                }
                                                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                                                title="编辑主邮箱"
                                                            >
                                                                <Pencil className="h-3 w-3" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleDeletePrimary(
                                                                        account.id,
                                                                        account.email,
                                                                    )
                                                                }
                                                                className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                                                                title="删除主邮箱"
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 2: 虚拟邮箱管理 */}
                {tab === 'virtual' && (
                    <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <select
                                    value={filterPrimaryId}
                                    onChange={e => setFilterPrimaryId(e.target.value)}
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-500"
                                >
                                    <option value="">全部主邮箱</option>
                                    {primaryAccounts.map(a => (
                                        <option key={a.id} value={a.id}>
                                            {a.email} {a.note ? `(${a.note})` : ''}
                                        </option>
                                    ))}
                                </select>
                                <div className="relative">
                                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                                    <input
                                        type="text"
                                        value={virtualSearch}
                                        onChange={e => setVirtualSearch(e.target.value)}
                                        placeholder="搜索虚拟邮箱 / 查询码 / 备注"
                                        className="rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-500"
                                    />
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setBatchDialog({
                                            open: true,
                                            primaryAccountId: primaryAccounts[0]?.id ?? '',
                                            emailsText: '',
                                        })
                                    }
                                    disabled={!primaryAccounts.length}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
                                >
                                    <UploadCloud className="h-3.5 w-3.5" />
                                    批量导入
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setVirtualDialog({
                                            open: true,
                                            editing: null,
                                            primaryAccountId: primaryAccounts[0]?.id ?? '',
                                            aliasEmail: '',
                                            note: '',
                                        })
                                    }
                                    disabled={!primaryAccounts.length}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 transition-colors shadow-2xs disabled:opacity-50"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    新增虚拟邮箱
                                </button>
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[850px] text-left text-xs">
                                    <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                        <tr>
                                            <th className="p-3.5">虚拟邮箱地址</th>
                                            <th className="p-3.5">所属主邮箱</th>
                                            <th className="p-3.5">备注说明</th>
                                            <th className="p-3.5">买家专属查询码</th>
                                            <th className="p-3.5">已收信</th>
                                            <th className="p-3.5">最近收信</th>
                                            <th className="p-3.5 text-right">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-slate-700">
                                        {filteredVirtualEmails.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="p-8 text-center text-slate-400">
                                                    {virtualEmails.length === 0
                                                        ? '暂无虚拟邮箱配置，请点击右上角「新增虚拟邮箱」'
                                                        : '没有匹配的虚拟邮箱'}
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredVirtualEmails.map(v => (
                                                <tr
                                                    key={v.id}
                                                    className="hover:bg-slate-50/80 transition-colors"
                                                >
                                                    <td className="p-3.5 font-bold text-slate-900">
                                                        {v.aliasEmail}
                                                    </td>
                                                    <td className="p-3.5 text-slate-500">
                                                        {v.primaryAccountEmail || '—'}
                                                    </td>
                                                    <td className="p-3.5 text-slate-500">{v.note || '—'}</td>
                                                    <td className="p-3.5">
                                                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 w-fit">
                                                            <span>{v.buyerQueryCode}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleCopy(
                                                                        v.buyerQueryCode,
                                                                        `virtual-${v.id}`,
                                                                    )
                                                                }
                                                                className="text-blue-600 hover:text-blue-800"
                                                                title="复制查询码"
                                                            >
                                                                {copiedKey === `virtual-${v.id}` ? (
                                                                    <Check className="h-3 w-3 text-emerald-600" />
                                                                ) : (
                                                                    <Copy className="h-3 w-3" />
                                                                )}
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="p-3.5">
                                                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                                                            {v.mailCount} 封
                                                        </span>
                                                    </td>
                                                    <td className="p-3.5 text-slate-500">
                                                        {v.lastMailReceivedAt
                                                            ? new Date(v.lastMailReceivedAt).toLocaleString(
                                                                  'zh-CN',
                                                                  {
                                                                      month: '2-digit',
                                                                      day: '2-digit',
                                                                      hour: '2-digit',
                                                                      minute: '2-digit',
                                                                  },
                                                              )
                                                            : '暂无'}
                                                    </td>
                                                    <td className="p-3.5 text-right">
                                                        <div className="inline-flex items-center gap-1">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleResetVirtualCode(v.id, v.aliasEmail)
                                                                }
                                                                className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-200 transition-colors"
                                                                title="重置买家查询码"
                                                            >
                                                                重置码
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    setVirtualDialog({
                                                                        open: true,
                                                                        editing: v,
                                                                        primaryAccountId: v.primaryAccountId,
                                                                        aliasEmail: v.aliasEmail,
                                                                        note: v.note || '',
                                                                    })
                                                                }
                                                                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                                                title="编辑备注"
                                                            >
                                                                <Pencil className="h-3 w-3" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleDeleteVirtual(v.id, v.aliasEmail)
                                                                }
                                                                className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                                                                title="删除虚拟邮箱"
                                                            >
                                                                <Trash2 className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* TAB 3: 收信记录 */}
                {tab === 'mails' && (
                    <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <p className="text-xs text-slate-500">
                                显示最近收到的 100 封邮件，系统已自动提取短信/邮件验证码。
                            </p>
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                                <input
                                    type="text"
                                    value={mailSearch}
                                    onChange={e => setMailSearch(e.target.value)}
                                    placeholder="搜索发件人 / 主题 / 验证码"
                                    className="rounded-lg border border-slate-300 bg-white pl-8 pr-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-500"
                                />
                            </div>
                        </div>

                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[850px] text-left text-xs">
                                    <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                        <tr>
                                            <th className="p-3.5">收信时间</th>
                                            <th className="p-3.5">发件人</th>
                                            <th className="p-3.5">邮件主题</th>
                                            <th className="p-3.5">提取到的验证码</th>
                                            <th className="p-3.5 text-right">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-slate-700">
                                        {filteredReceivedMails.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="p-8 text-center text-slate-400">
                                                    {receivedMails.length === 0
                                                        ? '暂无收信记录，请点击上方「刷新」或在主邮箱管理中点击「同步」'
                                                        : '没有匹配的收信记录'}
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredReceivedMails.map(mail => (
                                                <tr
                                                    key={mail.id}
                                                    className="hover:bg-slate-50/80 transition-colors"
                                                >
                                                    <td className="p-3.5 text-slate-500 whitespace-nowrap">
                                                        {new Date(mail.receivedAt).toLocaleString('zh-CN', {
                                                            month: '2-digit',
                                                            day: '2-digit',
                                                            hour: '2-digit',
                                                            minute: '2-digit',
                                                            second: '2-digit',
                                                        })}
                                                    </td>
                                                    <td className="p-3.5">
                                                        <div className="font-bold text-slate-900">
                                                            {mail.fromName || mail.fromAddress}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 font-mono">
                                                            {mail.fromAddress}
                                                        </div>
                                                    </td>
                                                    <td className="p-3.5 max-w-xs truncate text-slate-800">
                                                        {mail.subject || '（无主题）'}
                                                    </td>
                                                    <td className="p-3.5">
                                                        {mail.extractedCode ? (
                                                            <div className="flex items-center gap-1.5 font-mono text-sm font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 w-fit">
                                                                <span>{mail.extractedCode}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        handleCopy(
                                                                            mail.extractedCode!,
                                                                            `mail-${mail.id}`,
                                                                        )
                                                                    }
                                                                    className="text-emerald-600 hover:opacity-80"
                                                                    title="复制验证码"
                                                                >
                                                                    {copiedKey === `mail-${mail.id}` ? (
                                                                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                                                                    ) : (
                                                                        <Copy className="h-3.5 w-3.5" />
                                                                    )}
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-400">未提取</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3.5 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={() => setMailDetailDialog(mail)}
                                                            className="rounded border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                                        >
                                                            查看正文
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* Modal: Primary Account Add / Edit */}
            {primaryDialog.open && (
                <AdminModal
                    title={primaryDialog.editing ? '编辑主邮箱' : '新增 iCloud 主邮箱'}
                    description="配置 iCloud 邮箱及 App 专用密码，系统将自动连接收信"
                    onClose={() => setPrimaryDialog(prev => ({ ...prev, open: false }))}
                >
                    <div className="space-y-4 pt-4 text-xs">
                        <div>
                            <label className="block text-slate-700 font-bold mb-1">iCloud 邮箱地址 *</label>
                            <input
                                type="email"
                                value={primaryDialog.email}
                                onChange={e => setPrimaryDialog(p => ({ ...p, email: e.target.value }))}
                                placeholder="example@icloud.com"
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 text-xs"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-700 font-bold mb-1">
                                App 专用密码 {primaryDialog.editing ? '(如不修改请留空)' : '*'}
                            </label>
                            <input
                                type="password"
                                value={primaryDialog.appPassword}
                                onChange={e => setPrimaryDialog(p => ({ ...p, appPassword: e.target.value }))}
                                placeholder="xxxx-xxxx-xxxx-xxxx"
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 font-mono text-xs"
                            />
                            <p className="mt-1 text-[11px] text-slate-400">
                                💡 前往 appleid.apple.com 登录，在「登录与安全」-「App 专用密码」中生成。
                            </p>
                        </div>
                        <div>
                            <label className="block text-slate-700 font-bold mb-1">备注说明</label>
                            <input
                                type="text"
                                value={primaryDialog.note}
                                onChange={e => setPrimaryDialog(p => ({ ...p, note: e.target.value }))}
                                placeholder="例如：主号1号、客户专用"
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 text-xs"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-700 font-bold mb-1">查询码有效周期 (天)</label>
                            <input
                                type="number"
                                min={1}
                                max={365}
                                value={primaryDialog.codeResetIntervalDays}
                                onChange={e =>
                                    setPrimaryDialog(p => ({
                                        ...p,
                                        codeResetIntervalDays: parseInt(e.target.value, 10) || 30,
                                    }))
                                }
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 text-xs"
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => setPrimaryDialog(p => ({ ...p, open: false }))}
                                className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={handleSavePrimary}
                                disabled={createPrimaryState.loading || updatePrimaryState.loading}
                                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:opacity-50 text-xs shadow-2xs"
                            >
                                {createPrimaryState.loading || updatePrimaryState.loading
                                    ? '保存中…'
                                    : '保存'}
                            </button>
                        </div>
                    </div>
                </AdminModal>
            )}

            {/* Modal: Virtual Email Add / Edit */}
            {virtualDialog.open && (
                <AdminModal
                    title={virtualDialog.editing ? '编辑虚拟邮箱' : '新增虚拟邮箱'}
                    description="为虚拟邮箱分配所属主邮箱并生成买家专属查询码"
                    onClose={() => setVirtualDialog(prev => ({ ...prev, open: false }))}
                >
                    <div className="space-y-4 pt-4 text-xs">
                        {!virtualDialog.editing && (
                            <div>
                                <label className="block text-slate-700 font-bold mb-1">所属主邮箱 *</label>
                                <select
                                    value={virtualDialog.primaryAccountId}
                                    onChange={e =>
                                        setVirtualDialog(p => ({ ...p, primaryAccountId: e.target.value }))
                                    }
                                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 text-xs"
                                >
                                    <option value="">请选择主邮箱</option>
                                    {primaryAccounts.map(a => (
                                        <option key={a.id} value={a.id}>
                                            {a.email} {a.note ? `(${a.note})` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        <div>
                            <label className="block text-slate-700 font-bold mb-1">虚拟邮箱地址 *</label>
                            <input
                                type="email"
                                value={virtualDialog.aliasEmail}
                                disabled={Boolean(virtualDialog.editing)}
                                onChange={e => setVirtualDialog(p => ({ ...p, aliasEmail: e.target.value }))}
                                placeholder="alias@icloud.com"
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 disabled:bg-slate-100 text-xs"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-700 font-bold mb-1">备注说明</label>
                            <input
                                type="text"
                                value={virtualDialog.note}
                                onChange={e => setVirtualDialog(p => ({ ...p, note: e.target.value }))}
                                placeholder="例如：买家张三、订单号#1001"
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 text-xs"
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => setVirtualDialog(p => ({ ...p, open: false }))}
                                className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveVirtual}
                                disabled={createVirtualState.loading}
                                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 text-xs shadow-2xs"
                            >
                                {createVirtualState.loading ? '保存中…' : '保存'}
                            </button>
                        </div>
                    </div>
                </AdminModal>
            )}

            {/* Modal: Batch Import Virtual Emails */}
            {batchDialog.open && (
                <AdminModal
                    title="批量导入虚拟邮箱"
                    description="一行一个虚拟邮箱地址，每行空格后可跟备注说明"
                    onClose={() => setBatchDialog(prev => ({ ...prev, open: false }))}
                >
                    <div className="space-y-4 pt-4 text-xs">
                        <div>
                            <label className="block text-slate-700 font-bold mb-1">所属主邮箱 *</label>
                            <select
                                value={batchDialog.primaryAccountId}
                                onChange={e =>
                                    setBatchDialog(p => ({ ...p, primaryAccountId: e.target.value }))
                                }
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 text-xs"
                            >
                                <option value="">请选择主邮箱</option>
                                {primaryAccounts.map(a => (
                                    <option key={a.id} value={a.id}>
                                        {a.email} {a.note ? `(${a.note})` : ''}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-slate-700 font-bold mb-1">
                                邮箱列表 (一行一个) *
                            </label>
                            <textarea
                                rows={8}
                                value={batchDialog.emailsText}
                                onChange={e => setBatchDialog(p => ({ ...p, emailsText: e.target.value }))}
                                placeholder={`alias1@icloud.com 备注1\nalias2@icloud.com 备注2\nalias3@icloud.com`}
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 font-mono text-xs"
                            />
                        </div>
                        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => setBatchDialog(p => ({ ...p, open: false }))}
                                className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={handleBatchImportVirtual}
                                disabled={batchCreateState.loading}
                                className="px-4 py-1.5 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 text-xs shadow-2xs"
                            >
                                {batchCreateState.loading ? '导入中…' : '开始导入'}
                            </button>
                        </div>
                    </div>
                </AdminModal>
            )}

            {/* Modal: Mail Details */}
            {mailDetailDialog && (
                <AdminModal
                    title={mailDetailDialog.subject || '邮件详情'}
                    description={`发件人: ${mailDetailDialog.fromName || mailDetailDialog.fromAddress} (${mailDetailDialog.fromAddress})`}
                    onClose={() => setMailDetailDialog(null)}
                >
                    <div className="space-y-4 pt-4 text-xs">
                        {mailDetailDialog.extractedCode && (
                            <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
                                <div>
                                    <div className="text-[11px] font-bold text-emerald-800">
                                        提取到的验证码
                                    </div>
                                    <div className="text-xl font-bold font-mono text-emerald-700 tracking-wider mt-0.5">
                                        {mailDetailDialog.extractedCode}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleCopy(mailDetailDialog.extractedCode!, 'modal-code')}
                                    className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 shadow-2xs"
                                >
                                    {copiedKey === 'modal-code' ? '已复制 ✓' : '复制验证码'}
                                </button>
                            </div>
                        )}
                        <div className="border-t border-slate-100 pt-3">
                            <div className="text-slate-600 mb-2 font-bold">邮件正文：</div>
                            {mailDetailDialog.bodyHtml ? (
                                <iframe
                                    srcDoc={mailDetailDialog.bodyHtml}
                                    sandbox="allow-same-origin"
                                    className="w-full h-80 rounded-lg border border-slate-200 bg-white"
                                    title="邮件正文"
                                />
                            ) : (
                                <pre className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 whitespace-pre-wrap font-mono text-xs max-h-80 overflow-y-auto">
                                    {mailDetailDialog.bodyText || '(无文本内容)'}
                                </pre>
                            )}
                        </div>
                    </div>
                </AdminModal>
            )}
        </div>
    );
}

function AdminModal({
    title,
    description,
    onClose,
    children,
}: {
    title: string;
    description?: string;
    onClose: () => void;
    children: ReactNode;
}) {
    return (
        <div
            className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-xs"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <AccessibleDialogSurface
                accessibleName={title}
                onRequestClose={onClose}
                className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-slate-900"
            >
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                        <h2 className="text-base font-bold text-slate-900">{title}</h2>
                        {description && (
                            <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="关闭"
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                {children}
            </AccessibleDialogSurface>
        </div>
    );
}
