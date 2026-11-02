import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { AdminButton, AdminInput } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { type BlogAdminAction } from './news-blog-types';
import { RECONCILE_NEWS_BLOG_RUN } from './news-blog.graphql';
export function NewsBlogRunRecovery({ id, execute }: { id: string; execute: BlogAdminAction }) {
    const [cost, setCost] = useState(''),
        [confirmed, setConfirmed] = useState(false);
    const [save, state] = useMutation(RECONCILE_NEWS_BLOG_RUN);
    const amount = Number(cost);
    return (
        <details className="space-y-3">
            <summary>核对结果不明的任务</summary>
            <p className="text-sm">
                先核对供应商记录及文章，确认任务没有完成。此操作仅登记已结算费用并解除重试限制，不会自动发起新的付费请求。
            </p>
            <AdminField label="供应商已结算费用（USD）">
                <AdminInput
                    type="number"
                    min="0"
                    step="0.000001"
                    value={cost}
                    onChange={e => setCost(e.target.value)}
                />
            </AdminField>
            <AdminField label="已核对供应商结果，确认任务未完成">
                <AdminInput
                    type="checkbox"
                    checked={confirmed}
                    onChange={e => setConfirmed(e.target.checked)}
                />
            </AdminField>
            <AdminButton
                disabled={state.loading || !confirmed || !cost || !Number.isFinite(amount) || amount < 0}
                onClick={() =>
                    void execute(
                        () => save({ variables: { id, actualCostMicros: Math.round(amount * 1000000) } }),
                        '已登记人工核对结果；可单独重试该任务，重试将重新计费。',
                    )
                }
            >
                登记核对结果
            </AdminButton>
        </details>
    );
}
