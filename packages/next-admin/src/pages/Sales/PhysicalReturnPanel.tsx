import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useRef, useState } from 'react';
import { AdminButton, AdminInput, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { refreshAfterAdminWrite } from '../../utils/admin-write-readback';
import { toUserFacingError } from '../../utils/user-facing-error';

const RECEIPTS = gql`
    query PhysicalReturnReceipts($requestId: ID!) {
        physicalReturnReceipts(requestId: $requestId) {
            id
            orderLineId
            stockLocationId
            quantity
            quality
            state
            createdAt
        }
        stockLocations(options: { take: 100 }) {
            items {
                id
                name
            }
        }
    }
`;
const RECEIVE = gql`
    mutation ReceivePhysicalReturn($input: ReceivePhysicalReturnInput!) {
        receivePhysicalReturn(input: $input) {
            id
            state
        }
    }
`;
interface Receipt {
    id: string;
    orderLineId: string;
    stockLocationId: string;
    quantity: number;
    quality: string;
    state: string;
}
interface Item {
    orderLineId?: string | null;
    quantity: number;
    productName: string;
    fulfillmentType: string;
}

export function PhysicalReturnPanel({
    requestId,
    items,
    canOperate,
}: {
    requestId: string;
    items: Item[];
    canOperate: boolean;
}) {
    const physical = items.filter(item => item.fulfillmentType === 'physical' && item.orderLineId);
    const query = useQuery<{
        physicalReturnReceipts: Receipt[];
        stockLocations: { items: Array<{ id: string; name: string }> };
    }>(RECEIPTS, { variables: { requestId }, fetchPolicy: 'network-only' });
    const [receive, { loading }] = useMutation(RECEIVE);
    const [lineId, setLineId] = useState(physical[0]?.orderLineId ?? '');
    const [warehouse, setWarehouse] = useState('');
    const [quality, setQuality] = useState('GOOD');
    const [quantity, setQuantity] = useState('1');
    const [key, setKey] = useState(() => crypto.randomUUID());
    const [message, setMessage] = useState('');
    const [failure, setFailure] = useState('');
    const [readbackPending, setReadbackPending] = useState(false);
    const [readingBack, setReadingBack] = useState(false);
    const running = useRef(false);
    const location = warehouse || query.data?.stockLocations.items[0]?.id || '';
    const received = query.data?.physicalReturnReceipts ?? [];
    const limit =
        (physical.find(item => item.orderLineId === lineId)?.quantity ?? 0) -
        received.filter(item => item.orderLineId === lineId).reduce((sum, item) => sum + item.quantity, 0);
    function changed(action: () => void) {
        if (!canOperate || loading || readbackPending || running.current) return;
        action();
        setKey(crypto.randomUUID());
        setMessage('');
        setFailure('');
    }
    async function readAcceptedReceipt() {
        if (readingBack) return;
        setReadingBack(true);
        setFailure('');
        let failed = false;
        await refreshAfterAdminWrite(
            () => query.refetch(),
            message => {
                failed = true;
                setFailure(message);
            },
        );
        setReadbackPending(failed);
        setReadingBack(false);
        if (!failed) setKey(crypto.randomUUID());
    }
    async function submit() {
        if (!canOperate || loading || readbackPending || running.current) return;
        running.current = true;
        setFailure('');
        setMessage('');
        try {
            await receive({
                variables: {
                    input: {
                        requestId,
                        orderLineId: lineId,
                        stockLocationId: location,
                        quantity: Number(quantity),
                        quality,
                        idempotencyKey: key,
                    },
                },
            });
            setMessage(quality === 'GOOD' ? '已验收并回库' : '已验收，计入不可售库存');
            setReadbackPending(true);
            await readAcceptedReceipt();
        } catch (error) {
            setFailure(toUserFacingError(error));
        } finally {
            running.current = false;
        }
    }
    if (!physical.length) return null;
    return (
        <section className="border-t pt-4">
            <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">
                    {canOperate ? '退货验收与回库' : '历史退货验收记录'}
                </h3>
                <FeatureHelpButton
                    title="退货验收"
                    content={{
                        purpose:
                            '退款与回库分别处理。收到退货并验收后，合格商品才能回到可售库存。损坏或过期商品保留为不可售库存。',
                        requirements: [],
                        example: '',
                    }}
                />
            </div>
            {query.loading && <p className="my-3 text-xs">正在读取仓库与验收记录…</p>}
            {(failure || query.error) && (
                <p role="alert" className="my-3 text-xs text-red-700">
                    {failure || toUserFacingError(query.error)}
                </p>
            )}
            {message && (
                <p role="status" className="my-3 text-xs text-emerald-700">
                    {message}
                </p>
            )}
            {received.map(item => (
                <p key={item.id} className="mt-2 text-xs text-slate-600">
                    已验收 {item.quantity} 件 ·{' '}
                    {item.quality === 'GOOD' ? '合格' : item.quality === 'EXPIRED' ? '过期' : '损坏'}
                </p>
            ))}
            {readbackPending && (
                <AdminButton
                    type="button"
                    onClick={() => void readAcceptedReceipt()}
                    disabled={readingBack}
                    className="mt-3 text-xs font-semibold text-blue-700"
                >
                    核对最新验收记录
                </AdminButton>
            )}
            {canOperate && (
                <>
                    <fieldset
                        disabled={loading || readbackPending}
                        className="mt-4 grid gap-3 sm:grid-cols-2"
                    >
                        <AdminField className="text-xs" label={<>退货商品</>}>
                            {' '}
                            <AdminSelect
                                className="mt-2 w-full rounded-lg border p-2"
                                value={lineId}
                                onChange={event => changed(() => setLineId(event.target.value))}
                            >
                                {physical.map(item => (
                                    <option key={item.orderLineId} value={item.orderLineId!}>
                                        {item.productName}
                                    </option>
                                ))}
                            </AdminSelect>
                        </AdminField>
                        <AdminField className="text-xs" label={<>验收仓库</>}>
                            {' '}
                            <AdminSelect
                                className="mt-2 w-full rounded-lg border p-2"
                                value={location}
                                onChange={event => changed(() => setWarehouse(event.target.value))}
                            >
                                {query.data?.stockLocations.items.map(item => (
                                    <option key={item.id} value={item.id}>
                                        {item.name}
                                    </option>
                                ))}
                            </AdminSelect>
                        </AdminField>
                        <AdminField className="text-xs" label={<>数量</>}>
                            {' '}
                            <AdminInput
                                type="number"
                                min={1}
                                max={limit}
                                className="mt-2 w-full rounded-lg border p-2"
                                value={quantity}
                                onChange={event => changed(() => setQuantity(event.target.value))}
                            />
                        </AdminField>
                        <AdminField className="text-xs" label={<>验收结果</>}>
                            {' '}
                            <AdminSelect
                                className="mt-2 w-full rounded-lg border p-2"
                                value={quality}
                                onChange={event => changed(() => setQuality(event.target.value))}
                            >
                                <option value="GOOD">合格，回到可售库存</option>
                                <option value="DAMAGED">损坏，不可售</option>
                                <option value="EXPIRED">过期，不可售</option>
                            </AdminSelect>
                        </AdminField>
                    </fieldset>
                    <AdminButton
                        type="button"
                        disabled={
                            loading ||
                            readbackPending ||
                            query.loading ||
                            !!query.error ||
                            !location ||
                            !Number.isSafeInteger(Number(quantity)) ||
                            Number(quantity) < 1 ||
                            Number(quantity) > limit
                        }
                        className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-xs text-white disabled:opacity-50"
                        onClick={() => void submit()}
                    >
                        确认已收到并验收
                    </AdminButton>
                </>
            )}
        </section>
    );
}
