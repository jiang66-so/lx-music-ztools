// Some host sessions do not expose Chromium's output-device enumeration API.
// Keep the default audio output; avoid failing the entire original App setup.
module.exports = source => {
  if (!source.includes('export default () => {')) throw new Error('LX media device contract changed')
  return source.replace('export default () => {', `export default () => {
  if (!navigator.mediaDevices) return`)
}
