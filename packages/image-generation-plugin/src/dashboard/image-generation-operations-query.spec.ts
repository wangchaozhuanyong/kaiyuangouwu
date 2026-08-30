import { print } from 'graphql';
import { describe, expect, it } from 'vitest';

import { imageGenerationOperationsQuery } from './image-generation.graphql';

describe('image generation operations query', () => {
    it('loads generation history with server-side pagination and state filtering', () => {
        const query = print(imageGenerationOperationsQuery);

        expect(query).toContain('$jobSkip: Int');
        expect(query).toContain('$jobTake: Int');
        expect(query).toContain('$jobState: ImageGenerationState');
        expect(query).toContain('imageGenerationJobs(skip: $jobSkip, take: $jobTake, state: $jobState)');
    });
});
