import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useCallback, useRef } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { StorefrontSeoIdentity } from '../../../../store-management-plugin/src/seo/storefront-seo.contract';
import { getActiveChannelToken } from '../../apollo';
import { AdminButton, AdminSelect } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import { STOREFRONT_SEO_ENTITY_RECORD, type StorefrontSeoRecord } from '../../graphql/storefront-seo.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useAdminQuery } from '../../hooks/use-admin-query';
import { requestAppNavigation } from '../../hooks/use-unsaved-changes-warning';
import { toUserFacingError } from '../../utils/user-facing-error';
import { SeoDocumentRecordEditor } from './SeoDocumentRecordEditor';
import { seoIdentityKey } from './storefront-seo-utils';

/** Native catalog permissions authorize the attached SEO record, without reading store settings. */
export function StorefrontSeoEntityModule() {
    const location = useLocation();
    const navigate = useNavigate();
    const { id = '' } = useParams();
    const [params, setParams] = useSearchParams();
    const { hasAnyPermission } = useAdminPermissions();
    const targetType = location.pathname.startsWith('/catalog/collections/') ? 'COLLECTION' : 'PRODUCT';
    const languageCode = params.get('languageCode') === 'en' ? 'en' : 'zh_Hans';
    const identity: StorefrontSeoIdentity = { targetType, targetId: id, languageCode };
    const canRead = hasAnyPermission(
        targetType === 'PRODUCT' ? ['ReadProduct', 'ReadCatalog'] : ['ReadCollection', 'ReadCatalog'],
    );
    const canWrite = hasAnyPermission(
        targetType === 'PRODUCT' ? ['UpdateProduct', 'UpdateCatalog'] : ['UpdateCollection', 'UpdateCatalog'],
    );
    const query = useAdminQuery<{
        activeChannel: { id: string; code: string; token: string };
        storefrontSeoRecord: StorefrontSeoRecord;
    }>(STOREFRONT_SEO_ENTITY_RECORD, { variables: { input: identity }, skip: !canRead || !id });
    const channel = query.data?.activeChannel;
    const record = query.data?.storefrontSeoRecord;
    const consistent = Boolean(
        channel &&
        (!getActiveChannelToken() || channel.token === getActiveChannelToken()) &&
        record?.channelId === channel.id &&
        seoIdentityKey(record as StorefrontSeoIdentity) === seoIdentityKey(identity),
    );
    const dirty = useRef(false);
    const trackDirty = useCallback((value: boolean) => {
        dirty.current = value;
    }, []);
    const back =
        targetType === 'PRODUCT'
            ? `/catalog/products/${encodeURIComponent(id)}`
            : '/catalog/categories/categories';
    return (
        <div className="space-y-4 p-4 sm:p-6">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <AdminButton
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                        aria-label="返回原始资料"
                        onClick={() => {
                            if (requestAppNavigation(back)) navigate(back);
                        }}
                    >
                        <ArrowLeft size={16} />
                    </AdminButton>
                    <div>
                        <h1 className="flex items-center gap-2 text-xl font-semibold">
                            {targetType === 'PRODUCT' ? '商品' : '分类'}搜索优化
                            <FeatureHelpButton
                                title="搜索优化"
                                content={{
                                    purpose: '为当前店铺的商品或分类维护独立搜索资料。',
                                    requirements: [
                                        '核对当前店铺、语言与相应权限',
                                        '使用真实内容和可追溯证据，缺项保留待核验',
                                    ],
                                    example: '保存本店搜索标题草稿并发布，不改动共享商品的原始资料。',
                                    impact: '保存草稿与发布分开；搜索收录、排名与 AI 引用以实际外部结果为准。',
                                }}
                            />
                        </h1>
                        <p className="text-sm text-slate-500">
                            当前店铺的独立覆盖；不会改动共享商品、分类或店铺全局设置。
                        </p>
                    </div>
                </div>
                <AdminButton
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                    refreshPage
                >
                    <RefreshCw size={16} />
                    刷新本页
                </AdminButton>
            </header>
            {!canRead && (
                <div role="alert" className="admin-page-status" data-failed>
                    没有读取此商品或分类的权限。
                </div>
            )}
            {query.loading && !consistent && (
                <div role="status" className="admin-page-status">
                    正在读取对应页面配置…
                </div>
            )}
            {query.error && (
                <div role="alert" className="admin-page-status" data-failed>
                    <span>{toUserFacingError(query.error)}</span>
                    <AdminButton
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium disabled:opacity-50 text-slate-600 hover:bg-slate-100"
                        onClick={() => void query.refetch()}
                    >
                        重试读取
                    </AdminButton>
                </div>
            )}
            <AdminField label="语言">
                <AdminSelect
                    disabled={!consistent}
                    value={languageCode}
                    onChange={event => {
                        if (dirty.current && !window.confirm('切换语言会放弃未保存的修改，继续吗？')) return;
                        const language = event.target.value;
                        setParams(
                            current => {
                                const next = new URLSearchParams(current);
                                next.set('languageCode', language);
                                return next;
                            },
                            { replace: true },
                        );
                    }}
                >
                    <option value="zh_Hans">简体中文</option>
                    <option value="en">英文</option>
                </AdminSelect>
            </AdminField>
            {consistent && record && channel && (
                <>
                    <div className="text-sm text-slate-500">
                        店铺：{channel.code} · 目标 ID：{id}
                    </div>
                    <SeoDocumentRecordEditor
                        record={record}
                        channelToken={channel.token}
                        canWrite={canWrite}
                        sourceQuery={STOREFRONT_SEO_ENTITY_RECORD}
                        onRefresh={async () => {
                            const result = await query.refetch();
                            if (result.error) throw result.error;
                        }}
                        onDirtyChange={trackDirty}
                    />
                </>
            )}
        </div>
    );
}
