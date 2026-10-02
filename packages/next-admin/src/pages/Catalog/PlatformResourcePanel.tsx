import { gql } from '@apollo/client';
import { useMutation, useQuery } from '@apollo/client/react';
import { useState } from 'react';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { toUserFacingError } from '../../utils/user-facing-error';

const RESOURCES = gql`
    query PlatformResources($resourceType: String!) {
        platformCatalogResources(resourceType: $resourceType)
    }
`;
const PUBLISH = gql`
    mutation PublishTemplate($resourceType: String!, $resourceId: ID!) {
        publishPlatformCatalogTemplate(resourceType: $resourceType, resourceId: $resourceId)
    }
`;

export function PlatformResourcePanel({ stores }: { stores: Array<{ id: string; displayName: string }> }) {
    const [resourceType, setType] = useState('ProductOptionGroup');
    const [message, setMessage] = useState('');
    const query = useQuery<{
        platformCatalogResources: Array<{
            resourceType: string;
            resourceId: string;
            name: string;
            ownerChannelId: string | null;
            scope: string;
        }>;
    }>(RESOURCES, { variables: { resourceType }, fetchPolicy: 'network-only' });
    const [publish, state] = useMutation(PUBLISH);
    const submit = async (resourceId: string) => {
        try {
            await publish({ variables: { resourceType, resourceId } });
            await query.refetch();
            setMessage('已发布独立公共模板；原店铺资源保持独立维护。');
        } catch (error) {
            setMessage(toUserFacingError(error, '公共模板发布失败，请核对归属'));
        }
    };
    return (
        <section className="rounded-xl bg-white p-5 space-y-4">
            <h2 className="flex items-center gap-2 font-bold">
                资源归属与公共模板
                <FeatureHelpButton topic="catalog.platform-resources" title="资源归属与公共模板" />
            </h2>
            <p className="text-sm text-slate-500">
                归属待核对的资源须按
                ID、渠道关系及引用证据整理。公共模板发布为平台副本，经营店领取后独立维护。
            </p>
            <select
                aria-label="资源类型"
                className="rounded-lg border border-slate-200 p-2 text-sm"
                value={resourceType}
                onChange={e => {
                    setType(e.target.value);
                    setMessage('');
                }}
            >
                <option value="ProductOptionGroup">规格模板</option>
                <option value="Facet">属性与标签</option>
                <option value="Collection">商品分类</option>
                <option value="Asset">素材</option>
                <option value="Tag">素材标签</option>
            </select>
            {query.loading && <p role="status">读取归属中…</p>}
            {query.error && <p role="alert">{toUserFacingError(query.error, '资源读取失败')}</p>}
            <div className="max-h-80 overflow-auto text-sm">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-slate-100">
                            <th className="py-3">资源</th>
                            <th>ID</th>
                            <th>维护店铺</th>
                            <th>范围</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {query.data?.platformCatalogResources.map(item => (
                            <tr key={item.resourceId} className="border-b border-slate-100">
                                <td className="py-3">{item.name}</td>
                                <td>{item.resourceId}</td>
                                <td>
                                    {stores.find(s => String(s.id) === String(item.ownerChannelId))
                                        ?.displayName ??
                                        (item.scope === 'PLATFORM_TEMPLATE' ? '平台' : '待核对')}
                                </td>
                                <td>
                                    {item.scope === 'STORE'
                                        ? '店铺私有'
                                        : item.scope === 'PLATFORM_TEMPLATE'
                                          ? '公共模板'
                                          : '归属待核对'}
                                </td>
                                <td>
                                    {['Facet', 'ProductOptionGroup'].includes(resourceType) &&
                                        item.scope === 'STORE' && (
                                            <button
                                                className="text-blue-600 disabled:opacity-50"
                                                disabled={state.loading}
                                                onClick={() => void submit(item.resourceId)}
                                            >
                                                发布公共副本
                                            </button>
                                        )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {!query.loading && !query.error && !query.data?.platformCatalogResources.length && (
                <p>暂无此类资源</p>
            )}
            {message && (
                <p role="status" className="text-sm">
                    {message}
                </p>
            )}
        </section>
    );
}
