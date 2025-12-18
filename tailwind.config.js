/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'gl-bg': '#1a1a1a',
        'gl-header': '#2d2d2d',
        'widget-bg': '#252525',
      },
    },
  },
  plugins: [],
}
