import { gql } from '@apollo/client';
import { useApolloClient } from '@apollo/client/react';
import { print } from 'graphql';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { uploadAdminFile } from '../../apollo';
import { AdminButton, AdminInput, AdminSelect, AdminTextArea } from '../../components/AdminControls';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { UPLOAD_DIGITAL_FILE } from '../../graphql/product-domains.graphql';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { toUserFacingError } from '../../utils/user-facing-error';

interface ContentPackage {
    fields: Array<{ key: string; label: string; value: string; secret?: boolean }>;
    note: string;
    attachmentFileVersionIds?: string[];
}
interface Task {
    id: string;
    state: string;
    productName: string;
    sku: string;
    quantity: number;
    eligibleQuantity: number;
    hasContent: boolean;
    recipientEmail: string;
    expectedAt: string;
    overdue: boolean;
    lastError?: string;
    order: { id: string; code: string };
    packages?: ContentPackage[];
}
const TASKS = gql`
    query DigitalDeliveryTasks($options: ManualDigitalDeliveryListOptions) {
        manualDigitalDeliveries(options: $options) {
            totalItems
            items {
                id
                state
                productName
                sku
                quantity
                eligibleQuantity
                hasContent
                recipientEmail
                expectedAt
                overdue
                lastError
                order {
                    id
                    code
                }
            }
        }
    }
`;
const REVEAL = gql`
    mutation RevealManualContent($id: ID!) {
        revealMyManualDigitalDelivery(id: $id) {
            packages {
                fields {
                    key
                    label
                    value
                    secret
                }
                note
                attachmentFileVersionIds
            }
        }
    }
`;
const PUBLISH = gql`
    mutation PublishManualContent($input: SaveManualDigitalDeliveryInput!) {
        publishManualDigitalDelivery(input: $input) {
            id
        }
    }
`;
const DRAFT = gql`
    mutation DraftManualContent($input: SaveManualDigitalDeliveryInput!) {
        saveManualDigitalDeliveryDraft(input: $input) {
            id
        }
    }
`;
const APPEND = gql`
    mutation AppendManualContent($input: SaveManualDigitalDeliveryInput!) {
        appendManualDigitalDelivery(input: $input) {
            id
        }
    }
`;
const RETRY = gql`
    mutation RetryManualContent($id: ID!) {
        retryManualDigitalDelivery(id: $id) {
            id
        }
    }
`;
const EXCEPTIONS = gql`
    query DigitalDeliveryExceptions {
        digitalDeliveryExceptions {
            orderId
            state
            reviewReason
            updatedAt
        }
    }
`;
const RETRY_CHECKOUT = gql`
    mutation RetryDigitalCheckout($orderId: ID!) {
        retryCheckoutDelivery(orderId: $orderId) {
            id
            state
        }
    }
`;
const labels: Record<string, string> = {
    WAITING_PROCESSING: '待制作',
    DRAFT: '草稿',
    SENDING: '可领取，通知发送中',
    SENT: '已交付',
    EMAIL_FAILED: '可领取，通知失败',
    MANUAL_REVIEW: '需检查',
    CANCELLED: '已取消',
};
const blank = (): ContentPackage => ({
    fields: [{ key: 'content', label: '交付内容', value: '', secret: true }],
    note: '',
    attachmentFileVersionIds: [],
});

