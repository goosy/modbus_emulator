// The unit map that places data blocks at unit ids and byte offsets, and the
// es-modbus server handler that serves them. Writes go through the Ldata
// write methods, so that changes are detected or notified by the Ldata; reads
// go through read_bytes and read_bit. The bytes of a Ldata are never reached directly.
//
// A unit serves the IO buffer of each block in the byte order of the unit
// (doc/spec.md 3): the bytes of the unit are IO bytes, mapped to the bytes of the
// block by the table of the segment.

import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { Modbus_Exception } from "es-modbus";

// the most keys an event of a handler reports, which bounds the set that remembers them
const MAX_REPORTS = 1024;

// the exception code of a refused request
const ILLEGAL_DATA_ADDRESS = 0x02;

/** How a unit answers the reads of its unmapped addresses, the default first. */
export const UNMAPPED_READS = ["zero", "refuse"];

/** How a unit answers the writes of its unmapped addresses, the default first. */
export const UNMAPPED_WRITES = ["ignore", "refuse"];

/** The device byte orders of layout-data (its check_endian is internal). */
export const ENDIANS = ["BE", "LE", "BEBS", "LEBS"];

const DEFAULT_ENDIAN = "BE";

// the bytes of the register being written; write_bytes copies them at once
const REGISTER_BYTES = new Uint8Array(2);

// the table of each segment of a unit whose byte order is not BE: io_to_block[j] is the byte
// of the block served at the IO byte j of the segment. A BE segment has none.
const io_tables = new WeakMap();

/** Builds or drops the table of a segment for a byte order. */
const set_io_table = (segment, endian) => {
	if (endian === DEFAULT_ENDIAN) {
		io_tables.delete(segment);
		return;
	}
	// block byte i is the IO byte table[i]
	const table = segment.block.layout.io_index_table(endian);
	const io_to_block = new Int32Array(table.length);
	for (let i = 0; i < table.length; i++) io_to_block[table[i]] = i;
	io_tables.set(segment, io_to_block);
};

/** The read-only declarations that are not a list of tag names, the default first. */
export const READONLY_VALUES = ["none", "all"];

// the read-only mask of each segment declared read-only, in the bytes of its block (doc/design.md 2)
const readonly_masks = new WeakMap();

/**
 * The violations of a read-only declaration against a layout: none, all, or a non-empty list of
 * distinct tag names of the layout.
 *
 * @param {unknown} readonly - The declaration.
 * @param {import('layout-data').Layout} layout - The layout of the block.
 * @return {string[]} Empty for a valid declaration.
 */
export function readonly_errors(readonly, layout) {
	if (READONLY_VALUES.includes(readonly)) return [];
	if (!Array.isArray(readonly) || readonly.length === 0) {
		return ["readonly must be none, all or a non-empty list of tag names"];
	}
	const names = new Set(layout.items.map(({ name }) => name));
	const errors = [];
	const seen = new Set();
	for (const name of readonly) {
		if (typeof name !== "string") errors.push(`readonly has ${String(name)}, which is not a tag name`);
		else if (seen.has(name)) errors.push(`readonly names tag ${name} twice`);
		else if (!names.has(name)) errors.push(`readonly names tag ${name}, which layout ${layout.name} does not have`);
		seen.add(name);
	}
	return errors;
}

/**
 * Builds the read-only mask of a block: every bit for all; for a list of tag names, the bit of a Bool
 * and every bit of the bytes of another tag.
 */
const build_mask = (readonly, block) => {
	const mask = new Uint8Array(block.size);
	if (readonly === "all") return mask.fill(0xff);
	for (const name of readonly) {
		const { offset, length } = block.get(name).item;
		if (length === 1) mask[offset >> 3] |= 1 << (offset % 8);
		else mask.fill(0xff, offset >> 3, ((offset + length - 1) >> 3) + 1);
	}
	return mask;
};

/** The segment that holds a byte of a unit and the IO offset of the byte in its block, or null. */
const locate = (unit_map, unit_id, byte) => {
	const segments = unit_map.segments(unit_id);
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
	return { segment, offset: byte - segment.start + segment.offset };
};

const NOT_MAPPED = Object.freeze({ block: null, offset: -1, swapped: false, readonly: false });

/**
 * Locates a register: the block, the offset in it of the register of the block that holds its
 * two bytes, whether the two bytes are swapped (doc/design.md 2), and whether a bit of it is read-only.
 */
