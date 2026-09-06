import { useQuery } from '@apollo/client/react';
import { Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { GET_COLLECTIONS, GET_PRODUCTS } from '../../graphql/catalog.graphql';
import { type StorefrontTargetType } from '../../graphql/storefront.graphql';
import { navigationTargets } from './storefront-content-utils';
import { inputClass } from './storefront-editor-model';

export function TargetValueInput({
    type,
    value,
    onChange,
}: {
    type: StorefrontTargetType;
    value: string;
    onChange: (value: string) => void;
}) {
    const [lookupSearch, setLookupSearch] = useState('');
    const deferredLookupSearch = useDeferredValue(lookupSearch.trim());
    const productLookup = useQuery<{
        products: { items: Array<{ id: string; name: string }>; totalItems: number };
    }>(GET_PRODUCTS, {
        variables: {
            options: {
                take: 20,
                sort: { name: 'ASC', id: 'ASC' },
                filter: deferredLookupSearch ? { name: { contains: deferredLookupSearch } } : {},
            },
        },
        skip: type !== 'PRODUCT',
        fetchPolicy: 'cache-first',
    });
    const collectionLookup = useQuery<{
        collections: { items: Array<{ id: string; name: string }>; totalItems: number };
    }>(GET_COLLECTIONS, {
        variables: {
            options: {
                topLevelOnly: false,
                take: 20,
                sort: { name: 'ASC', id: 'ASC' },
                filter: deferredLookupSearch ? { name: { contains: deferredLookupSearch } } : {},
            },
        },
        skip: type !== 'COLLECTION',
        fetchPolicy: 'cache-first',
    });
    if (type === 'NONE')
        return <input value="" disabled className={`${inputClass} bg-slate-100`} placeholder="无需填写" />;
    if (type === 'PAGE')
        return (
            <select value={value} onChange={event => onChange(event.target.value)} className={inputClass}>
                <option value="">请选择页面</option>
                {navigationTargets.map(([path, label]) => (
                    <option key={path} value={path}>
                        {label} · {path}
                    </option>
                ))}
            </select>
        );
    if (type === 'PRODUCT' || type === 'COLLECTION') {
        const query = type === 'PRODUCT' ? productLookup : collectionLookup;
        const items =
            type === 'PRODUCT'
                ? (productLookup.data?.products.items ?? [])
                : (collectionLookup.data?.collections.items ?? []);
        const totalItems =
            type === 'PRODUCT'
                ? (productLookup.data?.products.totalItems ?? 0)
                : (collectionLookup.data?.collections.totalItems ?? 0);
        return (
            <div className="space-y-2">
                <div className="relative">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                        value={lookupSearch}
                        onChange={event => setLookupSearch(event.target.value)}
                        className={`${inputClass} pl-8`}
                        placeholder={`搜索${type === 'PRODUCT' ? '商品' : '分类专辑'}名称`}
                    />
                </div>
                <select value={value} onChange={event => onChange(event.target.value)} className={inputClass}>
                    <option value="">
                        {query.loading ? '正在查询…' : `请选择（匹配 ${totalItems} 条）`}
                    </option>
                    {value && !items.some(item => item.id === value) && (
                        <option value={value}>已选目标 · {value}</option>
                    )}
                    {items.map(item => (
                        <option key={item.id} value={item.id}>
                            {item.name}
                        </option>
                    ))}
                </select>
                {query.error && (
                    <p className="text-[10px] text-rose-600">目标列表读取失败，可保留原选择后重试</p>
                )}
            </div>
        );
    }
    return (
        <input
            value={value}
            onChange={event => onChange(event.target.value)}
            className={inputClass}
            placeholder={type === 'URL' ? 'https://...' : '请填写目标值'}
        />
    );
}
