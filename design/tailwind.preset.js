/* ==========================================================================
   Stacker — Preset Tailwind (v3.4) mappé sur tokens.css
   tailwind.config.js :
     import stacker from './design/tailwind.preset.js'
     export default { presets: [stacker], content: ['./index.html', './src/*.js'] }
   CSS d'entrée :
     @import "./design/fonts.css";  @import "./design/tokens.css";
     @tailwind base; @import "./design/components.css";
     @tailwind components; @tailwind utilities;
   Les couleurs passent par color-mix() pour garder les modificateurs
   d'opacité (bg-green/20) tout en restant pilotées par les variables.
   ========================================================================== */

const v = (name) => `color-mix(in srgb, var(--st-${name}) calc(<alpha-value> * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    screens: { sm: '390px', md: '640px', lg: '1024px', xl: '1280px' },
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: v('surface'),
      bg: { DEFAULT: v('bg'), 2: v('bg-2') },
      surface: { DEFAULT: v('surface'), 2: v('surface-2'), 3: v('surface-3') },
      line: { DEFAULT: v('line'), strong: v('line-strong') },
      ink: { DEFAULT: v('ink'), 2: v('text-2'), muted: v('muted') },
      dark: { 1: v('dark-1'), 2: v('dark-2') },
      'on-dark': { DEFAULT: v('on-dark'), 2: v('on-dark-2') },
      green: { DEFAULT: v('green'), 600: v('green-600'), ink: v('green-ink'), 50: v('green-50') },
      violet: { DEFAULT: v('violet'), ink: v('violet-ink'), 50: v('violet-50') },
      orange: { DEFAULT: v('orange'), ink: v('orange-ink'), 50: v('orange-50') },
      pink: { DEFAULT: v('pink'), ink: v('pink-ink'), 50: v('pink-50') },
      red: { DEFAULT: v('red'), ink: v('red-ink'), 50: v('red-50') },
      paper: v('paper'),
      level: { rookie: v('lvl-rookie'), pro: v('lvl-pro'), legend: v('lvl-legend'), elite: v('lvl-elite') },
    },
    fontFamily: {
      display: 'var(--st-font-display)',
      sans: 'var(--st-font-text)',
      serif: 'var(--st-font-serif)',
    },
    fontSize: {
      '2xs': ['var(--st-text-2xs)', { lineHeight: '1.3' }],
      xs: ['var(--st-text-xs)', { lineHeight: '1.35' }],
      sm: ['var(--st-text-sm)', { lineHeight: '1.4' }],
      base: ['var(--st-text-base)', { lineHeight: 'var(--st-leading-body)' }],
      md: ['var(--st-text-md)', { lineHeight: '1.45' }],
      lg: ['var(--st-text-lg)', { lineHeight: '1.3' }],
      xl: ['var(--st-text-xl)', { lineHeight: '1.15', letterSpacing: 'var(--st-tracking-title)' }],
      '2xl': ['var(--st-text-2xl)', { lineHeight: '1.1', letterSpacing: 'var(--st-tracking-display)' }],
      '3xl': ['var(--st-text-3xl)', { lineHeight: '1.06', letterSpacing: 'var(--st-tracking-display)' }],
      '4xl': ['var(--st-text-4xl)', { lineHeight: 'var(--st-leading-tight)', letterSpacing: 'var(--st-tracking-display)' }],
      '5xl': ['var(--st-text-5xl)', { lineHeight: '1', letterSpacing: 'var(--st-tracking-display)' }],
    },
    fontWeight: {
      normal: 'var(--st-weight-regular)',
      medium: 'var(--st-weight-medium)',
      semibold: 'var(--st-weight-semibold)',
      bold: 'var(--st-weight-bold)',
      heavy: 'var(--st-weight-heavy)',
      black: '900',
    },
    letterSpacing: {
      wordmark: 'var(--st-tracking-wordmark)',
      display: 'var(--st-tracking-display)',
      title: 'var(--st-tracking-title)',
      body: 'var(--st-tracking-body)',
      normal: '0',
      caps: 'var(--st-tracking-caps)',
    },
    borderRadius: {
      none: '0',
      xs: 'var(--st-r-xs)',
      sm: 'var(--st-r-sm)',
      DEFAULT: 'var(--st-r-sm)',
      md: 'var(--st-r-md)',
      lg: 'var(--st-r-lg)',
      xl: 'var(--st-r-xl)',
      '2xl': 'var(--st-r-2xl)',
      '3xl': 'var(--st-r-3xl)',
      full: 'var(--st-r-pill)',
    },
    boxShadow: {
      none: 'none',
      xs: 'var(--st-shadow-xs)',
      sm: 'var(--st-shadow-sm)',
      DEFAULT: 'var(--st-shadow-md)',
      md: 'var(--st-shadow-md)',
      card: 'var(--st-shadow-card)',
      float: 'var(--st-shadow-float)',
      inset: 'var(--st-shadow-inset)',
      sticker: 'var(--st-shadow-sticker)',
      focus: 'var(--st-focus)',
    },
    zIndex: {
      auto: 'auto',
      0: 'var(--st-z-base)',
      raised: 'var(--st-z-raised)',
      sticky: 'var(--st-z-sticky)',
      tabbar: 'var(--st-z-tabbar)',
      overlay: 'var(--st-z-overlay)',
      sheet: 'var(--st-z-sheet)',
      toast: 'var(--st-z-toast)',
      max: 'var(--st-z-max)',
    },
    transitionDuration: {
      DEFAULT: 'var(--st-dur-base)',
      instant: 'var(--st-dur-instant)',
      fast: 'var(--st-dur-fast)',
      base: 'var(--st-dur-base)',
      slow: 'var(--st-dur-slow)',
      slower: 'var(--st-dur-slower)',
    },
    transitionTimingFunction: {
      DEFAULT: 'var(--st-ease-out)',
      out: 'var(--st-ease-out)',
      'in-out': 'var(--st-ease-in-out)',
      in: 'var(--st-ease-in)',
      spring: 'var(--st-ease-spring)',
      linear: 'linear',
    },
    extend: {
      spacing: {
        gutter: 'var(--st-gutter)',
        tap: 'var(--st-tap)',
        tabbar: 'var(--st-tabbar-h)',
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-t': 'env(safe-area-inset-top)',
      },
      minHeight: { tap: 'var(--st-tap)' },
      minWidth: { tap: 'var(--st-tap)' },
      backgroundImage: {
        'dark-grad': 'var(--st-dark-grad)',
        grain: 'var(--st-grain)',
      },
      maxWidth: { app: '480px' },
    },
  },
  plugins: [],
};
