import { rm, copyFile } from "node:fs/promises";
import { build } from "vite";

// Only generated output is removed; the portfolio source stays editable.
await rm(new URL("./dist/", import.meta.url), { recursive: true, force: true });
await build({ base: "/hoopbids/", build: { outDir: "dist/hoopbids" } });
await copyFile(new URL("./portfolio.html", import.meta.url), new URL("./dist/index.html", import.meta.url));
