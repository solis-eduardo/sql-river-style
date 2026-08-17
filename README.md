# SQL River Style

An opinionated VS Code formatter for hand-written SQL — report queries,
one-off scripts, ad-hoc exports — that lays keywords out in the classic
**"river style"**: `SELECT`/`FROM`/`WHERE`/... right-aligned to a common
column, one column per line, structured `CASE` blocks and CTEs. It is
**not** a generic, configurable formatter: it reproduces a fixed set of
house conventions, the same ones this project started from when it was
an internal tool before going public.

*Leia isto em [português](#português) mais abaixo.*

## Rules applied

1. **Right-aligned keywords ("river style")**: `SELECT`, `FROM`,
   `WHERE`, `AND`/`OR`, `INNER/LEFT/RIGHT/FULL/CROSS JOIN`, `ON`/`USING`,
   `UNION ALL`, `GROUP BY`, `ORDER BY`, `HAVING`, `LIMIT`, `OFFSET` — and,
   in DML, `INSERT INTO`, `UPDATE`, `SET`, `DELETE`, `VALUES`,
   `RETURNING` — all end at the same column, set by the longest keyword
   in use in that query/statement. When the block has a `SELECT`, it
   never gets less than 4 spaces of indentation before it — even if
   `SELECT` alone would already be the longest keyword in use (e.g. a
   `SELECT` without `JOIN` whose longest clause is `GROUP BY`, which
   alone would only need 2 spaces).
2. **One column per line** in `SELECT`, `GROUP BY`, `ORDER BY` — and
   also in `SET` (one assignment per line), `VALUES` (one tuple per
   line) and `RETURNING` —, vertically aligned under the first item of
   the list.
3. **Table alias**: the formatter doesn't add or remove aliases — it
   only reformats what's already written. Avoiding aliases (except in
   self-joins) is a convention left to whoever writes the query.
4. **Uppercase**: SQL keywords, recognized native functions (`COUNT`,
   `UNNEST`, `ARRAY_LENGTH`, `COALESCE`, `FORMAT`, `QUOTE_IDENT`...) and
   casts (`::INT`, `::TEXT`). A "niladic" native function/keyword
   (`CURRENT_TIMESTAMP`, `CURRENT_DATE`, `CURRENT_USER`...) is uppercased
   even without a following `(`, since those are commonly used bare.
   Inside a `CREATE FUNCTION`/`PROCEDURE` body, a PL/pgSQL statement
   keyword with no structured formatting of its own (`RAISE`, `EXECUTE`,
   `PERFORM`, `EXIT`, `CONTINUE`, `OPEN`, `FETCH`, `CLOSE`) is uppercased
   whenever it's the first word of a statement — same for `RAISE`'s
   severity level (`RAISE NOTICE`/`WARNING`/`EXCEPTION`...). A declared
   variable's type in `DECLARE` and a function's `RETURNS` type
   (`INTEGER`, `RECORD`, `REFCURSOR`, `NUMERIC`, `TIMESTAMP`...) are
   uppercased too — but *only* in those two structurally-guaranteed-type
   positions, never in a general expression/column position, since
   several type names double as common column names (`date`, `text`,
   `real`, `name`...). **Lowercase**: column-alias `as`, and any
   identifier with no quotes in the source (`Customers` → `customers`) —
   matching what PostgreSQL itself does internally with an unquoted
   identifier; a quoted one (`"Customers"`) is untouched. CTE alias uses
   uppercase `AS` (the one exception). A column alias written as a
   string literal (`AS 'Foo'` — accepted by SQL Server, not valid
   PostgreSQL) becomes a real identifier instead (`AS "Foo"`, or
   unquoted if safe); the same quoting is carried over if that alias is
   later referenced by name in `GROUP BY`/`ORDER BY`.
5. `JOIN` condition wrapped in parentheses, on its own line after `ON`:
   `ON ( a.x = b.y )`. With more than one condition, each `AND`/`OR`
   breaks onto its own line inside the parentheses, aligned under the
   first condition — this holds whether the source already writes
   `ON ( a.x = b.x AND a.y = b.y )` or without parentheses
   (`ON a.x = b.x AND a.y = b.y`); both format the same way. `USING`
   doesn't get this wrap — it serves both the `USING (col1, col2)` form
   of `JOIN` and the `USING outra_tabela` form of Postgres's multi-table
   `DELETE`, so it's left as-is.
6. `CASE`/`WHEN`/`THEN`/`ELSE`/`END` in blocks: the first `WHEN` stays
   on the same line as `CASE`, each following `WHEN`/`THEN`/`ELSE`
   becomes its own line aligned right after `CASE ` (same column as the
   first `WHEN`), and `END` closes aligned with `CASE` itself. Applies
   both to a `SELECT` item and to a `WHERE`/`ON`/etc. condition.
7. Blank line separating `UNION ALL`/`UNION`/`EXCEPT`/`INTERSECT` from
   what comes before/after, and separating a `WITH` block's CTEs from
   the statement that consumes them (the `SELECT`/`INSERT`/`UPDATE`/
   `DELETE` right after the closing `)`).
8. Chained CTEs with no extra indentation and no blank line between
   them: closing one and opening the next on the same line
   (`), next_cte AS (`).
