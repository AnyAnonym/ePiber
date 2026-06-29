// eslint.config.js
import {defineConfig} from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import googleConfig from "eslint-config-google";

export default defineConfig([
  js.configs.recommended, // Entspricht "eslint:recommended"
  googleConfig, // Entspricht "google" extends
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      "linebreak-style": "off",
      "valid-jsdoc": "off",
      "no-restricted-globals": ["error", "name", "length"],
      "prefer-arrow-callback": "error",
      "quotes": ["error", "double", {allowTemplateLiterals: true}],
      "require-jsdoc": "off",
      "max-len": ["error", {code: 140}],


    },
  },
  {
    files: ["**/*.spec.*"],
    languageOptions: {
      globals: {...globals.mocha},
    },
  },
]);
