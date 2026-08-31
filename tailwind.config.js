/** @type {import('tailwindcss').Config} */
module.exports = {
  // lib/ IS scanned, and that is not optional. Tailwind only generates a class
  // it has literally seen in a scanned file, so a helper that RETURNS class
  // names is invisible unless its file is on this list.
  //
  // Added 31 Aug 2026, the day it bit: allergyPill in lib/format.js returns the
  // severity colours for the Dietary page, and every pill rendered grey. The
  // text was right, the logic was right, the classes simply did not exist in
  // the stylesheet — and nothing errors, which is what makes it hard to see.
  // The pill it replaced had been written inline in JSX, so it had always
  // worked.
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './lib/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#2a6f77',
          dark: '#1d4e54',
          light: '#e8f2f3',
          gold: '#d99a2b',
        },
      },
      fontFamily: {
        heading: ['Georgia', 'Cambria', '"Times New Roman"', 'serif'],
        body: ['-apple-system', '"Segoe UI"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