9. Standalone `--` comments (alone on their line) always sit at column
   1, unindented — even inside CTEs/subqueries. Comments at the end of a
   code line stay at the end of that line.
10. No trailing `;` at the end of the file (the query is treated as a
    fragment). In files with multiple statements, the `;` between them
    is kept — only the last one is removed.
11. Inside a `CREATE FUNCTION`/`PROCEDURE` body, a statement block
    (`IF`/`FOR`/`BEGIN`) gets a blank line after it too (symmetric with
    the blank line it already gets before) — including when immediately
    followed by another block. A `RETURN`/`RETURN NEXT`/`RETURN QUERY`
    gets the same "blank line after" whenever something follows it in
    the same statement list, not only before it.
12. Leading `--`/`/* */` comments right before a statement always render
    one per line, even when the rest of that statement isn't modeled and
    falls back to a single-line rendering.

Example:

```sql
    SELECT ecm_conteudo.id,
           ecm_conteudo.nome,
           COUNT(ecm_assinatura.id) as total_assinaturas
      FROM ecm_conteudo
INNER JOIN ecm_assinatura
        ON ( ecm_assinatura.ecm_conteudo_id = ecm_conteudo.id )
     WHERE ecm_conteudo.categoria_id = 10
       AND ecm_conteudo.ativo = TRUE
  GROUP BY ecm_conteudo.id,
           ecm_conteudo.nome
  ORDER BY ecm_conteudo.nome
```

`ON` with more than one condition breaks one per line (works the same
whether `AND`/`OR` is already wrapped in parentheses in the source or
not):

```sql
    SELECT issues.id
      FROM issues
INNER JOIN custom_values campo_nome
        ON ( campo_nome.customized_id = issues.id
         AND campo_nome.custom_field_id = 109 )
```

`CASE`/`WHEN`/`THEN` in blocks, one per line (works both as a `SELECT`
item and inside a `WHERE` condition):

```sql
     WHERE issues.status_id <> 42
       AND CASE WHEN '${situacao}' = ''
                THEN TRUE
                WHEN '${situacao}' = 'a' -- Arquivados
                THEN issues.status_id = 41
           END
```

Chained CTEs:

```sql
WITH primeira_cte AS (
    SELECT a.id,
           a.valor::NUMERIC
      FROM tabela_a a
), segunda_cte AS (
    SELECT b.id
      FROM tabela_b b
)

    SELECT primeira_cte.id
      FROM primeira_cte
```

(The final `SELECT` gets 4 leading spaces even without a `JOIN` around —
that's rule 1's minimum-4-spaces-before-`SELECT` kicking in, since
`FROM` alone would only ask for 2.)

Subqueries in `FROM`/`JOIN` are formatted recursively, with their own
indentation and their own river alignment (independent of the outer
scope) — the same goes for each CTE's body.

`UPDATE`/`DELETE`/`INSERT` follow the same river style (`UPDATE`/
`DELETE` share the same clause machinery as `SELECT`, so `FROM`,
`JOIN`, `WHERE`/`AND`/`OR` etc. all work the same way):

```sql
UPDATE ecm_conteudo
   SET nome = 'novo nome',
       ativo = TRUE
 WHERE ecm_conteudo.id = 1
   AND ecm_conteudo.categoria_id = 2
```

```sql
   DELETE
     FROM ecm_conteudo
    USING ecm_categoria
    WHERE ecm_conteudo.categoria_id = ecm_categoria.id
      AND ecm_categoria.ativo = FALSE
RETURNING ecm_conteudo.id
```

`INSERT INTO` shares the same river with whichever of
`VALUES`/`SELECT`/`RETURNING` comes after it in the same statement:

```sql
INSERT INTO ecm_conteudo (nome, categoria_id)
     VALUES ('a', 1),
            ('b', 2)
  RETURNING id
```

Function/procedure definitions (`CREATE [OR REPLACE] FUNCTION`/
`PROCEDURE` with a dollar-quoted body, `AS $$ ... $$`/`AS $tag$ ...
$tag$`) get their own layout: header clauses one per line, `DECLARE`/
`BEGIN`/`END` blocks, `IF`/`THEN`/`ELSE`/`END IF`, `FOR var IN (query)
LOOP`/`END LOOP`, assignment (`:=`), and `RETURN`/`RETURN NEXT`/
`RETURN QUERY` — any `SELECT`/`INSERT`/`UPDATE`/`DELETE` embedded in
the body goes through the same river-style formatting as everything
else. A blank line separates a multi-line embedded query from what
follows it, precedes `RETURN`, and also precedes an embedded query or
a nested `IF`/`FOR`/`BEGIN` block when it comes right after a plain
assignment/DDL statement — consecutive plain statements otherwise stay
tight, with no blank lines between them:

```sql
CREATE OR REPLACE FUNCTION calculate_discount (p_customer_id integer, p_amount numeric)
RETURNS numeric
AS $$
DECLARE
    v_tier text;
    v_discount numeric;
BEGIN
    SELECT tier INTO v_tier
      FROM customers
     WHERE id = p_customer_id;

    IF ( v_tier = 'gold' )
    THEN
        v_discount := 0.20;
    ELSE
        v_discount := 0.05;
    END IF;

    RETURN p_amount * (1 - v_discount);
END;
$$
LANGUAGE plpgsql;
```

