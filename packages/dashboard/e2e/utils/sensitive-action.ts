import { type Locator } from '@playwright/test';

const TEST_ADMIN_PASSWORD = process.env.VENDURE_DASHBOARD_E2E_PASSWORD ?? 'superadmin';

export async function confirmSensitiveAction(dialog: Locator, actionName: string | RegExp = 'Continue') {
    await dialog.waitFor({ state: 'visible' });
    const passwordInput = dialog.locator('input[autocomplete="current-password"]').first();
    if ((await passwordInput.count()) > 0) {
        await passwordInput.fill(TEST_ADMIN_PASSWORD);
    }
    await dialog.getByRole('button', { name: actionName }).last().click();
}
