import { gql } from '@apollo/client';
import { useApolloClient, useMutation, useQuery } from '@apollo/client/react';
import { Monitor, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
    DESKTOP_CATEGORY_BANNER_DEFAULT,
    desktopCategoryBannerCode,
    desktopCategoryBannerInput,
    parseDesktopCategoryBannerSettings,
    resolveDesktopCategoryBanner,
    type DesktopCategoryBannerFocal,
    type DesktopCategoryBannerLayout,
} from '../../../../storefront-content-plugin/src/desktop-category-banner';
import { channelRequestContext, getActiveChannelToken } from '../../apollo';
import { FeatureHelpButton } from '../../components/FeatureHelp';
import {
    CREATE_STOREFRONT_BLOCK_MUTATION,
    DELETE_STOREFRONT_BLOCK_MUTATION,
    STOREFRONT_CONTENT_QUERY,
    UPDATE_STOREFRONT_BLOCK_MUTATION,
    type StorefrontAssetRef,
    type StorefrontContentBlock,
    type StorefrontContentResult,
} from '../../graphql/storefront.graphql';
import { useAdminPermissions } from '../../hooks/use-admin-permissions';
import { useUnsavedChangesWarning } from '../../hooks/use-unsaved-changes-warning';
import { getChannelDisplayName } from '../../utils/channel-display';
import { toUserFacingError } from '../../utils/user-facing-error';
import { AssetPicker } from './storefront-asset-picker';

const COLLECTIONS = gql`
    query NextAdminBannerCollections($skip: Int!) {
        collections(options: { skip: $skip, take: 100, sort: { name: ASC } }) {
            items {
                id
                name
                parentId
            }
            totalItems
        }
    }
`;
type Category = { id: string; name: string; parentId: string };
type Draft = {
    mode: 'inherit' | 'image' | 'text';
    layout: DesktopCategoryBannerLayout;
    focal: DesktopCategoryBannerFocal;
    asset: StorefrontAssetRef | null;
    imageUrl: string | null;
};
function fromBlock(block?: StorefrontContentBlock): Draft {
    const settings = block && parseDesktopCategoryBannerSettings(block);
    return {
        mode: settings?.mode ?? 'inherit',
        layout: settings?.layout ?? 'side',
        focal: settings?.focal ?? 'center',
        asset: block?.imageAsset ?? null,
        imageUrl: block?.imageUrl ?? null,
    };
}
function signature(draft: Draft) {
    return JSON.stringify({ ...draft, asset: draft.asset?.id ?? null });
}
const control =
    'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50';

export function DesktopCategoryBannerPanel() {
    const query = useQuery<StorefrontContentResult>(STOREFRONT_CONTENT_QUERY, {
        fetchPolicy: 'no-cache',
        notifyOnNetworkStatusChange: true,
    });
    const channel = query.data?.activeChannel;
    const consistent = channel && (!getActiveChannelToken() || channel.token === getActiveChannelToken());
    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="电脑端分类横幅">
            <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
                <Monitor className="size-4" aria-hidden="true" />
                电脑端分类横幅
                <FeatureHelpButton topic="storefront.decoration" title="电脑端分类横幅" />
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
                分类独立图片优先，其次使用父分类、分类默认图片。仅用于电脑端，保留分类名称和手机端布局。
            </p>
            {query.error && (
                <p role="alert" className="mt-3 text-sm text-rose-700">
                    {toUserFacingError(query.error, '分类横幅读取失败')}
                </p>
            )}
            {consistent && query.data ? (
                <BannerEditor
                    key={channel.id}
                    channel={channel}
                    blocks={query.data.storefrontContentBlocks}
                    disabled={query.loading || Boolean(query.error)}
                    reload={async () => {
                        await query.refetch();
                    }}
                />
            ) : (
                <p role="status" className="mt-3 text-sm text-slate-500">
                    正在读取当前店铺…
                </p>
            )}
            {query.error && (
                <button
                    type="button"
                    className="mt-3 text-sm text-blue-700"
                    onClick={() => void query.refetch().catch(() => undefined)}
                >
                    重新读取
                </button>
            )}
        </section>
    );
}

