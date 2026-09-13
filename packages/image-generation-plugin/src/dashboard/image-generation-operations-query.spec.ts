import { print } from 'graphql';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
    imageGenerationOperationsQuery,
    type ImageAiUsageRecordDetailQueryResult,
} from './image-generation.graphql';
import { ProviderAttemptDetails } from './provider-attempt-details';

describe('image generation operations query', () => {
    it('shows unknown cost and separate request identifiers without inventing a charge', () => {
        const detail = {
            record: { costCompleteness: 'UNKNOWN', costBreakdown: [], missingCostCount: 1 },
            attempts: [
                {
                    callId: 'local-call',
                    attemptNumber: 1,
                    modelId: 'test-model',
                    stage: 'INITIAL',
                    outcome: 'FAILED',
                    headerRequestId: 'header-call',
                    modelResponseId: 'model-call',
                    costSource: 'UNVERIFIED',
                    actualCostMicrounits: null,
                    credentialNameSnapshot: 'Test',
                    latencyMs: 100,
                    reportedCostEvidence: { amount: 0.1, currency: null, field: 'usage.total_cost' },
                },
            ],
        } as unknown as ImageAiUsageRecordDetailQueryResult['imageAiUsageRecord'];
        const html = renderToStaticMarkup(createElement(ProviderAttemptDetails, { detail }));
        expect(html).toContain('费用待核对');
        expect(html).toContain('header-call');
        expect(html).toContain('model-call');
        expect(html).toContain('local-call');
        expect(html).toContain('币种未提供');
        expect(html).not.toContain('USD');
        expect(html).not.toContain('0.000000');
        expect(html).toContain('<details');
    });
    it('loads generation history with server-side pagination and state filtering', () => {
        const query = print(imageGenerationOperationsQuery);

        expect(query).toContain('$jobSkip: Int');
        expect(query).toContain('$jobTake: Int');
        expect(query).toContain('$jobState: ImageGenerationState');
        expect(query).toContain('imageGenerationJobs(skip: $jobSkip, take: $jobTake, state: $jobState)');
    });
});
