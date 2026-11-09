const { createDataService } = require('./data.cjs')
const { createSettings } = require('./settings.cjs')
const context = require('./context.cjs')
const { createAppEvent, createListEvent, createDislikeEvent } = require('../upstream/main/event/index.cjs')
const { CMMON_EVENT_NAME, WIN_MAIN_RENDERER_EVENT_NAME } = require('../upstream/common/ipcNames.cjs')
const modules = require('../upstream/main/worker/dbService/modules/index.cjs')
const registerList = require('../upstream/main/modules/commonRenderers/list/rendererEvent.cjs').default
const registerDislike = require('../upstream/main/modules/commonRenderers/dislike/rendererEvent.cjs').default
const registerMusic = require('../upstream/main/modules/winMain/rendererEvent/music.cjs').default
const registerDownload = require('../upstream/main/modules/winMain/rendererEvent/download.cjs').default
const listEvents = require('../upstream/main/modules/commonRenderers/list/winRendererEvent.cjs')
const dislikeEvents = require('../upstream/main/modules/commonRenderers/dislike/winRendererEvent.cjs')

/** Bind the original LX event/data handlers to plugin-local services. */
function initializeRuntime({ bridge, directory }) {
  const data = createDataService(directory)
  const settings = createSettings(data.getDatabase())
  const dbService = {}
  for (const [namespace, methods] of Object.entries(modules)) {
    for (const method of Object.keys(methods)) dbService[method] = (...args) => Promise.resolve(data.call(namespace, method, args))
  }
  const lx = context.lx = { database: data.getDatabase(), settings, worker: { dbService }, event_app: createAppEvent(), event_list: createListEvent(), event_dislike: createDislikeEvent(), appSetting: settings.get() }
  context.bridge = bridge
  bridge.register('runtime:ready', () => true)
  bridge.register(CMMON_EVENT_NAME.get_app_setting, () => settings.get())
  lx.event_app.on('updated_config', (_keys, patch) => bridge.emit(WIN_MAIN_RENDERER_EVENT_NAME.on_config_change, patch))
  bridge.register(CMMON_EVENT_NAME.set_app_setting, patch => lx.event_app.update_config(patch))
  bridge.setSnapshot(CMMON_EVENT_NAME.get_app_setting, lx.appSetting)
  for (const register of [registerList, registerDislike, registerMusic, registerDownload]) register()
  const unregisterList = listEvents.registerRendererEvents((channel, params) => bridge.emit(channel, params))
  const unregisterDislike = dislikeEvents.registerRendererEvents((channel, params) => bridge.emit(channel, params))
  return { data, settings, async dispose() {
    unregisterList(); unregisterDislike()
    lx.event_app.removeAllListeners(); lx.event_list.removeAllListeners(); lx.event_dislike.removeAllListeners()
    data.close(); context.lx = null; context.bridge = null
  } }
}
module.exports = { initializeRuntime }