Not covered: `EXCEPTION` blocks, `WHILE`/`CURSOR`, dynamic `EXECUTE`,
`ELSIF`, and `FOR` over a bare range/expression (`FOR i IN 1..10
LOOP`) — these fall back to the generic DDL rendering (keywords
uppercased, no restructuring), same as anything else out of scope. See
"Scope and known limitations" below for the `--` comment caveat, which
matters more here than anywhere else in the formatter.

## Usage

- **Format document**: `Shift+Alt+F` (VS Code's default formatter
  shortcut for `.sql`), or Command Palette → `SQL River Style: Format
  Document`.
- **Format on save**: enable `"editor.formatOnSave": true` in VS Code
  for `.sql` files (globally, or under `[sql]` in `settings.json`).

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `sqlRiverStyle.indentSize` | `4` | Spaces used to indent CTE bodies and derived-table subqueries in `FROM`/`JOIN`. |
| `sqlRiverStyle.additionalFunctions` | `[]` | Extra function names (besides the built-in native list) to uppercase when used as a function call, e.g. `["fn_calcula_total"]`. |

## Scope and known limitations

- Covers `SELECT`/`WITH` (the common case of report queries) and basic
  DML — `INSERT`/`UPDATE`/`DELETE`, including `UPDATE ... FROM`,
  `DELETE ... USING`, `INSERT ... VALUES`/`INSERT ... SELECT` and
  `RETURNING`. Other statements (DDL, `MERGE`, session commands...) are
  out of scope: they only get their keywords uppercased, without river
  restructuring.
- `CREATE FUNCTION`/`PROCEDURE` bodies (see the example above) cover the
  common case but aren't a full PL/pgSQL parser: `EXCEPTION` blocks,
  `WHILE`, cursor statements (`DECLARE ... CURSOR`, `OPEN`/`FETCH`/
  `CLOSE` — these three get their keyword uppercased like `RAISE`/
  `EXECUTE`/`PERFORM` do, but no multi-line structuring), dynamic
  `EXECUTE`, `ELSIF`, an unconditional `LOOP` (one not wrapped in
  `FOR var IN ...`), and `FOR` over a bare range or an un-parenthesized
  query (`FOR var IN SELECT ... LOOP` needs `(...)` around the query to
  get multi-line treatment — `FOR var IN (SELECT ...) LOOP` does) aren't
  modeled — they render via the generic DDL fallback (keywords
  uppercased, without restructuring): one line per gap between
  comments, since a `--` comment always swallows the rest of its own
  physical line and would otherwise silently "eat" code that follows on
  the next line of the original source. Same as any other out-of-scope
  statement. When one of these appears nested inside an
  otherwise-modeled block, the whole enclosing `CREATE FUNCTION`/
  `PROCEDURE` statement falls back this way instead of risking a
  partially-restructured result — see `examples/formatted/` for a
  couple of real-world functions (sourced from the official PostgreSQL
  docs) that hit this. `RETURNS`/`LANGUAGE`
  are recognized in either order before the `AS $$` body (some code puts
  `LANGUAGE` before the body instead of after it), and a body with
  neither `DECLARE` nor `BEGIN...END` (a plain `LANGUAGE SQL` function/
  procedure) is formatted as an ordinary statement list. `SELECT INTO
  var` only gets the combined `SELECT INTO` marker treatment when `INTO`
  immediately follows `SELECT`; the `SELECT col INTO var` word order is
  treated as a plain `SELECT` instead.
- **A `--` comment always swallows the rest of its physical source
  line** — including any real code crammed onto the same line. That's
  normal SQL comment syntax, not a formatter bug: if a raw file has
  `-- note SELECT 1;` all on one line, "un-swallowing" the `SELECT 1;`
  would mean changing what the file *means* (turning text that looks
  commented-out into live code again), not just reformatting it — this
  formatter never does that. The result is the whole thing rendering
  as one (long) comment line, unchanged. This bites hardest inside
  `CREATE FUNCTION` bodies exported from tools that collapse
  whitespace, since procedural code tends to have many short
  comment-adjacent statements — check files like that by eye before
  trusting the output wholesale. If swallowing an `IF`/`THEN` this way
  leaves a dangling `ELSE`/`END` the formatter can't match up, it never
  guesses: the whole function/procedure falls back to the generic
  single-line rendering instead of fabricating a closing keyword that
  isn't in the source.
