import { useEffect } from 'react';
import { useTheme } from '../../src/theme/theme-context';

/** Match the local audit URL without changing production theme behavior. */
export function FixtureAuditTheme() {
    const { setPreference } = useTheme();
    useEffect(() => {
        setPreference(new URLSearchParams(location.search).has('light') ? 'light' : 'dark');
    }, [setPreference]);
    return null;
}
