const context = require('./context.cjs')
const { WIN_MAIN_RENDERER_EVENT_NAME: names } = require('../upstream/common/ipcNames.cjs')
let selectModeListener
const sync = data => context.bridge.emit(names.sync_action, data)

// Original main services notify the existing renderer; they never create another player/window.
module.exports = {
  sendTaskbarButtonClick(action, data) { context.bridge.emit(names.player_action_on_button_click, { action, data }) },
  sendClientStatus(data) { sync({ action: 'client_status', data }) },
  sendServerStatus(data) { sync({ action: 'server_status', data }) },
  sendSelectMode(deviceName, type, listener) {
    if (selectModeListener) selectModeListener(null)
    selectModeListener = listener
    sync({ action: 'select_mode', data: { deviceName, type } })
  },
  chooseSyncMode(mode) { const callback = selectModeListener; selectModeListener = null; callback?.(mode) },
  removeSelectModeListener() { const callback = selectModeListener; selectModeListener = null; callback?.(null) },
  sendCloseSelectMode() { sync({ action: 'close_select_mode' }) },
}
