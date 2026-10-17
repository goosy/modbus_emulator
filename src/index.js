// Public interface of the package (doc/spec.md).
export { Modbus_Emulator } from "./emulator.js";
export { create_tcp_server, create_rtu_server } from "./server.js";
export { Unit_Map, create_vector } from "./unit_map.js";
// The part of layout-data that callers use. The Ldata objects of the devices belong to the
// interface of this package, so callers take the layout-data API from here and do not
// depend on layout-data themselves: there is then one copy of it in the process.
export { Ldata, Ltag, register_layout, get_layout, io_index_table, render_types } from "layout-data";
