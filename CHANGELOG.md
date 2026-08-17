# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-08-17

### Added

- `CREATE [OR REPLACE] FUNCTION`/`PROCEDURE` bodies with a dollar-quoted
  body (`AS $$ ... $$`/`AS $tag$ ... $tag$`) now get their own river-style
  layout: header clauses one per line, `DECLARE`/`BEGIN`/`END` blocks,
  `IF`/`THEN`/`ELSE`/`END IF`, `FOR var IN (query) LOOP`/`END LOOP`,
  assignment (`:=`), and `RETURN`/`RETURN NEXT`/`RETURN QUERY`. Embedded
  `SELECT`/`INSERT`/`UPDATE`/`DELETE` statements reuse the same
  formatting as top-level queries. See the README for the full example
  and the constructs still out of scope (`EXCEPTION`, `WHILE`, `CURSOR`,
  dynamic `EXECUTE`, `ELSIF`, bare-range `FOR`).
- `CREATE TYPE name AS (...)` composite type definitions: one field per
  line, indented.
- Malformed/unparseable PL/pgSQL bodies (e.g. a `--` comment that
  swallows an `IF`/`THEN`, leaving a dangling `ELSE`/`END`) never
  produce fabricated output — the whole statement safely falls back to
  the generic single-line rendering instead.

### Changed

- Removed the "function/procedure definitions are not supported"
  limitation note — superseded by the `CREATE FUNCTION`/`PROCEDURE`
  support above.

## [1.0.0] - 2026-08-14

First public release, as **SQL River Style** — renamed from the internal
`competo-sql-formatter`.

### Changed

- Renamed package/command/settings: `competoSqlFormatter.*` →
  `sqlRiverStyle.*`.
- License changed from `UNLICENSED` to MIT.
- Chained CTEs: the blank line that used to separate one CTE from the
  next now separates the whole `WITH` block from the statement that
  consumes it instead — no blank line between chained CTEs themselves.

### Added

- MIT `LICENSE` file.
- Extension icon (`images/icon.png`).
- Bilingual (English/Portuguese) README.
- Documented limitation: function/procedure definitions
  (`CREATE FUNCTION`/`CREATE PROCEDURE` with dollar-quoted bodies) are
  not supported and can corrupt the output — avoid formatting files
  that contain them.
