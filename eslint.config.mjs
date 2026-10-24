import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Server-only modules (admin client, crypto, env) import "server-only", which
// makes any accidental client-side import a build error.
const config = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // `_`-prefixed names mark intentionally unused values (e.g. omitting a key via destructuring).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  // .claude/ holds installed agent skills (third-party bundled scripts), not app code.
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", ".claude/**"] },
];

export default config;
