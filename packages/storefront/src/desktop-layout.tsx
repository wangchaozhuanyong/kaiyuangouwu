import { createContext, useContext } from 'react';

export const DesktopLayoutContext = createContext(false);
export const useDesktopLayout = () => useContext(DesktopLayoutContext);
