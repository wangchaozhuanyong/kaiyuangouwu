import { useQuery } from '@apollo/client/react';
import { RefreshCw } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { toUserFacingError } from '../utils/user-facing-error';
import type { CustomFieldServerConfigData } from './custom-field-types';
import { CustomFieldsContext } from './custom-fields-context';
import { CUSTOM_FIELD_SERVER_CONFIG_QUERY } from './custom-fields.graphql';

export function CustomFieldsProvider({ children }: { children: ReactNode }) {
    const query = useQuery<CustomFieldServerConfigData>(CUSTOM_FIELD_SERVER_CONFIG_QUERY, {
        fetchPolicy: 'cache-first',
    });
    const value = useMemo(
        () => ({
            availableLanguages: query.data?.globalSettings.availableLanguages ?? [],
            entities: query.data?.globalSettings.serverConfig.entityCustomFields ?? [],
        }),
        [query.data],
    );

    if (query.loading && !query.data) {
        return (
            <div className="flex h-full items-center justify-center gap-2 text-xs font-medium text-slate-500">
                <RefreshCw className="h-4 w-4 animate-spin" />
                正在读取后台字段配置…
            </div>
        );
    }

    if (query.error) {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <section className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
                    <h1 className="text-base font-bold text-slate-900">后台字段配置读取失败</h1>
                    <p className="mt-2 text-xs leading-5 text-rose-600">
                        {toUserFacingError(query.error, '暂时无法读取服务器自定义字段配置。')}
                    </p>
                    <button
                        type="button"
                        onClick={() => void query.refetch()}
                        className="mt-5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                    >
                        重新读取
                    </button>
                </section>
            </div>
        );
    }

    return <CustomFieldsContext.Provider value={value}>{children}</CustomFieldsContext.Provider>;
}
