// @vitest-environment jsdom
import { ApolloClient, ApolloLink, InMemoryCache, Observable } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import type { ImageAiUsageRecord } from '../../graphql/image-usage.graphql';
import { AiImageUsagePanel } from './AiImageUsagePanel';

const record: ImageAiUsageRecord = {
    id: '12',
    recordType: 'PROMPT_OPTIMIZATION',
    createdAt: '2026-09-13T12:00:00Z',
    channelId: '1',
    modelCode: 'gpt',
    credentialCode: 'gpt',
    credentialName: '主用',
    credentialLast4: '',
    state: 'SUCCEEDED',
    billingMode: 'FREE',
    freeQuantity: 1,
    paidQuantity: 0,
    chargedAmount: 0,
    refundedAmount: 0,
    currencyCode: 'CNY',
    actualCostMicrounits: null,
    costCurrency: null,
    missingCost: true,
    costCompleteness: 'UNKNOWN',
    missingCostCount: 1,
    costBreakdown: [],
    customer: { id: '1', firstName: '', lastName: '', emailAddress: '' },
};

it('真实 Apollo 缓存中同数字 ID 的生图和描述优化保持独立', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const prompt = { ...record, __typename: 'ImageAiUsageRecord', modelCode: 'prompt-model' };
    const image = { ...prompt, recordType: 'IMAGE_GENERATION', modelCode: 'image-model' };
    const requested: string[] = [];
    const client = new ApolloClient({
        cache: new InMemoryCache(),
        link: new ApolloLink(
            operation =>
                new Observable(observer => {
                    const selected = operation.variables.recordType === 'IMAGE_GENERATION' ? image : prompt;
                    requested.push(operation.variables.recordType || 'LIST');
                    observer.next({
                        data:
                            operation.operationName === 'NextAdminImageAiUsageRecords'
                                ? { imageAiUsageRecords: { items: [image, prompt], totalItems: 2 } }
                                : {
                                      imageAiUsageRecord: {
                                          record: selected,
                                          inputPrompt: '',
                                          outputPrompt: null,
                                          totalTokens: null,
                                          providerRequestIds: [],
                                          attempts: [],
                                          outputs: [],
                                          timeline: [],
                                      },
                                  },
                    });
                    observer.complete();
                }),
        ),
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
        await act(async () =>
            root.render(
                <ApolloProvider client={client}>
                    <AiImageUsagePanel />
                </ApolloProvider>,
            ),
        );
        const rows = container.querySelectorAll('tbody tr');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('生图 #12');
        expect(rows[0].textContent).toContain('image-model');
        expect(rows[1].textContent).toContain('描述优化 #12');
        expect(rows[1].textContent).toContain('prompt-model');
        await act(async () => rows[0].querySelector('button')!.click());
        expect(requested.at(-1)).toBe('IMAGE_GENERATION');
        await act(async () => container.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click());
        const currentRows = container.querySelectorAll('tbody tr');
        expect(currentRows[0].textContent).toContain('生图 #12');
        expect(currentRows[1].textContent).toContain('描述优化 #12');
        await act(async () => currentRows[1].querySelector('button')!.click());
        expect(requested.at(-1)).toBe('PROMPT_OPTIMIZATION');
    } finally {
        await act(async () => root.unmount());
        container.remove();
        client.stop();
    }
});
