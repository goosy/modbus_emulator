// The unit map that places data blocks at unit ids and byte offsets, and the
// es-modbus server handler that serves them. Writes go through the Ldata
// write methods, so that changes are detected or notified by the Ldata; reads
// go through read_bytes. The bytes of a Ldata are never reached directly.

import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";

const SILENT_LOGGER = { warn() { } };

// the most unmapped addresses reported by a handler, which bounds the set that remembers them
const MAX_UNMAPPED_REPORTS = 1024;

// the bytes of the register being written; write_bytes copies them at once
const REGISTER_BYTES = new Uint8Array(2);

const get_register_info = (addr, units) => {
	const byte_offset = addr * 2;
	for (const { block, start, offset, end } of units ?? []) {
		if (block && byte_offset >= start && byte_offset < end) {
			// return.offset: the byte offset in the block
			return { block, offset: byte_offset + offset - start };
		}
	}
	return { block: null, offset: -1 };
};

const get_coil_info = (addr, units) => {
	const byte_offset = addr >> 3;
	const bit_offset = addr % 8;
	const bit_mask = 1 << bit_offset;
	for (const { block, start, offset, end } of units ?? []) {
		if (block && byte_offset >= start && byte_offset < end) {
			// return.offset: the byte offset in the block
			return { block, offset: byte_offset + offset - start, bit_mask };
		}
	}
	return { block: null, offset: -1 };
};

/**
 * Splits the registers of one request into runs: consecutive registers held by one block at
 * consecutive offsets. An unmapped register is passed to `report` and belongs to no run.
 * run.index: the index of its first register in the request.
 */
const register_runs = (addr, quantity, units, report) => {
	const runs = [];
	let run = null;
	for (let i = 0; i < quantity; i++) {
		const { block, offset } = get_register_info(addr + i, units);
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
const coil_points = (addr, quantity, units, report) => {
	const points = [];
	for (let i = 0; i < quantity; i++) {
		const { block, offset, bit_mask } = get_coil_info(addr + i, units);
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
 * @param {Object} [options]
 * @param {{warn: (message: string) => void}} [options.logger] - Reports unmapped addresses; silent by default.
 * @return {EventEmitter} The handler: get_input_register, get_holding_register, set_holding_register,
 *   get_coil, set_coil, and the batch writes set_holding_registers, set_coils. It emits `listener_error`
 *   with `{ block, error }` for an error a block listener throws when a batch write commits.
 */
export function create_handler(unit_map, { logger = SILENT_LOGGER } = {}) {
	// An unmapped address (e.g. the gap between two data blocks of a unit)
	// reads as 0 and ignores writes, so that a block read spanning the gap
	// still succeeds. Each one is logged once, up to MAX_UNMAPPED_REPORTS of them.
	const reported = new Set();
	const report_unmapped = (kind, addr, unit_id) => {
		const key = `${kind}:${unit_id}:${addr}`;
		if (reported.has(key)) return;
		if (reported.size >= MAX_UNMAPPED_REPORTS) return;
		reported.add(key);
		logger.warn?.(`unmapped ${kind} address ${addr} in unit ${unit_id}`);
		if (reported.size === MAX_UNMAPPED_REPORTS) {
			logger.warn?.(`${MAX_UNMAPPED_REPORTS} unmapped addresses reported, further ones are not reported`);
		}
	};

	const read_register = (kind) => (addr, unit_id) => {
		const { block, offset } = get_register_info(addr, unit_map[unit_id]);
		if (block == null) {
			report_unmapped(kind, addr, unit_id);
			return 0;
		}
		return block.read_bytes(offset, 2).readUInt16BE(0);
	};

	const report_listener_error = (block, error) => handler.emit("listener_error", { block, error });

	const handler = Object.assign(new EventEmitter(), {
		get_input_register: read_register("input register"),
		get_holding_register: read_register("holding register"),
		set_holding_register: (addr, value, unit_id) => {
			const { block, offset } = get_register_info(addr, unit_map[unit_id]);
			if (block == null) {
				report_unmapped("holding register", addr, unit_id);
				return;
			}
			REGISTER_BYTES[0] = value >> 8;
			REGISTER_BYTES[1] = value & 0xff;
			block.write_bytes(offset, REGISTER_BYTES);
		},

		// one FC 16 request: written atomically, one write_bytes per run
		set_holding_registers: (addr, values, unit_id) => {
			const report = (unmapped) => report_unmapped("holding register", unmapped, unit_id);
			const runs = register_runs(addr, values.length, unit_map[unit_id], report);
			in_transactions(blocks_of(runs), () => {
				for (const { block, offset, index, count } of runs) {
					const bytes = Buffer.alloc(count * 2);
					for (let i = 0; i < count; i++) bytes.writeUInt16BE(values[index + i], i * 2);
					block.write_bytes(offset, bytes);
				}
			}, report_listener_error);
		},

		get_coil: (addr, unit_id) => {
			const { block, offset, bit_mask } = get_coil_info(addr, unit_map[unit_id]);
			if (block == null) {
				report_unmapped("coil", addr, unit_id);
				return false;
			}
			return (block.read_bytes(offset, 1)[0] & bit_mask) > 0;
		},

		set_coil: (addr, value, unit_id) => {
			const { block, offset, bit_mask } = get_coil_info(addr, unit_map[unit_id]);
			if (block == null) {
				report_unmapped("coil", addr, unit_id);
				return;
			}
			block.write_bit(offset, bit_mask, value);
		},

		// one FC 15 request: written atomically, one write_bit per byte and value
		set_coils: (addr, values, unit_id) => {
			const report = (unmapped) => report_unmapped("coil", unmapped, unit_id);
			const points = coil_points(addr, values.length, unit_map[unit_id], report);
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

export class Unit_Map {
	unit_ids = [];

	/**
	 * Attaches a unit to the unit map.
	 *
	 * @param {number} unit_id - The ID of the unit.
	 * @param {import('layout-data').Ldata} block - The Ldata object that contains the data associated with the unit.
	 * @param {number} [start=0] - The starting index of the unit's data.
	 * @param {number} [offset=0] - The starting index of the Ldata object.
	 * @return {void} This function does not return anything.
	 */
	attach_unit(unit_id, block, start = 0, offset = 0) {
		if (this[unit_id] == null) {
			this.unit_ids.push(unit_id);
			this[unit_id] = [];
		}
		this[unit_id].push({
			block,
			start,
			offset,
			end: block.size - offset + start,
		});
	}
}
