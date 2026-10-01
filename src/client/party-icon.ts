// src/client/party-icon.ts
// Shared 24px line artwork for the host tab and the plugin-owned playback control.
export const partyIconPaths = Object.freeze([
  'M14 9a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0',
  'M2.8 21a6.8 6.8 0 0 1 13.4 0',
  'M17 4.6a4.5 4.5 0 0 1 0 8.8',
  'M18.2 15.7a6.8 6.8 0 0 1 3.2 5.3',
  'M1 7.5v3',
  'M23 7.5v3',
])

export function createPartyIcon(size = 18): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [name, value] of Object.entries({
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    'data-party-icon': 'true',
  }))
    svg.setAttribute(name, value)
  for (const d of partyIconPaths) {
    const path = document.createElementNS(svg.namespaceURI, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}
