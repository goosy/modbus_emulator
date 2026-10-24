import assert from "node:assert/strict";
import test from "node:test";
import { Modbus_Client } from "es-modbus";
import { Ldata } from "layout-data";
import * as dist from "../dist/modbus_emulator.js";
import * as src from "../src/index.js";
import { HOST, listening_port } from "./helpers.js";

// The package exports the bundle, while the other tests import src: this smoke test checks
// that the bundle has the same interface, keeps its dependencies external and serves a master.
// register_layout can succeed only once per process, so this is a file of its own.

test("the bundle exports what src exports", () => {
	assert.deepEqual(Object.keys(dist).sort(), Object.keys(src).sort());
});

test("the bundle uses the one copy of layout-data", () => {
	assert.equal(dist.Ldata, Ldata);
});

test("an emulator built from the bundle serves a master", async (t) => {
	const emulator = new dist.Modbus_Emulator({
		layouts: { ONE: [{ name: "a", type: "UInt", offset: 0, init_value: 5 }] },
		blocks: [{ name: "one", unit_id: 1, layout: "ONE" }],
		servers: [{ protocol: "tcp", host: HOST, port: 0 }],
	});
	await emulator.start();
	t.after(() => emulator.stop());
	const master = new Modbus_Client(HOST, { port: listening_port(emulator.servers[0]), reconnect_time: 0 });
	master.on("error", () => { });
	t.after(() => master.disconnect());

	assert.equal((await master.read([3, 0, 1], 1)).readUInt16BE(0), 5);
	assert.ok(emulator.block("one") instanceof Ldata);
});
