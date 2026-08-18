/**
 * Formatter de SQL no estilo "river" (ver memória
 * feedback-sql-formatting-style). Não é um formatter SQL genérico e
 * configurável: é deliberadamente opinativo, reproduzindo as 9 regras
 * confirmadas pelo usuário. Ver README.md para exemplos e limitações
 * conhecidas.
 *
 * Abordagem: tokeniza o SQL (tokenizer.ts) e formata em cima do fluxo de
 * tokens usando profundidade de parênteses para achar limites de cláusula
 * — não é um parser de gramática completa. Cobre bem o caso comum
 * (SELECT/CTE/JOIN/UNION ALL de queries de relatório); construções raras
 * ficam documentadas como limitação em vez de arriscar formatar errado.
 */

import { Token, tokenize, quoteIdentIfNeeded } from './tokenizer';
import { DepthCursor, matchParen, findAtDepth0, findStatementEnd, hasCommaAtDepth0, splitAtCommaDepth0, splitAtSetOpDepth0, stripOuterParens } from './token-scan';
import { tryFormatCreateFunction, tryFormatCreateType } from './plpgsql';

export interface FormatOptions {
  /** Quantidade de espaços usada para indentar corpos de CTE e subqueries. */
  indentSize?: number;
  /** Nomes extras de função nativa a maiusculizar, além da lista padrão. */
  additionalFunctions?: string[];
}

export interface Cfg {
  indentSize: number;
  nativeFunctions: Set<string>;
  /**
   * plpgsql.ts precisa chamar de volta pro motor de query e pras primitivas
   * de renderização de expressão daqui de formatter.ts, mas não pode
   * importá-las como valor: formatter.ts importa `tryFormatCreateFunction`/
   * `tryFormatCreateType` DE plpgsql.ts, então um import de valor na
   * direção contrária fecharia um require() circular em CommonJS. `render`
   * é a injeção de dependência que resolve isso — populado uma vez aqui em
   * `buildCfg`, plpgsql.ts só importa o TIPO `Cfg` (apagado na compilação,
   * sem `require()`).
   */
  render: {
    query: typeof formatQuery;
    tokensInline: typeof renderTokensInline;
    expressionLines: typeof renderExpressionLines;
    uppercaseTypes: typeof uppercaseTypeTokens;
    fallbackLines: typeof renderFallbackLines;
    firstKeyword: typeof firstMeaningfulKeyword;
  };
}

/** Funções nativas do PostgreSQL cobertas por padrão (regra 4: maiúsculas). */
const NATIVE_FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'GREATEST', 'LEAST',
  'CAST', 'EXTRACT', 'DATE_TRUNC', 'DATE_PART', 'AGE', 'NOW', 'CURRENT_DATE',
  'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP',
  'TO_CHAR', 'TO_DATE', 'TO_TIMESTAMP', 'TO_NUMBER',
  'LOWER', 'UPPER', 'INITCAP', 'TRIM', 'LTRIM', 'RTRIM', 'LENGTH', 'CHAR_LENGTH',
  'SUBSTRING', 'SUBSTR', 'CONCAT', 'CONCAT_WS', 'REPLACE', 'SPLIT_PART',
  'POSITION', 'LPAD', 'RPAD', 'REPEAT', 'REVERSE',
  'ROUND', 'FLOOR', 'CEIL', 'CEILING', 'ABS', 'MOD', 'POWER', 'SQRT', 'TRUNC', 'SIGN',
  'ARRAY_AGG', 'ARRAY_LENGTH', 'ARRAY_TO_STRING', 'ARRAY_APPEND', 'ARRAY_REMOVE',
  'ARRAY_POSITION', 'UNNEST', 'GENERATE_SERIES', 'STRING_AGG',
  'JSON_AGG', 'JSON_BUILD_OBJECT', 'JSON_BUILD_ARRAY', 'JSON_OBJECT_AGG',
  'JSONB_AGG', 'JSONB_BUILD_OBJECT', 'JSONB_BUILD_ARRAY', 'JSONB_ARRAY_ELEMENTS',
  'JSONB_ARRAY_ELEMENTS_TEXT', 'JSON_EXTRACT_PATH', 'JSONB_EXTRACT_PATH',
  'JSONB_SET', 'JSONB_PRETTY',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LAG', 'LEAD',
  'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE', 'PERCENT_RANK', 'CUME_DIST',
  'REGEXP_REPLACE', 'REGEXP_MATCH', 'REGEXP_MATCHES', 'REGEXP_SPLIT_TO_ARRAY',
  'REGEXP_SPLIT_TO_TABLE',
  'CURRENT_USER', 'SESSION_USER', 'MD5', 'SHA256',
  'FORMAT', 'QUOTE_IDENT', 'QUOTE_LITERAL', 'QUOTE_NULLABLE',
]);

/** Subconjunto de `NATIVE_FUNCTIONS` que também são válidos SEM parênteses
 * (são keywords especiais do SQL standard, não chamadas de função comuns —
 * `CURRENT_TIMESTAMP - interval '1 day'` é tão válido quanto `now()`).
 * `renderTokensInline` normalmente só maiusculiza função nativa quando vem
 * seguida de `(` (pra não forçar maiúscula num identificador comum que só
 * coincide de nome, ex. uma coluna chamada "count"); esse subconjunto
 * ignora essa exigência. */
const NILADIC_NATIVE_FUNCTIONS = new Set([
  'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP',
  'CURRENT_USER', 'SESSION_USER',
]);

/** Exportado só pra teste direto de plpgsql.ts (test/plpgsql.ts) — é a
 * única forma de montar um `Cfg` de verdade, com `render.*` ligado nas
 * funções reais, sem duplicar essa injeção fora daqui. */
