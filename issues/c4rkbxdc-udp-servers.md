---
id: c4rkbxdc
opened: 2026-11-16T14:48:47.740Z
closed: 2026-11-16T15:09:41.000Z
title: Modbus UDP and RTU over UDP services
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

The services of this package have only three transports: Modbus TCP, RTU over TCP and RTU (serial port). `servers[].protocol` of a description accepts only `tcp`, `rtu_over_tcp` and `rtu`, and `udp` is a load error (`protocol must be one of tcp, rtu_over_tcp, rtu`). The API has only `create_tcp_server` and `create_rtu_server`.

es-modbus 0.3.1 adds two transports, Modbus UDP (`udp`, MBAP frames) and RTU over UDP (`rtu_over_udp`, RTU frames), for both the client and the server. This package depends on es-modbus 0.3.0 and cannot emulate a device that communicates over UDP, such as a serial device server in UDP mode.

Connected as they are, two parts of the current code would go wrong:

- The check of the ports in use compares only `host:port`. TCP and UDP ports are independent of each other, so a TCP service and a UDP service on the same `host:port` could coexist, but they would be reported as a conflict.
- `#check_serial_units` takes only `tcp` as not a serial bus. A `udp` service would be taken as a serial bus and get false warnings that unit 0 is the broadcast address and units 248 to 255 are reserved. By the rules of es-modbus, `udp` uses MBAP frames like `tcp`, and every unit is an ordinary unit; `rtu_over_udp` is a serial bus like `rtu_over_tcp`.

## Proposal

Upgrade the es-modbus dependency to 0.3.1 and connect its two UDP transports:

- Descriptions: `servers[].protocol` adds `udp` and `rtu_over_udp`, named as in es-modbus. Both have the keys of `tcp` (`protocol`, `unit_ids`, `host`, `port`), with the same defaults and ranges: `host` defaults to `0.0.0.0` and `port` to 502, an integer from 1 to 65535. No key is added, as the `local` and `any_source_port` options of es-modbus are for the client only.
- Ports in use: checked in two families. Two of `tcp` and `rtu_over_tcp` may not use the same `host:port`, and neither may two of `udp` and `rtu_over_udp`; a TCP-family service and a UDP-family service may use the same `host:port`.
- Unit warnings: `udp`, like `tcp`, gives no serial bus warning; `rtu_over_udp`, like `rtu` and `rtu_over_tcp`, gives a `warning` for unit 0 and units 248 to 255.
- Server labels: `modbus+udp://host:port` for UDP and `rtu+udp://host:port` for RTU over UDP, e.g. `servers[2] (modbus+udp://0.0.0.0:502)`. The current labels `modbus://`, `rtu://` and `serial://` stay as they are.
- API: a new `create_udp_server(unit_map, { host, port, rtu, unit_ids, handler, name })`, symmetric to `create_tcp_server`, where `rtu: true` selects RTU over UDP. It returns the es-modbus `Modbus_Server`, not started.

Alternatives not adopted:

- A transport option of `create_tcp_server`: the function name would not fit UDP, and a caller would change two options to get a UDP service, which is less clear than a symmetric new function.
- A check of the ports in use by `host:port` alone, whatever TCP or UDP: it would forbid a valid and common configuration, a TCP and a UDP service on the same port.

## Decision

Accepted, to be implemented as proposed. es-modbus 0.3.1 already provides the two UDP transports, and this package only has to connect them to emulate devices that communicate over UDP; the proposal also corrects the check of the ports in use and the serial bus warnings, which would go wrong if they were connected as they are.
