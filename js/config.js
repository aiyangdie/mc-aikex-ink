/**
 * 后端地址：正式站同域；GitHub Pages 预览时联机仍打 mc.aikex.ink
 */
const host = typeof location !== 'undefined' ? location.hostname : '';
const onPages = /\.github\.io$/i.test(host);

export const API_BASE = onPages ? 'https://mc.aikex.ink' : '';

export function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

export function wsUrl() {
  if (API_BASE) {
    const u = new URL(API_BASE);
    return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/ws`;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
