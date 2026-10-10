// The unit map that places data blocks at unit ids and byte offsets, and the
// es-modbus server vector that serves them. Writes go through the Ldata
// write methods, so that changes are detected or notified by the Ldata; reads
// go through read_bytes. The bytes of a Ldata are never reached directly.

const SILENT_LOGGER = { warn() { } };

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
 * Creates the es-modbus server vector that serves the data blocks of a unit map.
 *
 * @param {Unit_Map} unit_map - The data blocks attached per unit id.
 * @param {Object} [options]
 * @param {{warn: (message: string) => void}} [options.logger] - Reports unmapped addresses; silent by default.
 * @return {Object} The vector: get_input_register, get_holding_register, set_register, get_coil, set_coil.
 */
export function create_vector(unit_map, { logger = SILENT_LOGGER } = {}) {
	// An unmapped address (e.g. the gap between two data blocks of a unit)
	// reads as 0 and ignores writes, so that a block read spanning the gap
	// still succeeds. Each one is logged once.
	const reported = new Set();
	const report_unmapped = (kind, addr, unit_id) => {
		const key = `${kind}:${unit_id}:${addr}`;
		if (reported.has(key)) return;
		reported.add(key);
		logger.warn?.(`unmapped ${kind} address ${addr} in unit ${unit_id}`);
	};

	const read_register = (kind) => (addr, unit_id) => {
		const { block, offset } = get_register_info(addr, unit_map[unit_id]);
		if (block == null) {
			report_unmapped(kind, addr, unit_id);
			return 0;
		}
		return block.read_bytes(offset, 2).readUInt16BE(0);
	};

	const vector = {
		get_input_register: read_register("input register"),
		get_holding_register: read_register("holding register"),
		set_register: (addr, value, unit_id) => {
			const { block, offset } = get_register_info(addr, unit_map[unit_id]);
			if (block == null) {
				report_unmapped("holding register", addr, unit_id);
				return;
			}
			REGISTER_BYTES[0] = value >> 8;
			REGISTER_BYTES[1] = value & 0xff;
			block.write_bytes(offset, REGISTER_BYTES);
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
	};
	return vector;
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
