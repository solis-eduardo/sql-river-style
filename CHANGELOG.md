# Changelog

All notable changes to this project are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.2.1] - 2026-08-18

### Fixed

- The 1.2.0 fix for "reserved word outside `KEYWORD_SET` folded to
  lowercase by mistake" only exempted PostgreSQL's *reserved* keywords
  (`RESERVED_KEYWORDS`, e.g. `CREATE`/`TABLE`) — `DROP`, `ALTER`,
  `INDEX` and other *non-reserved* DDL keywords, explicitly named as
  examples in that same fix, were still being folded (`DROP TABLE Foo`
  →`drop TABLE foo`). A separate `NON_RESERVED_DDL_KEYWORDS` set
  (curated to unambiguous DDL verbs/objects, not the full non-reserved
  category — most of which double as plausible column names) now covers
  this half of the vocabulary too.

## [1.2.0] - 2026-08-17

### Changed

- The test suite moved entirely into `examples/original/` +
  `examples/formatted/` file pairs, run through `test/examples.ts`. This
  merges what used to be two separate suites: short synthetic snippets
  that each isolate one formatting rule (previously hardcoded as
  assertions in `test/run.ts`, now removed) and real-world SQL/PL-pgSQL
  gathered from several sources on the internet. A file can pin
  non-default `formatSql` options via a `-- sql-river-style-options: ...`
  directive on its first line (see `test/example-options.ts`) — needed
  for the one case covering the `additionalFunctions` setting.
- `SELECT` never getting less than 4 spaces of indentation before it,
  even when it's already the longest keyword in the query, now also
  applies to `UPDATE`, `DELETE`, and `INSERT INTO` — previously only
  `SELECT` had this floor, so e.g. a plain `UPDATE ... SET ... WHERE`
  (no `FROM`) rendered with `UPDATE` flush against the left margin
  (being the longest keyword in that statement) instead of indented
  like every other statement type.

### Fixed

- Positional PL/pgSQL parameters (`$1`, `$2`...) were corrupted into a
  fake empty dollar-quote tag (`$$`) plus a stray number token — the
  dollar-quote tag regex didn't match a `$` followed by a digit, so it
  fell through to the catch-all as a lone `$`, which the tokenizer then
  treated as an empty `$$` tag. `$1`/`$2`/... are now tokenized as a
  single ident-like token and pass through untouched.
- Standalone `--`/`/* */` comments right before `CREATE FUNCTION`/
  `PROCEDURE`/`TYPE` were silently dropped from the output — the header
  detection consumed them from the token stream to look past them, but
  never copied them into the rendered lines.
- A `BEGIN ... EXCEPTION WHEN ... THEN ... END;` block whose exception
  handler had no `;` of its own before its `END` (e.g. a "do nothing,
  just retry" handler with only a comment in the body — a common
  Postgres idiom) could make the single-line fallback used for
  unmodeled `EXCEPTION` handlers swallow that `END`, desyncing the rest
  of the parse and leaving stray fragments (like an orphaned `LOOP;`)
  in an otherwise-structured function body. `EXCEPTION` is now treated
  as a block terminator, so this safely falls back to a single-line
  rendering of the whole statement instead.
- `RETURNS type LANGUAGE lang AS $$ ... $$` (`LANGUAGE` before the body
  instead of after it — used by, among others, the official PostgreSQL
  tutorial) had everything between `RETURNS` and `AS` — `LANGUAGE`
  included — treated as part of the return type, producing a garbled
  `RETURNS type language lang` line. `CREATE PROCEDURE` (which has no
  `RETURNS`) with `LANGUAGE` before `AS` failed to be recognized at all
  and fell back to a single line for the whole statement. `RETURNS`/
  `LANGUAGE` are now recognized in either order before the body.
