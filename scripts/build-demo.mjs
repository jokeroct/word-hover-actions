// Builds the interactive demo into docs/ (served by GitHub Pages). The wheel is the plugin's own
// src/menu.ts and styles.css; `obsidian` is swapped for a small icon shim since there's no app.
import { copyFileSync, mkdirSync } from "node:fs";
import esbuild from "esbuild";

mkdirSync("docs", { recursive: true });

await esbuild.build({
	entryPoints: ["demo/demo.ts"],
	bundle: true,
	format: "iife",
	target: "es2021",
	minify: true,
	legalComments: "eof",
	alias: { obsidian: "./demo/obsidian-shim.ts" },
	outfile: "docs/demo.js",
	logLevel: "info",
});

copyFileSync("demo/index.html", "docs/index.html");
copyFileSync("demo/demo.css", "docs/demo.css");
copyFileSync("styles.css", "docs/styles.css");
console.log("Demo built in docs/");
