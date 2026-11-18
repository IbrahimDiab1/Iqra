// SVG path markup from the prototype's ICON object (folio-prototype.html).
const ICON = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.6L7 20z"/>',
  bookmarkFill: '<path d="M7 4h10v16l-5-3.6L7 20z" fill="currentColor"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  area: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  reflow: '<path d="M4 6h16M4 10.5h16M4 15h11M4 19.5h7"/>',
  pageview: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8.5 7.5h7M8.5 11h7M8.5 14.5h4"/>',
  chevL: '<path d="M15 18l-6-6 6-6"/>',
  chevR: '<path d="M9 6l6 6-6 6"/>',
  note: '<path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/>',
  tag: '<path d="M3.5 12.5V4h8.5l8.5 8.5-8 8z"/><circle cx="8" cy="8.5" r="1.3"/>',
  translate: '<path d="M4 5h9M8.5 3v2M11 5c-.8 3.8-3.6 6.8-7 8.2M6.3 8.6c1.4 2 3.3 3.6 5.7 4.6M13 21l4-9 4 9M14.4 18h5.2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  library: '<path d="M5 4h3v16H5zM10.5 4h3v16h-3zM16 5.2l2.9-.8 3.6 15-2.9.8z"/>',
  notes: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  words: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8"/>',
  stats: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  type: '<path d="M3 18L8 6l5 12M4.6 14.2h6.8M15 18l3-7 3 7M15.9 16h4.2"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 20h14"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  swap: '<path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  cloud: '<path d="M7.5 18.5a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 18.4 10.6 3.9 3.9 0 0 1 17.5 18.5z"/>',
  wifiOff: '<path d="M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 3.2-2M19 12.9a10 10 0 0 0-6-2.8M2 8.8A15 15 0 0 1 7 5.7M22 8.8A15 15 0 0 0 12 5"/><path d="M12 20h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>',
  histBack: '<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
  histFwd: '<path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M8 11h6"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>'
} as const;

export type IconName = keyof typeof ICON;

export function icon(name: IconName, size = 22): string {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
}