const get_register_info = (addr, unit_map, unit_id) => {
	const place = locate(unit_map, unit_id, addr * 2);
	if (place === null) return NOT_MAPPED;
	const { segment, segment: { block } } = place;
	const table = io_tables.get(segment);
	let { offset } = place;
	let swapped = false;
	if (table !== undefined) {
		const first = table[offset];
		const second = table[offset + 1];
		offset = Math.min(first, second);
		swapped = first > second;
	}
	const mask = readonly_masks.get(segment);
	const readonly = mask !== undefined && (mask[offset] | mask[offset + 1]) !== 0;
	return { block, offset, swapped, readonly };
};

/**
 * Locates a coil: the block, the offset in it of the byte that holds the coil, its bit mask, and whether
 * it is read-only.
 */
const get_coil_info = (addr, unit_map, unit_id) => {
	const place = locate(unit_map, unit_id, addr >> 3);
	if (place === null) return NOT_MAPPED;
	const table = io_tables.get(place.segment);
	const offset = table === undefined ? place.offset : table[place.offset];
	const bit_mask = 1 << (addr % 8);
	const mask = readonly_masks.get(place.segment);
	const readonly = mask !== undefined && (mask[offset] & bit_mask) !== 0;
	return { block: place.segment.block, offset, bit_mask, readonly };
};

/** The value of a register from its two bytes of a block at index, swapped or not. */
const decode = (bytes, index, swapped) => (swapped ? bytes.readUInt16LE(index) : bytes.readUInt16BE(index));

/**
 * Splits the registers of one request into runs: consecutive registers held by one block at
 * consecutive offsets, all swapped or all not. run.index: the index of its first register in the
 * request. An unmapped register belongs to no run, and is listed in `unmapped`; a read-only one is
 * listed in `readonly` too.
 */
const register_runs = (addr, quantity, unit_map, unit_id) => {
	const runs = [];
	const unmapped = [];
	const readonly = [];
	let run = null;
	for (let i = 0; i < quantity; i++) {
		const info = get_register_info(addr + i, unit_map, unit_id);
		const { block, offset, swapped } = info;
		if (block == null) {
			unmapped.push(addr + i);
			run = null;
			continue;
		}
		if (info.readonly) readonly.push(addr + i);
		if (run?.block === block && run.swapped === swapped && run.offset + run.count * 2 === offset) {
			run.count++;
		} else {
			run = { block, offset, swapped, index: i, count: 1 };
			runs.push(run);
		}
	}
	return { runs, unmapped, readonly };
};

/**
 * Locates the coils of one request: the block, the byte offset in it and the bit mask of each
 * mapped coil. point.index: its index in the request. An unmapped coil is left out, and listed in
 * `unmapped`; a read-only one is listed in `readonly` too.
 */
const coil_points = (addr, quantity, unit_map, unit_id) => {
	const points = [];
	const unmapped = [];
	const readonly = [];
	for (let i = 0; i < quantity; i++) {
		const { block, offset, bit_mask, readonly: is_readonly } = get_coil_info(addr + i, unit_map, unit_id);
		if (block == null) {
			unmapped.push(addr + i);
			continue;
		}
		if (is_readonly) readonly.push(addr + i);
		points.push({ block, offset, bit_mask, index: i });
	}
	return { points, unmapped, readonly };
};

/**
 * The points of one single-point request, in the shape of register_runs and coil_points; the read-only
 * point of a read is readable, so it is not listed.
 */
const single_point = (addr, { block, readonly }, operation) => ({
	unmapped: block == null ? [addr] : [],
	readonly: readonly && operation === "write" ? [addr] : [],
});

/**
 * Creates the reporter of an event of a handler: it emits `{ kind, unit_id, addr, operation }` once per
 * key, for at most MAX_REPORTS keys, then the limit event once.
 */
