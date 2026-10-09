import path from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import importPlugin from "eslint-plugin-import";
import simpleImportSort from "eslint-plugin-simple-import-sort";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  globalIgnores(["coverage/*", "dist/*"]),
  importPlugin.flatConfigs.recommended,
  {
    extends: compat.extends(
      "plugin:@typescript-eslint/recommended",
      "prettier",
      "plugin:import/typescript",
    ),

    plugins: {
      "@typescript-eslint": typescriptEslint,
      "simple-import-sort": simpleImportSort,
    },

    settings: {
      "import/resolver": {
        // You will also need to install and configure the TypeScript resolver
        // See also https://github.com/import-js/eslint-import-resolver-typescript#configuration
        typescript: true,
        node: true,
      },
    },

    rules: {
      "@typescript-eslint/no-restricted-types": "warn",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-var-requires": "warn",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-useless-constructor": "error",

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
        },
      ],

      semi: ["error", "always"],

      quotes: [
        "warn",
        "double",
        {
          avoidEscape: true,
        },
      ],

      curly: ["error", "all"],
      "comma-dangle": ["warn", "always-multiline"],
      "no-unused-vars": "off",

      "no-irregular-whitespace": [
        "error",
        {
          skipTemplates: true,
        },
      ],

      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "import/first": "error",
      "import/newline-after-import": "error",
      "import/no-duplicates": "error",
    },
  },
]);
