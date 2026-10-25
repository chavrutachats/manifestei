/**
 * O expo-task-manager adiciona o modo de fundo "fetch" ao Info.plist por padrão.
 * O Manifestei não usa busca em segundo plano: só "location" (registro de presença).
 * Declarar um modo não usado é motivo comum de recusa na revisão da Apple (2.5.4).
 */
const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withLocationOnlyBackgroundMode(config) {
  return withInfoPlist(config, (cfg) => {
    const modes = Array.isArray(cfg.modResults.UIBackgroundModes) ? cfg.modResults.UIBackgroundModes : [];
    cfg.modResults.UIBackgroundModes = modes.filter((m) => m !== 'fetch');
    return cfg;
  });
};
