/**
 * VeriTrend Plugin Manager (Frontend)
 * Generisches Registry-System für alle Plugin-Typen.
 */
(function() {
  'use strict';

  window.VT_PLUGINS = {};  // {pluginType: {pluginId: hooks}}

  window.vtRegisterPlugin = function(pluginType, pluginId, hooks) {
    VT_PLUGINS[pluginType] = VT_PLUGINS[pluginType] || {};
    VT_PLUGINS[pluginType][pluginId] = hooks;
  };

  window.vtGetPlugin = function(pluginType, pluginId) {
    return (VT_PLUGINS[pluginType] || {})[pluginId] || null;
  };

  window.vtAllPlugins = function(pluginType) {
    return VT_PLUGINS[pluginType] || {};
  };
})();
