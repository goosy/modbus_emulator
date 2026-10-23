import type { EventEmitter } from "node:events";
import type { Ldata, Layout } from "layout-data";

export { Ldata, Ltag, register_layout, get_layout, io_index_table, render_types } from "layout-data";
export type {
	Layout, Layout_Tag, Layout_Item, Tag_Item, Include_Item, Layout_Description,
	Layout_Source, Registered_Layouts, Endian, Tag_Type,
} from "layout-data";

/** A Modbus slave service (the server of es-modbus, a dependency of this package). */
export interface Modbus_Server extends EventEmitter {
	start(): Promise<unknown>;
	stop(): Promise<unknown>;
}

/** The es-modbus server vector over a unit map (see `create_vector`). */
export interface Modbus_Vector {
	get_holding_register(addr: number, unit_id: number): number;
	get_input_register(addr: number, unit_id: number): number;
	set_register(addr: number, value: number, unit_id: number): void;
	get_coil(addr: number, unit_id: number): boolean;
	set_coil(addr: number, value: boolean, unit_id: number): void;
}

export interface Emulator_Logger {
	info?: (message: string) => void;
	warn?: (message: string) => void;
	error?: (message: string) => void;
}

export interface Server_Options {
	rtu?: boolean;
	unit_ids?: number[];
	vector?: Modbus_Vector;
	logger?: Emulator_Logger;
}

export interface Serial_Options {
	baud_rate?: number;
	parity?: "none" | "odd" | "even";
	data_bits?: number;
	stop_bits?: number;
	unit_ids?: number[];
	vector?: Modbus_Vector;
	logger?: Emulator_Logger;
}

export class Unit_Map {
	unit_ids: number[];
	[unit_id: number]: { block: Ldata, start: number, offset: number, end: number }[];
	attach_unit(unit_id: number, block: Ldata, start?: number, offset?: number): void;
}

export function create_vector(unit_map: Unit_Map, options?: { logger?: Emulator_Logger }): Modbus_Vector;
export function create_tcp_server(host: string | undefined, port: number | undefined, unit_map: Unit_Map, options?: Server_Options): Modbus_Server;
export function create_rtu_server(path: string, unit_map: Unit_Map, options?: Serial_Options): Modbus_Server;

export class Modbus_Emulator {
	constructor(source: string | string[], options?: {
		logger?: Emulator_Logger;
	});
	unit_map: Unit_Map;
	vector: Modbus_Vector;
	blocks: Map<string, Ldata>;
	layouts: Record<string, Layout>;
	servers: Modbus_Server[];
	block(name: string): Ldata | undefined;
	start(): Promise<void>;
	stop(): Promise<void>;
}
