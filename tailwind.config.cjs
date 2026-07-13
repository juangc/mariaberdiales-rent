/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './assets/**/*.js'],
  theme: {
    extend: {
      colors: {
        cream: '#f2e5d7',
        ink: '#525252',
        accent: '#fe7700',
        hero: '#939393',
        whatsapp: '#25d366',
      },
      fontFamily: {
        body: ['Hanken Grotesk', 'ui-sans-serif', 'sans-serif'],
        display: ['Big Shoulders Display', 'ui-sans-serif', 'sans-serif'],
        mono: ['Space Mono', 'ui-monospace', 'monospace'],
      },
      screens: {
        wide: '55rem',
      },
      opacity: {
        15: '0.15',
      },
    },
  },
};
