import type { ListIcon } from '@/types/api'

/**
 * The list icons as die-cut stickers (Claude Design, "Listen-Icons ·
 * Iteration 3 · Die-Cut-Sticker"): small colored illustrations with an ink
 * outline. BaseSticker draws each shape a second time, fattened, as the
 * white cut border and the hard shadow.
 *
 * Shapes live on a 48 x 48 grid. The colors are part of the artwork and do
 * not follow the theme: the design keeps them the same in light and dark.
 */

/** One path of an illustration. */
export interface StickerShape {
  d: string
  /** null = not filled (a line). */
  fill: string | null
  /** null = no outline (a dot or a spot of color). */
  stroke: string | null
  strokeWidth: number
}

export interface Sticker {
  /** Degrees around the center; each sticker sits a little askew, like the logo. */
  rotate: number
  /** Back to front. */
  shapes: StickerShape[]
}

const INK = '#16181d'
const WHITE = '#ffffff'

const COLOR = {
  tomato: '#ff7a59',
  lilac: '#b89cff',
  sky: '#6ec1f0',
  sun: '#ffd23f',
  mint: '#7fd99a',
  rose: '#ff9ec7',
  apricot: '#ffa24c',
  green: '#1f7a3a',
  white: WHITE,
  silver: '#dce3ee',
  wood: '#ffe0b0',
  milk: '#fff1c2',
} as const

// Shape helpers, named like in the design file so the two stay comparable.