export function buildCfg(options: FormatOptions): Cfg {
  return {
    indentSize: options.indentSize ?? 4,
    nativeFunctions: new Set([
      ...NATIVE_FUNCTIONS,
      ...(options.additionalFunctions ?? []).map((f) => f.toUpperCase()),
    ]),
    render: {
      query: formatQuery,
      tokensInline: renderTokensInline,
      expressionLines: renderExpressionLines,
      uppercaseTypes: uppercaseTypeTokens,
      fallbackLines: renderFallbackLines,
      firstKeyword: firstMeaningfulKeyword,
    },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function formatSql(source: string, options: FormatOptions = {}): string {
  const cfg = buildCfg(options);
  const tokens = tokenize(source);

  if (tokens.length === 0) {
    return '';
  }
  if (tokens.every((t) => t.type === 'comment' || t.type === 'blockComment')) {
    return tokens.map((t) => t.text).join('\n') + '\n';
  }

  const statements = splitStatements(tokens);
  const rendered = statements.map((stmt) => formatStatement(stmt, cfg)).filter((s) => s.text.trim().length > 0);

  if (rendered.length === 0) {
    return '';
  }
  // Regra 9: sem `;` no final. Entre statements (arquivo com múltiplas
  // queries) o `;` é mantido, pois é necessário para a validade do SQL.
  // Exceção: CREATE FUNCTION/PROCEDURE/TYPE sempre mantêm o `;` final, mesmo
  // sendo o último (ou único) statement do arquivo — ao contrário de um
  // SELECT (comumente colado como fragmento em outro lugar), aqui o `;`
  // fecha de fato o corpo entre `$tag$`/`LANGUAGE` ou a lista de campos.
  const last = rendered[rendered.length - 1];
  const trailingSemicolon = last.ownSemicolon ? ';' : '';
  return rendered.map((r) => r.text).join(';\n\n') + trailingSemicolon + '\n';
}

interface StatementResult {
  text: string;
  /** true para CREATE FUNCTION/PROCEDURE/TYPE — mantêm `;` mesmo no fim do arquivo (ver regra 9 em `formatSql`). */
  ownSemicolon: boolean;
}

function formatStatement(tokens: Token[], cfg: Cfg): StatementResult {
  if (tokens.length === 0) {
    return { text: '', ownSemicolon: false };
  }

  // Comentários de cabeçalho (antes de qualquer código do statement) são
  // extraídos uma vez aqui, uma linha cada, e prefixados no resultado final
  // não importa qual caminho abaixo formata o resto — inclusive o fallback
  // de linha única genérico, que de outra forma colaria os comentários
  // junto com o código todo numa linha só (ver README, limitação sobre
  // comentário engolindo código: aqui não tem código sendo engolido, só
  // comentários de linhas diferentes grudando um no outro).
  let cursor = 0;
  const leadingComments: string[] = [];
  while (tokens[cursor] && (tokens[cursor].type === 'comment' || tokens[cursor].type === 'blockComment')) {
    leadingComments.push(tokens[cursor].text);
    cursor++;
  }
  const rest = cursor > 0 ? tokens.slice(cursor) : tokens;
  const prefix = leadingComments.length > 0 ? leadingComments.join('\n') + '\n' : '';

  if (rest.length === 0) {
    // Statement era só comentário(s) — não deveria rolar aqui de verdade
    // (ver o `every` de comentário em `formatSql`), mas por segurança
    // devolve os comentários em vez de um StatementResult vazio.
    return { text: leadingComments.join('\n'), ownSemicolon: false };
  }

  const createFn = tryFormatCreateFunction(rest, cfg);
  if (createFn) {
    return { text: prefix + trimBlankEdges(createFn).join('\n'), ownSemicolon: true };
  }
  const createType = tryFormatCreateType(rest, cfg);
  if (createType) {
    return { text: prefix + trimBlankEdges(createType).join('\n'), ownSemicolon: true };
  }

  const FORMATTABLE = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE']);
  const firstKeyword = firstMeaningfulKeyword(rest);
  if (!firstKeyword || !FORMATTABLE.has(firstKeyword)) {
    // Statements que não são consulta/DML básico (DDL, MERGE, comandos de
    // sessão...) ficam fora do escopo das regras de river style.
    // Maiusculiza palavras-chave e devolve numa linha só por trecho entre
    // comentários (ver `renderFallbackLines`), sem arriscar reestruturar o
    // que não é modelado por este formatter.
    return { text: prefix + renderFallbackLines(rest, cfg).join('\n'), ownSemicolon: false };
  }

  const lines = formatQuery(rest, 0, cfg);
  return { text: prefix + trimBlankEdges(lines).join('\n'), ownSemicolon: false };
}

function trimBlankEdges(lines: string[]): string[] {
  while (lines.length > 0 && lines[0] === '') {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function firstMeaningfulKeyword(tokens: Token[]): string | undefined {
  for (const t of tokens) {
    if (t.type === 'comment' || t.type === 'blockComment') {
      continue;
    }
    return t.upper;
  }
  return undefined;
}

function splitStatements(tokens: Token[]): Token[][] {
  const statements: Token[][] = [];
  let depth = 0;
  // Tag do dollar-quote aberto no momento (null fora de um corpo de
  // função/procedure). Enquanto aberto, `;` não separa statement — um
  // corpo de função tem um `;` por statement interno, e não são eles que
  // devem virar limite de arquivo (ver README, "Definição de função").
  let openTag: string | null = null;
  let current: Token[] = [];
  for (const t of tokens) {
    if (t.type === 'dollarQuote') {
      openTag = openTag === null ? t.text : openTag === t.text ? null : openTag;
      current.push(t);
      continue;
    }
    if (openTag !== null) {
      current.push(t);
      continue;
    }
    if (t.text === '(') {
      depth++;
    } else if (t.text === ')') {
      depth--;
    } else if (t.text === ';' && depth === 0) {
      statements.push(current);
      current = [];
      continue;
    }
    current.push(t);
  }
  if (current.length > 0) {
    statements.push(current);
  }
  return statements;
}

// ---------------------------------------------------------------------------
// WITH ... / SELECT ... UNION ALL SELECT ... chain
// ---------------------------------------------------------------------------

/**
 * `nested`: true quando `tokens` é o corpo de um aninhamento sintático de
 * verdade — subquery entre parênteses (`FROM (...)`, `FOR ... IN (...)`,
 * `IF (SELECT ...)`, `CREATE TEMP TABLE x AS (...)`) ou corpo de CTE
 * (`WITH x AS (...)`) — e não um statement comum que só está indentado por
 * já estar dentro de um corpo de função (`BEGIN`/`LOOP`/`IF`...). Regra
 * confirmada pelo usuário: só o aninhamento sintático de verdade ganha
 * `cfg.indentSize` a mais na coluna de alinhamento das keywords, além do
 * `indent` que já vem embutido — ver `formatSelectChain`. Um `SELECT`
 * embutido no corpo de uma função (`renderSimpleBodyStatement`) passa
 * `nested: false` (padrão): já está na indentação certa por causa do
 * BEGIN/LOOP/IF ao redor, sem precisar de nada a mais.
 */
function formatQuery(tokens: Token[], indent: number, cfg: Cfg, nested = false): string[] {
  const lines: string[] = [];
  let cursor = 0;

  while (tokens[cursor] && (tokens[cursor].type === 'comment' || tokens[cursor].type === 'blockComment') && tokens[cursor].standalone) {
    lines.push(tokens[cursor].text);
    cursor++;
  }

  if (tokens[cursor]?.upper === 'WITH') {
    cursor++;
    let withLabel = 'WITH';
    if (tokens[cursor]?.upper === 'RECURSIVE') {
      withLabel = 'WITH RECURSIVE';
      cursor++;
    }

    let cteIndex = 0;
    for (;;) {
      while (tokens[cursor] && (tokens[cursor].type === 'comment' || tokens[cursor].type === 'blockComment') && tokens[cursor].standalone) {
        lines.push(tokens[cursor].text);
        cursor++;
      }

      const nameTok = tokens[cursor++];
      let header = nameTok ? nameTok.text : '';
      if (tokens[cursor]?.text === '(') {
        const start = cursor;
        cursor = matchParen(tokens, cursor);
        header += ' ' + renderTokensInline(tokens.slice(start, cursor), cfg);
      }
      if (tokens[cursor]?.upper === 'AS') {
        cursor++;
      }
      const openIdx = cursor;
      const bodyEnd = matchParen(tokens, openIdx) - 1;
      const bodyTokens = tokens.slice(openIdx + 1, bodyEnd);
      cursor = bodyEnd + 1;

      const prefix = cteIndex === 0 ? `${' '.repeat(indent)}${withLabel} ` : `${' '.repeat(indent)}), `;
      lines.push(`${prefix}${header} AS (`);
      // Corpo de CTE não é aninhamento sintático pra fins de alinhamento
      // (diferente de subquery em FROM/FOR...IN): regra confirmada pelo
      // usuário — o corpo de uma CTE nunca ganha bônus de indentação, se
      // comporta como se fosse uma query solta no nível mais externo (por
      // isso `indent` não incrementa aqui, e `nested` fica false).
      lines.push(...formatQuery(bodyTokens, indent, cfg, false));

      cteIndex++;
      if (tokens[cursor]?.text === ',') {
        // CTEs encadeadas colam direto: sem linha em branco entre o corpo
        // de uma CTE e o `), proxima_cte AS (` da seguinte (essa linha já
        // é o próprio separador visual).
        cursor++;
        continue;
      }
      break;
    }
    lines.push(`${' '.repeat(indent)})`);
    // Regra 6: linha em branco separando o bloco de CTEs (WITH ... )) do
    // statement que as consome (SELECT/INSERT/UPDATE/DELETE).
    lines.push('');
  }

  lines.push(...formatSelectChain(tokens.slice(cursor), indent, cfg, nested));
  return lines;
}

function formatSelectChain(tokens: Token[], indent: number, cfg: Cfg, nested = false): string[] {
  const { blocks, ops } = splitAtSetOpDepth0(tokens);
  const parsedBlocks = blocks.map((b) => parseSelectBlock(b));
  const width = computeWidth(parsedBlocks, ops, indent, nested, cfg);

  const lines: string[] = [];
  parsedBlocks.forEach((block, idx) => {
    if (idx > 0) {
      const op = ops[idx - 1];
      lines.push('');
      lines.push(`${' '.repeat(Math.max(0, width - op.length))}${op}`);
      lines.push('');
    }
    lines.push(...renderSelectBlock(block, indent, width, cfg));
  });
  return lines;
}

/** A keyword que abre o statement (`SELECT`/`SELECT INTO`, `UPDATE`,
 * `DELETE`, `INSERT INTO`) nunca fica com menos de 4 espaços de indentação
 * antes dela, mesmo quando ela mesma já é a keyword mais longa da query
 * (ex.: um `UPDATE` sem `FROM` cuja única outra cláusula é `WHERE` — sem
 * essa regra, `UPDATE` ficaria colado na margem por ser a mais longa).
 * Regra confirmada pelo usuário originalmente só pro `SELECT`, estendida
 * aqui pros outros abridores de statement pelo mesmo raciocínio. Não afeta
 * escopos aninhados com o indentSize padrão (4): o próprio indent já
 * garante os 4 espaços. */
const MIN_PAD_BEFORE_OPENER = 4;

/** Labels de cláusula que abrem um statement (nunca aparecem como cláusula
 * "no meio" de outro tipo de statement) — únicas elegíveis pra regra do
 * `MIN_PAD_BEFORE_OPENER` acima. */
const OPENER_LABELS = new Set(['SELECT', 'SELECT INTO', 'UPDATE', 'DELETE', 'INSERT INTO', 'INSERT']);

/**
 * Devolve a coluna final onde as keywords desse bloco/cadeia terminam
 * alinhadas à direita — quem chama usa só `width - label.length`.
 *
 * `naturalMax` é o comprimento da maior label/operador de fato presente
 * (`INNER JOIN`, `GROUP BY`...). `floor` é o piso mínimo pro opener do
 * statement (`SELECT`/`UPDATE`/`DELETE`/`INSERT INTO`) — nunca menos que
 * `MIN_PAD_BEFORE_OPENER` de espaço antes dele, mesmo quando é a keyword
 * mais longa da query.
 *
 * A base somada ao piso depende de `nested` (ver `formatQuery` sobre a
 * diferença). Num aninhamento sintático de verdade (CTE, subquery em
 * `FROM`/`FOR ... IN (...)`/etc.) a base é sempre um `cfg.indentSize` fixo
 * — não o `indent` de verdade do container, não importa quão fundo ele já
 * esteja (regra confirmada pelo usuário: uma query aninhada tem sempre um
 * único nível de recuo visual próprio, igual ela estivesse logo abaixo do
 * nível mais externo, mesmo quando o container em si já está fundo dentro
 * de uma função). Um statement comum embutido no corpo de uma função
 * (dentro de um BEGIN/LOOP/IF) usa o `indent` de verdade, com o piso
 * reduzido pela própria indentação (`Math.max(0, MIN_PAD_BEFORE_OPENER -
 * indent)`): a indentação do corpo ao redor já cobre a exigência de "nunca
 * colado na margem", então o piso não soma nada extra além do indent.
 */
function computeWidth(blocks: ClauseLine[][], ops: string[], indent: number, nested: boolean, cfg: Cfg): number {
  let naturalMax = 0;
  let opener: string | null = null;
  for (const block of blocks) {
    for (const line of block) {
      naturalMax = Math.max(naturalMax, line.label.length);
      if (opener === null && OPENER_LABELS.has(line.label)) {
        opener = line.label;
      }
    }
  }
  for (const op of ops) {
    naturalMax = Math.max(naturalMax, op.length);
  }
  if (nested) {
    const floor = opener === null ? 0 : MIN_PAD_BEFORE_OPENER + opener.length;
    return cfg.indentSize + Math.max(naturalMax, floor);
  }
  const floor = opener === null ? 0 : opener.length + Math.max(0, MIN_PAD_BEFORE_OPENER - indent);
  return indent + Math.max(naturalMax, floor);
}

// ---------------------------------------------------------------------------
// SELECT block: quebra em cláusulas (SELECT/FROM/JOIN/ON/WHERE/...)
// ---------------------------------------------------------------------------

interface Marker {
  start: number;
  end: number;
  kind: string;
  label: string;
}

interface ClauseLine {
  label: string;
  kind: string;
  body: Token[];
}

function mk(start: number, end: number, kind: string, label: string): Marker {
  return { start, end, kind, label };
}

const JOIN_PREFIXES = new Set(['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS']);

function findMarkers(tokens: Token[]): Marker[] {
  const markers: Marker[] = [];
  // `DepthCursor` (token-scan.ts) é quem sabe achar o nível de topo — CASE
  // não usa parênteses, então precisa do próprio contador: sem isso, um
  // AND/OR dentro de um WHEN/THEN (ex.: `CASE WHEN a AND b THEN ...`) é
  // confundido com o AND/OR de encadeamento do WHERE, e o CASE acaba
  // partido ao meio em cláusulas soltas. findMarkers dirige o cursor
  // diretamente (em vez de usar uma função de conveniência) porque reage a
  // ~15 palavras-chave diferentes por token, não a uma busca/divisão só.
  const cursor = new DepthCursor();
  let seenFrom = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    cursor.advance(t);
    if (!cursor.atTop() || t.type !== 'keyword') {
      continue;
    }
    const u = t.upper;

    if (u === 'SELECT') {
      // `SELECT INTO var ...` (PL/pgSQL, só válido dentro de function/
      // procedure) — "SELECT INTO" conta como um marcador só, do mesmo
      // jeito que "INSERT INTO", empurrando FROM/WHERE mais pra direita.
      // Só cobre essa ordem (INTO logo após SELECT); `SELECT col INTO var
      // FROM` fica sem esse ajuste especial.
      if (tokens[i + 1]?.upper === 'INTO') {
        markers.push(mk(i, i + 2, 'SELECT', 'SELECT INTO'));
        i++;
      } else {
        markers.push(mk(i, i + 1, 'SELECT', 'SELECT'));
      }
      continue;
    }
    if (u === 'FROM') {
      markers.push(mk(i, i + 1, 'FROM', 'FROM'));
      seenFrom = true;
      continue;
    }
    if (u === 'WHERE') {
      markers.push(mk(i, i + 1, 'WHERE', 'WHERE'));
      continue;
    }
    if (u === 'HAVING') {
      markers.push(mk(i, i + 1, 'HAVING', 'HAVING'));
      continue;
    }
    if (u === 'LIMIT') {
      markers.push(mk(i, i + 1, 'LIMIT', 'LIMIT'));
      continue;
    }
    if (u === 'OFFSET') {
      markers.push(mk(i, i + 1, 'OFFSET', 'OFFSET'));
      continue;
    }
    if (u === 'ON' && seenFrom && tokens[i + 1]?.upper !== 'CONFLICT') {
      markers.push(mk(i, i + 1, 'ON', 'ON'));
      continue;
    }
    if (u === 'USING') {
      // Serve duas construções diferentes: `JOIN ... USING (col1, col2)`
      // (lista de colunas) e `DELETE FROM t USING outra_tabela` (like FROM,
      // sem parênteses). Não dá pra distinguir por depth/seenFrom sozinho,
      // então os dois caem no render genérico de linha única — só o `ON`
      // ganha o wrap especial da regra 5.
      markers.push(mk(i, i + 1, 'USING', 'USING'));
      continue;
    }
    if (u === 'DELETE') {
      markers.push(mk(i, i + 1, 'DELETE', 'DELETE'));
      continue;
    }
    if (u === 'UPDATE' && tokens[i - 1]?.upper !== 'DO') {
      // "DO UPDATE" só aparece dentro de `ON CONFLICT (...) DO UPDATE SET
      // ...` — não é o início de um novo statement UPDATE, então não abre
      // cláusula própria (o SET logo depois já vira sua própria linha).
      markers.push(mk(i, i + 1, 'UPDATE', 'UPDATE'));
      continue;
    }
    if (u === 'SET') {
      markers.push(mk(i, i + 1, 'SET', 'SET'));
      continue;
    }
    if (u === 'INSERT') {
      if (tokens[i + 1]?.upper === 'INTO') {
        markers.push(mk(i, i + 2, 'INSERT_INTO', 'INSERT INTO'));
        i++;
      } else {
        markers.push(mk(i, i + 1, 'INSERT_INTO', 'INSERT'));
      }
      continue;
    }
    if (u === 'VALUES') {
      markers.push(mk(i, i + 1, 'VALUES', 'VALUES'));
      continue;
    }
    if (u === 'RETURNING') {
      markers.push(mk(i, i + 1, 'RETURNING', 'RETURNING'));
      continue;
    }
    if (u === 'GROUP' && tokens[i + 1]?.upper === 'BY') {
      markers.push(mk(i, i + 2, 'GROUP_BY', 'GROUP BY'));
      i++;
      continue;
    }
    if (u === 'ORDER' && tokens[i + 1]?.upper === 'BY') {
      markers.push(mk(i, i + 2, 'ORDER_BY', 'ORDER BY'));
      i++;
      continue;
    }
    if (u === 'AND') {
      if (cursor.consumeBetweenAnd(t)) {
        continue;
      }
      markers.push(mk(i, i + 1, 'AND', 'AND'));
      continue;
    }
    if (u === 'OR') {
      markers.push(mk(i, i + 1, 'OR', 'OR'));
      continue;
    }
    if (u === 'JOIN' && seenFrom) {
      markers.push(mk(i, i + 1, 'JOIN', 'JOIN'));
      continue;
    }
    if (seenFrom && JOIN_PREFIXES.has(u)) {
      let j = i + 1;
      let label = u;
      if (tokens[j]?.upper === 'OUTER') {
        label += ' OUTER';
        j++;
      }
      if (tokens[j]?.upper === 'JOIN') {
        markers.push(mk(i, j + 1, 'JOIN', `${label} JOIN`));
        i = j;
        continue;
      }
    }
  }
  return markers;
}

function parseSelectBlock(tokens: Token[]): ClauseLine[] {
  const markers = findMarkers(tokens);
  return markers.map((m, k) => {
    const bodyStart = m.end;
    const bodyEnd = k + 1 < markers.length ? markers[k + 1].start : tokens.length;
    return { label: m.label, kind: m.kind, body: tokens.slice(bodyStart, bodyEnd) };
  });
}

function renderSelectBlock(clauseLines: ClauseLine[], indent: number, width: number, cfg: Cfg): string[] {
  const out: string[] = [];
  // Aliases do SELECT que precisam de aspas (maiúscula/espaço/reservada)
  // ficam "lembrados" aqui pra quando GROUP BY/ORDER BY os referenciarem
  // pelo nome — ver `collectQuotedAliases`. `undefined` até o SELECT
  // aparecer (não deveria rolar, mas por segurança), e trocado sempre que
  // um SELECT novo é visto (uma query com múltiplos SELECTs encadeados por
  // UNION, por exemplo, tem uma lista de aliases própria pra cada um).
  let selectAliases: Map<string, string> | undefined;
  for (let i = 0; i < clauseLines.length; i++) {
    const line = clauseLines[i];
    if (line.kind === 'SELECT') {
      const collected = collectQuotedAliases(line.body);
      selectAliases = collected.size > 0 ? collected : undefined;
    }
    if (line.kind === 'ON') {
      // AND/OR que seguem um ON pertencem à condição do JOIN — agrupa e
      // quebra uma linha por conector dentro dos parênteses, em vez de
      // deixá-los virar linhas soltas de WHERE (ver renderOnGroup).
      const condLines: ClauseLine[] = [];
      let j = i + 1;
      while (j < clauseLines.length && (clauseLines[j].kind === 'AND' || clauseLines[j].kind === 'OR')) {
        condLines.push(clauseLines[j]);
        j++;
      }
      out.push(...renderOnGroup(line, condLines, width, cfg));
      i = j - 1;
      continue;
    }
    out.push(...renderClauseLine(line, indent, width, cfg, selectAliases));
  }
  return out;
}

/**
 * Mapeia, pra cada item do SELECT com alias "quotado" — identificador entre
 * aspas no fonte, ou string convertida em identificador por
 * `renderTokensInline` (`AS 'Foo'`, ver `stringLiteralInner`) —, o nome
 * final sem aspas (já dobrado pra minúsculo, igual uma referência solta a
 * ele chega tokenizada — regra 1) pra forma com aspas. Usado por
 * `renderSelectBlock` pra "lembrar" esses aliases quando GROUP BY/ORDER BY
 * os referenciam pelo nome como um identificador solto: sem isso, a
 * referência (sem aspas, dobrada pra minúsculo) deixa de bater com o alias
 * entre aspas — SQL inválido no Postgres, não só feio.
 */
function collectQuotedAliases(body: Token[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of splitAtCommaDepth0(body)) {
    if (item.length === 0) {
      continue;
    }
    const last = item[item.length - 1];
    const prev = item[item.length - 2];
    let quoted: string | null = null;
    if (last.type === 'ident' && last.text.startsWith('"')) {
      quoted = last.text;
    } else if (last.type === 'string' && prev?.type === 'keyword' && prev.upper === 'AS') {
      quoted = quoteIdentIfNeeded(stringLiteralInner(last.text));
    }
    if (quoted === null || !quoted.startsWith('"')) {
      // Alias sem aspas (ou que não precisa delas) não precisa de
      // propagação — a referência solta em GROUP BY/ORDER BY já bate por
      // padrão (os dois lados dobram pro mesmo minúsculo).
      continue;
    }
    const bareName = quoted.slice(1, -1).replace(/""/g, '"');
    map.set(bareName.toLowerCase(), quoted);
  }
  return map;
}

/**
 * Renderiza `ON` e o(s) AND/OR que vierem logo depois como um bloco só:
 * primeira condição na mesma linha do `ON (`, cada AND/OR seguinte em sua
 * própria linha (right-aligned entre si), fechando o `)` no fim da última.
 * Sem AND/OR depois, cai no render de sempre (`ON ( cond )` em uma linha).
 */
interface AndOrSegment {
  /** null no primeiro segmento; "AND"/"OR" nos seguintes. */
  connector: string | null;
  tokens: Token[];
}

/**
 * Divide `tokens` em segmentos separados por AND/OR de profundidade 0 (sem
 * entrar em parênteses nem em CASE...END, e sem contar o AND de um
 * BETWEEN...AND como separador). É a mesma lógica de `findMarkers` para
 * AND/OR, só que operando dentro de um único corpo de cláusula já extraído
 * (o corpo do ON, tipicamente `( cond1 AND cond2 )` — depth 1 lá fora, mas
 * depth 0 aqui dentro, pois quem chama já tirou os parênteses externos).
 */
function splitTopLevelAndOr(tokens: Token[]): AndOrSegment[] {
  const segments: AndOrSegment[] = [{ connector: null, tokens: [] }];
  const cursor = new DepthCursor();

  for (const t of tokens) {
    cursor.advance(t);
    if (cursor.atTop() && t.type === 'keyword' && (t.upper === 'AND' || t.upper === 'OR') && !cursor.consumeBetweenAnd(t)) {
      segments.push({ connector: t.upper, tokens: [] });
      continue;
    }
    segments[segments.length - 1].tokens.push(t);
  }
  return segments;
}

/**
 * Renderiza `ON` — com uma condição só (`ON ( cond )`, uma linha) ou várias
 * encadeadas por AND/OR (`ON ( cond1\n AND cond2 )`, uma linha por
 * conector, alinhadas sob a primeira condição). `condLines` cobre o caso
 * raro de ON sem parênteses no fonte, onde o AND/OR vira marker próprio em
 * vez de ficar dentro do corpo do ON — reincorporado ao corpo antes de
 * dividir, pra tratar os dois casos com o mesmo código.
 */
function renderOnGroup(onLine: ClauseLine, condLines: ClauseLine[], width: number, cfg: Cfg): string[] {
  const fullBody = onLine.body.slice();
  for (const c of condLines) {
    fullBody.push({ type: 'keyword', text: c.label, upper: c.label });
    fullBody.push(...c.body);
  }

  const stripped = stripOuterParens(fullBody);
  const segments = splitTopLevelAndOr(stripped);

  const pad = ' '.repeat(Math.max(0, width - onLine.label.length));
  const connectorWidth = segments.length > 1 ? Math.max(...segments.slice(1).map((s) => s.connector!.length)) : 0;
  const connectorBase = pad.length + 1;
  const out: string[] = [];

  segments.forEach((seg, idx) => {
    const { comments, clean } = extractStandaloneComments(seg.tokens);
    out.push(...comments);
    const isLast = idx === segments.length - 1;
    const prefix =
      idx === 0
        ? `${pad}${onLine.label} ( `
        : `${' '.repeat(connectorBase + (connectorWidth - seg.connector!.length))}${seg.connector} `;

    if (isLast) {
      const { body, trailing } = splitTrailingComments(clean);
      const lines = renderExpressionLines(body, prefix.length, cfg);
      lines[0] = prefix + lines[0];
      lines[lines.length - 1] += ` )${renderTrailingComments(trailing)}`;
      out.push(...lines);
    } else {
      const lines = renderExpressionLines(clean, prefix.length, cfg);
      lines[0] = prefix + lines[0];
      out.push(...lines);
    }
  });

  return out;
}

const LIST_KINDS = new Set(['SELECT', 'GROUP_BY', 'ORDER_BY', 'SET', 'VALUES', 'RETURNING']);

function renderClauseLine(line: ClauseLine, indent: number, width: number, cfg: Cfg, selectAliases?: Map<string, string>): string[] {
  const pad = ' '.repeat(Math.max(0, width - line.label.length));
  const contentIndent = ' '.repeat(width + 1);

  if (LIST_KINDS.has(line.kind)) {
    // Cada item cuida dos seus próprios comentários standalone (podem
    // aparecer entre colunas); não extrair no nível da cláusula inteira,
    // senão um comentário do meio da lista sobe para antes do primeiro item.
    const out: string[] = [];
    // Alias do SELECT só é propagado em GROUP BY/ORDER BY (únicas cláusulas
    // que podem referenciar um alias pelo nome — ver `collectQuotedAliases`).
    const aliasMap = line.kind === 'GROUP_BY' || line.kind === 'ORDER_BY' ? selectAliases : undefined;
    pushItemList(out, line.body, line.label, pad, contentIndent, cfg, aliasMap);
    return out;
  }

  const { comments, clean } = extractStandaloneComments(line.body);
  const out: string[] = [...comments];

  if (line.kind === 'FROM' || line.kind === 'JOIN') {
    // Coluna do "(" que abre a subquery (`${pad}${label} (`) — o ")" que
    // fecha alinha embaixo dele, não com o indent de fora.
    const parenColumn = pad.length + line.label.length + 1;
    const sub = trySubquery(clean, indent, cfg, parenColumn);
    if (sub) {
      out.push(`${pad}${line.label} ${sub[0]}`, ...sub.slice(1));
      return out;
    }
    if (hasCommaAtDepth0(clean)) {
      pushItemList(out, clean, line.label, pad, contentIndent, cfg);
      return out;
    }
    out.push(`${pad}${line.label} ${renderTokensInline(clean, cfg)}`);
    return out;
  }

  if (line.kind === 'ON') {
    // Regra 5: só a condição de JOIN ganha o wrap `( ... )` com espaço
    // interno. USING não — serve tanto a forma `USING (col1, col2)` de
    // JOIN quanto a forma `USING outra_tabela` de DELETE multi-tabela, e
    // cai no render genérico logo abaixo.
    const { body: bodyNoComment, trailing } = splitTrailingComments(clean);
    const stripped = stripOuterParens(bodyNoComment);
    out.push(`${pad}${line.label} ( ${renderTokensInline(stripped, cfg)} )${renderTrailingComments(trailing)}`);
    return out;
  }

  if (line.kind === 'INSERT_INTO') {
    // `tabela` sozinho, ou `tabela ( col1, col2 )` — força espaço antes do
    // parêntese da lista de colunas, já que a heurística padrão de
    // espaçamento trata identificador+"(" como chamada de função.
    const parenIdx = clean.findIndex((t) => t.text === '(');
    if (parenIdx === -1) {
      out.push(`${pad}${line.label} ${renderTokensInline(clean, cfg)}`);
    } else {
      const table = renderTokensInline(clean.slice(0, parenIdx), cfg);
      const columns = renderTokensInline(clean.slice(parenIdx), cfg);
      out.push(`${pad}${line.label} ${table} ${columns}`);
    }
    return out;
  }

  if (clean.length === 0) {
    // Cláusulas sem corpo (ex.: `DELETE` sozinho, antes do `FROM`).
    out.push(`${pad}${line.label}`);
    return out;
  }

  const prefix = `${pad}${line.label} `;
  const lines = renderExpressionLines(clean, prefix.length, cfg);
  lines[0] = prefix + lines[0];
  out.push(...lines);
  return out;
}

function pushItemList(
  out: string[],
  clean: Token[],
  label: string,
  pad: string,
  contentIndent: string,
  cfg: Cfg,
  aliasMap?: Map<string, string>,
): void {
  const items = fixCommentSplitItems(splitAtCommaDepth0(clean));
  items.forEach((rawItem, idx) => {
    // Item de GROUP BY/ORDER BY que é só um identificador solto batendo
    // (por nome, já dobrado pra minúsculo — regra 1) com um alias do
    // SELECT que precisa de aspas: troca pela forma com aspas antes de
    // renderizar, senão a referência sem aspas não bate mais com o alias
    // no Postgres (ver `collectQuotedAliases`).
    const quotedAlias = aliasMap && rawItem.length === 1 && rawItem[0].type === 'ident' ? aliasMap.get(rawItem[0].text) : undefined;
    const item = quotedAlias !== undefined ? [{ ...rawItem[0], text: quotedAlias, upper: quotedAlias.toUpperCase() }] : rawItem;
    const { comments: itemComments, clean: itemClean } = extractStandaloneComments(item);
    // Diferente de comentário de topo/cabeçalho (regra 8, coluna 1): um
    // comentário ENTRE itens de uma lista (SELECT/GROUP BY/ORDER BY/...)
    // alinha com os itens da lista, não com a margem esquerda do arquivo.
    out.push(...itemComments.map((c) => contentIndent + c));
    const { body, trailing } = splitTrailingComments(itemClean);
    const suffix = idx < items.length - 1 ? ',' : '';
    const prefix = idx === 0 ? `${pad}${label} ` : contentIndent;
    const lines = renderExpressionLines(body, prefix.length, cfg);
    lines[lines.length - 1] += suffix + renderTrailingComments(trailing);
    lines[0] = prefix + lines[0];
    out.push(...lines);
  });
}

function trySubquery(tokens: Token[], indent: number, cfg: Cfg, parenColumn: number): string[] | null {
  if (tokens[0]?.text !== '(') {
    return null;
  }
  const closeIdx = matchParen(tokens, 0) - 1;
  let p = 1;
  while (tokens[p] && (tokens[p].type === 'comment' || tokens[p].type === 'blockComment')) {
    p++;
  }
  const kw = tokens[p]?.upper;
  if (kw !== 'SELECT' && kw !== 'WITH') {
    return null;
  }

  const inner = tokens.slice(1, closeIdx);
  const aliasTokens = tokens.slice(closeIdx + 1);
  const innerLines = formatQuery(inner, indent + cfg.indentSize, cfg, true);

  const result: string[] = ['('];
  result.push(...innerLines);
  const aliasText = aliasTokens.length ? ' ' + renderTokensInline(aliasTokens, cfg) : '';
  // ")" alinha embaixo do "(" que abriu a subquery, não com o indent de
  // fora — regra confirmada pelo usuário.
  result.push(`${' '.repeat(parenColumn)})${aliasText}`);
  return result;
}

/**
 * Um comentário não-standalone logo após uma vírgula (`col1, -- nota`)
 * fica, no fluxo de tokens, "grudado" no início do próximo item em vez do
 * fim do anterior. Corrige devolvendo-o para o item anterior, onde ele
 * pertence semanticamente.
 */
function fixCommentSplitItems(items: Token[][]): Token[][] {
  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    while (item.length > 0 && item[0].type === 'comment' && !item[0].standalone) {
      const c = item.shift()!;
      items[i - 1].push(c);
    }
  }
  return items;
}

/**
 * Comentários `--` consomem o resto da linha física em que aparecem, então
 * nada pode vir depois deles na mesma linha renderizada (um `)` de
 * fechamento, uma `,`, um alias...). Sempre que o formatter for acrescentar
 * um sufixo depois de uma expressão, precisa primeiro tirar os comentários
 * finais do corpo e reanexá-los só no fim, depois do sufixo.
 */
function splitTrailingComments(tokens: Token[]): { body: Token[]; trailing: Token[] } {
  let end = tokens.length;
  while (end > 0 && (tokens[end - 1].type === 'comment' || tokens[end - 1].type === 'blockComment')) {
    end--;
  }
  return { body: tokens.slice(0, end), trailing: tokens.slice(end) };
}

function renderTrailingComments(trailing: Token[]): string {
  return trailing.length > 0 ? ' ' + trailing.map((t) => t.text).join(' ') : '';
}

function extractStandaloneComments(tokens: Token[]): { comments: string[]; clean: Token[] } {
  const comments: string[] = [];
  const clean: Token[] = [];
  for (const t of tokens) {
    if ((t.type === 'comment' || t.type === 'blockComment') && t.standalone) {
      comments.push(t.text);
    } else {
      clean.push(t);
    }
  }
  return { comments, clean };
}

// ---------------------------------------------------------------------------
// Renderização inline de expressões (regra 4: maiúsculas/minúsculas)
// ---------------------------------------------------------------------------

/**
 * Nomes de tipo do padrão SQL/PostgreSQL compostos por mais de uma palavra
 * (`x::double precision`, `x::character varying`, `x::timestamp with time
 * zone`...). Casts de uma palavra só (`::int`, `::text`, `::numeric`,
 * `::date`...) já funcionam sem entrar nesta lista — ela existe só para os
 * tipos cujo nome tem espaço. Ordenada da frase mais longa pra mais curta
 * para casar o mais específico primeiro (ex: "NATIONAL CHARACTER VARYING"
 * antes de "NATIONAL CHARACTER").
 */
const MULTI_WORD_CAST_TYPES: string[][] = [
  ['TIMESTAMP', 'WITH', 'TIME', 'ZONE'],
  ['TIMESTAMP', 'WITHOUT', 'TIME', 'ZONE'],
  ['TIME', 'WITH', 'TIME', 'ZONE'],
  ['TIME', 'WITHOUT', 'TIME', 'ZONE'],
  ['NATIONAL', 'CHARACTER', 'VARYING'],
  ['NATIONAL', 'CHAR', 'VARYING'],
  ['CHARACTER', 'LARGE', 'OBJECT'],
  ['NATIONAL', 'CHARACTER'],
  ['NATIONAL', 'CHAR'],
  ['CHARACTER', 'VARYING'],
  ['CHAR', 'VARYING'],
  ['DOUBLE', 'PRECISION'],
  ['BIT', 'VARYING'],
];

/** Testa se `tokens` a partir de `start` casa com a sequência de palavras de `phrase`. */
function matchesCastPhrase(tokens: Token[], start: number, phrase: string[]): boolean {
  for (let k = 0; k < phrase.length; k++) {
    const tok = tokens[start + k];
    if (!tok || (tok.type !== 'ident' && tok.type !== 'keyword') || tok.upper !== phrase[k]) {
      return false;
    }
  }
  return true;
}

/**
 * Para cada `::` do token stream, decide quantas palavras seguintes formam
 * o nome do tipo (1 para a maioria; 2+ para os tipos compostos da lista
 * acima) e devolve o conjunto de índices que devem ser maiusculizados.
 */
function computeCastUppercaseIndexes(tokens: Token[]): Set<number> {
  const indexes = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text !== '::') {
      continue;
    }
    const start = i + 1;
    let span = 0;
    for (const phrase of MULTI_WORD_CAST_TYPES) {
      if (matchesCastPhrase(tokens, start, phrase)) {
        span = phrase.length;
        break;
      }
    }
    if (span === 0 && tokens[start] && (tokens[start].type === 'ident' || tokens[start].type === 'keyword')) {
      span = 1;
    }
    for (let k = 0; k < span; k++) {
      indexes.add(start + k);
    }
  }
  return indexes;
}

