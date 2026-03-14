import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Disable overly aggressive react-hooks rules that flag intentional patterns:
    // - set-state-in-effect: flags async callbacks and intentional synchronous resets
    //   (e.g., reset timer on transition, flatten waveform bars, kick off async pipeline)
    //   These are correct patterns — the rule cannot distinguish async setState from sync.
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
