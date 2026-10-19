// Run by `npm version <patch|minor|major>`: copies the new package version into manifest.json
// and records which Obsidian version it needs in versions.json.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
	console.error("Run this through `npm version`, which sets npm_package_version.");
	process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = manifest.minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, 2)}\n`);