- A function/procedure body with neither `DECLARE` nor `BEGIN...END`
  (a plain `LANGUAGE SQL` body — just a sequence of ordinary SQL
  statements) rendered as a single inline line instead of one
  statement per line; now reuses the same statement-list formatting as
  a `BEGIN...END` body.
- `RAISE`/`EXECUTE`/`PERFORM`/`EXIT`/`CONTINUE`/`OPEN`/`FETCH`/`CLOSE`
  (PL/pgSQL statement keywords with no structured formatting of their
  own) only rendered uppercase when the source already happened to have
  them uppercase — there was no forcing, unlike `DECLARE`/`BEGIN`/
  `RETURN`/etc., so a lowercase `raise notice ...` stayed lowercase,
  inconsistent with the rest of the same function body. Now uppercased
  whenever one is the first word of a leaf statement inside a
  function/procedure body; `RAISE`'s severity level (`DEBUG`/`LOG`/
  `INFO`/`NOTICE`/`WARNING`/`EXCEPTION`) gets the same treatment.
- `FORMAT`/`QUOTE_IDENT`/`QUOTE_LITERAL`/`QUOTE_NULLABLE` — real
  PostgreSQL built-in functions, constantly used for dynamic SQL and
  safe identifier quoting inside PL/pgSQL bodies — were missing from the
  native-function list entirely, so `format('...')`/`quote_ident(x)`
  never got uppercased like `count(*)`/`now()` do.
- A generic single-line fallback (an unmodeled construct, e.g. a
  function using `EXCEPTION`) glued every embedded `--`/`/* */` comment
  to the code around it on the same rendered line — including code that
  came *after* the comment in the original source, on a following
  physical line. Since a `--` comment always swallows the rest of its
  own physical line, this made it look like there was live code after
  the comment when there wasn't any (in the original source, that code
  was on the *next* line, past where the comment's swallowing ends).
  Each comment now gets its own line in this fallback too, matching
  what the source actually meant; the code around it is still one
  fallback line per gap between comments, not fully restructured.
- A declared variable's type (`v_score NUMERIC;`) and a function's
  `RETURNS` type only rendered uppercase if the source already had it
  that way — no forcing, unlike other structural parts of a
  `DECLARE`/`RETURNS`. Recognized type names (`INTEGER`, `RECORD`,
  `REFCURSOR`, `NUMERIC`, `TEXT`, `TIMESTAMP`...) are now always
  uppercased in these two positions specifically — never in a general
  expression/column position, where several of these words double as
  common column names (`date`, `text`, `real`, `name`...) and forcing
  uppercase there would risk corrupting a real column reference.
- `v_x := 0` (assignment/`DEFAULT`) rendered as `v_x : = 0` (extra
  space) outside of a body assignment statement — e.g. a `DECLARE ...
  DEFAULT`/`:=` — since `:=` tokenizes as two separate operator tokens
  with no dedicated spacing rule joining them; a body assignment
  statement worked around this by hardcoding a literal `:=` in its own
  prefix, but nothing else did.

### Added

- Identifiers with no quotes in the source are folded to lowercase —
  matching what PostgreSQL itself does internally with an unquoted
  identifier (`Customers` unquoted is exactly `customers` to the
  database; showing it any other way would show a casing that never
  really existed as far as the database is concerned). Quoted
  identifiers are untouched, same as before.
- A native "niladic" function/keyword (`CURRENT_DATE`, `CURRENT_TIME`,
  `CURRENT_TIMESTAMP`, `LOCALTIME`, `LOCALTIMESTAMP`, `CURRENT_USER`,
  `SESSION_USER`) is now uppercased even without a following `(` — these
  are commonly used bare (`CURRENT_TIMESTAMP - interval '1 day'`), unlike
  ordinary native functions (`count`, `now`...) which are only forced
  uppercase when actually called, to avoid also uppercasing a plain
  column that happens to share the name.
