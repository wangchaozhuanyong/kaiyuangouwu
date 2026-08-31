import { createContext, useContext } from 'react';

export interface ConfirmDialogOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'warning' | 'danger';
  requireCurrentPassword?: boolean;
}

export type ConfirmDialogResult = false | { currentPassword?: string };

export type RequestConfirmation = (options: ConfirmDialogOptions) => Promise<ConfirmDialogResult>;

export const ConfirmDialogContext = createContext<RequestConfirmation | null>(null);

export function useConfirmDialog() {
  const requestConfirmation = useContext(ConfirmDialogContext);
  if (!requestConfirmation) {
    throw new Error('useConfirmDialog must be used within ConfirmDialogProvider');
  }
  return requestConfirmation;
}
