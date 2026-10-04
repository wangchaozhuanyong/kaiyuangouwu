import { useContext } from 'react';
import { UNSAFE_LocationContext } from 'react-router-dom';
import { getStandaloneAdminPage, localizeAdminNavigationTitle } from '../navigation/admin-navigation';

export function useStandaloneAdminPage() {
    const location = useContext(UNSAFE_LocationContext)?.location;
    const page = getStandaloneAdminPage(location?.pathname ?? '');
    return page ? { ...page, title: localizeAdminNavigationTitle(page.title) } : undefined;
}
export function useAdminPageTitle(fallback: string) {
    return useStandaloneAdminPage()?.title ?? fallback;
}
