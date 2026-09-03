import { describe, expect, it } from 'vitest';

import { resolveVersionedDraft } from './versioned-draft';

describe('resolveVersionedDraft', () => {
    it('renders a newly arrived server draft without waiting for an effect', () => {
        expect(resolveVersionedDraft('server-v1', '', { title: '服务端内容' }, null)).toEqual({
            title: '服务端内容',
        });
    });

    it('preserves local edits while the server version is unchanged', () => {
        expect(
            resolveVersionedDraft(
                'server-v1',
                'server-v1',
                { title: '服务端内容' },
                { title: '未保存的本地修改' },
            ),
        ).toEqual({ title: '未保存的本地修改' });
    });
});
