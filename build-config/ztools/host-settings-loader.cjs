// Explain host-owned desktop features while retaining every music/data control.
module.exports = function adaptHostSettings(source) {
  source = source.replaceAll('\r\n', '\n')
  const file = this.resourcePath.replaceAll('\\', '/')
  const disable = id => {
    const pattern = `base-checkbox(id="${id}" `
    if (!source.includes(pattern)) throw new Error('LX host setting shape changed: ' + id)
    source = source.replace(pattern, `base-checkbox(id="${id}" disabled title="此功能由 ZTools 管理或尚无公开接口" `)
  }
  const note = (id, text) => { const end = source.indexOf('\n', source.indexOf(`dt#${id} `)); source = source.slice(0, end) + `\ndd\n  p.small ${text}` + source.slice(end) }
  if (file.endsWith('/SettingBasic.vue')) {
    disable('setting_start_in_fullscreen'); disable('setting_to_tray')
    source = source.replace('name="setting_window_size" need', 'name="setting_window_size" need').replace(':disabled="isFullscreen" :value="item.id"', ':disabled="true" :value="item.id"')
    source = source.replace('name="setting_basic_control_btn_position" need', 'name="setting_basic_control_btn_position" need disabled')
    note('basic', '插件窗口大小、全屏、托盘与关闭按钮由 ZTools 管理。隐藏插件会继续播放；终止插件才会停止服务。')
  } else if (file.endsWith('/SettingPlay.vue')) {
    disable('setting_player_power_save_blocker'); disable('setting_player_showTaskProgess'); disable('setting_player_showStatusBarLyric')
    source = source.replace('await navigator.mediaDevices.enumerateDevices()', 'await (navigator.mediaDevices?.enumerateDevices() ?? Promise.resolve([]))')
      .replaceAll('navigator.mediaDevices.addEventListener', 'navigator.mediaDevices?.addEventListener')
      .replaceAll('navigator.mediaDevices.removeEventListener', 'navigator.mediaDevices?.removeEventListener')
      .replace('base-selection.gap-left(v-model="mediaDeviceId"', 'base-selection.gap-left(:disabled="!mediaDevices.length" v-model="mediaDeviceId"')
    note('play', '阻止系统睡眠、Windows 任务栏进度/缩略图按钮和系统状态栏歌词尚无可用的 ZTools 公开接口。音频输出设备列表不可用时使用系统默认输出。')
  } else if (file.endsWith('/SettingDesktopLyric.vue')) {
    disable('setting_desktop_lyric_fullscreen_hide')
    note('desktop_lyric', '桌面歌词沿用原 LX 页面。自动检测其他应用全屏并隐藏尚无 ZTools 公开接口，可使用 LX 桌面歌词指令手动开关。')
  } else if (file.endsWith('/SettingOther.vue')) {
    disable('setting_transparent_window')
    source = source.replace('name="setting_tray_theme"', 'name="setting_tray_theme" disabled')
    source = source.replace(':disabled="isDisabledResourceCacheClear"', ':disabled="true"')
    const start = source.indexOf('    const refreshCacheSize = () => {'), end = source.indexOf('    const clearResourceCache', start)
    if (start < 0 || end < 0) throw new Error('LX resource-cache settings shape changed')
    source = source.slice(0, start) + "    const refreshCacheSize = () => { cacheSize.value = '由 ZTools 管理' }\n" + source.slice(end)
    note('other', '透明窗口、托盘图标与浏览器资源缓存由 ZTools 管理。下方的歌曲地址、歌词、换源缓存和不喜欢列表保留独立管理。')
  }
  return source
}