/** Nomes de tipo do Postgres/PL-pgSQL de uma palavra só, maiusculizados em
 * posições onde um nome de tipo é estruturalmente garantido — DECLARE
 * (`renderDeclareLine`) e `RETURNS` (`tryFormatCreateFunction`). Fora
 * dessas posições, de propósito, essas palavras NÃO são maiusculizadas:
 * várias colidem com nome de coluna comum (`date`, `text`, `char`, `money`,
 * `real`, `numeric`, `boolean`, `name`, `json`...) — forçar maiúscula fora
 * de uma posição garantidamente-tipo arriscaria estragar uma referência de
 * coluna de verdade (mesma cautela do README, "Escopo e limitações", sobre
 * `date`/`time`/`type`/`value`/`text`/`name`). Tipos compostos de mais de
 * uma palavra reaproveitam `MULTI_WORD_CAST_TYPES` (mesma lista usada pra
 * `::tipo`) em vez de uma lista própria. */
const POSTGRES_TYPE_NAMES = new Set([
  'INT', 'INT2', 'INT4', 'INT8', 'INTEGER', 'SMALLINT', 'BIGINT',
  'DECIMAL', 'NUMERIC', 'REAL', 'FLOAT4', 'FLOAT8', 'MONEY',
  'SERIAL', 'SMALLSERIAL', 'BIGSERIAL',
  'TEXT', 'VARCHAR', 'CHAR', 'CHARACTER', 'BPCHAR', 'NAME',
  'BOOLEAN', 'BOOL',
  'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIMETZ', 'INTERVAL',
  'UUID', 'JSON', 'JSONB', 'XML', 'BYTEA',
  'RECORD', 'REFCURSOR', 'VOID', 'TRIGGER', 'EVENT_TRIGGER',
  'ANYELEMENT', 'ANYARRAY', 'ANYENUM', 'ANYRANGE', 'ANYNONARRAY', 'ANYCOMPATIBLE',
  'INET', 'CIDR', 'MACADDR', 'MACADDR8',
  'POINT', 'LINE', 'LSEG', 'BOX', 'PATH', 'POLYGON', 'CIRCLE',
  'TSVECTOR', 'TSQUERY', 'PG_LSN', 'OID', 'REGCLASS', 'REGPROC', 'REGTYPE',
]);

