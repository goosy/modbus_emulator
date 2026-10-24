import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { Unit_Map } from "../src/index.js";

/** A stand-in of a Ldata: the unit map only reads its size. */
const block = (name, size) => ({ name, size });

describe("Unit_Map", () => {
	test("keeps the segments of a unit sorted by start, whatever the order of attachment", () => {
		const unit_map = new Unit_Map();
		const [a, b, c] = [block("a", 4), block("b", 4), block("c", 4)];
		unit_map.attach_unit(1, b, 8);
		unit_map.attach_unit(2, c, 0);
		unit_map.attach_unit(1, a, 0);

		assert.deepEqual(unit_map.unit_ids, [1, 2]);
		assert.deepEqual(unit_map.segments(1).map((segment) => [segment.block.name, segment.start, segment.end]), [["a", 0, 4], ["b", 8, 12]]);
		assert.deepEqual(unit_map.segments(3), []);
		assert.equal(unit_map[1], undefined);
	});

	test("resolves a byte of a unit to its block and the byte offset in it", () => {
		const unit_map = new Unit_Map();
		const [a, b] = [block("a", 4), block("b", 8)];
		unit_map.attach_unit(1, a, 0);
		unit_map.attach_unit(1, b, 10, 2); // bytes 2..7 of b at bytes 10..15 of the unit

		assert.deepEqual(unit_map.resolve(1, 3), { block: a, offset: 3 });
		assert.equal(unit_map.resolve(1, 4), null); // the gap
		assert.equal(unit_map.resolve(1, 9), null);
		assert.deepEqual(unit_map.resolve(1, 10), { block: b, offset: 2 });
		assert.deepEqual(unit_map.resolve(1, 15), { block: b, offset: 7 });
		assert.equal(unit_map.resolve(1, 16), null);
		assert.equal(unit_map.resolve(2, 0), null); // a unit without block
	});

	test("start and offset must be even non-negative integers", () => {
		const unit_map = new Unit_Map();

		assert.throws(() => unit_map.attach_unit(1, block("a", 4), 3), { name: "RangeError", message: /start must be an even/ });
		assert.throws(() => unit_map.attach_unit(1, block("a", 4), -2), /start must be an even/);
		assert.throws(() => unit_map.attach_unit(1, block("a", 4), 0, 1), /offset must be an even/);
		assert.throws(() => unit_map.attach_unit(1, block("a", 4), 0, 0.5), /offset must be an even/);
		assert.deepEqual(unit_map.unit_ids, []);
	});
});
