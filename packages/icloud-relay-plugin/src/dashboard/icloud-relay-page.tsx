import {
    Badge,
    Button,
    Input,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    useMutation,
    useNotificationService,
    useQuery,
} from '@vendure/dashboard';
import { Copy, Mail, Pencil, Plug, Plus, RefreshCw, RotateCcw, Trash2, UploadCloud, X } from 'lucide-react';
import { useState } from 'react';

import {
    batchCreateIcloudVirtualEmailsMutation,
    createIcloudPrimaryAccountMutation,
    createIcloudVirtualEmailMutation,
    deleteIcloudPrimaryAccountMutation,
    deleteIcloudVirtualEmailMutation,
    icloudPrimaryAccountsQuery,
    icloudReceivedMailsQuery,
    icloudVirtualEmailsQuery,
    resetIcloudMasterCodeMutation,
    resetIcloudVirtualEmailCodeMutation,
    syncIcloudAccountMutation,
    testIcloudConnectionMutation,
    updateIcloudPrimaryAccountMutation,
    updateIcloudVirtualEmailMutation,
} from './icloud-relay.graphql';

// ==========================================
// Status Badge Helper
// ==========================================
const StatusBadge = ({ status }: { status: string }) => {
    switch (status) {
        case 'ACTIVE':
            return <Badge color="green">正常</Badge>;
        case 'DISABLED':
            return <Badge color="gray">已禁用</Badge>;
        case 'AUTH_ERROR':
            return <Badge color="red">授权错误</Badge>;
        case 'SYNCING':
            return <Badge color="blue">同步中</Badge>;
        default:
            return <Badge color="gray">{status}</Badge>;
    }
};

