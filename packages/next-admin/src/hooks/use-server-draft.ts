import { useCallback, useState, type SetStateAction } from 'react';
import { useUnsavedChangesWarning } from './use-unsaved-changes-warning';

interface DraftState<T> {
    identity: string;
    version: string;
    baseline: T | null;
    draft: T | null;
}
const sameDraft = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** A new server version rebases clean forms only. Dirty drafts stay attached to their loaded version. */
export function useServerDraft<T>(identity: string, version: string, source: T | null) {
    const [stored, setStored] = useState<DraftState<T>>({
        identity,
        version,
        baseline: source,
        draft: source,
    });
    let state = stored;
    const storedDirty = !sameDraft(stored.draft, stored.baseline);
    if (identity !== stored.identity || (!storedDirty && version !== stored.version)) {
        state = { identity, version, baseline: source, draft: source };
        setStored(state);
    }
    const dirty = !sameDraft(state.draft, state.baseline);
    const sourceChanged = Boolean(version && state.version && version !== state.version && dirty);
    useUnsavedChangesWarning(dirty, '当前页面还有未保存的修改，确定放弃吗？');
    const setDraft = useCallback(
        (next: SetStateAction<T | null>) =>
            setStored(previous => ({
                ...previous,
                draft:
                    typeof next === 'function'
                        ? (next as (value: T | null) => T | null)(previous.draft)
                        : next,
            })),
        [],
    );
    const accept = (draft: T | null, nextVersion = version) =>
        setStored({ identity, version: nextVersion, baseline: draft, draft });
    return {
        draft: state.draft,
        baseline: state.baseline,
        dirty,
        sourceChanged,
        setDraft,
        accept,
        reload: () => accept(source),
    };
}
