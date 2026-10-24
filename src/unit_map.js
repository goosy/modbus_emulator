// The unit map that places data blocks at unit ids and byte offsets, and the
// es-modbus server handler that serves them. Writes go through the Ldata
// write methods, so that changes are detected or notified by the Ldata; reads
// go through read_bytes. The bytes of a Ldata are never reached directly.

import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

// the most unmapped addresses reported by a handler, which bounds the set that remembers them
const MAX_UNMAPPED_REPORTS = 1024;

// the bytes of the register being written; write_bytes copies them at once
const REGISTER_BYTES = new Uint8Array(2);

const NOT_MAPPED = Object.freeze({ block: null, offset: -1 });

// return.offset: the byte offset in the block
const get_register_info = (addr, unit_map, unit_id) => unit_map.resolve(unit_id, addr * 2) ?? NOT_MAPPED;

const get_coil_info = (addr, unit_map, unit_id) => {
	const place = unit_map.resolve(unit_id, addr >> 3);
	return place ? { ...place, bit_mask: 1 << (addr % 8) } : NOT_MAPPED;
};

/**
 * Splits the registers of one request into runs: consecutive registers held by one block at
 * consecutive offsets. An unmapped register is passed to `report` and belongs to no run.
 * run.index: the index of its first register in the request.
 */
const register_runs = (addr, quantity, unit_map, unit_id, report) => {
	const runs = [];
	let run = null;
	for (let i = 0; i < quantity; i++) {
		const { block, offset } = get_register_info(addr + i, unit_map, unit_id);
		if (block == null) {
			report(addr + i);
			run = null;
		} else if (run?.block === block && run.offset + run.count * 2 === offset) {
			run.count++;
		} else {
			run = { block, offset, index: i, count: 1 };
			runs.push(run);
		}
	}
	return runs;
};

/**
 * Locates the coils of one request: the block, the byte offset in it and the bit mask of each
 * mapped coil. An unmapped coil is passed to `report` and left out. point.index: its index in the request.
 */
const coil_points = (addr, quantity, unit_map, unit_id, report) => {
	const points = [];
	for (let i = 0; i < quantity; i++) {
		const { block, offset, bit_mask } = get_coil_info(addr + i, unit_map, unit_id);
		if (block == null) report(addr + i);
		else points.push({ block, offset, bit_mask, index: i });
	}
	return points;
};

/** The distinct blocks of runs or points, in the order of the addresses. */
const blocks_of = (parts) => [...new Set(parts.map(({ block }) => block))];

/**
 * Runs fn in the transactions of blocks, nested with the last block outermost: the inner ones
 * commit first, so the events follow the addresses. When fn throws, every block rolls back and
 * the error is thrown. The error a listener throws at the commit of a block (transaction rethrows
 * the first one) is passed to `report` once fn is done: it undoes nothing and does not stop the
 * commit of the other blocks.
 */
const in_transactions = (blocks, fn, report) => {
	let done = false;
	const nest = (i) => {
		if (i < 0) {
			fn();
			done = true;
			return;
		}
		const block = blocks[i];
		try {
			block.transaction(() => nest(i - 1));
		} catch (error) {
			if (!done) throw error;
			report(block, error);
		}
	};
	nest(blocks.length - 1);
};

/**
 * Creates the es-modbus server handler that serves the data blocks of a unit map.
 *
 * @param {Unit_Map} unit_map - The data blocks attached per unit id.
 * @return {EventEmitter} The handler: get_input_register, get_holding_register, set_holding_register,
 *   get_coil, set_coil, and the batch methods get_input_registers, get_holding_registers, get_coils,
 *   set_holding_registers, set_coils. It emits `unmapped` with `{ kind, unit_id, addr }` once per unmapped
 *   address, `unmapped_limit` with `{ limit }` when no further one is emitted, and `listener_error` with
 *   `{ block, error }` for an error a block listener throws when a batch request commits.
 */
