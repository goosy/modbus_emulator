// The public interface the tests run against (doc/design.md section 5): the entry of src
// by default, or the bundle in dist when test/dist.js is imported first
// (node --test --import ./test/dist.js).
const DIST = process.env.MODBUS_EMULATOR_TEST_TARGET === "dist";

/** "src" or "dist": what the tests run against. */
export const TARGET = DIST ? "dist" : "src";

export const {
	Modbus_Emulator,
	create_tcp_server,
	create_rtu_server,
	Unit_Map,
	create_handler,
	Ldata,
	Ltag,
	create_scope,
	get_scope,
	yaml,
	desc_file,
} = DIST ? await import("modbus-emulator") : await import("../src/index.js");
