import { readFileSync, rmSync } from "node:fs";
import { defineConfig } from "rolldown";

// The source is bundled into one file (doc/design.md section 5). A library does not
// bundle its dependencies: they and the built-in modules of Node.js stay as imports.
const { dependencies = {} } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const dependency_names = Object.keys(dependencies);

/** Whether an import is left to the user's installation: a dependency (or a subpath of it) or a built-in module. */
function is_external(id) {
	if (id.startsWith("node:")) return true;
	return dependency_names.some((name) => id === name || id.startsWith(`${name}/`));
}

// no product of an earlier build is left in dist
rmSync(new URL("./dist", import.meta.url), { recursive: true, force: true });

/** Emits the hand-written declarations unchanged beside the bundle. */
const declarations = {
	name: "declarations",
	generateBundle() {
		this.emitFile({
			type: "asset",
			fileName: "index.d.ts",
			source: readFileSync(new URL("./src/index.d.ts", import.meta.url), "utf8"),
		});
	},
};

export default defineConfig({
	input: "src/index.js",
	platform: "node",
	external: is_external,
	plugins: [declarations],
	output: {
		dir: "dist",
		entryFileNames: "index.js",
		format: "es",
		codeSplitting: false,
	},
});
