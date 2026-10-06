/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        jungle: {
          900: '#07160d',
          800: '#0e2b1b',
          700: '#17472d',
          600: '#226943',
          500: '#2f945e',
          accent: '#10b981',
          gold: '#f59e0b',
          ghost: '#60a5fa',
        }
      },
      fontFamily: {
        game: ['Outfit', 'Inter', 'sans-serif']
      }
    },
  },
  plugins: [],
}
