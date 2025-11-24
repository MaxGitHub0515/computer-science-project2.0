import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import { defineConfig } from "eslint/config";



export default defineConfig([
  // JS/TS files
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    plugins: { js },
    extends: ["js/recommended", tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
  },
  // React TSX/JSX files
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: { react: pluginReact },
    languageOptions: { globals: globals.browser },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      ...pluginReact.configs.flat.recommended.rules,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
]);
