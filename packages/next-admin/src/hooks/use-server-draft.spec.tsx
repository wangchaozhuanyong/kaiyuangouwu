// @vitest-environment jsdom
import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useServerDraft } from './use-server-draft';

const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(async () => cleanups.splice(0).forEach(cleanup => cleanup()));
});
describe('server draft ownership', () => {
    it('rebases clean forms, preserves dirty forms on late updates and resets scope explicitly', async () => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        let draft!: ReturnType<typeof useServerDraft<{ name: string }>>;
        function Form({ identity, version, name }: { identity: string; version: string; name: string }) {
            const current = useServerDraft(identity, version, { name });
            useLayoutEffect(() => {
                draft = current;
            }, [current]);
            return <input readOnly value={current.draft?.name ?? ''} />;
        }
        const render = (version: string, name: string, identity = 'store-a') =>
            act(async () => root.render(<Form identity={identity} version={version} name={name} />));
        cleanups.push(() => {
            root.unmount();
            container.remove();
        });
        await render('v1', 'first');
        await render('v2', 'clean update');
        expect(draft.draft?.name).toBe('clean update');
        await act(async () => draft.setDraft({ name: 'unsaved' }));
        await render('v3', 'late update');
        expect(draft.draft?.name).toBe('unsaved');
        expect(draft.baseline?.name).toBe('clean update');
        expect(draft.sourceChanged).toBe(true);
        await act(async () => draft.reload());
        expect(draft.draft?.name).toBe('late update');
        expect(draft.dirty).toBe(false);
        await act(async () => draft.setDraft({ name: 'other edits' }));
        await render('v1', 'other store', 'store-b');
        expect(draft.draft?.name).toBe('other store');
        expect(draft.dirty).toBe(false);
    });
});
