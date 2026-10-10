import { defineConfig } from "rolldown";
import pkg from "./package.json" with { type: "json" };

// yaml is a development dependency: it is bundled into the library.
// The runtime dependencies stay external.
export default defineConfig({
	input: "src/index.js",
	platform: "node",
	external: Object.keys(pkg.dependencies),
	output: {
		file: "dist/modbus_emulator.js",
		format: "es",
	},
});
