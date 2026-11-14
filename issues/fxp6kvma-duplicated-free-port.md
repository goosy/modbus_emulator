---
id: fxp6kvma
opened: 2026-10-17T23:58:26.000Z
closed: 2026-10-24T09:26:11.000Z
title: The test helper free_port is duplicated and racy
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

`free_port` probes a port and then releases it; between the release and the server under test listening, the port may be taken by another process, making tests fail occasionally. It is implemented twice, in `test/emulator_test.js` and `test/server_test.js`.

## Proposal

Merge it into one shared test helper module. Let the server under test listen on port 0 and read the actual port, which removes the race.

## Decision

The issue holds; fixed as proposed: the helpers are merged into `test/helpers.js`; the server under test listens on port 0, and the tests read the actual port from `server.server.address()` inside es-modbus, which removes the race.
