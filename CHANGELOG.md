# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