export function create_handler(unit_map) {
	// An unmapped address (e.g. the gap between two data blocks of a unit)
	// reads as 0 and ignores writes, so that a block read spanning the gap
	// still succeeds. Each one is emitted once, up to MAX_UNMAPPED_REPORTS of them.
	const reported = new Set();
	const report_unmapped = (kind, addr, unit_id) => {
		const key = `${kind}:${unit_id}:${addr}`;
		if (reported.has(key)) return;
		if (reported.size >= MAX_UNMAPPED_REPORTS) return;
		reported.add(key);
		handler.emit("unmapped", { kind, unit_id, addr });
		if (reported.size === MAX_UNMAPPED_REPORTS) handler.emit("unmapped_limit", { limit: MAX_UNMAPPED_REPORTS });
	};

	const read_register = (kind) => (addr, unit_id) => {
		const { block, offset } = get_register_info(addr, unit_map, unit_id);
		if (block == null) {
			report_unmapped(kind, addr, unit_id);
			return 0;
		}
		return block.read_bytes(offset, 2).readUInt16BE(0);
	};

	const report_listener_error = (block, error) => handler.emit("listener_error", { block, error });

	// one FC 3 / FC 4 request: one read_bytes per run, one access per block
	const read_registers = (kind) => (addr, quantity, unit_id) => {
		const values = new Array(quantity).fill(0);
		const report = (unmapped) => report_unmapped(kind, unmapped, unit_id);
		const runs = register_runs(addr, quantity, unit_map, unit_id, report);
		in_transactions(blocks_of(runs), () => {
			for (const { block, offset, index, count } of runs) {
				const bytes = block.read_bytes(offset, count * 2);
				for (let i = 0; i < count; i++) values[index + i] = bytes.readUInt16BE(i * 2);
			}
		}, report_listener_error);
		return values;
	};

	const handler = Object.assign(new EventEmitter(), {
		get_input_register: read_register("input_register"),
		get_holding_register: read_register("holding_register"),
		get_input_registers: read_registers("input_register"),
		get_holding_registers: read_registers("holding_register"),
		set_holding_register: (addr, value, unit_id) => {
			const { block, offset } = get_register_info(addr, unit_map, unit_id);
			if (block == null) {
				report_unmapped("holding_register", addr, unit_id);
				return;
			}
			REGISTER_BYTES[0] = value >> 8;
			REGISTER_BYTES[1] = value & 0xff;
			block.write_bytes(offset, REGISTER_BYTES);
		},

		// one FC 16 request: written atomically, one write_bytes per run
		set_holding_registers: (addr, values, unit_id) => {
			const report = (unmapped) => report_unmapped("holding_register", unmapped, unit_id);
			const runs = register_runs(addr, values.length, unit_map, unit_id, report);
			in_transactions(blocks_of(runs), () => {
				for (const { block, offset, index, count } of runs) {
					const bytes = Buffer.alloc(count * 2);
					for (let i = 0; i < count; i++) bytes.writeUInt16BE(values[index + i], i * 2);
					block.write_bytes(offset, bytes);
				}
			}, report_listener_error);
		},

		get_coil: (addr, unit_id) => {
			const { block, offset, bit_mask } = get_coil_info(addr, unit_map, unit_id);
			if (block == null) {
				report_unmapped("coil", addr, unit_id);
				return false;
			}
			return (block.read_bytes(offset, 1)[0] & bit_mask) > 0;
		},

		// one FC 1 / FC 2 request: one read_bit per coil, one access per block naming the Bools read
		get_coils: (addr, quantity, unit_id) => {
			const values = new Array(quantity).fill(false);
			const report = (unmapped) => report_unmapped("coil", unmapped, unit_id);
			const points = coil_points(addr, quantity, unit_map, unit_id, report);
			in_transactions(blocks_of(points), () => {
				for (const { block, offset, bit_mask, index } of points) values[index] = block.read_bit(offset, bit_mask);
			}, report_listener_error);
			return values;
		},

		set_coil: (addr, value, unit_id) => {
			const { block, offset, bit_mask } = get_coil_info(addr, unit_map, unit_id);
			if (block == null) {
				report_unmapped("coil", addr, unit_id);
				return;
			}
			block.write_bit(offset, bit_mask, value);
		},

		// one FC 15 request: written atomically, one write_bit per byte and value
		set_coils: (addr, values, unit_id) => {
			const report = (unmapped) => report_unmapped("coil", unmapped, unit_id);
			const points = coil_points(addr, values.length, unit_map, unit_id, report);
			// the coils of one byte: the mask of the bits set and of the bits cleared
			const bytes = [];
			for (const { block, offset, bit_mask, index } of points) {
				let byte = bytes.at(-1);
				if (byte?.block !== block || byte.offset !== offset) {
					byte = { block, offset, set: 0, clear: 0 };
					bytes.push(byte);
				}
				if (values[index]) byte.set |= bit_mask;
				else byte.clear |= bit_mask;
			}
			in_transactions(blocks_of(points), () => {
				for (const { block, offset, set, clear } of bytes) {
					if (set) block.write_bit(offset, set, true);
					if (clear) block.write_bit(offset, clear, false);
				}
			}, report_listener_error);
		},
	});
	return handler;
}

