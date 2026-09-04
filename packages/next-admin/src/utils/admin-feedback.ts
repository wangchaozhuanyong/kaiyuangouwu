export type AdminFeedbackKind = 'loading' | 'success' | 'error' | 'info';

export interface AdminFeedback {
    id: string;
    kind: AdminFeedbackKind;
    title: string;
    message?: string;
    durationMs?: number;
}

export type AdminFeedbackInput = Omit<AdminFeedback, 'id'> & { id?: string };

type AdminFeedbackListener = (feedback: AdminFeedback) => void;

const listeners = new Set<AdminFeedbackListener>();
let feedbackSequence = 0;

export function createAdminFeedbackId(prefix = 'admin-action') {
    feedbackSequence += 1;
    return `${prefix}-${Date.now()}-${feedbackSequence}`;
}

export function publishAdminFeedback(input: AdminFeedbackInput) {
    const feedback: AdminFeedback = {
        ...input,
        id: input.id ?? createAdminFeedbackId(),
    };
    listeners.forEach(listener => listener(feedback));
    return feedback.id;
}

export function subscribeAdminFeedback(listener: AdminFeedbackListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
