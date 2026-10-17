import { defineConfig } from "rolldown";
import pkg from "./package.json" with { type: "json" };

// This package is a dependency of other packages, so it is not an application bundle:
// all its dependencies stay external, and the final application bundles them once.
export default defineConfig({
	input: "src/index.js",
	platform: "node",
	external: Object.keys(pkg.dependencies),
	output: {
		file: "dist/modbus_emulator.js",
		format: "es",
	},
});