const NO_SEGMENTS = Object.freeze([]);

/** Throws unless value is an even non-negative integer: the byte offsets of a unit map are register aligned. */
const check_even = (value, name) => {
	if (!Number.isInteger(value) || value < 0 || value % 2 !== 0) {
		throw new RangeError(`${name} must be an even non-negative byte offset, got ${value}`);
	}
};

/**
 * The data blocks placed per unit id. A unit holds segments: the byte range [start, end) of the
 * unit maps to the bytes of a block from its byte `offset`. The segments of a unit are kept
 * sorted by `start`.
 */
export class Unit_Map {
	#units = new Map();

	/** The unit ids that have a segment, in the order of their first attachment. */
	get unit_ids() {
		return [...this.#units.keys()];
	}

	/**
	 * The segments of a unit, sorted by start; empty for a unit without block.
	 * The array is the one of the unit map: read it only.
	 *
	 * @param {number} unit_id
	 * @return {ReadonlyArray<{block: import('layout-data').Ldata, start: number, offset: number, end: number}>}
	 */
	segments(unit_id) {
		return this.#units.get(unit_id) ?? NO_SEGMENTS;
	}

	/**
	 * Finds the block that holds a byte of a unit.
	 *
	 * @param {number} unit_id
	 * @param {number} byte - The byte offset in the unit.
	 * @return {{block: import('layout-data').Ldata, offset: number} | null} The block and the byte offset in it; null for an unmapped byte.
	 */
	resolve(unit_id, byte) {
		const segments = this.segments(unit_id);
		// the last segment that starts at or before byte
		let low = 0;
		let high = segments.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (segments[middle].start <= byte) low = middle + 1;
			else high = middle;
		}
		const segment = segments[low - 1];
		if (segment === undefined || byte >= segment.end) return null;
		return { block: segment.block, offset: byte - segment.start + segment.offset };
	}

	/**
	 * Attaches a block to a unit: bytes [start, start + block.size - offset) of the unit map to
	 * the bytes of the block from `offset`.
	 *
	 * @param {number} unit_id - The ID of the unit.
	 * @param {import('layout-data').Ldata} block - The data block.
	 * @param {number} [start=0] - The byte offset in the unit, even.
	 * @param {number} [offset=0] - The byte offset in the block, even.
	 * @return {void}
	 * @throws {RangeError} When start or offset is not an even non-negative integer.
	 * @throws {Error} When the bytes overlap the ones of another block of the unit.
	 */
	attach_unit(unit_id, block, start = 0, offset = 0) {
		check_even(start, "start");
		check_even(offset, "offset");
		const segment = { block, start, offset, end: block.size - offset + start };
		const segments = this.#units.get(unit_id) ?? [];
		let index = segments.length;
		while (index > 0 && segments[index - 1].start > start) index--;
		// the segments are sorted and do not overlap: only the neighbors can overlap the new one
		const [before, after] = [segments[index - 1], segments[index]];
		const other = before?.end > start ? before : after?.start < segment.end ? after : null;
		if (other) {
			const bytes = ({ start, end }) => `bytes ${start}..${end - 1}`;
			throw new Error(`unit ${unit_id}: ${bytes(segment)} of block ${block.name} overlap ${bytes(other)} of block ${other.block.name}`);
		}
		segments.splice(index, 0, segment);
		this.#units.set(unit_id, segments);
	}
}
