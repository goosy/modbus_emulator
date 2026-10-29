import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import * as pkg from "modbus-emulator";
import * as src from "../src/index.js";

// The other tests run against src or the bundle (test/target.js): this test checks the
// bundling itself, so a wrong `exports` entry in package.json or a bundled dependency is
// found before publishing.

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const { types, default: entry } = manifest.exports["."];

test("exports points to the files of dist", () => {
	assert.equal(entry, "./dist/index.js");
	assert.equal(types, "./dist/index.d.ts");
	assert.ok(existsSync(new URL(`../${entry}`, import.meta.url)), entry);
	assert.ok(existsSync(new URL(`../${types}`, import.meta.url)), types);
});

test("the declarations are those of src", () => {
	const copy = readFileSync(new URL(`../${types}`, import.meta.url), "utf8");
	assert.equal(copy, readFileSync(new URL("../src/index.d.ts", import.meta.url), "utf8"));
});

test("the bundle exports the names of the entry of src", () => {
	assert.deepEqual(Object.keys(pkg).sort(), Object.keys(src).sort());
	// the forwarded API of layout-data is the one copy of the process
	for (const name of ["Ldata", "Ltag", "create_scope", "get_scope", "yaml", "desc_file"]) {
		assert.equal(pkg[name], src[name], name);
	}
});

test("the bundle imports only the dependencies and built-in modules", () => {
	const code = readFileSync(new URL(`../${entry}`, import.meta.url), "utf8");
	const specifiers = [...code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*"([^"]+)"/gm)].map((match) => match[1]);
	assert.ok(specifiers.length > 0);
	for (const specifier of specifiers) {
		assert.ok(["layout-data", "es-modbus"].includes(specifier) || specifier.startsWith("node:"), specifier);
	}
});