export function DigitalDeliveryModule() {
    const client = useApolloClient();
    const [page, setPage] = useState(0);
    const [filter, setFilter] = useState('');
    const [task, setTask] = useState<Task | null>(null);
    const [packages, setPackages] = useState<ContentPackage[]>([]);
    const [revealed, setRevealed] = useState<ContentPackage[]>([]);
    const [message, setMessage] = useState('');
    const [failure, setFailure] = useState('');
    const [busy, setBusy] = useState(false);
    const tasks = useQuery<{ manualDigitalDeliveries: { totalItems: number; items: Task[] } }>(TASKS, {
        variables: { options: { skip: page * 20, take: 20, ...(filter ? { state: filter } : {}) } },
        fetchPolicy: 'network-only',
    });
    const exceptions = useQuery<{
        digitalDeliveryExceptions: Array<{
            orderId: string;
            state: string;
            reviewReason: string;
            updatedAt: string;
        }>;
    }>(EXCEPTIONS, { fetchPolicy: 'network-only' });
    function select(item: Task) {
        setTask(item);
        setRevealed([]);
        setMessage('');
        setFailure('');
        const isInitial = ['WAITING_PROCESSING', 'DRAFT'].includes(item.state);
        setPackages(
            Array.from(
                {
                    length: Math.max(
                        0,
                        isInitial ? item.eligibleQuantity : item.eligibleQuantity - item.quantity,
                    ),
                },
                blank,
            ),
        );
    }
    async function act(action: () => Promise<unknown>, success: string) {
        setBusy(true);
        setFailure('');
        setMessage('');
        try {
            await action();
            setMessage(success);
            const refreshed = await tasks.refetch();
            await exceptions.refetch();
            if (task) {
                const current = refreshed.data?.manualDigitalDeliveries.items.find(
                    item => item.id === task.id,
                );
                if (current) {
                    setTask(current);
                    if (current.state !== task.state && current.state !== 'DRAFT') setPackages([]);
                }
            }
        } catch (error) {
            setFailure(toUserFacingError(error));
        } finally {
            setBusy(false);
        }
    }
    async function showOriginal(item: Task) {
        const result = await client.mutate<{ revealMyManualDigitalDelivery: { packages: ContentPackage[] } }>(
            { mutation: REVEAL, variables: { id: item.id }, fetchPolicy: 'no-cache' },
        );
        setRevealed(result.data?.revealMyManualDigitalDelivery.packages ?? []);
        if (item.state === 'DRAFT') setPackages(result.data?.revealMyManualDigitalDelivery.packages ?? []);
    }
    function patch(index: number, update: Partial<ContentPackage>) {
        setPackages(items =>
            items.map((item, position) => (position === index ? { ...item, ...update } : item)),
        );
    }
    return (
        <div className="h-full overflow-y-auto p-5 sm:p-8">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="flex items-center gap-2 text-lg font-semibold">
                    数字交付
                    <FeatureHelpButton topic="sales.manual-digital-delivery" title="数字交付" />
                </h1>
                <Link className="text-sm text-blue-600" to="/catalog/card-pool">
                    卡密与发卡记录
                </Link>
            </header>
            <div className="mt-5 flex items-center gap-2">
                <h2 className="font-semibold">人工待办</h2>
                <FeatureHelpButton
                    title="人工交付说明"
                    content={{
                        purpose:
                            '付款后填写成品并发布，买家在订单页领取。通知失败时重发沿用原成品。补交只填写新增份数。附件保存在私有交付区。',
                        requirements: [],
                        example: '',
                    }}
                />
            </div>
            <AdminSelect
                aria-label="筛选人工交付状态"
                disabled={busy}
                className="my-3 rounded-lg border p-2 text-sm"
                value={filter}
                onChange={event => {
                    setFilter(event.target.value);
                    setPage(0);
                    setTask(null);
                    setRevealed([]);
                }}
            >
                {[
                    '',
                    'WAITING_PROCESSING',
                    'DRAFT',
                    'SENDING',
                    'SENT',
                    'EMAIL_FAILED',
                    'MANUAL_REVIEW',
                    'CANCELLED',
                ].map(value => (
                    <option key={value} value={value}>
                        {labels[value] ?? '全部状态'}
                    </option>
                ))}
            </AdminSelect>
            {(failure || tasks.error || exceptions.error) && (
                <p role="alert" className="my-3 text-sm text-red-700">
                    {failure || toUserFacingError(tasks.error || exceptions.error)}
                </p>
            )}
            {message && (
                <p role="status" className="my-3 text-sm text-emerald-700">
                    {message}
                </p>
            )}
            {tasks.loading ? (
                <p>正在读取待办…</p>
            ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                    {tasks.data?.manualDigitalDeliveries.items.map(item => (
                        <AdminButton
                            key={item.id}
                            type="button"
                            disabled={busy}
                            onClick={() => select(item)}
                            className={`rounded-lg border p-4 text-left ${task?.id === item.id ? 'border-blue-500' : 'border-slate-200'}`}
                        >
                            <div className="flex justify-between gap-3">
                                <strong>{item.productName}</strong>
                                <span className="text-sm">{labels[item.state] ?? '交付状态待核验'}</span>
                            </div>
                            <p className="mt-2 text-sm text-slate-600">
                                {item.order.code} · {item.eligibleQuantity} 份 · {item.recipientEmail}
                            </p>
                            <p className={`mt-1 text-xs ${item.overdue ? 'text-red-700' : 'text-slate-500'}`}>
                                预计 {new Date(item.expectedAt).toLocaleString('zh-CN')}
                                {item.overdue ? '，已超时' : ''}
                            </p>
                        </AdminButton>
                    ))}
                </div>
            )}
            {!tasks.loading && !tasks.data?.manualDigitalDeliveries.items.length && (
                <p className="py-5 text-sm text-slate-500">暂无人工交付待办</p>
            )}
            <div className="my-3 flex items-center gap-3 text-sm">
                <AdminButton disabled={busy || page === 0} onClick={() => setPage(value => value - 1)}>
                    上一页
                </AdminButton>
                <span>第 {page + 1} 页</span>
                <AdminButton
                    disabled={
                        busy || (page + 1) * 20 >= (tasks.data?.manualDigitalDeliveries.totalItems ?? 0)
                    }
                    onClick={() => setPage(value => value + 1)}
                >
                    下一页
                </AdminButton>
            </div>
            {task && (
                <section className="mt-5 border-t pt-5">
                    <div className="flex flex-wrap justify-between gap-3">
                        <h2 className="flex items-center gap-2 font-semibold">
                            {task.productName} · 成品
                            <FeatureHelpButton topic="sales.manual-digital-delivery" title="填写成品" />
                        </h2>
                        <Link className="text-sm text-blue-600" to={`/sales/orders/${task.order.id}`}>
                            查看订单
                        </Link>
                    </div>
                    {task.lastError && (
                        <p className="my-2 text-sm text-amber-700">
                            {toUserFacingError(task.lastError, '交付或通知失败，请查看订单并重试')}
                        </p>
                    )}
                    {task.hasContent && (
                        <AdminButton
                            type="button"
                            disabled={busy}
                            className="my-3 text-sm text-blue-600"
                            onClick={() => void act(() => showOriginal(task), '已读取原内容并记录查看操作')}
                        >
                            查看已保存内容
                        </AdminButton>
                    )}
                    {revealed.map((item, index) => (
                        <div
                            key={index}
                            className="my-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm"
                        >
                            {item.fields.map(field => (
                                <p key={field.key}>
                                    {field.label}：{field.value}
                                </p>
                            ))}
                            {item.note}
                        </div>
                    ))}
                    {packages.map((item, index) => (
                        <div key={index} className="my-4 grid gap-3 md:grid-cols-2">
                            <label className="text-sm">
                                第 {index + 1} 份成品内容
                                <AdminTextArea
                                    disabled={busy}
                                    className="mt-2 min-h-28 w-full rounded-lg border p-3"
                                    value={item.fields[0]?.value ?? ''}
                                    onChange={event =>
                                        patch(index, {
                                            fields: [
                                                {
                                                    key: 'content',
                                                    label: '交付内容',
                                                    value: event.target.value,
                                                    secret: true,
                                                },
                                            ],
                                        })
                                    }
                                />
                            </label>
                            <label className="text-sm">
                                使用说明
                                <AdminTextArea
                                    disabled={busy}
                                    className="mt-2 min-h-28 w-full rounded-lg border p-3"
                                    value={item.note}
                                    onChange={event => patch(index, { note: event.target.value })}
                                />
                            </label>
                            <label className="text-sm">
                                私有附件
                                <AdminInput
                                    type="file"
                                    disabled={busy}
                                    className="mt-2 block w-full"
                                    onChange={event => {
                                        const file = event.target.files?.[0];
                                        if (file)
                                            void act(async () => {
                                                const result = await uploadAdminFile<{
                                                    uploadDigitalDeliveryFile: { id: string };
                                                }>(print(UPLOAD_DIGITAL_FILE), file, { file: null });
                                                patch(index, {
                                                    attachmentFileVersionIds: [
                                                        ...(item.attachmentFileVersionIds ?? []),
                                                        result.uploadDigitalDeliveryFile.id,
                                                    ],
                                                });
                                            }, '附件已保存');
                                        event.target.value = '';
                                    }}
                                />
                                <span className="mt-1 block text-xs text-slate-500">
                                    已添加 {item.attachmentFileVersionIds?.length ?? 0} 个附件
                                </span>
                            </label>
                        </div>
                    ))}
                    <div className="flex flex-wrap gap-3">
                        {packages.length > 0 && (
                            <>
                                {['WAITING_PROCESSING', 'DRAFT'].includes(task.state) && (
                                    <AdminButton
                                        className="rounded-lg border px-4 py-2 text-sm"
                                        disabled={busy}
                                        onClick={() =>
                                            void act(
                                                () =>
                                                    client.mutate({
                                                        mutation: DRAFT,
                                                        variables: { input: { id: task.id, packages } },
                                                    }),
                                                '草稿已保存',
                                            )
                                        }
                                    >
                                        保存草稿
                                    </AdminButton>
                                )}
                                <AdminButton
                                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white"
                                    disabled={
                                        busy ||
                                        packages.some(
                                            item =>
                                                !item.fields.some(field => field.value.trim()) &&
                                                !item.note.trim() &&
                                                !item.attachmentFileVersionIds?.length,
                                        )
                                    }
                                    onClick={() =>
                                        void act(
                                            () =>
                                                client.mutate({
                                                    mutation: ['WAITING_PROCESSING', 'DRAFT'].includes(
                                                        task.state,
                                                    )
                                                        ? PUBLISH
                                                        : APPEND,
                                                    variables: { input: { id: task.id, packages } },
                                                }),
                                            '已发布，买家可在订单页领取',
                                        )
                                    }
                                >
                                    {['WAITING_PROCESSING', 'DRAFT'].includes(task.state)
                                        ? '发布成品'
                                        : '发布新增成品'}
                                </AdminButton>
                            </>
                        )}
                        {['EMAIL_FAILED', 'MANUAL_REVIEW', 'SENT'].includes(task.state) && (
                            <AdminButton
                                className="rounded-lg border px-4 py-2 text-sm"
                                disabled={busy || task.eligibleQuantity === 0}
                                onClick={() =>
                                    void act(
                                        () => client.mutate({ mutation: RETRY, variables: { id: task.id } }),
                                        '原领取通知已进入重发队列',
                                    )
                                }
                            >
                                重发领取通知
                            </AdminButton>
                        )}
                    </div>
                </section>
            )}
            <section className="mt-8 border-t pt-5">
                <h2 className="flex items-center gap-2 font-semibold">
                    交付异常
                    <FeatureHelpButton topic="sales.manual-digital-delivery" title="交付异常" />
                </h2>
                {exceptions.data?.digitalDeliveryExceptions.map(item => (
                    <div
                        key={item.orderId}
                        className="my-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                    >
                        <div>
                            <Link className="text-sm text-blue-600" to={`/sales/orders/${item.orderId}`}>
                                查看订单及退款
                            </Link>
                            <p className="mt-1 text-sm">{item.reviewReason}</p>
                        </div>
                        <AdminButton
                            className="rounded-lg border px-3 py-2 text-sm"
                            disabled={busy || item.reviewReason === '付款结果待核验'}
                            onClick={() =>
                                void act(
                                    () =>
                                        client.mutate({
                                            mutation: RETRY_CHECKOUT,
                                            variables: { orderId: item.orderId },
                                        }),
                                    '已重新核对资源并尝试交付',
                                )
                            }
                        >
                            补货后重新交付
                        </AdminButton>
                    </div>
                ))}
                {!exceptions.loading && !exceptions.data?.digitalDeliveryExceptions.length && (
                    <p className="mt-3 text-sm text-slate-500">暂无交付异常</p>
                )}
            </section>
        </div>
    );
}
