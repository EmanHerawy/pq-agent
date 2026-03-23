import { copyFileSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  shims: true,
  splitting: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
  async onSuccess() {
    copyFileSync(
      "src/scaffold-templates/secret-add.mjs",
      "dist/secret-add.mjs",
    );
  },
});
