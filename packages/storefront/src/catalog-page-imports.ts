// Share the exact dynamic import (and its emitted dependency list) between
// navigation warmup and the lazy route component, without importing the wrapper.
export const importHomePage = () => import('./pages/home-page');
export const importProductDetailPage = () => import('./pages/product-detail-page');
