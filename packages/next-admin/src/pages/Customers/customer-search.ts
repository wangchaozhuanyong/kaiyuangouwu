import type { CustomerFilterParameter } from '../../../../common/src/generated-types';

/** Shared by the complete customer list and group-member queries; filtering stays server-side. */
export function customerFilter(searchTerm: string): CustomerFilterParameter | undefined {
    const value = searchTerm.trim();
    if (!value) return;
    const alternatives: CustomerFilterParameter[] = [
        { firstName: { contains: value } },
        { lastName: { contains: value } },
        { phoneNumber: { contains: value } },
        { emailAddress: { contains: value } },
    ];
    // The list displays lastName + firstName. Exact full names can span that boundary,
    // even when neither stored field contains the whole search (e.g. w + ww -> www).
    // Use existing equality operators, avoiding regex limits and a schema/DB migration.
    const letters = Array.from(value);
    if (!value.includes('@')) {
        for (let index = 1; index < letters.length; index++) {
            const lastName = letters.slice(0, index).join('').trim();
            const firstName = letters.slice(index).join('').trim();
            if (!lastName || !firstName) continue;
            alternatives.push({ _and: [{ lastName: { eq: lastName } }, { firstName: { eq: firstName } }] });
        }
    }
    return { _or: alternatives };
}
