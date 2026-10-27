// Public interface of the package (doc/spec.md).
export { Modbus_Emulator } from "./emulator.js";
export { create_tcp_server, create_rtu_server } from "./server.js";
export { Unit_Map, create_handler } from "./unit_map.js";
// The part of layout-data that callers use. The Ldata objects of the blocks belong to the
// interface of this package, so callers take the layout-data API from here and do not
// depend on layout-data themselves: there is then one copy of it in the process, and its scopes.
export { Ldata, Ltag, create_scope, get_scope, yaml, yaml_file } from "layout-data";
