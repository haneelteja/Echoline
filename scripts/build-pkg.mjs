#!/usr/bin/env node
// Bundles a workspace package's entry point to dist/index.js (plain ESM,
// runnable by plain `node`, no ts-node/tsx needed). Dependencies are left
// external (resolved from node_modules at runtime) — only the package's own
// relative-import source files get bundled together. Type declarations are
// generated separately via `tsc --emitDeclarationOnly` (see each package's
// "build" script) since that doesn't depend on esbuild/rollup at all.
import { build } from "esbuild";

const entry = process.argv[2];
if (!entry) {
  console.error("Usage: build-pkg.mjs <entry-relative-to-cwd>");
  process.exit(1);
}

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/index.js",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});