const create_reporter = (handler, event, limit_event) => {
	const reported = new Set();
	return (kind, unit_id, addr, operation) => {
		const key = `${kind}:${unit_id}:${addr}:${operation}`;
		if (reported.has(key) || reported.size >= MAX_REPORTS) return;
		reported.add(key);
		handler.emit(event, { kind, unit_id, addr, operation });
		if (reported.size === MAX_REPORTS) handler.emit(limit_event, { limit: MAX_REPORTS });
	};
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
 *   set_holding_registers, set_coils. It emits `unmapped` and `request_refused` with
 *   `{ kind, unit_id, addr, operation }` once per key, for at most 1024 keys each, then `unmapped_limit` /
 *   `request_refused_limit` with `{ limit }` once, and `listener_error` with `{ block, error }` for an error a
 *   block listener throws when a write or a batch read commits. A refused request throws a Modbus_Exception(0x02).
 */
export function create_handler(unit_map) {
	const handler = new EventEmitter();
	// An unmapped address (e.g. the gap between two data blocks of a unit) reads as 0 and
	// ignores writes by default, so that a block read spanning the gap still succeeds.
	const report_unmapped = create_reporter(handler, "unmapped", "unmapped_limit");
	const report_refused = create_reporter(handler, "request_refused", "request_refused_limit");

	/**
	 * Admits a request before it reads or writes anything: refuses it with 0x02 when it writes a read-only
	 * point, or reaches an unmapped point of a unit that refuses them, emitting each such point; otherwise
	 * emits its unmapped points.
	 */
	const admit = (kind, operation, unit_id, { unmapped, readonly }) => {
		const policy = operation === "read" ? unit_map.get_unmapped_read(unit_id) : unit_map.get_unmapped_write(unit_id);
		const refused = policy === "refuse" ? [...readonly, ...unmapped].sort((a, b) => a - b) : readonly;
		if (refused.length > 0) {
			for (const addr of refused) report_refused(kind, unit_id, addr, operation);
			throw new Modbus_Exception(ILLEGAL_DATA_ADDRESS, `unit ${unit_id}: ${operation} of ${kind} ${refused[0]} refused`);
		}
		for (const addr of unmapped) report_unmapped(kind, unit_id, addr, operation);
	};

	const read_register = (kind) => (addr, unit_id) => {
		const info = get_register_info(addr, unit_map, unit_id);
		admit(kind, "read", unit_id, single_point(addr, info, "read"));
		if (info.block == null) return 0;
		return decode(info.block.read_bytes(info.offset, 2), 0, info.swapped);
	};

	const report_listener_error = (block, error) => handler.emit("listener_error", { block, error });

	// one FC 3 / FC 4 request: one read_bytes per run, one access per block
	const read_registers = (kind) => (addr, quantity, unit_id) => {
		const values = new Array(quantity).fill(0);
		const { runs, unmapped } = register_runs(addr, quantity, unit_map, unit_id);
		// the read-only points are readable
		admit(kind, "read", unit_id, { unmapped, readonly: [] });
		in_transactions(blocks_of(runs), () => {
			for (const { block, offset, swapped, index, count } of runs) {
				const bytes = block.read_bytes(offset, count * 2);
				for (let i = 0; i < count; i++) values[index + i] = decode(bytes, i * 2, swapped);
			}
		}, report_listener_error);
		return values;
	};

	return Object.assign(handler, {
		get_input_register: read_register("input_register"),
		get_holding_register: read_register("holding_register"),
		get_input_registers: read_registers("input_register"),
		get_holding_registers: read_registers("holding_register"),
		set_holding_register: (addr, value, unit_id) => {
			const info = get_register_info(addr, unit_map, unit_id);
			admit("holding_register", "write", unit_id, single_point(addr, info, "write"));
			const { block, offset, swapped } = info;
			if (block == null) return;
			REGISTER_BYTES[swapped ? 1 : 0] = value >> 8;
			REGISTER_BYTES[swapped ? 0 : 1] = value & 0xff;
			// one FC 6 request: committed like a batch write, so a listener error is reported, not thrown
			in_transactions([block], () => block.write_bytes(offset, REGISTER_BYTES), report_listener_error);
		},

		// one FC 16 request: written atomically, one write_bytes per run
		set_holding_registers: (addr, values, unit_id) => {
			const { runs, ...listed } = register_runs(addr, values.length, unit_map, unit_id);
			admit("holding_register", "write", unit_id, listed);
			in_transactions(blocks_of(runs), () => {
				for (const { block, offset, swapped, index, count } of runs) {
					const bytes = Buffer.alloc(count * 2);
					for (let i = 0; i < count; i++) {
						if (swapped) bytes.writeUInt16LE(values[index + i], i * 2);
						else bytes.writeUInt16BE(values[index + i], i * 2);
					}
					block.write_bytes(offset, bytes);
				}
			}, report_listener_error);
		},

		get_coil: (addr, unit_id) => {
			const info = get_coil_info(addr, unit_map, unit_id);
			admit("coil", "read", unit_id, single_point(addr, info, "read"));
			if (info.block == null) return false;
			return info.block.read_bit(info.offset, info.bit_mask);
		},

		// one FC 1 / FC 2 request: one read_bit per coil, one access per block naming the Bools read
		get_coils: (addr, quantity, unit_id) => {
			const values = new Array(quantity).fill(false);
			const { points, unmapped } = coil_points(addr, quantity, unit_map, unit_id);
			// the read-only points are readable
			admit("coil", "read", unit_id, { unmapped, readonly: [] });
			in_transactions(blocks_of(points), () => {
				for (const { block, offset, bit_mask, index } of points) values[index] = block.read_bit(offset, bit_mask);
			}, report_listener_error);
			return values;
		},

		set_coil: (addr, value, unit_id) => {
			const info = get_coil_info(addr, unit_map, unit_id);
			admit("coil", "write", unit_id, single_point(addr, info, "write"));
			const { block, offset, bit_mask } = info;
			if (block == null) return;
			// one FC 5 request: committed like a batch write, so a listener error is reported, not thrown
			in_transactions([block], () => block.write_bit(offset, bit_mask, value), report_listener_error);
		},

		// one FC 15 request: written atomically, one write_bit per byte and value
		set_coils: (addr, values, unit_id) => {
			const { points, ...listed } = coil_points(addr, values.length, unit_map, unit_id);
			admit("coil", "write", unit_id, listed);
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
}

const NO_SEGMENTS = Object.freeze([]);

/** Throws unless value is an even non-negative integer: the byte offsets of a unit map are register aligned. */
const check_even = (value, name) => {
	if (!Number.isInteger(value) || value < 0 || value % 2 !== 0) {
		throw new RangeError(`${name} must be an even non-negative byte offset, got ${value}`);
	}
};

/** Throws unless unit_id is an integer from 0 to 255. */
const check_unit_id = (unit_id) => {
	if (!Number.isInteger(unit_id) || unit_id < 0 || unit_id > 255) {
		throw new RangeError(`unit_id must be an integer from 0 to 255, got ${unit_id}`);
	}
};

/** Throws unless value is one of a list of values. */
const check_value = (value, values, name) => {
	if (!values.includes(value)) throw new RangeError(`${name} must be one of ${values.join(", ")}, got ${value}`);
};

/**
 * The data blocks placed per unit id. A unit holds segments: the byte range [start, end) of the
 * unit maps to the IO buffer of a block from its byte `offset`, in the byte order of the unit.
 * The segments of a unit are kept sorted by `start`.
 */
export class Unit_Map {
	#units = new Map();
	// the byte order of each unit set by set_endian
	#endians = new Map();
	// how each unit answers the reads and the writes of its unmapped addresses, set by set_unmapped_*
	#unmapped_reads = new Map();
	#unmapped_writes = new Map();

	/** The unit ids that have a segment, in the order of their first attachment. */
	get unit_ids() {
		return [...this.#units.keys()];
	}

	/**
	 * Sets the byte order of a unit, before or after its blocks are attached.
	 *
	 * @param {number} unit_id - The ID of the unit, from 0 to 255.
	 * @param {import('layout-data').Endian} endian - BE, LE, BEBS or LEBS.
	 * @return {void}
	 * @throws {RangeError} For another unit id or byte order.
	 */
	set_endian(unit_id, endian) {
		check_unit_id(unit_id);
		if (!ENDIANS.includes(endian)) throw new RangeError(`unknown byte order ${endian}: use ${ENDIANS.join(", ")}`);
		this.#endians.set(unit_id, endian);
		for (const segment of this.segments(unit_id)) set_io_table(segment, endian);
	}

	/**
	 * Gets the byte order of a unit, BE until it is set.
	 *
	 * @param {number} unit_id
	 * @return {import('layout-data').Endian}
	 */
	get_endian(unit_id) {
		return this.#endians.get(unit_id) ?? DEFAULT_ENDIAN;
	}

	/**
	 * Sets how a unit answers the reads of its unmapped addresses, before or after its blocks are attached.
	 *
	 * @param {number} unit_id - The ID of the unit, from 0 to 255.
	 * @param {"zero"|"refuse"} value - Read 0 / false, or refuse the request with 0x02.
	 * @return {void}
	 * @throws {RangeError} For another unit id or value.
	 */
	set_unmapped_read(unit_id, value) {
		check_unit_id(unit_id);
		check_value(value, UNMAPPED_READS, "unmapped_read");
		this.#unmapped_reads.set(unit_id, value);
	}

	/**
	 * Gets how a unit answers the reads of its unmapped addresses, zero until it is set.
	 *
	 * @param {number} unit_id
	 * @return {"zero"|"refuse"}
	 */
	get_unmapped_read(unit_id) {
		return this.#unmapped_reads.get(unit_id) ?? UNMAPPED_READS[0];
	}

	/**
	 * Sets how a unit answers the writes of its unmapped addresses, before or after its blocks are attached.
	 *
	 * @param {number} unit_id - The ID of the unit, from 0 to 255.
	 * @param {"ignore"|"refuse"} value - Ignore the write, or refuse the request with 0x02.
	 * @return {void}
	 * @throws {RangeError} For another unit id or value.
	 */
	set_unmapped_write(unit_id, value) {
		check_unit_id(unit_id);
		check_value(value, UNMAPPED_WRITES, "unmapped_write");
		this.#unmapped_writes.set(unit_id, value);
	}

	/**
	 * Gets how a unit answers the writes of its unmapped addresses, ignore until it is set.
	 *
	 * @param {number} unit_id
	 * @return {"ignore"|"refuse"}
	 */
	get_unmapped_write(unit_id) {
		return this.#unmapped_writes.get(unit_id) ?? UNMAPPED_WRITES[0];
	}

	/**
	 * The segments of a unit, sorted by start; empty for a unit without block.
	 * The array is the one of the unit map: read it only.
	 *
	 * @param {number} unit_id
	 * @return {ReadonlyArray<{block: import('layout-data').Ldata, start: number, offset: number, end: number,
	 *     readonly: "none" | "all" | readonly string[]}>}
	 */
	segments(unit_id) {
		return this.#units.get(unit_id) ?? NO_SEGMENTS;
	}

	/**
	 * Finds the block that holds a byte of a unit.
	 *
	 * @param {number} unit_id
	 * @param {number} byte - The byte offset in the unit.
	 * @return {{block: import('layout-data').Ldata, offset: number} | null} The block and the byte offset in its IO
	 *     buffer; null for an unmapped byte.
	 */
	resolve(unit_id, byte) {
		const place = locate(this, unit_id, byte);
		return place && { block: place.segment.block, offset: place.offset };
	}

	/**
	 * Attaches a block to a unit: bytes [start, start + block.size - offset) of the unit map to
	 * the bytes of the IO buffer of the block from `offset`, in the byte order of the unit.
	 *
	 * @param {number} unit_id - The ID of the unit, from 0 to 255.
	 * @param {import('layout-data').Ldata} block - The data block.
	 * @param {Object} [options]
	 * @param {number} [options.start=0] - The byte offset in the unit, even.
	 * @param {number} [options.offset=0] - The byte offset in the block, even.
	 * @param {"none"|"all"|string[]} [options.readonly="none"] - All for the whole block, or the read-only tags.
	 * @return {void}
	 * @throws {RangeError} When unit_id is not an integer from 0 to 255, start or offset is not an even
	 *     non-negative integer, offset is not below the block size, or readonly is not valid.
	 * @throws {Error} When the bytes overlap the ones of another block of the unit.
	 */
	attach_unit(unit_id, block, { start = 0, offset = 0, readonly = READONLY_VALUES[0] } = {}) {
		check_unit_id(unit_id);
		check_even(start, "start");
		check_even(offset, "offset");
		if (offset >= block.size) {
			throw new RangeError(`block ${block.name}: offset ${offset} must be below the block size ${block.size}`);
		}
		const [error] = readonly_errors(readonly, block.layout);
		if (error !== undefined) throw new RangeError(`block ${block.name}: ${error}`);
		if (Array.isArray(readonly)) readonly = Object.freeze([...readonly]);
		const segment = { block, start, offset, end: block.size - offset + start, readonly };
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
		set_io_table(segment, this.get_endian(unit_id));
		if (readonly !== READONLY_VALUES[0]) readonly_masks.set(segment, build_mask(readonly, block));
		segments.splice(index, 0, segment);
		this.#units.set(unit_id, segments);
	}
}
