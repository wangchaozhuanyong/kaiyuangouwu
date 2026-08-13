import { toast } from '@/vdb/components/ui/sonner.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';

import { DashboardAlertDefinition } from '../../extension-api/types/index.js';

const pendingSearchIndexUpdatesDocument = graphql(`
    query GetPendingSearchIndexUpdates {
        pendingSearchIndexUpdates
    }
`);

export const runPendingSearchIndexUpdatesDocument = graphql(`
    mutation RunPendingSearchIndexUpdates {
        runPendingSearchIndexUpdates {
            success
        }
    }
`);

export const searchIndexBufferAlert: DashboardAlertDefinition<number> = {
    id: 'search-index-buffer-alert',
    check: async () => {
        const data = await api.query(pendingSearchIndexUpdatesDocument);
        return data.pendingSearchIndexUpdates;
    },
    shouldShow: data => data > 0,
    title: data => msg`${data} pending search index updates`,
    severity: data => (data < 10 ? 'info' : 'warning'),
    actions: [
        {
            label: msg`Run pending updates`,
            onClick: async ({ dismiss }) => {
                await api.mutate(runPendingSearchIndexUpdatesDocument, {});
                toast.success(i18n._(msg`Running pending search index updates`));
                dismiss();
            },
        },
    ],
    recheckInterval: 60_000,
};
