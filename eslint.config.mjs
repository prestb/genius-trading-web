import { defineConfig, globalIgnores } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const compat = new FlatCompat({
baseDirectory: dirname,
});

const eslintConfig = defineConfig([
...compat.extends("next/core-web-vitals", "next/typescript"),
globalIgnores([".next/", "out/", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
