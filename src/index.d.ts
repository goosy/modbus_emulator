import type { Ldata, Layout } from "layout-data";
import type { Modbus_Server } from "es-modbus";

export interface Emulator_Logger {
	info?: (message: string) => void;
	warn?: (message: string) => void;
	error?: (message: string) => void;
}

export interface Server_Options {
	rtu?: boolean;
	unit_ids?: number[];
	vector?: Record<string, Function>;
	logger?: Emulator_Logger;
}

export interface Serial_Options {
	baud_rate?: number;
	parity?: "none" | "odd" | "even";
	data_bits?: number;
	stop_bits?: number;
	unit_ids?: number[];
	vector?: Record<string, Function>;
	logger?: Emulator_Logger;
}

export class Unit_Map {
	unit_ids: number[];
	[unit_id: number]: { block: Ldata, start: number, offset: number, end: number }[];
	attach_unit(unit_id: number, block: Ldata, start?: number, offset?: number): void;
}

export function create_vector(unit_map: Unit_Map, options?: { logger?: Emulator_Logger }): Record<string, Function>;
export function create_tcp_server(host?: string, port?: number, unit_map?: Unit_Map, options?: Server_Options): Modbus_Server;
export function create_rtu_server(path: string, unit_map?: Unit_Map, options?: Serial_Options): Modbus_Server;

export class Modbus_Emulator {
	constructor(yaml_path: string, options?: {
		logger?: Emulator_Logger;
	});
	unit_map: Unit_Map;
	vector: Record<string, Function>;
	devices: Map<string, Ldata>;
	layouts: Record<string, Layout>;
	fragments: Record<string, Record<string, any>[]>;
	servers: Modbus_Server[];
	device(name: string): Ldata | undefined;
	start(): Promise<void>;
	stop(): Promise<void>;
}
