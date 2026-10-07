import { createElement, type ReactNode } from 'react';
import { ConfirmDialogContext } from '../../src/components/confirm-dialog-context';
import { ConfirmDialogProvider } from '../../src/components/ConfirmDialog';

export function FixtureSettingsConfirmation({
    children,
    settingsFixture,
    mockWritesEnabled,
}: {
    children: ReactNode;
    settingsFixture: boolean;
    mockWritesEnabled: boolean;
}) {
    return settingsFixture
        ? createElement(ConfirmDialogProvider, null, children)
        : createElement(
              ConfirmDialogContext.Provider,
              {
                  value: async () =>
                      mockWritesEnabled ? { currentPassword: 'synthetic-local-proof' } : false,
              },
              children,
          );
}
