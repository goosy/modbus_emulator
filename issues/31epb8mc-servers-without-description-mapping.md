---
id: 31epb8mc
opened: 2026-10-17T23:58:22.000Z
closed: 2026-10-24T18:26:07.000Z
title: servers has no mapping to the description entries
status: rejected    # open | accepted | fixed | rejected | wontfix
labels: []
remote:
---

## Problem

`servers` is a bare array: the caller cannot map a server back to its entry in the description file, nor look one up by name.

## Proposal

Expose the mapping between `servers` and the description entries (e.g. `{ protocol, label, server }`, or lookup by name). The server label shares the same data with issue#4rk8vyme.

The same label also identifies the source of events: when the emulator forwards server events, the payload carries that label (see issue#mnwdf2fy).

## Decision

The issue does not hold (rejected): `servers[i]` already corresponds to the `i`-th server entry of the merged description; es-modbus servers carry their own `name`, `protocol` and other properties, and once the emulator sets the server label as `name`, looking up by name is just `servers.find((server) => server.name === ...)`, and the source of an event is known from `server.name` (issue#mnwdf2fy). The structure of `servers` is not changed, and no `name` key is added to server entries.
