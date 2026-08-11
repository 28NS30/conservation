import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships native flat configs, so no FlatCompat bridge —
 * routing them through @eslint/eslintrc throws on ESLint 9.39.
 */
export default [
  {
    ignores: [
      ".next/**",
      "public/maplibre/**", // vendored dist build, not ours to lint
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Unused imports and variables are the rot linting is actually for here.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  {
    // Config files idiomatically export an anonymous object/array.
    files: ["*.config.mjs", "*.config.ts"],
    rules: { "import/no-anonymous-default-export": "off" },
  },
  {
    // Test and e2e scripts are plain Node ESM, not Next app code.
    files: ["test/**/*.mjs", "e2e/**/*.mjs"],
    rules: { "@typescript-eslint/no-unused-vars": "off", "@next/next/no-assign-module-variable": "off" },
  },
];
