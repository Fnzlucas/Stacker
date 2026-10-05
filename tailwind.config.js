import stacker from './design/tailwind.preset.js';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [stacker],
  content: ['./src/**/*.{ts,tsx}'],
  // Classes construites dynamiquement (index d'animation ransom, taille du logo, niveau).
  safelist: [{ pattern: /^ri-([0-9]|1[0-9]|2[0-3])$/ }, { pattern: /^logo-size-(28|32|34|40)$/ }, { pattern: /^level-(rookie|pro|legend|elite)$/ }],
};