/** Maiusculiza nomes de tipo dentro de `tokens` — frases de
 * `MULTI_WORD_CAST_TYPES` (ex.: "double precision") como uma unidade só,
 * palavras de `POSTGRES_TYPE_NAMES` individualmente. Preserva o resto
 * (parênteses de precisão/escala, colchetes de array) como veio. */
function uppercaseTypeTokens(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    const phrase = MULTI_WORD_CAST_TYPES.find((p) => matchesCastPhrase(tokens, i, p));
    if (phrase) {
      for (let k = 0; k < phrase.length; k++) {
        out.push({ ...tokens[i + k], text: tokens[i + k].upper });
      }
      i += phrase.length;
      continue;
    }
    const t = tokens[i];
    out.push((t.type === 'ident' || t.type === 'keyword') && POSTGRES_TYPE_NAMES.has(t.upper) ? { ...t, text: t.upper } : t);
    i++;
  }
  return out;
}

function computeUnaryFlags(tokens: Token[]): boolean[] {
  const flags: boolean[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.text !== '-' && t.text !== '+') {
      flags.push(false);
      continue;
    }
    const prev = tokens[i - 1];
    const isUnary =
      !prev ||
      prev.text === '(' ||
      prev.text === ',' ||
      prev.type === 'op' ||
      (prev.type === 'keyword' && prev.upper !== 'NULL' && prev.upper !== 'TRUE' && prev.upper !== 'FALSE');
    flags.push(isUnary);
  }
  return flags;
}

