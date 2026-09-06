import { homepageModuleCatalog } from './homepage-manifest';

export const fixedHomepageModuleTypes = homepageModuleCatalog.map(module => module.type);

export type FixedHomepageModuleType = (typeof fixedHomepageModuleTypes)[number];

/** Defaults for editor drafts; clients render persisted, published blocks only. */
export const homepageModuleDefaults = homepageModuleCatalog.map((module, index) => ({
    type: module.type,
    position: (index + 1) * 10,
    enabled: module.defaultEnabled,
}));
