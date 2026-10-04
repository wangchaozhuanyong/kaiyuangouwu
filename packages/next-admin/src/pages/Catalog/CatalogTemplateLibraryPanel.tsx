import { gql } from '@apollo/client';
import { useMutation } from '@apollo/client/react';
import { useState } from 'react';
import { AdminButton } from '../../components/AdminControls';
import { useAdminQuery as useQuery } from '../../hooks/use-admin-query';
import { toUserFacingError } from '../../utils/user-facing-error';

const LIBRARY = gql`
    query TemplateLibrary {
        catalogTemplateLibrary
    }
`;
const CLAIM = gql`
    mutation ClaimTemplate($resourceType: String!, $resourceId: ID!) {
        claimCatalogTemplate(resourceType: $resourceType, resourceId: $resourceId)
    }
`;

export function CatalogTemplateLibraryPanel({ onClaimed }: { onClaimed: () => void }) {
    const query = useQuery<{
        catalogTemplateLibrary: Array<{ resourceType: string; resourceId: string; name: string }>;
    }>(LIBRARY, {});
    const [claim, state] = useMutation(CLAIM);
    const [message, setMessage] = useState('');
    const receive = async (resourceType: string, resourceId: string) => {
        try {
            await claim({ variables: { resourceType, resourceId } });
            setMessage('已领取为本店独立副本，可在本店模板或属性列表修改。');
            onClaimed();
        } catch (error) {
            setMessage(toUserFacingError(error, '领取失败，请检查权限后重试'));
        }
    };
    return (
        <details className="shrink-0 bg-white px-6 py-3 text-sm">
            <summary className="cursor-pointer font-medium text-blue-600">
                公共模板库（领取后独立维护）
            </summary>
            <p className="my-3 text-slate-500">
                公共模板由平台发布；领取后成为本店副本，平台更新不会覆盖本店修改。
            </p>
            {query.loading && !query.data && <p role="status">读取公共模板中…</p>}
            {query.error && <p role="alert">{toUserFacingError(query.error, '模板库读取失败')}</p>}
            {!query.loading && !query.error && !query.data?.catalogTemplateLibrary.length && (
                <p>暂无公共模板</p>
            )}
            {query.data?.catalogTemplateLibrary.map(item => (
                <div key={`${item.resourceType}-${item.resourceId}`} className="flex items-center gap-4 py-2">
                    <span>
                        {item.name} · {item.resourceType === 'Facet' ? '属性与标签' : '规格模板'}
                    </span>
                    <AdminButton
                        className="text-blue-600 disabled:opacity-50"
                        disabled={state.loading}
                        onClick={() => void receive(item.resourceType, item.resourceId)}
                    >
                        领取本店副本
                    </AdminButton>
                </div>
            ))}
            {message && (
                <p role="status" className="mt-3">
                    {message}
                </p>
            )}
        </details>
    );
}