/** Decide se `curr` cola sem espaço no que veio antes (`prev`), sem precisar do array de flags de unário completo — usado tanto no loop principal quanto pra costurar texto em volta de um bloco CASE renderizado à parte. */
function needsNoSpaceBefore(curr: Token, prev: Token | undefined, prevIsUnary: boolean): boolean {
  return (
    curr.text === ')' ||
    curr.text === ']' ||
    curr.text === ',' ||
    curr.text === '::' ||
    curr.text === '[' ||
    (curr.text === '(' && prev?.type === 'ident') ||
    // `:=` (atribuição/DEFAULT) é tokenizado como dois tokens soltos (":" e
    // "=" — não tem entrada própria no regex de operadores), então sem essa
    // regra colava um espaço entre eles ("v_x : = 0" em vez de "v_x := 0").
    // Atribuição dentro de corpo (`renderSimpleBodyStatement`) já escapa
    // disso escrevendo ":=" líteral no prefixo; isso aqui cobre os outros
    // lugares que passam pelo `renderTokensInline` genérico (ex.: `DEFAULT`
    // via `:=` numa declaração de `DECLARE`).
    (curr.text === '=' && prev?.text === ':') ||
    prev?.text === '(' ||
    prev?.text === '[' ||
    prev?.text === '::' ||
    prevIsUnary
  );
}