function BannerEditor({
    channel,
    blocks,
    disabled,
    reload,
}: {
    channel: StorefrontContentResult['activeChannel'];
    blocks: StorefrontContentBlock[];
    disabled: boolean;
    reload: () => Promise<void>;
}) {
    const client = useApolloClient();
    const { hasAnyPermission } = useAdminPermissions();
    const canReadCategories = hasAnyPermission(['ReadCatalog', 'ReadCollection']);
    const [categories, setCategories] = useState<Category[]>([]);
    const [categoryError, setCategoryError] = useState('');
    const [retry, setRetry] = useState(0);
    const [categoryId, setCategoryId] = useState(DESKTOP_CATEGORY_BANNER_DEFAULT);
    const [search, setSearch] = useState('');
    const [edited, setEdited] = useState<{ original?: StorefrontContentBlock; value: Draft } | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [create] = useMutation(CREATE_STOREFRONT_BLOCK_MUTATION, { fetchPolicy: 'no-cache' });
    const [update] = useMutation(UPDATE_STOREFRONT_BLOCK_MUTATION, { fetchPolicy: 'no-cache' });
    const [remove] = useMutation<{ deleteStorefrontContentBlock: { result: string; message?: string } }>(
        DELETE_STOREFRONT_BLOCK_MUTATION,
    );

    useEffect(() => {
        if (!canReadCategories) return;
        let cancelled = false;
        void (async () => {
            const items: Category[] = [];
            let total = 0;
            do {
                const result = await client.query<{ collections: { items: Category[]; totalItems: number } }>(
                    {
                        query: COLLECTIONS,
                        variables: { skip: items.length },
                        context: channelRequestContext(channel.token),
                        fetchPolicy: 'no-cache',
                    },
                );
                if (cancelled) return;
                if (!result.data) throw new Error('分类列表未返回结果');
                items.push(...result.data.collections.items);
                total = result.data.collections.totalItems;
                if (!result.data.collections.items.length) break;
            } while (items.length < total);
            setCategories(items);
            setCategoryError('');
        })().catch(reason => {
            if (!cancelled) setCategoryError(toUserFacingError(reason, '分类列表读取失败'));
        });
        return () => {
            cancelled = true;
        };
    }, [client, channel.token, canReadCategories, retry]);

    const existing = blocks.find(
        block =>
            block.code === desktopCategoryBannerCode(categoryId) && parseDesktopCategoryBannerSettings(block),
    );
    const draft = edited?.value ?? fromBlock(existing);
    const dirty = Boolean(edited && signature(draft) !== signature(fromBlock(edited.original)));
    const source = edited ? edited.original : existing;
    const canSave = hasAnyPermission([
        draft.mode === 'inherit'
            ? 'DeleteStorefrontContent'
            : source
              ? 'UpdateStorefrontContent'
              : 'CreateStorefrontContent',
    ]);
    const locked = disabled || saving;
    const valid = draft.mode !== 'image' || Boolean(draft.asset || draft.imageUrl);
    const category = categories.find(item => item.id === categoryId);
    const inherited = resolveDesktopCategoryBanner(
        blocks.filter(block => block !== existing),
        categoryId,
        category?.parentId,
    );
    const preview =
        draft.mode === 'image'
            ? (draft.asset?.preview ?? draft.imageUrl)
            : draft.mode === 'inherit' && inherited?.settings.mode === 'image'
              ? (inherited.block.imageAsset?.preview ?? inherited.block.imageUrl)
              : null;
    const layout = draft.mode === 'inherit' ? inherited?.settings.layout : draft.layout;
    const focal = draft.mode === 'inherit' ? inherited?.settings.focal : draft.focal;
    useUnsavedChangesWarning(dirty || saving, '分类横幅尚未保存，离开后将放弃本次修改。');
    const change = (patch: Partial<Draft>) => {
        setEdited({ original: edited ? edited.original : existing, value: { ...draft, ...patch } });
        setError('');
        setNotice('');
    };
    const save = async () => {
        if (locked || !canSave || !dirty || !valid) return;
        const activeToken = getActiveChannelToken();
        if (activeToken && activeToken !== channel.token) return;
        const stillCurrent = () => getActiveChannelToken() === activeToken;
        setSaving(true);
        setError('');
        setNotice('');
        let persisted = false;
        try {
            const context = channelRequestContext(channel.token);
            if (draft.mode === 'inherit') {
                if (source) {
                    const result = await remove({ context, variables: { id: source.id } });
                    if (result.data?.deleteStorefrontContentBlock.result !== 'DELETED')
                        throw new Error(
                            result.data?.deleteStorefrontContentBlock.message || '未能恢复继承配置',
                        );
                }
            } else {
                const input = desktopCategoryBannerInput(categoryId, {
                    ...draft,
                    mode: draft.mode,
                    imageAssetId: draft.asset?.id ?? null,
                });
                if (source) {
                    if (!source.updatedAt) throw new Error('缺少内容版本，请刷新后重试');
                    await update({
                        context,
                        variables: {
                            input: { ...input, id: source.id, expectedUpdatedAt: source.updatedAt },
                        },
                    });
                } else await create({ context, variables: { input } });
            }
            persisted = true;
            if (!stillCurrent()) return;
            await reload();
            if (stillCurrent()) {
                setEdited(null);
                setNotice('分类横幅已保存到当前店铺。');
            }
        } catch (reason) {
            if (stillCurrent())
                setError(
                    persisted
                        ? '已保存，刷新失败。请重新读取配置后继续编辑。'
                        : toUserFacingError(reason, '分类横幅保存失败，请重试'),
                );
        } finally {
            if (stillCurrent()) setSaving(false);
        }
    };

    return (
        <div className="mt-4 space-y-4">
            <p className="text-xs text-slate-500">当前店铺：{getChannelDisplayName(channel)}</p>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-bold text-slate-700">
                    查找分类
                    <input
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        disabled={locked || dirty || !canReadCategories}
                        className={control}
                        placeholder="输入分类名称"
                    />
                </label>
                <label className="text-xs font-bold text-slate-700">
                    设置范围
                    <select
                        aria-label="横幅设置范围"
                        className={control}
                        value={categoryId}
                        disabled={locked || dirty}
                        onChange={event => {
                            setCategoryId(event.target.value);
                            setEdited(null);
                            setError('');
                            setNotice('');
                        }}
                    >
                        <option value="default">所有分类默认</option>
                        {categories
                            .filter(
                                item =>
                                    item.id === categoryId ||
                                    item.name.toLowerCase().includes(search.trim().toLowerCase()),
                            )
                            .map(item => (
                                <option key={item.id} value={item.id}>
                                    {item.name}
                                </option>
                            ))}
                    </select>
                </label>
            </div>
            {!canReadCategories && (
                <p className="text-xs text-slate-500">
                    当前权限可设置分类默认横幅；选择具体分类需要分类读取权限。
                </p>
            )}
            {categoryError && (
                <p role="alert" className="text-xs text-rose-700">
                    {categoryError}{' '}
                    <button type="button" onClick={() => setRetry(value => value + 1)}>
                        重试
                    </button>
                </p>
            )}
            {dirty && <p className="text-xs text-slate-500">保存或放弃修改后可切换分类。</p>}
            <fieldset disabled={locked} className="space-y-4">
                <label className="block text-xs font-bold text-slate-700">
                    展示方式
                    <select
                        aria-label="横幅展示方式"
                        className={control}
                        value={draft.mode}
                        onChange={event => change({ mode: event.target.value as Draft['mode'] })}
                    >
                        <option value="inherit">
                            {categoryId === 'default' ? '前台默认样式' : '继承上级 / 默认配置'}
                        </option>
                        <option value="image">自定义图片</option>
                        <option value="text">仅保留文字</option>
                    </select>
                </label>
                {draft.mode === 'image' && (
                    <>
                        <AssetPicker
                            label="分类横幅图片"
                            value={draft.asset}
                            fallbackUrl={draft.imageUrl}
                            onChange={asset => change({ asset, imageUrl: null })}
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="text-xs font-bold text-slate-700">
                                图片版式
                                <select
                                    className={control}
                                    value={draft.layout}
                                    onChange={event =>
                                        change({ layout: event.target.value as DesktopCategoryBannerLayout })
                                    }
                                >
                                    <option value="side">右侧配图</option>
                                    <option value="background">完整图片在上</option>
                                </select>
                            </label>
                            <label className="text-xs font-bold text-slate-700">
                                图片焦点
                                <select
                                    className={control}
                                    value={draft.focal}
                                    onChange={event =>
                                        change({ focal: event.target.value as DesktopCategoryBannerFocal })
                                    }
                                >
                                    <option value="left">靠左</option>
                                    <option value="center">居中</option>
                                    <option value="right">靠右</option>
                                </select>
                            </label>
                        </div>
                        <p className="text-xs leading-5 text-slate-500">
                            建议使用 1600 × 480 px 横图；图片会完整显示，文字位于独立区域，不遮挡图片。
                        </p>
                    </>
                )}
            </fieldset>
            <div
                className={`relative isolate flex min-h-36 overflow-hidden rounded-xl ${layout === 'background' ? 'flex-col bg-white text-slate-900' : 'items-center gap-4 bg-slate-800 px-5 py-6 text-white'}`}
                aria-label="分类横幅预览"
            >
                {preview && layout === 'background' && (
                    <img
                        src={preview}
                        alt="分类横幅图片预览"
                        style={{ objectPosition: focal }}
                        className="block h-auto w-full object-contain"
                    />
                )}
                <div className={layout === 'background' ? 'p-4' : 'min-w-0 flex-1'}>
                    <strong className="block text-lg">{category?.name ?? '分类名称'}</strong>
                    <span className="mt-2 block text-xs leading-5">浏览商品，查看规格、库存与交付信息。</span>
                </div>
                {preview && layout === 'side' && (
                    <img
                        src={preview}
                        alt="分类横幅图片预览"
                        style={{ objectPosition: focal }}
                        className="h-32 w-2/5 flex-none object-contain"
                    />
                )}
            </div>
            {notice && (
                <p role="status" className="text-sm text-emerald-700">
                    {notice}
                </p>
            )}
            {error && (
                <div className="space-y-2">
                    <p role="alert" className="text-sm text-rose-700">
                        {error}
                    </p>
                    <button
                        type="button"
                        disabled={locked}
                        className="text-sm text-blue-700"
                        onClick={() => {
                            void reload()
                                .then(() => {
                                    setEdited(null);
                                    setError('');
                                    setNotice('已读取最新配置。');
                                })
                                .catch(reason => setError(toUserFacingError(reason, '重新读取失败，请重试')));
                        }}
                    >
                        重新读取并放弃修改
                    </button>
                </div>
            )}
            {!canSave && <p className="text-xs text-slate-500">当前账号没有保存此项修改的权限。</p>}
            <div className="flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    disabled={locked || !dirty || !canSave || !valid}
                    onClick={() => void save()}
                    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-40"
                >
                    <Save className="size-4" aria-hidden="true" />
                    {saving ? '正在保存…' : '保存分类横幅'}
                </button>
                <button
                    type="button"
                    disabled={locked || !edited}
                    onClick={() => {
                        setEdited(null);
                        setError('');
                        setNotice('');
                    }}
                    className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                    放弃修改
                </button>
            </div>
        </div>
    );
}
