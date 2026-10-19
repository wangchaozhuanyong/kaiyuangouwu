import { useState } from 'react';
import type { StorefrontSeoIdentity } from '../../../../store-management-plugin/src/seo/storefront-seo.contract';
import { AdminButton } from '../../components/AdminControls';
import { AdminField } from '../../components/AdminField';
import { SearchInput } from '../../components/SearchInput';
import type { StorefrontSeoRecord } from '../../graphql/storefront-seo.graphql';
import { DEFAULT_PAGE_SIZE } from '../../utils/pagination';
import { InlinePager } from './storefront-editor-controls';
import { SEO_TARGET_LABELS } from './storefront-seo-utils';

/** A selector over the existing workspace query, never a second business-data cache. */
export function SeoRecordPicker({
    records,
    identity,
    onSelect,
}: {
    records: StorefrontSeoRecord[];
    identity: StorefrontSeoIdentity;
    onSelect: (record: StorefrontSeoRecord) => void;
}) {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const scoped = records.filter(
        item => item.targetType === identity.targetType && item.languageCode === identity.languageCode,
    );
    const term = search.trim().toLocaleLowerCase();
    const title = (item: StorefrontSeoRecord) =>
        item.draft && 'title' in item.draft ? item.draft.title : '';
    const filtered = term
        ? scoped.filter(item => `${item.targetId} ${title(item)}`.toLocaleLowerCase().includes(term))
        : scoped;
    const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
    const current = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
    return (
        <details className="min-w-0 rounded-lg border border-slate-200 bg-white" data-seo-record-picker>
            <summary className="cursor-pointer rounded-lg px-3 py-3 text-sm font-medium text-slate-700">
                已配置记录 · {SEO_TARGET_LABELS[identity.targetType]} ·{' '}
                {identity.languageCode === 'en' ? '英文' : '简体中文'} · {scoped.length} 条
            </summary>
            <div className="space-y-3 border-t border-slate-100 p-3">
                <AdminField label="搜索已配置记录" description="按目标 ID、文章网址标识或搜索标题查找。">
                    <SearchInput
                        value={search}
                        onValueChange={value => {
                            setSearch(value);
                            setPage(0);
                        }}
                        placeholder="输入 ID 或搜索标题"
                    />
                </AdminField>
                <div
                    className="custom-scrollbar grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3"
                    role="group"
                    aria-label="已配置记录列表"
                    tabIndex={0}
                >
                    {current.map(item => (
                        <AdminButton
                            key={item.targetId}
                            aria-pressed={item.targetId === identity.targetId}
                            className="min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-600 aria-pressed:border-blue-500 aria-pressed:bg-blue-50"
                            onClick={() => onSelect(item)}
                        >
                            <span className="block break-words [overflow-wrap:anywhere]">
                                {item.targetId} · {item.published ? '已发布' : '草稿'}
                            </span>
                            {title(item) && (
                                <span className="block break-words text-xs [overflow-wrap:anywhere]">
                                    {title(item)}
                                </span>
                            )}
                        </AdminButton>
                    ))}
                    {!current.length && (
                        <p role="status" className="text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
                            {term
                                ? '没有匹配的记录，请调整搜索条件。'
                                : '当前类型和语言暂无已配置记录，可在上方填写目标后编辑。'}
                        </p>
                    )}
                </div>
                <InlinePager
                    page={currentPage}
                    pageSize={pageSize}
                    totalItems={filtered.length}
                    onPageChange={setPage}
                    onPageSizeChange={size => {
                        setPageSize(size);
                        setPage(0);
                    }}
                />
            </div>
        </details>
    );
}