/** Conteúdo de um token `string` (`'texto'`) sem as aspas simples, desfazendo o escape `''` -> `'`. */
function stringLiteralInner(text: string): string {
  return text.slice(1, -1).replace(/''/g, "'");
}

function renderTokensInline(tokens: Token[], cfg: Cfg): string {
  const unary = computeUnaryFlags(tokens);
  const castUpper = computeCastUppercaseIndexes(tokens);
  let out = '';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    let text = t.text;

    if (t.type === 'keyword') {
      // Palavra de tipo composto que também é keyword (ex.: "WITH" em
      // "timestamp with time zone") já sai maiúscula por aqui.
      text = t.upper === 'AS' ? 'as' : t.upper;
    } else if (t.type === 'ident') {
      const isQualified = t.text.includes('.');
      const bare = (isQualified ? t.text.slice(t.text.lastIndexOf('.') + 1) : t.text).toUpperCase();
      const calledOrNiladic = tokens[i + 1]?.text === '(' || NILADIC_NATIVE_FUNCTIONS.has(bare);
      if (!isQualified && cfg.nativeFunctions.has(bare) && calledOrNiladic) {
        text = t.text.toUpperCase();
      } else if (castUpper.has(i)) {
        text = t.text.toUpperCase();
      }
    } else if (t.type === 'string' && prev?.type === 'keyword' && prev.upper === 'AS') {
      // Alias como string literal (`AS 'Foo'`) — convenção do SQL Server
      // (aceita quando QUOTED_IDENTIFIER está OFF), mas não é sintaxe
      // válida no Postgres: aspa simples é sempre literal de string, nunca
      // identificador. Vira um identificador de verdade — com aspas duplas
      // só se precisar (ver `quoteIdentIfNeeded`).
      text = quoteIdentIfNeeded(stringLiteralInner(t.text));
    }

    if (out === '') {
      out = text;
      continue;
    }

    const prevIsUnary = !!prev && (prev.text === '-' || prev.text === '+') && unary[i - 1];
    out += needsNoSpaceBefore(t, prev, prevIsUnary) ? text : ' ' + text;
  }

  return out;
}

