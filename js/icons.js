const s = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;

export const ICON = {
  play: s('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  pause: s('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/>'),
  home: s('<path d="M6 6h2.2v12H6zM19 6v12l-9-6z" fill="currentColor"/>'),
  rec: s('<circle cx="12" cy="12" r="6.5" fill="currentColor"/>'),
  stop: s('<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>'),
  metro: s('<path d="M9.2 3.5h5.6L19 20.5H5zM12 15.5l4.5-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>'),
  loop: s('<path d="M17 4l3 3-3 3M20 7H8a4 4 0 0 0-4 4v1M7 20l-3-3 3-3M4 17h12a4 4 0 0 0 4-4v-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  more: s('<circle cx="5.5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor"/>'),
  studio: s('<path d="M6 4v16M12 4v16M18 4v16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="3.5" y="13" width="5" height="3" rx="1" fill="currentColor"/><rect x="9.5" y="7" width="5" height="3" rx="1" fill="currentColor"/><rect x="15.5" y="11" width="5" height="3" rx="1" fill="currentColor"/>'),
  beat: s('<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.8" fill="currentColor"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.8" fill="currentColor"/>'),
  keys: s('<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 4v16M15 4v16" stroke="currentColor" stroke-width="1.6"/><rect x="7.3" y="4" width="3.4" height="9" fill="currentColor"/><rect x="13.3" y="4" width="3.4" height="9" fill="currentColor"/>'),
  tune: s('<path d="M3 15c2-6 4-6 6 0s4 6 6 0 4-6 6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M3 8h18" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2.5"/>'),
  screw: s('<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1" opacity=".6"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>'),
  mic: s('<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
};
