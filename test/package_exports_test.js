import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import * as pkg from "modbus_emulator";
import * as src from "../src/index.js";

// The other tests import src: this test imports the package by its own name, so a wrong
// `exports` entry in package.json is found before publishing.

test("the package name resolves to src", () => {
	assert.deepEqual(Object.keys(pkg).sort(), Object.keys(src).sort());
	for (const name of Object.keys(src)) assert.equal(pkg[name], src[name], name);
});

test("the declarations of the package exist", () => {
	const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
	const types = manifest.exports["."].types;
	assert.ok(existsSync(new URL(`../${types}`, import.meta.url)), types);
});