/**
 * Fallback de statement/trecho não modelado, mas nunca deixando código
 * "depois" de um comentário `--`/`\/* *\/` na mesma linha renderizada — um
 * comentário sempre engole o resto da sua linha física (regra 12), e juntar
 * tudo com espaço simples (como `renderTokensInline` sozinho faria) criaria
 * a impressão de código vivo depois de um comentário que na verdade foi
 * silenciosamente comentado. Cada comentário vira sua própria linha; o
 * código antes/entre/depois deles continua uma linha só cada (mesmo
 * fallback "feio" de sempre — só sem essa armadilha).
 */
function renderFallbackLines(tokens: Token[], cfg: Cfg): string[] {
  const lines: string[] = [];
  let segment: Token[] = [];
  for (const t of tokens) {
    if (t.type === 'comment' || t.type === 'blockComment') {
      if (segment.length > 0) {
        lines.push(renderTokensInline(segment, cfg));
        segment = [];
      }
      lines.push(t.text);
      continue;
    }
    segment.push(t);
  }
  if (segment.length > 0) {
    lines.push(renderTokensInline(segment, cfg));
  }
  return lines;
}

// ---------------------------------------------------------------------------
// CASE ... WHEN ... THEN ... ELSE ... END em blocos, um WHEN/THEN por linha
// ---------------------------------------------------------------------------

