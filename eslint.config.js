import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "coverage"]),
  {
    files: ["**/*.{js,jsx}"],
    plugins: { react },
    settings: { react: { version: "detect" } },
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      prettier,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    rules: {
      // jsx-uses-vars marks components referenced only in JSX as used, so
      // no-unused-vars can catch genuinely dead imports without a name pattern.
      "react/jsx-uses-vars": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // HMR hint, not a correctness rule — components.jsx deliberately co-locates helpers.
      "react-refresh/only-export-components": "warn",
      // React Compiler rule; the compiler isn't enabled here and it false-positives
      // on hoisted function references inside effects.
      "react-hooks/immutability": "warn",
    },
  },
]);