- A column alias written as a string literal (`AS 'Foo'` — accepted by
  SQL Server when `QUOTED_IDENTIFIER` is off, but not valid PostgreSQL
  syntax) is rewritten as a real identifier: quoted only if it actually
  needs to be (mixed case, space, reserved word), same rule as any other
  identifier. If that alias is later referenced by name in `GROUP BY`/
  `ORDER BY`, the same quoting is propagated there too — otherwise the
  unquoted (and therefore lowercase-folded) reference would silently
  stop matching the quoted alias, an invalid query rather than just an
  ugly one.
- A statement block (`IF`/`FOR`/`BEGIN`) now gets a blank line after it
  too, symmetric with the blank line it already got before — including
  when immediately followed by another block. A `RETURN`/`RETURN NEXT`/
  `RETURN QUERY` gets the same treatment when something follows it in
  the same statement list (not just before it as before) — e.g. between
  two `RETURN NEXT` calls in a loop that returns multiple rows, but not
  after the very last one before the enclosing block's `END`.
- Leading `--`/`/* */` comments right before a statement are now always
  rendered one per line, even when the rest of that statement falls back
  to the generic single-line rendering (an unmodeled construct such as
  `EXCEPTION`) — previously they got glued to the code and to each other
  on that single line.
- `CREATE FUNCTION`/`PROCEDURE` no longer put a space between the name
  and its parameter list (`f(a, b)`, not `f (a, b)`), matching common
  convention. Parameter types (`f(key INT, data TEXT)`) are now
  uppercased the same way `DECLARE`/`RETURNS` types already were.
- An unconditional `LOOP ... END LOOP` (not wrapped in `FOR var IN`) is
  now structured like any other block, and `BEGIN ... EXCEPTION WHEN
  cond THEN ... END` handlers are now modeled too (first `WHEN`/`THEN`
  fuses onto the `EXCEPTION` line, further ones — rare — get their own
  line) — both were previously unmodeled and fell back to a single line
  for the whole enclosing statement. This covers the classic Postgres
  "update, or insert and retry on conflict" idiom end to end.
- A comment between items of a list (`SELECT`/`GROUP BY`/`ORDER BY`/...)
  now aligns with the list items instead of sitting at column 1 —
  column 1 is still used for a comment before/outside a list (top of the
  statement, before a whole clause).
- A condition with `AND`/`OR` inside a `CASE`'s `THEN` now breaks across
  lines the same way a `WHERE`/`ON` condition does, instead of always
  staying on one line regardless of length.
- `RAISE`/`EXECUTE`/`PERFORM`/`OPEN`/`FETCH`/`CLOSE` calls are now
  isolated with a blank line before and after (including between two
  such calls back to back), matching how a query or a nested block
  already gets blank-line spacing.
- `RETURN`/`RETURN NEXT`/`RETURN QUERY` no longer gets a spurious blank
  line before it when it's the very first statement of a block (right
  after `BEGIN`/`THEN`/`ELSE`) — only when it follows another real
  statement.
- The extra indentation a truly nested query gets (subquery in `FROM`,
  `FOR ... IN (...)`, `IF (SELECT ...)`) is now a flat `indentSize`
  regardless of how deep the surrounding context already is, instead of
  compounding with it — and its closing `)` aligns under the `(` that
  opened it, not under the surrounding statement's own indentation. A
  CTE's body is the one exception: it gets no extra nesting indentation
  at all, formatting as if it were a standalone top-level query.
- A reserved PostgreSQL keyword that isn't part of this formatter's
  clause-marker `KEYWORD_SET` (`CREATE`, `TABLE`, `DROP`, `ALTER`...) no
  longer gets folded to lowercase — a truly reserved word is never a
  legal unquoted data identifier in the first place, so the "PostgreSQL
  folds an unquoted identifier to lowercase" reasoning behind that rule
  doesn't apply to it; it's DDL syntax out of this formatter's scope,
  left exactly as the source had it (same as before the lowercase-fold
  rule existed).

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
