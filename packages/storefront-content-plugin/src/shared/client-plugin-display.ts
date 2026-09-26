import { getLocalizedInterfaceCopy, type DisplayLanguage } from '../../../common/src/display-localization';
import { storefrontClientPluginCatalog } from '../client-plugin-manifest';

/** Resolve display metadata from the catalog, including unknown or newer plugin codes. */
export function getClientPluginDisplay(code: string | null | undefined, language: DisplayLanguage = 'zh') {
    const definition = storefrontClientPluginCatalog.find(plugin => plugin.code === code);
    return {
        name: getLocalizedInterfaceCopy(
            definition ? { zh: definition.name, en: definition.englishName } : undefined,
            language,
            'plugin',
        ),
        description: definition
            ? getLocalizedInterfaceCopy(
                  { zh: definition.description, en: definition.englishDescription },
                  language,
                  'description',
              )
            : language === 'en'
              ? 'This plugin is not registered in the current version.'
              : '当前版本未登记的插件配置',
        version: definition?.version,
    };
}
