---
id: 2jdmx0kw
opened: 2026-10-17T23:58:11.000Z
closed: 2026-10-23T14:07:46.000Z
title: The port validation is incomplete
status: fixed       # open | accepted | fixed | rejected | wontfix
fixed_in: [a14a08c]        # commit IDs, backfilled at version commit time
labels: []
remote:
problem_title:
proposal_title:
decision_title:
---

## Problem

Location: `#read_servers` in `src/emulator.js`.

The TCP port is only checked to be an integer, not to be in the range 0..65535 (the 99999 in the reproduction of issue#4rk8vyme passes the validation this way); several servers using the same port are not checked either.

## Proposal

Validate the TCP port to be in 0..65535; report an error when several servers use the same port:

- `tcp` and `rtu_over_tcp` are compared by `host` and `port` (default values take part in the comparison); different `host`s using the same port are not a conflict;
- port 0 is assigned by the system, differs each time, and takes no part in the duplicate check;
- two `rtu` servers must not use the same serial port path.

## Decision

The issue holds; fixed as proposed: the TCP port must be in 0..65535; the same `host` and `port` must not repeat (except port 0; different `host`s may use the same port), and serial port paths must not repeat.