/** Filled shape with an ink outline. */
const P = (d: string, fill?: string): StickerShape => ({
  d,
  fill: fill ?? null,
  stroke: INK,
  strokeWidth: 2.5,
})
/** Ink line. */
const L = (d: string): StickerShape => P(d)
/** Thinner ink outline, for details on top of a larger shape. */
const T = (d: string, fill?: string, strokeWidth = 2): StickerShape => ({
  d,
  fill: fill ?? null,
  stroke: INK,
  strokeWidth,
})
/** White highlight line. */
const H = (d: string): StickerShape => ({ d, fill: null, stroke: WHITE, strokeWidth: 2 })
/** Fill without outline. */
const N = (d: string, fill: string): StickerShape => ({ d, fill, stroke: null, strokeWidth: 0 })

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`
const rect = (x: number, y: number, w: number, h: number, rx: number) =>
  `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${rx} 0 0 1 ${rx} ${rx}v${h - 2 * rx}` +
  `a${rx} ${rx} 0 0 1 ${-rx} ${rx}h${-(w - 2 * rx)}a${rx} ${rx} 0 0 1 ${-rx} ${-rx}` +
  `v${-(h - 2 * rx)}a${rx} ${rx} 0 0 1 ${rx} ${-rx}Z`
const C = (cx: number, cy: number, r: number, fill: string) => P(circle(cx, cy, r), fill)
const R = (x: number, y: number, w: number, h: number, rx: number, fill: string) =>
  P(rect(x, y, w, h, rx), fill)

const K = COLOR

/** Record, not a plain object: a new icon in the API contract fails the type check here. */
export const STICKERS: Record<ListIcon, Sticker> = {
  // Food
  supermarket: {
    rotate: -6,
    shapes: [
      P('M15 21 L20 8 a2.5 2.5 0 0 1 4.6 1.8 L20 21 Z', K.apricot),
      L('M19.6 12.6l2 .8'),
      L('M18.3 16.2l2 .8'),
      C(29.5, 16, 5, K.mint),
      L('M29.5 11v-2.5'),
      P('M29.5 10.5c.5-2 2.3-3 4.3-2.6-.6 2-2.3 3-4.3 2.6z', K.green),
      R(36.25, 7, 2.5, 4, 1, K.sky),
      R(35, 10, 5, 11, 2, K.sky),
      P('M8 20 H42 L38.6 33 a2.5 2.5 0 0 1 -2.4 1.8 H14.2 a2.5 2.5 0 0 1 -2.4 -1.8 Z', K.tomato),
      L('M16.5 20 l1.3 14.8'),
      L('M25 20 v14.8'),
      L('M33.5 20 l-1.3 14.8'),
      H('M11.5 23.5h2.5'),
      L('M8 20 L6.2 13 H3'),
      L('M13 35 v3 H37'),
      C(16, 41.5, 2.8, K.white),
      C(34, 41.5, 2.8, K.white),
    ],
  },
  market: {
    rotate: 5,
    shapes: [
      P('M28 9c-.5-3 .5-5.5 3-6.5.8 2.6-.3 5-3 6.5z', K.green),
      P('M29.5 10c1.5-2.5 4-3.5 6.5-2.8-1.3 2.4-3.8 3.4-6.5 2.8z', K.mint),
      P('M18 30 L25.5 9.5 a3 3 0 0 1 5.6 2 L24 30 Z', K.apricot),
      L('M26 16l2.5.8'),
      L('M24.4 21l2.4.8'),
      C(15, 24, 6, K.tomato),
      P('M12.5 18.5l2.5 1.6 2.5-1.6-.9 2.6h-3.2z', K.green),
      H('M11.5 23c.3-1.3 1-2.2 2-2.7'),
      C(32, 22.5, 4.5, K.mint),
      C(37, 25, 5.5, K.mint),
      P('M6 29 H42 L38.4 40.4 a3 3 0 0 1 -2.9 2.1 H12.5 a3 3 0 0 1 -2.9 -2.1 Z', K.sun),
      L('M9.5 35.5h29'),
      L('M17 31v11'),
      L('M24 31v11'),
      L('M31 31v11'),
      R(4, 25.5, 40, 5, 2.5, K.apricot),
    ],
  },
  bakery: {
    rotate: -3,
    shapes: [
      P('M6 30 L34 8 a3.5 3.5 0 0 1 4.4 5.4 L10.4 35.6 a3.5 3.5 0 0 1 -4.4 -5.6 Z', K.sun),
      L('M17 23l3 1.5'),
      L('M23 18.3l3 1.5'),
      L('M29 13.6l3 1.5'),
      P('M10 40 V31 a14 9 0 0 1 28 0 V40 a2 2 0 0 1 -2 2 H12 a2 2 0 0 1 -2 -2 Z', K.apricot),
      L('M17 26.5l2 3.5'),
      L('M23 24.2l2 3.5'),
      L('M29 25l2 3.5'),
      H('M14 30c.8-1.8 2-3.2 3.4-4.2'),
      L('M10 36h28'),
    ],
  },
  butcher: {
    rotate: 4,
    shapes: [
      P('M8 24c0-9 9-15 19-14s14 8 13 16-9 14-18 13c-6-.5-9-3.5-11-7-2-2.5-3-5-3-8z', K.white),
      T(
        'M13 24c0-6 6-10 13-9.5s10 5.5 9.5 11-6 9.5-12.5 9c-4-.4-6.5-2.5-8-5-1.5-1.7-2-3.5-2-5.5z',
        K.rose,
      ),
      C(24.5, 24.5, 3, K.white),
      H('M16.5 28.5c2 .5 3.5 2 4.5 3.5'),
      H('M28.5 19c1.6.6 2.8 1.8 3.4 3.3'),
      P('M33 39c2-3.2 5-4.5 8.5-3.6-1.2 3.2-4.4 4.6-8.5 3.6z', K.mint),
      L('M33 39l5-2'),
    ],
  },
  drinks: {
    rotate: -5,
    shapes: [
      P(
        'M13 7h6v5l2.5 4a3 3 0 0 1 .5 1.7V40a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V17.7a3 3 0 0 1 .5-1.7L13 12z',
        K.sky,
      ),
      R(12.5, 4, 7, 4, 1.5, K.tomato),
      R(10, 23, 12, 9, 1.5, K.white),
      L('M13 27.5h6'),
      H('M12.5 35v3'),
      P(
        'M29 11h5v5l2.5 4a3 3 0 0 1 .5 1.7V40a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V21.7a3 3 0 0 1 .5-1.7L29 16z',
        K.mint,
      ),
      R(28.5, 8, 6, 3.5, 1.2, K.sun),
      R(26, 27, 11, 8, 1.5, K.sun),
      L('M29 31h5'),
      N(circle(41.5, 8, 1.5), K.sky),
      N(circle(44, 13, 1), K.sky),
    ],
  },
  organic: {
    rotate: 3,
    shapes: [
      P('M18 14c-2.5-4.5-1-8.5 3-10 1.2 4-.5 8-3 10z', K.mint),
      P('M23 14c.5-5 3.5-8 8-8.3 0 4.3-3.2 7.6-8 8.3z', K.green),
      P('M27 14c1.5-3 4-4.5 7-4.2-.8 2.9-3.4 4.4-7 4.2z', K.mint),
      P('M10 16h28l-2 24.5a2 2 0 0 1-2 1.8H14a2 2 0 0 1-2-1.8z', K.mint),
      R(8.5, 12.5, 31, 6, 2, K.white),
      P('M18 37c0-6.5 4.5-10.5 12-10.5 0 7.3-4.5 10.5-12 10.5z', K.white),
      L('M18 37l7.5-6.3'),
      H('M14 22v6'),
    ],
  },

  // Household, care and DIY
  drugstore: {
    rotate: 4,
    shapes: [
      R(29.5, 15.5, 10, 4, 1, K.rose),
      P('M30.5 19.5h8l-1.4 17a2 2 0 0 1-2 1.8h-1.2a2 2 0 0 1-2-1.8z', K.rose),
      R(31.6, 38, 5, 4.5, 1.2, K.white),
      L('M17 13V8'),
      R(12, 5, 10, 3.5, 1.5, K.white),
      L('M22 6.75h4v2.5'),
      R(12.5, 12.5, 9, 5.5, 1.5, K.white),
      R(8, 18, 18, 24, 4.5, K.lilac),
      R(11, 24, 12, 12, 2, K.white),
      T('M17 26.5c2 2.5 3 4 3 5.2a3 3 0 0 1-6 0c0-1.2 1-2.7 3-5.2z', K.sky),
      H('M11 39.5v-.5'),
      C(40, 9, 2.5, K.white),
      C(34.5, 6.5, 1.5, K.white),
      C(34, 11.5, 1.2, K.white),
    ],
  },
  pharmacy: {
    rotate: -4,
    shapes: [
      P('M12.5 38.5 a6.36 6.36 0 0 1 -9 -9 L13 20 L22 29 Z', K.rose),
      P('M13 20 L19.5 13.5 a6.36 6.36 0 0 1 9 9 L22 29 Z', K.white),
      H('M7 30.5l4.5-4.5'),
      C(35, 14, 9, K.mint),
      T('M32.5 8.5h5v3h3v5h-3v3h-5v-3h-3v-5h3z', K.white),
      C(36, 36, 5.5, K.sun),
      L('M32.2 39.8l7.6-7.6'),
    ],
  },
  baby: {
    rotate: 6,
    shapes: [
      P('M20 10.5c0-3 1.8-5.5 4-5.5s4 2.5 4 5.5z', K.sun),
      R(16, 10, 16, 5.5, 2, K.lilac),
      R(15, 15.5, 18, 27, 5, K.white),
      T('M15 28h18v9.5a5 5 0 0 1-5 5h-8a5 5 0 0 1-5-5z', K.milk, 2.5),
      L('M19 20h4'),
      L('M19 24h2.5'),
      T(
        'M24 38c-3-2-4.5-3.5-4.5-5a2.2 2.2 0 0 1 4.5-.8 2.2 2.2 0 0 1 4.5.8c0 1.5-1.5 3-4.5 5z',
        K.rose,
      ),
      T('M39 8l1.3 3 3 1.3-3 1.3-1.3 3-1.3-3-3-1.3 3-1.3z', K.sun),
      N(circle(9, 14, 1.8), K.sky),
    ],
  },
  pets: {
    rotate: -3,
    shapes: [
      P(
        'M14 8.5h20a3.6 3.6 0 1 1 3.4 3.5 3.6 3.6 0 1 1 -3.4 3.5H14a3.6 3.6 0 1 1 -3.4 -3.5A3.6 3.6 0 1 1 14 8.5z',
        K.white,
      ),
      P('M10 28c2-5.5 8-7.5 14-7.5s12 2 14 7.5z', K.apricot),
      N(circle(18, 25.5, 1.4), K.tomato),
      N(circle(24, 24, 1.4), K.tomato),
      N(circle(29.5, 25.5, 1.4), K.tomato),
      P('M5 28h38l-3.5 11.2a3 3 0 0 1-2.9 2.1H11.4a3 3 0 0 1-2.9-2.1z', K.sky),
      R(4, 25.5, 40, 5, 2.5, K.sky),
      N(circle(24, 36.5, 2.4), K.white),
      N(circle(20.4, 33.6, 1.2), K.white),
      N(circle(23, 32.2, 1.2), K.white),
      N(circle(25.9, 32.4, 1.2), K.white),
      N(circle(28.2, 34.2, 1.2), K.white),
    ],
  },
  hardware: {
    rotate: 5,
    shapes: [
      R(15, 10, 4.5, 14, 1.5, K.apricot),
      R(9, 6, 16, 6, 2, K.silver),
      R(28.5, 8, 6, 10, 2.5, K.sun),
      L('M31.5 18v4'),
      R(5, 20, 38, 22, 3.5, K.sky),
      L('M5 27h38'),
      R(21, 24.5, 6, 5.5, 1.5, K.sun),
      H('M9 31v6'),
    ],
  },
  garden: {
    rotate: -6,
    shapes: [
      L('M24 31V13'),
      P('M24 26c-6.5 0-10.5-4-10.5-10.5 6.5 0 10.5 4 10.5 10.5z', K.mint),
      L('M16.5 18.5l5 5'),
      P('M24 23c0-6.5 4-10.5 10.5-10.5 0 6.5-4 10.5-10.5 10.5z', K.green),
      C(24, 5.5, 2.6, K.rose),
      C(27.5, 9, 2.6, K.rose),
      C(24, 12.5, 2.6, K.rose),
      C(20.5, 9, 2.6, K.rose),
      C(24, 9, 2.2, K.sun),
      P('M14 35h20l-2 6.5a2 2 0 0 1-2 1.5H18a2 2 0 0 1-2-1.5z', K.tomato),
      R(12, 30, 24, 5.5, 1.8, K.tomato),
      H('M17 38.5h3'),
    ],
  },

  // Everything else
  furniture: {
    rotate: -4,
    shapes: [
      R(9, 12, 30, 17, 4, K.tomato),
      R(13, 16.5, 10, 9, 3, K.sun),
      R(25, 16.5, 10, 9, 3, K.sky),
      R(10, 26.5, 28, 9, 2.5, K.tomato),
      R(4, 22, 8, 15.5, 3.5, K.tomato),
      R(36, 22, 8, 15.5, 3.5, K.tomato),
      L('M9 37.5v4'),
      L('M39 37.5v4'),
      H('M13 15h5'),
    ],
  },
  electronics: {
    rotate: 3,
    shapes: [
      L('M24 37v3.5a4 4 0 0 1-4 4h-9'),
      R(17, 3.5, 4, 9.5, 1.5, K.silver),
      R(27, 3.5, 4, 9.5, 1.5, K.silver),
      P('M11 12h26v8a13 13 0 0 1-26 0z', K.sun),
      R(20, 31.5, 8, 6, 1.8, K.sun),
      T('M25.5 15l-6 8.5h5l-2 7 6-9h-5z', K.white),
      H('M14.5 15v4'),
    ],
  },
  stationery: {
    rotate: -5,
    shapes: [
      R(7, 6, 26, 34, 3, K.sky),
      L('M12.5 6v34'),
      R(17, 12, 12, 6.5, 1.5, K.white),
      N(circle(10, 12, 1), INK),
      N(circle(10, 20, 1), INK),
      N(circle(10, 28, 1), INK),
      P('M18 44 L20.4 37.4 L24.6 41.6 Z', K.wood),
      P('M20.4 37.4 L35.9 21.9 L40.1 26.1 L24.6 41.6 Z', K.sun),
      L('M22.5 39.5 L38 24'),
      P('M35.9 21.9 L37.9 19.9 L42.1 24.1 L40.1 26.1 Z', K.silver),
      P('M37.9 19.9 L40.4 17.4 a2.97 2.97 0 0 1 4.2 4.2 L42.1 24.1 Z', K.rose),
      N('M18 44 L18.9 41.6 L20.4 43.1 Z', INK),
    ],
  },
  clothing: {
    rotate: 6,
    shapes: [
      P(
        'M40.76 7.92 L32 5 a8 8 0 0 1 -16 0 L7.24 7.92 a4 4 0 0 0 -2.68 4.46 l1.16 6.94 a2 2 0 0 0 1.98 1.68 H12 v20 c0 2.2 1.8 4 4 4 h16 a4 4 0 0 0 4 -4 V21 h4.3 a2 2 0 0 0 1.98 -1.68 l1.16 -6.94 a4 4 0 0 0 -2.68 -4.46 z',
        K.rose,
      ),
      T('M12 26h24v5H12z', K.white, 2.5),
      T('M18.5 6.5a6 6 0 0 0 11 0', undefined, 2.5),
      R(27, 14, 5, 5, 1.2, K.sun),
      H('M8 13l.6 3.5'),
    ],
  },
  online: {
    rotate: -3,
    shapes: [
      R(8, 18, 32, 24, 3, K.lilac),
      R(6, 12, 36, 8, 2.5, K.lilac),
      T('M21 12h6v30h-6z', K.sun, 2.5),
      R(11, 30, 7.5, 6, 1, K.white),
      L('M12.8 33h4'),
      C(38.5, 11, 7, K.mint),
      T('M35.3 11.2l2.2 2.2 4.2-4.6', undefined, 2.5),
    ],
  },
  general: {
    rotate: 4,
    shapes: [
      R(8, 7, 32, 37, 4, K.tomato),
      R(12.5, 12, 23, 28, 2, K.white),
      R(18, 3.5, 12, 7, 2, K.lilac),
      R(16, 16.5, 4.5, 4.5, 1, K.mint),
      T('M16.8 18.8l1.2 1.2 2-2.4', undefined, 1.6),
      L('M24 18.8h8'),
      R(16, 24.5, 4.5, 4.5, 1, K.mint),
      T('M16.8 26.8l1.2 1.2 2-2.4', undefined, 1.6),
      L('M24 26.8h8'),
      R(16, 32.5, 4.5, 4.5, 1, K.white),
      L('M24 34.8h5.5'),
    ],
  },
}