/**
 * Acha o primeiro CASE...END de topo (profundidade de parênteses 0) em
 * `tokens`, respeitando CASE aninhado (conta profundidade própria, já que
 * CASE...END não usa parênteses). Devolve `null` se não houver CASE.
 */
function findTopLevelCase(tokens: Token[]): { start: number; end: number } | null {
  // Aninhamento de CASE só conta enquanto a profundidade de parênteses (via
  // `DepthCursor`) está em 0 — um CASE inteiro dentro de `foo(...)` é
  // invisível aqui (não é candidato a `start` nem mexe em `caseDepth`),
  // igual ao comportamento de sempre.
  const cursor = new DepthCursor();
  let caseDepth = 0;
  let start = -1;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    cursor.advance(t);
    if (cursor.depth !== 0 || t.type !== 'keyword') {
      continue;
    }
    if (t.upper === 'CASE') {
      if (caseDepth === 0 && start === -1) {
        start = i;
      }
      caseDepth++;
      continue;
    }
    if (t.upper === 'END' && caseDepth > 0) {
      caseDepth--;
      if (caseDepth === 0) {
        return { start, end: i + 1 };
      }
    }
  }
  return null;
}

interface CaseBranch {
  when: Token[];
  then: Token[];
}

/** Separa o miolo de um CASE (sem os tokens CASE/END) em expressão simples (forma `CASE expr WHEN ...`), branches WHEN/THEN e ELSE opcional. */
function splitCaseBranches(inner: Token[]): { simpleExpr: Token[]; branches: CaseBranch[]; elseExpr: Token[] | null } {
  // Mesma convenção de gating de `findTopLevelCase`: CASE aninhado só conta
  // fora de parênteses.
  const cursor = new DepthCursor();
  let nestedCase = 0;
  const markers: { kind: 'WHEN' | 'THEN' | 'ELSE'; index: number }[] = [];

  for (let i = 0; i < inner.length; i++) {
    const t = inner[i];
    cursor.advance(t);
    if (cursor.depth !== 0 || t.type !== 'keyword') {
      continue;
    }
    if (t.upper === 'CASE') {
      nestedCase++;
      continue;
    }
    if (t.upper === 'END' && nestedCase > 0) {
      nestedCase--;
      continue;
    }
    if (nestedCase > 0) {
      continue;
    }
    if (t.upper === 'WHEN' || t.upper === 'THEN' || t.upper === 'ELSE') {
      markers.push({ kind: t.upper, index: i });
    }
  }

  const simpleExpr = inner.slice(0, markers.length > 0 ? markers[0].index : inner.length);
  const branches: CaseBranch[] = [];
  let elseExpr: Token[] | null = null;

  markers.forEach((m, k) => {
    const segEnd = k + 1 < markers.length ? markers[k + 1].index : inner.length;
    const seg = inner.slice(m.index + 1, segEnd);
    if (m.kind === 'WHEN') {
      branches.push({ when: seg, then: [] });
    } else if (m.kind === 'THEN') {
      if (branches.length > 0) {
        branches[branches.length - 1].then = seg;
      }
    } else {
      elseExpr = seg;
    }
  });

  return { simpleExpr, branches, elseExpr };
}

/**
 * Renderiza o THEN de um branch de CASE — condição comum numa linha só
 * (`THEN expr`); com AND/OR de topo, quebra uma linha por conector, cada um
 * alinhado pra terminar na mesma coluna que o "N" de "THEN" — mesma regra 5
 * de quebra de AND/OR (igual `renderOnGroup` faz pra `ON`), agora também
 * dentro de um CASE.
 */
function renderCaseThenLines(branchPad: string, thenTokens: Token[], cfg: Cfg): string[] {
  const segments = splitTopLevelAndOr(thenTokens);
  const lines = [`${branchPad}THEN ${renderTokensInline(segments[0].tokens, cfg)}`];
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const connectorPad = ' '.repeat(branchPad.length + 'THEN'.length - seg.connector!.length);
    lines.push(`${connectorPad}${seg.connector} ${renderTokensInline(seg.tokens, cfg)}`);
  }
  return lines;
}

/**
 * Renderiza um CASE...END em blocos: primeiro WHEN gruda na linha do CASE,
 * cada THEN/WHEN seguinte vira sua própria linha alinhada sob a coluna logo
 * depois de "CASE " (5 caracteres — WHEN/THEN/ELSE têm o mesmo tamanho, não
 * precisa de padding extra), e END fecha alinhado com o próprio CASE.
 * CASE aninhado dentro de um branch (raro) renderiza inline via
 * renderTokensInline — só o CASE mais externo ganha o layout em blocos.
 */
function renderCaseBlock(caseTokens: Token[], caseColumn: number, cfg: Cfg): string[] {
  const inner = caseTokens.slice(1, caseTokens.length - 1);
  const { simpleExpr, branches, elseExpr } = splitCaseBranches(inner);
  const branchColumn = caseColumn + 'CASE '.length;
  const branchPad = ' '.repeat(branchColumn);

  const lines: string[] = [];
  let firstLine = 'CASE';
  if (simpleExpr.length > 0) {
    firstLine += ' ' + renderTokensInline(simpleExpr, cfg);
  }

  if (branches.length === 0) {
    lines.push(firstLine);
  }

  branches.forEach((branch, idx) => {
    const whenText = renderTokensInline(branch.when, cfg);
    if (idx === 0) {
      lines.push(`${firstLine} WHEN ${whenText}`);
    } else {
      lines.push(`${branchPad}WHEN ${whenText}`);
    }
    lines.push(...renderCaseThenLines(branchPad, branch.then, cfg));
  });

  if (elseExpr && elseExpr.length > 0) {
    lines.push(`${branchPad}ELSE ${renderTokensInline(elseExpr, cfg)}`);
  }

  lines.push(`${' '.repeat(caseColumn)}END`);
  return lines;
}

/**
 * Renderiza `tokens` como uma ou mais linhas, quebrando em blocos quando há
 * um CASE...END de topo — usado nos mesmos lugares onde antes só se chamava
 * `renderTokensInline` (itens de lista, corpo de cláusula genérica).
 * `baseColumn` é a coluna (0-indexada) onde `tokens` começa a ser impresso,
 * necessária pra alinhar WHEN/THEN/END corretamente.
 */
function renderExpressionLines(tokens: Token[], baseColumn: number, cfg: Cfg): string[] {
  const span = findTopLevelCase(tokens);
  if (!span) {
    return [renderTokensInline(tokens, cfg)];
  }

  const before = tokens.slice(0, span.start);
  const caseTokens = tokens.slice(span.start, span.end);
  const after = tokens.slice(span.end);

  const beforeText = before.length > 0 ? renderTokensInline(before, cfg) : '';
  const caseKeyword = caseTokens[0];
  const gapBeforeSpace = beforeText.length > 0 && !needsNoSpaceBefore(caseKeyword, before[before.length - 1], false);
  const caseColumn = baseColumn + beforeText.length + (gapBeforeSpace ? 1 : 0);

  const caseLines = renderCaseBlock(caseTokens, caseColumn, cfg);
  caseLines[0] = beforeText + (gapBeforeSpace ? ' ' : '') + caseLines[0];

  if (after.length > 0) {
    const afterText = renderTokensInline(after, cfg);
    const gapAfterSpace = !needsNoSpaceBefore(after[0], caseTokens[caseTokens.length - 1], false);
    caseLines[caseLines.length - 1] += (gapAfterSpace ? ' ' : '') + afterText;
  }

  return caseLines;
}

