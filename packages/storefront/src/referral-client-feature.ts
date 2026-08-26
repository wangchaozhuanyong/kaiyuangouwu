import { ReferralProgram } from './types';

export function isReferralClientFeatureEnabled(
    program: Pick<ReferralProgram, 'enabled'> | null | undefined,
): boolean {
    return program?.enabled === true;
}
