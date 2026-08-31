// ESLint, added 30 August 2026.
//
// This project had no linter for its whole life. That is not as odd as it
// sounds -- it began as flat HTML published by GitHub Pages -- but it stopped
// making sense the day it grew server actions, a database and payments. The
// class of mistake a linter catches is exactly the class that survives a
// careful read: a hook called conditionally, a variable used before it exists,
// a dependency array quietly missing the thing it depends on.
//
// `next/core-web-vitals` is the Next.js team's own preset. Deliberately not
// something stricter: a linter that shouts about style on a volunteer's
// Saturday afternoon is a linter that gets switched off, and the point is to
// keep it switched on.
//
// Flat config (eslint.config.mjs) rather than .eslintrc, because ESLint 9
// requires it. FlatCompat is the bridge that lets the flat file consume
// eslint-config-next, which is still written in the old format.
//
// Run it with `npm run lint`. `npm run lint:fix` fixes what is safely
// fixable. Neither is wired into a git hook on purpose -- see the note in
// .github/workflows/build.yml about where checks belong here.

import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

export default [
  {
    // Generated, vendored, or not ours. `supabase/functions` is Deno, not
    // Node: it uses URL imports and a Deno global that this config would flag
    // on every line while being entirely correct for where it runs.
    ignores: [
      '.next/**',
      'node_modules/**',
      'out/**',
      'next-env.d.ts',
      'supabase/functions/**',
    ],
  },
  {
    // ⚠️ DO NOT DELETE THIS BLOCK. Without it, `eslint .` lints nothing that
    // matters.
    //
    // ESLint 9's flat config discovers **/*.js, **/*.mjs and **/*.cjs by
    // default and NOTHING ELSE. This project is JSX: roughly a hundred .jsx
    // components against fifty .js files. On the first run without this block
    // ESLint inspected 50 files, 0 of them .jsx, and reported "0 errors" --
    // which is the worst possible output, because it is indistinguishable
    // from a clean codebase and everybody believes it.
    //
    // Naming .jsx in `files` is what adds it to the discovery set.
    files: ['**/*.{js,mjs,cjs,jsx}'],
  },
  ...compat.extends('next/core-web-vitals'),
  {
    rules: {
      // ON as a warning, not off, and this is the one rule worth explaining.
      //
      // The site serves 127 images from public/ through plain <img> tags, a
      // habit inherited from the GitHub Pages era when `output: 'export'`
      // disabled Next's image optimiser and next/image could not work. That
      // constraint went away on 5 August 2026 and the tags did not.
      //
      // Left as a warning because turning it into an error would fail the
      // build over something that is a real improvement rather than a real
      // bug, and would block every unrelated change until all of it is
      // converted. It stays visible so the conversion is a decision somebody
      // makes, not a warning somebody deleted.
      '@next/next/no-img-element': 'warn',
    },
  },
];
