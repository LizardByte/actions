import globals from "globals";
import pluginJs from "@eslint/js";
import pluginJest from "eslint-plugin-jest";

export default [
  pluginJs.configs.recommended,
  {
    ignores: [
      "build/**",
      "coverage/**",
      "node_modules/**",
      "**/node_modules/**",
      "**/__pycache__/**",
      ".venv/**",
      "**/.venv/**",
    ],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["tests/**/*.test.js"],
    ...pluginJest.configs['flat/recommended'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      "jest/no-disabled-tests": "error",
      "jest/no-focused-tests": "error",
      "jest/no-identical-title": "error",
      "jest/prefer-to-have-length": "error",
      "jest/valid-expect": "error",
    },
  },
];