- `INSERT ... ON CONFLICT` isn't specifically modeled — `ON CONFLICT
  (...) DO NOTHING` stays concatenated at the end of the `VALUES` line;
  in `ON CONFLICT (...) DO UPDATE SET ...` the `SET` gets its own line
  (reusing the normal `SET` marker), but the `ON CONFLICT (...) DO
  UPDATE` that precedes it stays entirely on the `VALUES` line. It
  doesn't break the query, it just isn't formatted into full river
  clauses.
- Uppercased "native functions" come from a fixed list of PostgreSQL
  functions (`src/formatter.ts`, `NATIVE_FUNCTIONS` constant); your own
  database business functions are only uppercased if listed in
  `sqlRiverStyle.additionalFunctions`.
- Nested `CASE` (a `CASE` inside another's `WHEN`/`THEN`/`ELSE`) only
  breaks into blocks at the outermost `CASE` — the nested one(s) render
  inline via `renderTokensInline`, like any other ordinary expression.
- Chained quoted identifiers (`"tabela"."coluna"`, common in SQL
  exported by query builders such as Laravel's) are recognized as a
  single qualified identifier, preserving the `.` — same as
  `tabela.coluna` unquoted. Any character not recognized by any
  tokenizer rule (e.g. a `?` bind parameter from a query log) becomes
  an isolated token instead of being dropped — the formatter should
  never silently erase content from the original SQL, even when it
  doesn't know how to format it with ideal spacing.
- Unnecessary quotes around an identifier are stripped:
  `"tabela"."coluna"` becomes `tabela.coluna` when the content is only
  lowercase/digit/`_` and doesn't collide with a reserved PostgreSQL
  keyword. The collision check uses `RESERVED_KEYWORDS`
  (`src/tokenizer.ts`) — the full list of "reserved" variants from the
  [official Postgres keyword
  table](https://www.postgresql.org/docs/current/sql-keywords-appendix.html),
  not the curated `KEYWORD_SET` used for uppercasing/clause markers
  (that one is deliberately much smaller — uppercasing `CREATE`/
  `TABLE`/`ARRAY`/etc. whenever they appear would collide with DDL,
  which is out of scope for this formatter). Non-reserved Postgres
  words that are also common column names (`date`, `time`, `type`,
  `value`, `text`, `name`...) never lose their quotes by mistake nor
  get forced uppercase by this list, since they aren't truly reserved.
- Subqueries used inside an expression (`WHERE x IN (SELECT ...)`,
  `SELECT (SELECT ...) AS foo`) render on a single line — only
  subqueries in `FROM`/`JOIN` position (derived tables) get recursive
  multi-line formatting.
- Casts whose type name is more than one word (`::double precision`,
  `::character varying`, `::timestamp with time zone`...) are
  uppercased as a whole — the list of recognized phrases is the
  `MULTI_WORD_CAST_TYPES` constant in `src/formatter.ts`. A compound
  name not on that list only gets its first word uppercased.

## Development

```bash
npm install
npm run compile            # or: npm run watch
npm test                   # regression suite (test/examples.ts) over every file in examples/
npm run smoke              # prints the formatting of several examples, for manual inspection (test/smoke.ts)
npm run generate-examples  # (re)generates examples/formatted/ from examples/original/ — review the diff before committing
```

The whole test suite lives as file pairs under `examples/`: `examples/original/`
holds SQL/PL-pgSQL inputs — short synthetic snippets that each isolate one
formatting rule, alongside real-world SQL gathered from several sources on
the internet (official PostgreSQL docs, W3Schools, Sentry, Neon, Stack
Overflow...) — every file with a header comment documenting where it came
from (`caso sintético do formatter sql-river-style` for the synthetic ones).
`examples/formatted/` is the sibling directory with the corresponding
"correctly formatted" output — generated by `npm run generate-examples` and
reviewed by hand before being committed. `test/examples.ts` formats every
file in `examples/original/` again into a fresh OS temp directory and
compares it against `examples/formatted/`, so any change in formatter output
fails `npm test` until `examples/formatted/` is regenerated and re-reviewed
on purpose. A file can pin non-default `formatSql` options via a directive
on its very first line — `-- sql-river-style-options: additionalFunctions=foo,bar`
(see `test/example-options.ts`) — currently only used by the one file
covering the `sqlRiverStyle.additionalFunctions` setting.

To debug inside VS Code: open this repository's root as a workspace and
press `F5` (Extension Development Host).

To build an installable package:

```bash
npx @vscode/vsce package
```

That produces a `.vsix` file, installable via
`code --install-extension sql-river-style-1.0.0.vsix` or through VS
Code's Extensions tab → `Install from VSIX...`.

## License

[MIT](LICENSE) — © Eduardo Braun.

---

## Português

Extensão de VS Code que formata SQL escrito à mão — queries de
relatório, scripts avulsos, exportações pontuais — no estilo clássico
**"river"**: `SELECT`/`FROM`/`WHERE`/... alinhados à direita numa coluna
comum, uma coluna por linha, blocos `CASE` e CTEs estruturados. **Não**
é um formatter genérico/configurável: reproduz um conjunto fixo de
convenções de estilo, as mesmas com que este projeto começou quando
ainda era uma ferramenta interna, antes de se tornar público.

*Read this in [English](#sql-river-style) above.*

### Regras aplicadas

1. **Keywords alinhadas à direita ("river style")**: `SELECT`, `FROM`,
   `WHERE`, `AND`/`OR`, `INNER/LEFT/RIGHT/FULL/CROSS JOIN`, `ON`/`USING`,
   `UNION ALL`, `GROUP BY`, `ORDER BY`, `HAVING`, `LIMIT`, `OFFSET` — e, em
   DML, `INSERT INTO`, `UPDATE`, `SET`, `DELETE`, `VALUES`, `RETURNING` —
   terminam todas na mesma coluna, definida pela keyword mais longa em uso
   naquela query/statement. Quando o bloco tem um `SELECT`, ele nunca fica
   com menos de 4 espaços de indentação antes dele — mesmo que `SELECT`
   por si só já fosse a keyword mais longa em uso (ex.: um `SELECT` sem
   `JOIN` cuja cláusula mais longa é `GROUP BY`, que sozinha só pediria 2
   espaços).
2. **Uma coluna por linha** em `SELECT`, `GROUP BY`, `ORDER BY` — e também
   em `SET` (uma atribuição por linha), `VALUES` (uma tupla por linha) e
   `RETURNING` —, alinhadas verticalmente sob o primeiro item da lista.
3. **Alias de tabela**: o formatter não adiciona nem remove alias — só
   reformata o que está escrito. A convenção de evitar alias (exceto em
   self-join) é responsabilidade de quem escreve a query.
4. **Maiúsculo**: palavras-chave SQL, funções nativas reconhecidas
   (`COUNT`, `UNNEST`, `ARRAY_LENGTH`, `COALESCE`, `FORMAT`,
   `QUOTE_IDENT`...) e casts (`::INT`, `::TEXT`). Uma função/keyword
   nativa "niládica" (`CURRENT_TIMESTAMP`, `CURRENT_DATE`,
   `CURRENT_USER`...) fica maiúscula mesmo sem `(` logo depois, já que
   essas costumam ser usadas sem parênteses. Dentro de um corpo de
   `CREATE FUNCTION`/`PROCEDURE`, uma keyword de statement do PL/pgSQL
   sem estruturação própria (`RAISE`, `EXECUTE`, `PERFORM`, `EXIT`,
   `CONTINUE`, `OPEN`, `FETCH`, `CLOSE`) fica maiúscula sempre que é a
   primeira palavra de um statement — vale também pro nível de
   severidade do `RAISE` (`RAISE NOTICE`/`WARNING`/`EXCEPTION`...). O
   tipo de uma variável declarada em `DECLARE` e o tipo de retorno em
   `RETURNS` (`INTEGER`, `RECORD`, `REFCURSOR`, `NUMERIC`, `TIMESTAMP`...)
   também ficam maiúsculos — só nessas duas posições onde um tipo é
   estruturalmente garantido, nunca numa posição comum de
   expressão/coluna, já que vários nomes de tipo também são nome de
   coluna comum (`date`, `text`, `real`, `name`...). **Minúsculo**: `as`
   de alias de coluna, e qualquer identificador sem aspas no fonte
   (`Customers` → `customers`) — igual o que o próprio PostgreSQL faz
   internamente com um identificador sem aspas; um entre aspas
   (`"Customers"`) fica intocado. Alias de CTE usa `AS` maiúsculo (única
   exceção). Um alias de coluna escrito como string literal (`AS 'Foo'` —
   aceito pelo SQL Server, não é sintaxe válida no Postgres) vira um
   identificador de verdade (`AS "Foo"`, ou sem aspas se for seguro); a
   mesma quotação é levada adiante se esse alias for referenciado pelo
   nome depois, em `GROUP BY`/`ORDER BY`.
5. Condição de `JOIN` entre parênteses, em linha própria após `ON`:
   `ON ( a.x = b.y )`. Com mais de uma condição, cada `AND`/`OR` quebra
   linha dentro dos parênteses, alinhado sob a primeira condição — vale
   tanto pra quem já escreve `ON ( a.x = b.x AND a.y = b.y )` quanto pra
   quem escreve sem parênteses (`ON a.x = b.x AND a.y = b.y`), os dois
   formatam igual. `USING` não ganha esse wrap — serve tanto a forma
   `USING (col1, col2)` de `JOIN` quanto a forma `USING outra_tabela` de
   `DELETE` multi-tabela do Postgres, e por isso fica como está.
6. `CASE`/`WHEN`/`THEN`/`ELSE`/`END` em blocos: o primeiro `WHEN` fica na
   mesma linha do `CASE`, cada `WHEN`/`THEN`/`ELSE` seguinte vira sua
   própria linha alinhada logo depois de `CASE ` (mesma coluna do
   primeiro `WHEN`), e `END` fecha alinhado com o próprio `CASE`. Vale
   tanto num item de `SELECT` quanto numa condição de `WHERE`/`ON`/etc.
7. Linha em branco separando `UNION ALL`/`UNION`/`EXCEPT`/`INTERSECT` do
   que vem antes/depois, e separando o bloco de CTEs de um `WITH` do
   statement que as consome (o `SELECT`/`INSERT`/`UPDATE`/`DELETE` logo
   após o fechamento `)`).
8. CTEs encadeadas sem indentação e sem linha em branco entre elas:
   fechamento de uma e abertura da próxima na mesma linha
   (`), proxima_cte AS (`).
9. Comentários `--` standalone (sozinhos na linha) sempre na coluna 1, sem
   indentação — mesmo dentro de CTEs/subqueries. Comentários no fim de uma
   linha de código permanecem no fim dessa linha.
10. Sem `;` no final do arquivo (a query é tratada como fragmento). Em
    arquivos com múltiplos statements, o `;` entre eles é mantido — só o
    último é removido.
11. Dentro de um corpo de `CREATE FUNCTION`/`PROCEDURE`, um bloco
    (`IF`/`FOR`/`BEGIN`) também ganha linha em branco depois (simétrico à
    que já ganha antes) — inclusive quando seguido direto por outro
    bloco. Um `RETURN`/`RETURN NEXT`/`RETURN QUERY` ganha o mesmo "linha
    em branco depois" sempre que vem mais statement na sequência, não só
    antes dele.
12. Comentários `--`/`/* */` de cabeçalho, logo antes de um statement,
    sempre saem um por linha — mesmo quando o resto desse statement não é
    modelado e cai no fallback de linha única.

Exemplo:

```sql
    SELECT ecm_conteudo.id,
           ecm_conteudo.nome,
           COUNT(ecm_assinatura.id) as total_assinaturas
      FROM ecm_conteudo
INNER JOIN ecm_assinatura
        ON ( ecm_assinatura.ecm_conteudo_id = ecm_conteudo.id )
     WHERE ecm_conteudo.categoria_id = 10
       AND ecm_conteudo.ativo = TRUE
  GROUP BY ecm_conteudo.id,
           ecm_conteudo.nome
  ORDER BY ecm_conteudo.nome
```

`ON` com mais de uma condição quebra uma por linha (funciona igual se o
`AND`/`OR` já vier entre parênteses no fonte ou não):

```sql
    SELECT issues.id
      FROM issues
INNER JOIN custom_values campo_nome
        ON ( campo_nome.customized_id = issues.id
         AND campo_nome.custom_field_id = 109 )
```

`CASE`/`WHEN`/`THEN` em blocos, um por linha (funciona tanto num item de
`SELECT` quanto dentro de uma condição de `WHERE`):

```sql
     WHERE issues.status_id <> 42
       AND CASE WHEN '${situacao}' = ''
                THEN TRUE
                WHEN '${situacao}' = 'a' -- Arquivados
                THEN issues.status_id = 41
           END
```

CTEs encadeadas:

```sql
WITH primeira_cte AS (
    SELECT a.id,
           a.valor::NUMERIC
      FROM tabela_a a
), segunda_cte AS (
    SELECT b.id
      FROM tabela_b b
)

    SELECT primeira_cte.id
      FROM primeira_cte
```

(O `SELECT` final ganha 4 espaços à esquerda mesmo sem `JOIN` por perto —
é a regra 1, o mínimo de 4 espaços antes do `SELECT`, entrando em ação,
já que sozinho o `FROM` só pediria 2.)

Subqueries em `FROM`/`JOIN` são formatadas recursivamente, com indentação
própria e seu próprio alinhamento de river (independente do escopo
externo) — o mesmo vale para o corpo de cada CTE.

`UPDATE`/`DELETE`/`INSERT` seguem o mesmo river style (`UPDATE`/`DELETE`
compartilham a máquina de cláusulas do `SELECT`, então `FROM`, `JOIN`,
`WHERE`/`AND`/`OR` etc. funcionam igual):

```sql
UPDATE ecm_conteudo
   SET nome = 'novo nome',
       ativo = TRUE
 WHERE ecm_conteudo.id = 1
   AND ecm_conteudo.categoria_id = 2
```

```sql
   DELETE
     FROM ecm_conteudo
    USING ecm_categoria
    WHERE ecm_conteudo.categoria_id = ecm_categoria.id
      AND ecm_categoria.ativo = FALSE
RETURNING ecm_conteudo.id
```

`INSERT INTO` compartilha o mesmo river com `VALUES`/`SELECT`/`RETURNING`
que vierem depois dele na mesma statement:

```sql
INSERT INTO ecm_conteudo (nome, categoria_id)
     VALUES ('a', 1),
            ('b', 2)
  RETURNING id
```

Definição de função/procedure (`CREATE [OR REPLACE] FUNCTION`/
`PROCEDURE` com corpo em dollar-quoting, `AS $$ ... $$`/`AS $tag$ ...
$tag$`) ganha layout próprio: cláusulas do cabeçalho uma por linha,
blocos `DECLARE`/`BEGIN`/`END`, `IF`/`THEN`/`ELSE`/`END IF`, `FOR var
IN (query) LOOP`/`END LOOP`, atribuição (`:=`) e `RETURN`/`RETURN
NEXT`/`RETURN QUERY` — qualquer `SELECT`/`INSERT`/`UPDATE`/`DELETE`
embutido no corpo passa pela mesma formatação river do resto. Uma
linha em branco separa uma query embutida de múltiplas linhas do que
vem depois dela, antecede o `RETURN`, e também antecede uma query
embutida ou um bloco `IF`/`FOR`/`BEGIN` aninhado quando vêm logo após
uma atribuição/DDL simples — statements simples consecutivos, por
outro lado, ficam colados, sem linha em branco entre eles:

```sql
CREATE OR REPLACE FUNCTION calculate_discount (p_customer_id integer, p_amount numeric)
RETURNS numeric
AS $$
DECLARE
    v_tier text;
    v_discount numeric;
BEGIN
    SELECT tier INTO v_tier
      FROM customers
     WHERE id = p_customer_id;

    IF ( v_tier = 'gold' )
    THEN
        v_discount := 0.20;
    ELSE
        v_discount := 0.05;
    END IF;

    RETURN p_amount * (1 - v_discount);
END;
$$
LANGUAGE plpgsql;
```

Fora de escopo: blocos `EXCEPTION`, `WHILE`/`CURSOR`, `EXECUTE`
dinâmico, `ELSIF`, e `FOR` sobre um range/expressão solta (`FOR i IN
1..10 LOOP`) — esses caem no fallback genérico de DDL (palavras-chave
maiúsculas, sem reestruturação), igual a qualquer outra coisa fora de
escopo. Veja "Escopo e limitações conhecidas" logo abaixo pra
ressalva sobre comentário `--`, que pesa mais aqui do que em qualquer
outro lugar do formatter. Se um comentário engolir um `IF`/`THEN`
desse jeito e sobrar um `ELSE`/`END` órfão que o formatter não
consegue casar, ele nunca chuta: a função/procedure inteira cai no
fallback de linha única em vez de inventar uma palavra-chave de
fechamento que não está no fonte.

### Uso

- **Formatar documento**: `Shift+Alt+F` (formatador padrão do VS Code
  para `.sql`), ou paleta de comandos → `SQL River Style: Format
  Document` (o título do comando é em inglês — a extensão ainda não tem
  tradução da paleta de comandos).
- **Format on save**: ative `"editor.formatOnSave": true` no VS Code para
  arquivos `.sql` (globalmente ou em `[sql]` no `settings.json`).

### Configuração

| Setting | Padrão | Descrição |
| --- | --- | --- |
| `sqlRiverStyle.indentSize` | `4` | Espaços usados para indentar corpo de CTEs e subqueries em `FROM`/`JOIN`. |
| `sqlRiverStyle.additionalFunctions` | `[]` | Nomes de função extras (além da lista nativa padrão) a maiusculizar quando usados como chamada de função, ex. `["fn_calcula_total"]`. |

### Escopo e limitações conhecidas

- Cobre `SELECT`/`WITH` (o caso comum de queries de relatório) e o DML
  básico — `INSERT`/`UPDATE`/`DELETE`, incluindo `UPDATE ... FROM`,
  `DELETE ... USING`, `INSERT ... VALUES`/`INSERT ... SELECT` e
  `RETURNING`. Outros statements (DDL, `MERGE`, comandos de sessão...)
  ficam fora do escopo: só têm as palavras-chave maiusculizadas, sem
  reestruturação em river style.
- Corpos de `CREATE FUNCTION`/`PROCEDURE` (veja o exemplo acima) cobrem
  o caso comum, mas não são um parser completo de PL/pgSQL: blocos
  `EXCEPTION`, `WHILE`, statements de cursor (`DECLARE ... CURSOR`,
  `OPEN`/`FETCH`/`CLOSE` — esses três ganham a palavra-chave
  maiusculizada, igual `RAISE`/`EXECUTE`/`PERFORM`, mas sem
  estruturação multi-linha), `EXECUTE` dinâmico, `ELSIF`, um `LOOP`
  incondicional (não envolvido em `FOR var IN ...`), e `FOR` sobre um
  range solto ou uma query sem parênteses (`FOR var IN SELECT ... LOOP`
  precisa de `(...)` ao redor da query pra ganhar tratamento
  multi-linha — `FOR var IN (SELECT ...) LOOP` ganha) não são modelados
  — renderizam via o fallback genérico de DDL (palavras-chave
  maiusculizadas, sem reestruturação): uma linha por trecho entre
  comentários, já que um comentário `--` sempre engole o resto da sua
  própria linha física e, sem essa quebra, "comeria" em silêncio código
  que no fonte original estava na linha seguinte. Igual a qualquer outro
  statement fora de escopo. Quando uma dessas construções aparece
  aninhada dentro de um bloco que seria modelado, o `CREATE FUNCTION`/
  `PROCEDURE` inteiro cai nesse fallback em vez de arriscar um resultado
  parcialmente reestruturado — veja
  `examples/formatted/` pra algumas funções reais (extraídas dos docs
  oficiais do PostgreSQL) que batem nisso. `RETURNS`/`LANGUAGE` são
  reconhecidos em qualquer ordem antes do corpo `AS $$` (parte do código
  põe `LANGUAGE` antes do corpo em vez de depois), e um corpo sem
  `DECLARE` nem `BEGIN...END` (uma função/procedure `LANGUAGE SQL` pura)
  é formatado como uma lista comum de statements. `SELECT INTO var` só
  ganha o tratamento de marcador combinado `SELECT INTO` quando `INTO`
  vem logo depois de `SELECT`; a ordem `SELECT col INTO var` é tratada
  como um `SELECT` comum.
- **Um comentário `--` sempre engole o resto da linha física de
  origem** — inclusive código de verdade colado na mesma linha. Isso é
  sintaxe normal de comentário SQL, não um bug do formatter: se um
  arquivo bruto tem `-- nota SELECT 1;` tudo numa linha só,
  "desengolir" o `SELECT 1;` significaria mudar o que o arquivo
  *significa* (transformar texto que parece comentado em código vivo de
  novo), não só reformatar — este formatter nunca faz isso. O
  resultado é o trecho inteiro virando uma linha de comentário (longa),
  sem alteração. Isso pesa mais dentro de corpos de `CREATE FUNCTION`
  exportados por ferramentas que colapsam espaços em branco, já que
  código procedural tende a ter muitos statements colados a
  comentários — confira arquivos assim manualmente antes de confiar na
  saída de olhos fechados.
- `INSERT ... ON CONFLICT` não é modelado especificamente — `ON CONFLICT
  (...) DO NOTHING` fica concatenado no fim da linha de `VALUES`; em
  `ON CONFLICT (...) DO UPDATE SET ...` o `SET` ganha sua própria linha
  (reaproveitando o marker normal de `SET`), mas o `ON CONFLICT (...) DO
  UPDATE` que vem antes dele fica todo na linha de `VALUES`. Não quebra a
  query, só não é formatado em cláusulas river completas.
- "Funções nativas" maiusculizadas vêm de uma lista fixa de funções do
  PostgreSQL (`src/formatter.ts`, constante `NATIVE_FUNCTIONS`); funções
  de negócio do seu banco só são maiusculizadas se listadas em
  `sqlRiverStyle.additionalFunctions`.
- `CASE` aninhado (um `CASE` dentro do `WHEN`/`THEN`/`ELSE` de outro) só
  quebra em blocos no `CASE` mais externo — o(s) aninhado(s) renderizam
  inline via `renderTokensInline`, igual a qualquer expressão comum.
- Identificadores entre aspas encadeados (`"tabela"."coluna"`, comum em
  SQL exportado por query builders como o do Laravel) são reconhecidos
  como um único identificador qualificado, preservando o `.` — assim como
  `tabela.coluna` sem aspas. Qualquer caractere não reconhecido por
  nenhuma regra do tokenizer (ex.: `?` de bind parameter de log de query)
  vira um token isolado em vez de ser descartado — o formatter nunca deve
  apagar conteúdo do SQL original em silêncio, mesmo que não saiba
  formatá-lo com o espaçamento ideal.
- Aspas desnecessárias em identificador são removidas: `"tabela"."coluna"`
  vira `tabela.coluna` quando o conteúdo é só minúsculas/dígito/`_` e não
  colide com uma palavra reservada do PostgreSQL. A checagem de colisão
  usa `RESERVED_KEYWORDS` (`src/tokenizer.ts`) — a lista completa de
  variantes "reserved" da [tabela oficial de keywords do
  Postgres](https://www.postgresql.org/docs/current/sql-keywords-appendix.html),
  não a `KEYWORD_SET` curada usada pra maiúsculas/marcador de cláusula
  (essa é bem menor de propósito — colocar `CREATE`/`TABLE`/`ARRAY`/etc.
  em maiúsculo sempre que aparecem bateria com DDL, fora do escopo deste
  formatter). Palavras não-reservadas do Postgres que também são nomes de
  coluna comuns (`date`, `time`, `type`, `value`, `text`, `name`...) nunca
  perdem as aspas por engano nem ficam forçadas a maiúsculo por essa
  lista, já que não são reservadas de verdade.
- Subqueries usadas dentro de uma expressão (`WHERE x IN (SELECT ...)`,
  `SELECT (SELECT ...) AS foo`) são renderizadas em uma linha só — apenas
  subqueries na posição de `FROM`/`JOIN` (derived table) recebem
  formatação multi-linha recursiva.
- Casts com nome de tipo composto por mais de uma palavra (`::double
  precision`, `::character varying`, `::timestamp with time zone`...) são
  maiusculizados por inteiro — a lista de frases reconhecidas é a
  constante `MULTI_WORD_CAST_TYPES` em `src/formatter.ts`. Um nome
  composto que não estiver nessa lista maiusculiza só a primeira palavra.

### Desenvolvimento

```bash
npm install
npm run compile            # ou: npm run watch
npm test                   # suíte de regressão (test/examples.ts) sobre todo arquivo em examples/
npm run smoke              # imprime a formatação de vários exemplos, para inspeção manual (test/smoke.ts)
npm run generate-examples  # (re)gera examples/formatted/ a partir de examples/original/ — confira o diff antes de commitar
```

A suíte de testes inteira mora como pares de arquivo dentro de `examples/`:
`examples/original/` guarda entradas SQL/PL-pgSQL — casos sintéticos curtos
que isolam uma regra de formatação cada, lado a lado com SQL real vindo de
várias fontes diferentes da internet (docs oficiais do PostgreSQL,
W3Schools, Sentry, Neon, Stack Overflow...) —, cada arquivo com um
comentário de cabeçalho documentando a origem (`caso sintético do formatter
sql-river-style` nos sintéticos). `examples/formatted/` é o diretório irmão
com a saída "corretamente formatada" correspondente — gerada por `npm run
generate-examples` e conferida manualmente antes de ser commitada.
`test/examples.ts` formata de novo cada arquivo de `examples/original/`,
agora num diretório temporário do sistema operacional, e compara com
`examples/formatted/` — qualquer mudança na formatação derruba `npm test`
até `examples/formatted/` ser regenerado e reconferido de propósito. Um
arquivo pode fixar opções não-padrão do `formatSql` via uma diretiva na
primeira linha — `-- sql-river-style-options: additionalFunctions=foo,bar`
(ver `test/example-options.ts`) —, hoje usada só no arquivo que cobre a
configuração `sqlRiverStyle.additionalFunctions`.

Para depurar dentro do VS Code: abra a raiz deste repositório como
workspace e pressione `F5` (Extension Development Host).

Para gerar um pacote instalável:

```bash
npx @vscode/vsce package
```

Isso gera um `.vsix` que pode ser instalado via
`code --install-extension sql-river-style-1.0.0.vsix` ou pela aba de
Extensões do VS Code → `Install from VSIX...`.

### Licença

[MIT](LICENSE) — © Eduardo Braun.
