/**
 * Stroke icons as SVG path data on a 24 x 24 grid.
 *
 * Paths from Lucide (https://lucide.dev), ISC License,
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
 * part of Feather (MIT). All other copyright (c) for Lucide are held by
 * Lucide Contributors 2022.
 * Copied instead of installed: the app needs only a handful of icons.
 */
export const ICONS = {
  cart: [
    'M7 21a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
    'M18 21a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
    'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12',
  ],
  sprayCan: [
    'M3 3h.01',
    'M7 5h.01',
    'M11 7h.01',
    'M3 7h.01',
    'M7 9h.01',
    'M3 11h.01',
    'M15 5h4v4h-4z',
    'm19 9 2 2v10c0 .6-.4 1-1 1h-6c-.6 0-1-.4-1-1V11l2-2',
    'm13 14 8-2',
    'm13 19 8-2',
  ],
  hammer: [
    'm15 12-8.373 8.373a1 1 0 1 1-3-3L12 9',
    'm18 15 4-4',
    'm21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5',
  ],
  alert: [
    'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
    'M12 9v4',
    'M12 17h.01',
  ],
  logOut: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  cloudOff: [
    'm2 2 20 20',
    'M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193',
    'M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07',
  ],
  retry: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
} as const satisfies Record<string, readonly string[]>

export type IconName = keyof typeof ICONS
