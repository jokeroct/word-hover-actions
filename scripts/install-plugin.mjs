// Copies the built plugin into a vault: node scripts/install-plugin.mjs [path/to/vault]
// Defaults to ./dev-vault. Run `npm run build` first.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const vault = resolve(process.argv[2] ?? join(root, "dev-vault"));
const { id } = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

if (!existsSync(join(vault, ".obsidian"))) {
	console.error(`No .obsidian folder in ${vault}. Open the folder as a vault in Obsidian once, then rerun.`);
	process.exit(1);
}
if (!existsSync(join(root, "main.js"))) {
	console.error("main.js is missing. Run `npm run build` first.");
	process.exit(1);
}

const target = join(vault, ".obsidian", "plugins", id);
mkdirSync(target, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) copyFileSync(join(root, file), join(target, file));
console.log(`Installed ${id} into ${target}`);
