import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { api } from '@/vdb/graphql/api.js';
import { configurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
    getShippingMethodFulfillmentHandlers,
    isShippingMethodFulfillmentHandler,
} from './shipping-method-fulfillment-handlers.js';

export const fulfillmentHandlersDocument = graphql(
    `
        query GetFulfillmentHandlers {
            fulfillmentHandlers {
                ...ConfigurableOperationDef
            }
        }
    `,
    [configurableOperationDefFragment],
);

interface FulfillmentHandlerSelectorProps {
    value: string | undefined;
    onChange: (value: string | undefined) => void;
}

export function FulfillmentHandlerSelector({ value, onChange }: Readonly<FulfillmentHandlerSelectorProps>) {
    const { t } = useLingui();
    const { displayLanguage } = useUserSettings().settings;

    const { data: fulfillmentHandlersData } = useQuery({
        queryKey: ['fulfillmentHandlers', displayLanguage],
        queryFn: () => api.queryForDisplayLanguage(fulfillmentHandlersDocument, displayLanguage),
        staleTime: 1000 * 60 * 60 * 5,
    });

    const fulfillmentHandlers = getShippingMethodFulfillmentHandlers(
        fulfillmentHandlersData?.fulfillmentHandlers ?? [],
    );

    useEffect(() => {
        if (value && fulfillmentHandlersData && !isShippingMethodFulfillmentHandler(value)) {
            onChange(undefined);
        }
    }, [fulfillmentHandlersData, onChange, value]);

    const onFulfillmentHandlerSelected = (code: string) => {
        const fulfillmentHandler = fulfillmentHandlers?.find(fh => fh.code === code);
        if (!fulfillmentHandler) {
            return;
        }
        onChange(fulfillmentHandler.code);
    };

    return (
        <div>
            <Select
                items={
                    fulfillmentHandlers.length
                        ? Object.fromEntries(fulfillmentHandlers.map(fh => [fh.code, fh.description]))
                        : undefined
                }
                onValueChange={selectedCode => {
                    if (selectedCode != null) onFulfillmentHandlerSelected(selectedCode);
                }}
                value={value ?? undefined}
            >
                <SelectTrigger>
                    <SelectValue placeholder={t`Select a fulfillment handler`} />
                </SelectTrigger>
                <SelectContent>
                    {fulfillmentHandlers?.map(fulfillmentHandler => (
                        <SelectItem key={fulfillmentHandler.code} value={fulfillmentHandler.code}>
                            {fulfillmentHandler.description}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}