// ==========================================
// Format Relative Time
// ==========================================
const formatRelativeTime = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return '刚刚';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}分钟前`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}小时前`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}天前`;
    return date.toLocaleDateString('zh-CN');
};

export function IcloudRelayPage() {
    const [activeTab, setActiveTab] = useState<'primary' | 'virtual'>('primary');
    const notificationService = useNotificationService();

    // Data fetching
    const {
        data: primaryData,
        loading: primaryLoading,
        refetch: refetchPrimary,
    } = useQuery(icloudPrimaryAccountsQuery);

    const [selectedPrimaryFilter, setSelectedPrimaryFilter] = useState<string>('');
    const {
        data: virtualData,
        loading: virtualLoading,
        refetch: refetchVirtual,
    } = useQuery(icloudVirtualEmailsQuery, {
        variables: { primaryAccountId: selectedPrimaryFilter || undefined },
    });

    // Mutations
    const [createPrimaryAccount] = useMutation(createIcloudPrimaryAccountMutation);
    const [updatePrimaryAccount] = useMutation(updateIcloudPrimaryAccountMutation);
    const [deletePrimaryAccount] = useMutation(deleteIcloudPrimaryAccountMutation);
    const [testConnection] = useMutation(testIcloudConnectionMutation);
    const [syncAccount] = useMutation(syncIcloudAccountMutation);
    const [resetMasterCode] = useMutation(resetIcloudMasterCodeMutation);

    const [createVirtualEmail] = useMutation(createIcloudVirtualEmailMutation);
    const [batchCreateVirtualEmails] = useMutation(batchCreateIcloudVirtualEmailsMutation);
    const [updateVirtualEmail] = useMutation(updateIcloudVirtualEmailMutation);
    const [deleteVirtualEmail] = useMutation(deleteIcloudVirtualEmailMutation);
    const [resetVirtualCode] = useMutation(resetIcloudVirtualEmailCodeMutation);

    // Form states
    const [isAddPrimaryModalOpen, setIsAddPrimaryModalOpen] = useState(false);
    const [newPrimary, setNewPrimary] = useState({
        email: '',
        appPassword: '',
        note: '',
        codeResetIntervalDays: 30,
    });

    const [isAddVirtualModalOpen, setIsAddVirtualModalOpen] = useState(false);
    const [newVirtual, setNewVirtual] = useState({
        aliasEmail: '',
        primaryAccountId: '',
        note: '',
        codeResetIntervalDays: 30,
    });

    const [isBatchVirtualModalOpen, setIsBatchVirtualModalOpen] = useState(false);
    const [batchVirtualData, setBatchVirtualData] = useState({
        primaryAccountId: '',
        emailsText: '',
    });

    // Mail preview drawer
    const [previewVirtualId, setPreviewVirtualId] = useState<string | null>(null);
    const [previewVirtualEmail, setPreviewVirtualEmail] = useState<string>('');
    const {
        data: mailsData,
        loading: mailsLoading,
        refetch: refetchMails,
    } = useQuery(icloudReceivedMailsQuery, {
        variables: { virtualEmailId: previewVirtualId, limit: 50 },
        skip: !previewVirtualId,
    });

    // Edit states
    const [editingPrimary, setEditingPrimary] = useState<any>(null);
    const [editingVirtual, setEditingVirtual] = useState<any>(null);

    // Helpers
    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            notificationService.success('复制成功');
        } catch {
            notificationService.error('复制失败');
        }
    };

    // ==========================================
    // Handlers: Primary Accounts
    // ==========================================
    const handleTestConnection = async (id: string) => {
        try {
            const { data } = await testConnection({ variables: { id } });
            if (data?.testIcloudConnection?.success) {
                notificationService.success('连接测试成功，收件箱正常');
            } else {
                notificationService.error(data?.testIcloudConnection?.message || '连接测试失败');
            }
        } catch (e: any) {
            notificationService.error(e.message);
        }
    };

    const handleSyncAccount = async (id: string) => {
        try {
            notificationService.info('正在同步 iCloud 邮件...');
            const { data } = await syncAccount({ variables: { id } });
            if (data?.syncIcloudAccount?.success) {
                notificationService.success(`同步完成！新增 ${data.syncIcloudAccount.syncedCount} 封邮件`);
            } else {
                notificationService.error(data?.syncIcloudAccount?.error || '同步失败');
            }
            refetchPrimary();
            refetchVirtual();
        } catch (e: any) {
            notificationService.error(e.message);
        }
    };

    const handleResetMasterCode = async (id: string) => {
        if (!window.confirm('确定要重置该主邮箱的查询码吗？旧代码将立即失效。')) return;
        try {
            await resetMasterCode({ variables: { id } });
            notificationService.success('主查询码已重置');
            refetchPrimary();
        } catch (e: any) {
            notificationService.error(e.message);
        }
    };

    const handleDeletePrimary = async (id: string) => {
        if (!window.confirm('确定要删除该主邮箱吗？下属虚拟邮箱及所有邮件也将被级联删除！')) return;
        try {
            await deletePrimaryAccount({ variables: { id } });
            notificationService.success('主邮箱删除成功');
            refetchPrimary();
            refetchVirtual();
        } catch (e: any) {
            notificationService.error(e.message);
        }
    };

    const handleSavePrimary = async () => {
        try {
            if (editingPrimary) {
                await updatePrimaryAccount({
                    variables: {
                        input: {
                            id: editingPrimary.id,
                            note: editingPrimary.note,
                            codeResetIntervalDays: Number(editingPrimary.codeResetIntervalDays) || 30,
                        },
                    },
                });
                notificationService.success('更新成功');
                setEditingPrimary(null);
            } else {
                if (!newPrimary.email || !newPrimary.appPassword) {
                    notificationService.error('邮箱与 App 专用密码为必填项');
                    return;
                }
                await createPrimaryAccount({
                    variables: {
                        input: {
                            email: newPrimary.email.trim(),
                            appPassword: newPrimary.appPassword.trim(),
                            note: newPrimary.note,
                            codeResetIntervalDays: Number(newPrimary.codeResetIntervalDays) || 30,
                        },
                    },
                });
                notificationService.success('主邮箱添加成功');
                setIsAddPrimaryModalOpen(false);
                setNewPrimary({ email: '', appPassword: '', note: '', codeResetIntervalDays: 30 });
            }
            refetchPrimary();
        } catch (e: any) {
            notificationService.error(e.message);
        }
    };

    // ==========================================
    // Handlers: Virtual Emails
    // ==========================================
    const handleResetVirtualCode = async (id: string) => {
        if (!window.confirm('确定要重置该虚拟邮箱的查询码吗？旧买家查询码将立即失效。')) return;
        try {
            await resetVirtualCode({ variables: { id } });
            notificationService.success('买家查询码已重置');
            refetchVirtual();
        } catch (e: any) {
            notificationService.error(e.message);
        }
    };

    const handleDeleteVirtual = async (id: string) => {
        if (!window.confirm('确定要删除该虚拟邮箱吗？')) return;
        try {
            await deleteVirtualEmail({ variables: { id } });
            notificationService.success('虚拟邮箱删除成功');
            refetchVirtual();
            refetchPrimary();
        } catch (e: any) {
            notificationService.error(e.message);
        }
    };

    const handleSaveVirtual = async () => {
        try {
            if (editingVirtual) {
                await updateVirtualEmail({
                    variables: {
                        input: {
                            id: editingVirtual.id,
                            note: editingVirtual.note,
                            codeResetIntervalDays: Number(editingVirtual.codeResetIntervalDays) || 30,
                        },
                    },
                });
                notificationService.success('更新成功');
                setEditingVirtual(null);
            } else {
                if (!newVirtual.aliasEmail || !newVirtual.primaryAccountId) {
                    notificationService.error('虚拟邮箱地址与所属主邮箱为必填项');
                    return;
                }
                await createVirtualEmail({
                    variables: {
                        input: {
                            aliasEmail: newVirtual.aliasEmail.trim(),
                            primaryAccountId: newVirtual.primaryAccountId,
                            note: newVirtual.note,
                            codeResetIntervalDays: Number(newVirtual.codeResetIntervalDays) || 30,
                        },
                    },
                });
                notificationService.success('虚拟邮箱添加成功');
                setIsAddVirtualModalOpen(false);
                setNewVirtual({
                    aliasEmail: '',
                    primaryAccountId: primaryAccounts[0]?.id || '',
                    note: '',
                    codeResetIntervalDays: 30,
                });
            }
            refetchVirtual();
            refetchPrimary();
        } catch (e: any) {
            notificationService.error(e.message);
        }
    };

    const handleBatchSaveVirtual = async () => {
        try {
            if (!batchVirtualData.primaryAccountId || !batchVirtualData.emailsText.trim()) {
                notificationService.error('请选择主邮箱并输入邮箱列表');
                return;
            }
            const { data } = await batchCreateVirtualEmails({
                variables: {
                    input: {
                        primaryAccountId: batchVirtualData.primaryAccountId,
                        rawInput: batchVirtualData.emailsText,
                    },
                },
            });
            const result = data?.batchCreateIcloudVirtualEmails;
            notificationService.success(
                `批量导入完成：成功 ${result?.createdCount || 0} 个，跳过 ${result?.skippedCount || 0} 个`,
            );
            setIsBatchVirtualModalOpen(false);
            setBatchVirtualData({ primaryAccountId: '', emailsText: '' });
            refetchVirtual();
            refetchPrimary();
        } catch (e: any) {
            notificationService.error(e.message);
        }
    };

    const primaryAccounts = primaryData?.icloudPrimaryAccounts || [];
    const virtualEmails = virtualData?.icloudVirtualEmails || [];

    return (
        <div className="icloud-relay-dashboard p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">iCloud 隐藏邮箱管理中心</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        管理 iCloud 主账号、多别名虚拟邮箱、智能分流及买家查询码
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        onClick={() => setActiveTab('primary')}
                        variant={activeTab === 'primary' ? 'primary' : 'secondary'}
                    >
                        主邮箱管理 ({primaryAccounts.length})
                    </Button>
                    <Button
                        onClick={() => setActiveTab('virtual')}
                        variant={activeTab === 'virtual' ? 'primary' : 'secondary'}
                    >
                        虚拟邮箱管理 ({virtualEmails.length})
                    </Button>
                </div>
            </div>

            {/* TAB 1: Primary Accounts */}
            {activeTab === 'primary' && (
                <div>
                    <div className="flex justify-between items-center mb-4">
                        <div className="text-sm text-gray-500">
                            共录入{' '}
                            <span className="font-semibold text-gray-800">{primaryAccounts.length}</span> 个
                            iCloud 主账号
                        </div>
                        <Button onClick={() => setIsAddPrimaryModalOpen(true)}>
                            <Plus className="w-4 h-4 mr-1" /> 新增主邮箱
                        </Button>
                    </div>

                    <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>主邮箱地址</TableHead>
                                    <TableHead>备注</TableHead>
                                    <TableHead>虚拟邮箱数</TableHead>
                                    <TableHead>状态</TableHead>
                                    <TableHead>主查询码</TableHead>
                                    <TableHead>有效期</TableHead>
                                    <TableHead>最近查询</TableHead>
                                    <TableHead>最近同步</TableHead>
                                    <TableHead className="text-right">操作</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {primaryLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8 text-gray-400">
                                            正在加载主邮箱数据...
                                        </TableCell>
                                    </TableRow>
                                ) : primaryAccounts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-12 text-gray-400">
                                            暂无主邮箱，请点击上方按钮新增
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    primaryAccounts.map((account: any) => (
                                        <TableRow key={account.id}>
                                            <TableCell className="font-medium text-gray-900">
                                                {account.email}
                                            </TableCell>
                                            <TableCell className="text-gray-600">
                                                {account.note || '-'}
                                            </TableCell>
                                            <TableCell>
                                                <Badge color="blue">
                                                    {account.virtualEmailCount || 0} 个
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <StatusBadge status={account.status} />
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-mono text-sm bg-gray-100 px-2 py-0.5 rounded">
                                                        {account.masterQueryCode}
                                                    </span>
                                                    <button
                                                        onClick={() =>
                                                            copyToClipboard(account.masterQueryCode)
                                                        }
                                                        className="text-gray-400 hover:text-blue-600 p-1"
                                                        title="点击复制"
                                                    >
                                                        <Copy className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-xs text-gray-600">
                                                    {account.remainingDays != null
                                                        ? `剩余 ${account.remainingDays} 天`
                                                        : '永久有效'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-500">
                                                {formatRelativeTime(account.lastQueriedAt)}
                                                {account.lastQueriedIp && (
                                                    <div className="text-gray-400 text-[11px]">
                                                        {account.lastQueriedIp}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-500">
                                                {formatRelativeTime(account.lastSyncedAt)}
                                                {account.lastSyncError && (
                                                    <div
                                                        className="text-red-500 text-[11px] truncate max-w-[120px]"
                                                        title={account.lastSyncError}
                                                    >
                                                        {account.lastSyncError}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <button
                                                        title="测试 IMAP 连通性"
                                                        onClick={() => handleTestConnection(account.id)}
                                                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                                                    >
                                                        <Plug className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        title="立即同步邮件"
                                                        onClick={() => handleSyncAccount(account.id)}
                                                        className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                                                    >
                                                        <RefreshCw className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        title="重置主查询码"
                                                        onClick={() => handleResetMasterCode(account.id)}
                                                        className="p-1.5 text-amber-600 hover:bg-amber-50 rounded"
                                                    >
                                                        <RotateCcw className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        title="编辑"
                                                        onClick={() =>
                                                            setEditingPrimary({
                                                                id: account.id,
                                                                note: account.note || '',
                                                                codeResetIntervalDays:
                                                                    account.codeResetIntervalDays || 30,
                                                            })
                                                        }
                                                        className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        title="删除"
                                                        onClick={() => handleDeletePrimary(account.id)}
                                                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Add / Edit Primary Account Modal */}
                    {(isAddPrimaryModalOpen || editingPrimary) && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                            <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-md">
                                <h3 className="text-lg font-bold mb-4">
                                    {editingPrimary ? '编辑主邮箱' : '新增 iCloud 主邮箱'}
                                </h3>

                                {!editingPrimary && (
                                    <>
                                        <div className="mb-4">
                                            <label className="block text-sm font-medium mb-1">
                                                iCloud 主邮箱账号 *
                                            </label>
                                            <Input
                                                value={newPrimary.email}
                                                onChange={(e: any) =>
                                                    setNewPrimary({ ...newPrimary, email: e.target.value })
                                                }
                                                placeholder="your-apple-id@icloud.com"
                                            />
                                        </div>

                                        <div className="mb-4">
                                            <label className="block text-sm font-medium mb-1">
                                                App 专用密码 (App-Specific Password) *
                                            </label>
                                            <Input
                                                type="password"
                                                value={newPrimary.appPassword}
                                                onChange={(e: any) =>
                                                    setNewPrimary({
                                                        ...newPrimary,
                                                        appPassword: e.target.value,
                                                    })
                                                }
                                                placeholder="abcd-efgh-ijkl-mnop"
                                            />
                                            <p className="text-xs text-gray-400 mt-1">
                                                前往 appleid.apple.com 生成专用密码，密码将使用 AES-256
                                                加密存储
                                            </p>
                                        </div>
                                    </>
                                )}

                                <div className="mb-4">
                                    <label className="block text-sm font-medium mb-1">备注说明</label>
                                    <Input
                                        value={editingPrimary ? editingPrimary.note : newPrimary.note}
                                        onChange={(e: any) =>
                                            editingPrimary
                                                ? setEditingPrimary({
                                                      ...editingPrimary,
                                                      note: e.target.value,
                                                  })
                                                : setNewPrimary({ ...newPrimary, note: e.target.value })
                                        }
                                        placeholder="例如：主号A / 店铺1"
                                    />
                                </div>

                                <div className="mb-6">
                                    <label className="block text-sm font-medium mb-1">
                                        查询码自动重置周期 (天)
                                    </label>
                                    <Input
                                        type="number"
                                        value={
                                            editingPrimary
                                                ? editingPrimary.codeResetIntervalDays
                                                : newPrimary.codeResetIntervalDays
                                        }
                                        onChange={(e: any) => {
                                            const val = parseInt(e.target.value, 10) || 0;
                                            if (editingPrimary) {
                                                setEditingPrimary({
                                                    ...editingPrimary,
                                                    codeResetIntervalDays: val,
                                                });
                                            } else {
                                                setNewPrimary({
                                                    ...newPrimary,
                                                    codeResetIntervalDays: val,
                                                });
                                            }
                                        }}
                                    />
                                    <p className="text-xs text-gray-400 mt-1">
                                        默认为 30 天，设为 0 则不自动重置
                                    </p>
                                </div>

                                <div className="flex justify-end gap-3">
                                    <Button
                                        variant="secondary"
                                        onClick={() => {
                                            setIsAddPrimaryModalOpen(false);
                                            setEditingPrimary(null);
                                        }}
                                    >
                                        取消
                                    </Button>
                                    <Button variant="primary" onClick={handleSavePrimary}>
                                        保存
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 2: Virtual Emails */}
            {activeTab === 'virtual' && (
                <div>
                    <div className="flex flex-wrap justify-between items-center mb-4 gap-3">
                        <div className="flex items-center gap-3">
                            <label className="text-sm font-medium text-gray-700">所属主邮箱筛选:</label>
                            <select
                                className="border rounded-lg px-3 py-1.5 text-sm bg-white"
                                value={selectedPrimaryFilter}
                                onChange={e => setSelectedPrimaryFilter(e.target.value)}
                            >
                                <option value="">全部主邮箱 ({primaryAccounts.length})</option>
                                {primaryAccounts.map((acc: any) => (
                                    <option key={acc.id} value={acc.id}>
                                        {acc.email} ({acc.note || '无备注'})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="secondary" onClick={() => setIsBatchVirtualModalOpen(true)}>
                                <UploadCloud className="w-4 h-4 mr-1" /> 批量导入
                            </Button>
                            <Button onClick={() => setIsAddVirtualModalOpen(true)}>
                                <Plus className="w-4 h-4 mr-1" /> 新增虚拟邮箱
                            </Button>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg border shadow-sm overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>虚拟邮箱地址</TableHead>
                                    <TableHead>所属主邮箱</TableHead>
                                    <TableHead>备注</TableHead>
                                    <TableHead>已收邮件数</TableHead>
                                    <TableHead>状态</TableHead>
                                    <TableHead>买家查询码</TableHead>
                                    <TableHead>有效期</TableHead>
                                    <TableHead>最近查询</TableHead>
                                    <TableHead className="text-right">操作</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {virtualLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8 text-gray-400">
                                            正在加载虚拟邮箱...
                                        </TableCell>
                                    </TableRow>
                                ) : virtualEmails.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-12 text-gray-400">
                                            暂无虚拟邮箱，请点击右上角新增或批量导入
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    virtualEmails.map((virtual: any) => (
                                        <TableRow key={virtual.id}>
                                            <TableCell className="font-mono text-sm font-medium text-gray-900">
                                                {virtual.aliasEmail}
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-600">
                                                {virtual.primaryAccountEmail || '-'}
                                            </TableCell>
                                            <TableCell className="text-sm text-gray-600">
                                                {virtual.note || '-'}
                                            </TableCell>
                                            <TableCell>
                                                <button
                                                    onClick={() => {
                                                        setPreviewVirtualId(virtual.id);
                                                        setPreviewVirtualEmail(virtual.aliasEmail);
                                                    }}
                                                    className="inline-flex items-center gap-1 text-blue-600 hover:underline text-sm font-medium"
                                                >
                                                    <Mail className="w-3.5 h-3.5" />
                                                    {virtual.mailCount || 0} 封
                                                </button>
                                            </TableCell>
                                            <TableCell>
                                                <StatusBadge status={virtual.status} />
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-mono text-sm bg-blue-50 text-blue-800 px-2 py-0.5 rounded font-semibold">
                                                        {virtual.buyerQueryCode}
                                                    </span>
                                                    <button
                                                        onClick={() =>
                                                            copyToClipboard(virtual.buyerQueryCode)
                                                        }
                                                        className="text-gray-400 hover:text-blue-600 p-1"
                                                        title="点击复制买家查询码"
                                                    >
                                                        <Copy className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-xs text-gray-600">
                                                    {virtual.remainingDays != null
                                                        ? `剩余 ${virtual.remainingDays} 天`
                                                        : '永久有效'}
                                                </span>
                                            </TableCell>
                                            <TableCell className="text-xs text-gray-500">
                                                {formatRelativeTime(virtual.lastQueriedAt)}
                                                {virtual.lastQueriedIp && (
                                                    <div className="text-gray-400 text-[11px]">
                                                        {virtual.lastQueriedIp}
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <button
                                                        title="查看邮件"
                                                        onClick={() => {
                                                            setPreviewVirtualId(virtual.id);
                                                            setPreviewVirtualEmail(virtual.aliasEmail);
                                                        }}
                                                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                                                    >
                                                        <Mail className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        title="重置买家查询码"
                                                        onClick={() => handleResetVirtualCode(virtual.id)}
                                                        className="p-1.5 text-amber-600 hover:bg-amber-50 rounded"
                                                    >
                                                        <RotateCcw className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        title="编辑备注"
                                                        onClick={() =>
                                                            setEditingVirtual({
                                                                id: virtual.id,
                                                                note: virtual.note || '',
                                                                codeResetIntervalDays:
                                                                    virtual.codeResetIntervalDays || 30,
                                                            })
                                                        }
                                                        className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        title="删除"
                                                        onClick={() => handleDeleteVirtual(virtual.id)}
                                                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Add / Edit Virtual Email Modal */}
                    {(isAddVirtualModalOpen || editingVirtual) && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                            <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-md">
                                <h3 className="text-lg font-bold mb-4">
                                    {editingVirtual ? '编辑虚拟邮箱' : '新增虚拟邮箱'}
                                </h3>

                                {!editingVirtual && (
                                    <>
                                        <div className="mb-4">
                                            <label className="block text-sm font-medium mb-1">
                                                所属主邮箱 *
                                            </label>
                                            <select
                                                className="w-full border rounded-lg p-2 text-sm bg-white"
                                                value={newVirtual.primaryAccountId}
                                                onChange={e =>
                                                    setNewVirtual({
                                                        ...newVirtual,
                                                        primaryAccountId: e.target.value,
                                                    })
                                                }
                                            >
                                                <option value="">请选择所属主邮箱</option>
                                                {primaryAccounts.map((acc: any) => (
                                                    <option key={acc.id} value={acc.id}>
                                                        {acc.email} ({acc.note || '无备注'})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="mb-4">
                                            <label className="block text-sm font-medium mb-1">
                                                虚拟邮箱地址 (Hide My Email) *
                                            </label>
                                            <Input
                                                value={newVirtual.aliasEmail}
                                                onChange={(e: any) =>
                                                    setNewVirtual({
                                                        ...newVirtual,
                                                        aliasEmail: e.target.value,
                                                    })
                                                }
                                                placeholder="xxxx@privaterelay.appleid.com"
                                            />
                                        </div>
                                    </>
                                )}

                                <div className="mb-4">
                                    <label className="block text-sm font-medium mb-1">
                                        备注 (买家信息/用途)
                                    </label>
                                    <Input
                                        value={editingVirtual ? editingVirtual.note : newVirtual.note}
                                        onChange={(e: any) =>
                                            editingVirtual
                                                ? setEditingVirtual({
                                                      ...editingVirtual,
                                                      note: e.target.value,
                                                  })
                                                : setNewVirtual({ ...newVirtual, note: e.target.value })
                                        }
                                        placeholder="例如：买家张三 / 注册账号A"
                                    />
                                </div>

                                <div className="mb-6">
                                    <label className="block text-sm font-medium mb-1">
                                        查询码重置周期 (天)
                                    </label>
                                    <Input
                                        type="number"
                                        value={
                                            editingVirtual
                                                ? editingVirtual.codeResetIntervalDays
                                                : newVirtual.codeResetIntervalDays
                                        }
                                        onChange={(e: any) => {
                                            const val = parseInt(e.target.value, 10) || 0;
                                            if (editingVirtual) {
                                                setEditingVirtual({
                                                    ...editingVirtual,
                                                    codeResetIntervalDays: val,
                                                });
                                            } else {
                                                setNewVirtual({
                                                    ...newVirtual,
                                                    codeResetIntervalDays: val,
                                                });
                                            }
                                        }}
                                    />
                                </div>

                                <div className="flex justify-end gap-3">
                                    <Button
                                        variant="secondary"
                                        onClick={() => {
                                            setIsAddVirtualModalOpen(false);
                                            setEditingVirtual(null);
                                        }}
                                    >
                                        取消
                                    </Button>
                                    <Button variant="primary" onClick={handleSaveVirtual}>
                                        保存
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Batch Import Virtual Emails Modal */}
                    {isBatchVirtualModalOpen && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                            <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-lg">
                                <h3 className="text-lg font-bold mb-3">批量导入虚拟邮箱</h3>
                                <p className="text-xs text-gray-500 mb-4">
                                    支持从苹果生成的隐藏邮箱多行粘贴导入，系统会自动分配唯一查询码
                                </p>

                                <div className="mb-4">
                                    <label className="block text-sm font-medium mb-1">所属主邮箱 *</label>
                                    <select
                                        className="w-full border rounded-lg p-2 text-sm bg-white"
                                        value={batchVirtualData.primaryAccountId}
                                        onChange={e =>
                                            setBatchVirtualData({
                                                ...batchVirtualData,
                                                primaryAccountId: e.target.value,
                                            })
                                        }
                                    >
                                        <option value="">请选择所属主邮箱</option>
                                        {primaryAccounts.map((acc: any) => (
                                            <option key={acc.id} value={acc.id}>
                                                {acc.email} ({acc.note || '无备注'})
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="mb-6">
                                    <label className="block text-sm font-medium mb-1">
                                        虚拟邮箱列表 (支持 邮箱 或 邮箱,备注 每行一个)
                                    </label>
                                    <textarea
                                        className="w-full border rounded-lg p-3 h-48 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        value={batchVirtualData.emailsText}
                                        onChange={e =>
                                            setBatchVirtualData({
                                                ...batchVirtualData,
                                                emailsText: e.target.value,
                                            })
                                        }
                                        placeholder={`abc123@privaterelay.appleid.com\ndef456@privaterelay.appleid.com,买家李四\nghi789@privaterelay.appleid.com,注册专员`}
                                    />
                                </div>

                                <div className="flex justify-end gap-3">
                                    <Button
                                        variant="secondary"
                                        onClick={() => setIsBatchVirtualModalOpen(false)}
                                    >
                                        取消
                                    </Button>
                                    <Button variant="primary" onClick={handleBatchSaveVirtual}>
                                        开始批量导入
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Mail Preview Drawer / Modal */}
                    {previewVirtualId && (
                        <div className="fixed inset-0 bg-black/50 flex items-center justify-end z-50">
                            <div className="bg-white w-full max-w-2xl h-full shadow-2xl p-6 overflow-y-auto flex flex-col">
                                <div className="flex justify-between items-center pb-4 border-b mb-4">
                                    <div>
                                        <h3 className="font-bold text-lg text-gray-900">邮件接收明细</h3>
                                        <p className="text-xs font-mono text-gray-500">
                                            {previewVirtualEmail}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setPreviewVirtualId(null)}
                                        className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto space-y-3">
                                    {mailsLoading ? (
                                        <div className="text-center py-12 text-gray-400">加载邮件中...</div>
                                    ) : (mailsData?.icloudReceivedMails || []).length === 0 ? (
                                        <div className="text-center py-16 text-gray-400">
                                            该虚拟邮箱暂未收到任何邮件
                                        </div>
                                    ) : (
                                        (mailsData?.icloudReceivedMails || []).map((mail: any) => (
                                            <div
                                                key={mail.id}
                                                className="border rounded-lg p-4 hover:border-blue-400 transition bg-gray-50/50"
                                            >
                                                {mail.extractedCode && (
                                                    <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-800 px-3 py-1 rounded-md font-bold text-sm mb-2">
                                                        🔑 提取验证码: {mail.extractedCode}
                                                        <button
                                                            onClick={() =>
                                                                copyToClipboard(mail.extractedCode)
                                                            }
                                                            className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded ml-1"
                                                        >
                                                            复制
                                                        </button>
                                                    </div>
                                                )}
                                                <div className="text-sm font-semibold text-gray-900 mb-1">
                                                    {mail.subject}
                                                </div>
                                                <div className="flex justify-between text-xs text-gray-500 mb-2">
                                                    <span>发件人: {mail.fromName || mail.fromAddress}</span>
                                                    <span>{formatRelativeTime(mail.receivedAt)}</span>
                                                </div>
                                                <div className="text-xs text-gray-600 line-clamp-3 bg-white p-2.5 rounded border">
                                                    {mail.bodyText || '(无纯文本正文)'}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
