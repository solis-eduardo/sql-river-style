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

import { Token, tokenize } from './tokenizer';

export interface FormatOptions {
  /** Quantidade de espaços usada para indentar corpos de CTE e subqueries. */
  indentSize?: number;
  /** Nomes extras de função nativa a maiusculizar, além da lista padrão. */
  additionalFunctions?: string[];
}

interface Cfg {
  indentSize: number;
  nativeFunctions: Set<string>;
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
]);

function buildCfg(options: FormatOptions): Cfg {
  return {
    indentSize: options.indentSize ?? 4,
    nativeFunctions: new Set([
      ...NATIVE_FUNCTIONS,
      ...(options.additionalFunctions ?? []).map((f) => f.toUpperCase()),
    ]),
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

  const createFn = tryFormatCreateFunction(tokens, cfg);
  if (createFn) {
    return { text: trimBlankEdges(createFn).join('\n'), ownSemicolon: true };
  }
  const createType = tryFormatCreateType(tokens, cfg);
  if (createType) {
    return { text: trimBlankEdges(createType).join('\n'), ownSemicolon: true };
  }

  const FORMATTABLE = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE']);
  const firstKeyword = firstMeaningfulKeyword(tokens);
  if (!firstKeyword || !FORMATTABLE.has(firstKeyword)) {
    // Statements que não são consulta/DML básico (DDL, MERGE, comandos de
    // sessão...) ficam fora do escopo das regras de river style.
    // Maiusculiza palavras-chave e devolve em uma linha só, sem arriscar
    // reestruturar o que não é modelado por este formatter.
    return { text: renderTokensInline(tokens, cfg), ownSemicolon: false };
  }

  const lines = formatQuery(tokens, 0, cfg);
  return { text: trimBlankEdges(lines).join('\n'), ownSemicolon: false };
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

function formatQuery(tokens: Token[], indent: number, cfg: Cfg): string[] {
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
      lines.push(...formatQuery(bodyTokens, indent + cfg.indentSize, cfg));

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

  lines.push(...formatSelectChain(tokens.slice(cursor), indent, cfg));
  return lines;
}

function matchParen(tokens: Token[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i++) {
    if (tokens[i].text === '(') {
      depth++;
    } else if (tokens[i].text === ')') {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
  }
  return tokens.length;
}

function splitSetOps(tokens: Token[]): { blocks: Token[][]; ops: string[] } {
  const blocks: Token[][] = [];
  const ops: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.text === '(') {
      depth++;
      continue;
    }
    if (t.text === ')') {
      depth--;
      continue;
    }
    if (depth !== 0 || t.type !== 'keyword') {
      continue;
    }
    if (t.upper === 'UNION' || t.upper === 'EXCEPT' || t.upper === 'INTERSECT') {
      let op = t.upper;
      let end = i;
      if (t.upper === 'UNION' && tokens[i + 1]?.upper === 'ALL') {
        op = 'UNION ALL';
        end = i + 1;
      }
      blocks.push(tokens.slice(start, i));
      ops.push(op);
      start = end + 1;
      i = end;
    }
  }
  blocks.push(tokens.slice(start));
  return { blocks, ops };
}

function formatSelectChain(tokens: Token[], indent: number, cfg: Cfg): string[] {
  const { blocks, ops } = splitSetOps(tokens);
  const parsedBlocks = blocks.map((b) => parseSelectBlock(b));
  const width = computeWidth(parsedBlocks, ops, indent);

  const lines: string[] = [];
  parsedBlocks.forEach((block, idx) => {
    if (idx > 0) {
      const op = ops[idx - 1];
      lines.push('');
      lines.push(`${' '.repeat(Math.max(0, indent + width - op.length))}${op}`);
      lines.push('');
    }
    lines.push(...renderSelectBlock(block, indent, width, cfg));
  });
  return lines;
}

/** `SELECT` nunca fica com menos de 4 espaços de indentação antes dela, mesmo quando é a keyword mais longa da query (ex.: um SELECT sem JOIN cuja única outra cláusula é WHERE). Não afeta escopos aninhados com o indentSize padrão (4): o próprio indent já garante os 4 espaços. */
const MIN_PAD_BEFORE_SELECT = 4;

function computeWidth(blocks: ClauseLine[][], ops: string[], indent: number): number {
  let max = 0;
  let hasSelect = false;
  for (const block of blocks) {
    for (const line of block) {
      max = Math.max(max, line.label.length);
      if (line.label === 'SELECT' || line.label === 'SELECT INTO') {
        hasSelect = true;
      }
    }
  }
  for (const op of ops) {
    max = Math.max(max, op.length);
  }
  if (hasSelect) {
    max = Math.max(max, 'SELECT'.length + Math.max(0, MIN_PAD_BEFORE_SELECT - indent));
  }
  return max;
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
  let depth = 0;
  let caseDepth = 0;
  let betweenDepth = -1;
  let seenFrom = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'punct' && t.text === '(') {
      depth++;
      continue;
    }
    if (t.type === 'punct' && t.text === ')') {
      depth--;
      continue;
    }
    // CASE...END não usa parênteses, então precisa do próprio contador.
    // Sem isso, um AND/OR dentro de um WHEN/THEN (ex.: `CASE WHEN a AND b
    // THEN ...`) é confundido com o AND/OR de encadeamento do WHERE, e o
    // CASE acaba partido ao meio em cláusulas soltas.
    if (t.type === 'keyword' && t.upper === 'CASE') {
      caseDepth++;
      continue;
    }
    if (t.type === 'keyword' && t.upper === 'END' && caseDepth > 0) {
      caseDepth--;
      continue;
    }
    if (depth !== 0 || caseDepth !== 0 || t.type !== 'keyword') {
      continue;
    }
    const u = t.upper;

    if (u === 'BETWEEN') {
      betweenDepth = depth;
      continue;
    }
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
      if (betweenDepth === depth) {
        betweenDepth = -1;
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
  for (let i = 0; i < clauseLines.length; i++) {
    const line = clauseLines[i];
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
      out.push(...renderOnGroup(line, condLines, indent, width, cfg));
      i = j - 1;
      continue;
    }
    out.push(...renderClauseLine(line, indent, width, cfg));
  }
  return out;
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
  let depth = 0;
  let caseDepth = 0;
  let betweenDepth = -1;

  for (const t of tokens) {
    if (t.text === '(') {
      depth++;
    } else if (t.text === ')') {
      depth--;
    } else if (t.type === 'keyword' && t.upper === 'CASE') {
      caseDepth++;
    } else if (t.type === 'keyword' && t.upper === 'END' && caseDepth > 0) {
      caseDepth--;
    } else if (depth === 0 && caseDepth === 0 && t.type === 'keyword' && t.upper === 'BETWEEN') {
      betweenDepth = depth;
    } else if (depth === 0 && caseDepth === 0 && t.type === 'keyword' && (t.upper === 'AND' || t.upper === 'OR')) {
      if (t.upper === 'AND' && betweenDepth === depth) {
        betweenDepth = -1;
      } else {
        segments.push({ connector: t.upper, tokens: [] });
        continue;
      }
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
function renderOnGroup(onLine: ClauseLine, condLines: ClauseLine[], indent: number, width: number, cfg: Cfg): string[] {
  const fullBody = onLine.body.slice();
  for (const c of condLines) {
    fullBody.push({ type: 'keyword', text: c.label, upper: c.label });
    fullBody.push(...c.body);
  }

  const stripped = stripOuterParens(fullBody);
  const segments = splitTopLevelAndOr(stripped);

  const pad = ' '.repeat(Math.max(0, indent + width - onLine.label.length));
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

function renderClauseLine(line: ClauseLine, indent: number, width: number, cfg: Cfg): string[] {
  const pad = ' '.repeat(Math.max(0, indent + width - line.label.length));
  const contentIndent = ' '.repeat(indent + width + 1);

  if (LIST_KINDS.has(line.kind)) {
    // Cada item cuida dos seus próprios comentários standalone (podem
    // aparecer entre colunas); não extrair no nível da cláusula inteira,
    // senão um comentário do meio da lista sobe para antes do primeiro item.
    const out: string[] = [];
    pushItemList(out, line.body, line.label, pad, contentIndent, cfg);
    return out;
  }

  const { comments, clean } = extractStandaloneComments(line.body);
  const out: string[] = [...comments];

  if (line.kind === 'FROM' || line.kind === 'JOIN') {
    const sub = trySubquery(clean, indent, cfg);
    if (sub) {
      out.push(`${pad}${line.label} ${sub[0]}`, ...sub.slice(1));
      return out;
    }
    if (hasTopLevelComma(clean)) {
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
): void {
  const items = fixCommentSplitItems(splitTopLevelCommas(clean));
  items.forEach((item, idx) => {
    const { comments: itemComments, clean: itemClean } = extractStandaloneComments(item);
    out.push(...itemComments);
    const { body, trailing } = splitTrailingComments(itemClean);
    const suffix = idx < items.length - 1 ? ',' : '';
    const prefix = idx === 0 ? `${pad}${label} ` : contentIndent;
    const lines = renderExpressionLines(body, prefix.length, cfg);
    lines[lines.length - 1] += suffix + renderTrailingComments(trailing);
    lines[0] = prefix + lines[0];
    out.push(...lines);
  });
}

function trySubquery(tokens: Token[], indent: number, cfg: Cfg): string[] | null {
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
  const innerLines = formatQuery(inner, indent + cfg.indentSize, cfg);

  const result: string[] = ['('];
  result.push(...innerLines);
  const aliasText = aliasTokens.length ? ' ' + renderTokensInline(aliasTokens, cfg) : '';
  result.push(`${' '.repeat(indent)})${aliasText}`);
  return result;
}

function hasTopLevelComma(tokens: Token[]): boolean {
  let depth = 0;
  for (const t of tokens) {
    if (t.text === '(') {
      depth++;
    } else if (t.text === ')') {
      depth--;
    } else if (t.text === ',' && depth === 0) {
      return true;
    }
  }
  return false;
}

function splitTopLevelCommas(tokens: Token[]): Token[][] {
  const items: Token[][] = [];
  let depth = 0;
  let current: Token[] = [];
  for (const t of tokens) {
    if (t.text === '(') {
      depth++;
    } else if (t.text === ')') {
      depth--;
    } else if (t.text === ',' && depth === 0) {
      items.push(current);
      current = [];
      continue;
    }
    current.push(t);
  }
  items.push(current);
  const filtered = items.filter((it) => it.length > 0);
  return filtered.length > 0 ? filtered : [[]];
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

function stripOuterParens(tokens: Token[]): Token[] {
  if (tokens.length < 2) {
    return tokens;
  }
  if (tokens[0].text !== '(' || tokens[tokens.length - 1].text !== ')') {
    return tokens;
  }
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].text === '(') {
      depth++;
    } else if (tokens[i].text === ')') {
      depth--;
      if (depth === 0 && i !== tokens.length - 1) {
        return tokens; // fecha antes do fim: não é um único par envolvendo tudo
      }
    }
  }
  return stripOuterParens(tokens.slice(1, tokens.length - 1));
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
    prev?.text === '(' ||
    prev?.text === '[' ||
    prev?.text === '::' ||
    prevIsUnary
  );
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
      if (!isQualified && cfg.nativeFunctions.has(bare) && tokens[i + 1]?.text === '(') {
        text = t.text.toUpperCase();
      } else if (castUpper.has(i)) {
        text = t.text.toUpperCase();
      }
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

// ---------------------------------------------------------------------------
// CASE ... WHEN ... THEN ... ELSE ... END em blocos, um WHEN/THEN por linha
// ---------------------------------------------------------------------------

/**
 * Acha o primeiro CASE...END de topo (profundidade de parênteses 0) em
 * `tokens`, respeitando CASE aninhado (conta profundidade própria, já que
 * CASE...END não usa parênteses). Devolve `null` se não houver CASE.
 */
function findTopLevelCase(tokens: Token[]): { start: number; end: number } | null {
  let depth = 0;
  let caseDepth = 0;
  let start = -1;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.text === '(') {
      depth++;
      continue;
    }
    if (t.text === ')') {
      depth--;
      continue;
    }
    if (depth !== 0 || t.type !== 'keyword') {
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
  let depth = 0;
  let nestedCase = 0;
  const markers: { kind: 'WHEN' | 'THEN' | 'ELSE'; index: number }[] = [];

  for (let i = 0; i < inner.length; i++) {
    const t = inner[i];
    if (t.text === '(') {
      depth++;
      continue;
    }
    if (t.text === ')') {
      depth--;
      continue;
    }
    if (depth !== 0 || t.type !== 'keyword') {
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
    lines.push(`${branchPad}THEN ${renderTokensInline(branch.then, cfg)}`);
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

// ---------------------------------------------------------------------------
// CREATE FUNCTION / PROCEDURE — corpo em PL/pgSQL (dollar-quoted, ex.: $BODY$)
// ---------------------------------------------------------------------------
//
// Não é um parser PL/pgSQL completo: cobre o subconjunto usado em queries de
// relatório/funções de negócio comuns — DECLARE, BEGIN...END, IF/THEN/ELSE/
// END IF, FOR var IN (query) LOOP...END LOOP, atribuição (:=), RETURN/RETURN
// NEXT/RETURN QUERY, e o SQL comum (SELECT/INSERT/UPDATE/DELETE) embutido em
// qualquer um desses — reaproveitando o mesmo `formatQuery` usado no resto do
// arquivo. Construções não cobertas (EXCEPTION, WHILE, CURSOR, EXECUTE
// dinâmico, ELSIF...) caem no fallback de linha única (renderTokensInline),
// igual a qualquer DDL fora de escopo — nunca perdem conteúdo, só não ganham
// reestruturação.

/** `true` se `tokens[i]` é uma palavra que fecha o bloco atual (ELSE, ou
 * qualquer `END`/`END IF`/`END LOOP`) — quem está formatando uma lista de
 * statements pára aqui e devolve o cursor pra quem a chamou decidir o que
 * fazer com o terminador. */
function isBodyTerminator(tokens: Token[], i: number): boolean {
  const u = tokens[i]?.upper;
  return u === 'ELSE' || u === 'END';
}

/** Acha `keyword` na profundidade 0 de parênteses (e fora de um CASE...END
 * aninhado) a partir de `start` — usado pra achar o THEN de um IF, o IN/LOOP
 * de um FOR etc. */
function findKeywordAtDepth0(tokens: Token[], start: number, keyword: string): number {
  let depth = 0;
  let caseDepth = 0;
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.text === '(') {
      depth++;
      continue;
    }
    if (t.text === ')') {
      depth--;
      continue;
    }
    if (t.type === 'keyword' && t.upper === 'CASE') {
      caseDepth++;
      continue;
    }
    if (t.type === 'keyword' && t.upper === 'END' && caseDepth > 0) {
      caseDepth--;
      continue;
    }
    if (depth === 0 && caseDepth === 0 && t.upper === keyword) {
      return i;
    }
  }
  return tokens.length;
}

/** Acha o fim do statement atual: o `;` de profundidade 0 seguinte, ou o fim
 * do array. Statements PL/pgSQL (atribuição, RETURN, DDL simples...) usam
 * isso pra saber onde parar — diferente de blocos (IF/FOR/BEGIN), que têm
 * suas próprias palavras de fechamento em vez de `;`. */
function findStatementEnd(tokens: Token[], start: number): number {
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i].text === '(') {
      depth++;
    } else if (tokens[i].text === ')') {
      depth--;
    } else if (tokens[i].text === ';' && depth === 0) {
      return i;
    }
  }
  return tokens.length;
}

interface BodyResult {
  lines: string[];
  next: number;
}

/** `query`: SELECT/WITH/INSERT/UPDATE/DELETE embutido (via `formatQuery`) —
 * ganha uma linha em branco depois, e também antes se vier logo após uma
 * atribuição/DDL simples (`other`). `return`: RETURN/RETURN NEXT/RETURN
 * QUERY — ganha uma linha em branco antes. `block`: IF/FOR/BEGIN aninhado —
 * mesma regra de "antes" que `query` quando vem logo após `other`. `other`:
 * atribuição/DDL simples — sem espaçamento extra ao redor. */
type BodyStmtKind = 'query' | 'return' | 'block' | 'other';

interface OneStmtResult extends BodyResult {
  kind: BodyStmtKind;
}

/** Formata uma sequência de statements PL/pgSQL a partir de `start`, parando
 * ao encontrar um terminador de bloco (ELSE/END) que pertence a quem chamou.
 * Devolve `null` se algum statement da lista não pôde ser formatado com
 * segurança (ver `formatOneBodyStatement`) — propaga pra quem chamou em vez
 * de tentar continuar com o que sobrou. */
function formatStatementList(tokens: Token[], start: number, indent: number, cfg: Cfg): BodyResult | null {
  const lines: string[] = [];
  let cursor = start;
  let prevKind: BodyStmtKind | null = null;
  while (cursor < tokens.length && !isBodyTerminator(tokens, cursor)) {
    const r = formatOneBodyStatement(tokens, cursor, indent, cfg);
    if (r === null) {
      return null;
    }
    if (r.next === cursor) {
      // Salvaguarda: nunca deve acontecer, mas evita loop infinito se algum
      // caso não cobrir consumir zero tokens.
      break;
    }
    if (prevKind === 'query' || r.kind === 'return' || ((r.kind === 'query' || r.kind === 'block') && prevKind === 'other')) {
      lines.push('');
    }
    lines.push(...r.lines);
    cursor = r.next;
    prevKind = r.kind;
  }
  return { lines, next: cursor };
}

/** Devolve `null` se um bloco filho (IF/FOR/BEGIN) não pôde ser formatado com
 * segurança — ver os comentários em `formatBeginBlock`/`formatIfStatement`/
 * `formatForStatement` sobre terminador inesperado. */
function formatOneBodyStatement(tokens: Token[], start: number, indent: number, cfg: Cfg): OneStmtResult | null {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  let cursor = start;

  // Dentro de um corpo PL/pgSQL, todo comentário fica em linha própria —
  // não só os "standalone" (regra 8 do river style é para SQL de topo; uma
  // fonte bagunçada pode ter um `--` colado ao token anterior sem `\n`
  // antes, mas ele continua sendo o comentário do statement que vem a
  // seguir, não parte do statement anterior).
  while (tokens[cursor] && (tokens[cursor].type === 'comment' || tokens[cursor].type === 'blockComment')) {
    lines.push(pad + tokens[cursor].text);
    cursor++;
  }
  if (cursor >= tokens.length || isBodyTerminator(tokens, cursor)) {
    return { lines, next: cursor, kind: 'other' };
  }

  const kw = tokens[cursor].upper;
  if (kw === 'IF') {
    const r = formatIfStatement(tokens, cursor, indent, cfg);
    if (r === null) {
      return null;
    }
    return { lines: [...lines, ...r.lines], next: r.next, kind: 'block' };
  }
  if (kw === 'FOR') {
    const r = formatForStatement(tokens, cursor, indent, cfg);
    if (r === null) {
      return null;
    }
    return { lines: [...lines, ...r.lines], next: r.next, kind: 'block' };
  }
  if (kw === 'BEGIN') {
    const r = formatBeginBlock(tokens, cursor, indent, cfg);
    if (r === null) {
      return null;
    }
    return { lines: [...lines, ...r.lines], next: r.next, kind: 'block' };
  }
  if (kw === 'RETURN') {
    const r = formatReturnStatement(tokens, cursor, indent, cfg);
    return { lines: [...lines, ...r.lines], next: r.next, kind: 'return' };
  }

  const end = findStatementEnd(tokens, cursor);
  const stmtTokens = tokens.slice(cursor, end);
  const stmtFirstKeyword = firstMeaningfulKeyword(stmtTokens);
  const isQuery = !!stmtFirstKeyword && EMBEDDED_QUERY_KEYWORDS.has(stmtFirstKeyword);
  lines.push(...renderSimpleBodyStatement(stmtTokens, indent, cfg));
  const next = tokens[end]?.text === ';' ? end + 1 : end;
  return { lines, next, kind: isQuery ? 'query' : 'other' };
}

const EMBEDDED_QUERY_KEYWORDS = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE']);

/** Statement "folha" que não é IF/FOR/BEGIN/RETURN: atribuição
 * (`var := expr;`), SQL comum (SELECT/INSERT/UPDATE/DELETE — reaproveita
 * `formatQuery`, então CTEs/JOIN/subquery funcionam igual ao resto do
 * arquivo) ou fallback genérico de DDL simples (TRUNCATE, DROP TABLE,
 * CREATE INDEX, CREATE TEMP TABLE ... AS (subquery)...). */
function renderSimpleBodyStatement(stmtTokens: Token[], indent: number, cfg: Cfg): string[] {
  const pad = ' '.repeat(indent);

  if (stmtTokens[0]?.type === 'ident' && stmtTokens[1]?.text === ':' && stmtTokens[2]?.text === '=') {
    const name = stmtTokens[0].text;
    const exprTokens = stmtTokens.slice(3);
    const prefix = `${pad}${name} := `;
    const lines = renderExpressionLines(exprTokens, prefix.length, cfg);
    lines[0] = prefix + lines[0];
    lines[lines.length - 1] += ';';
    return lines;
  }

  const firstKeyword = firstMeaningfulKeyword(stmtTokens);
  if (firstKeyword && EMBEDDED_QUERY_KEYWORDS.has(firstKeyword)) {
    const lines = formatQuery(stmtTokens, indent, cfg);
    lines[lines.length - 1] += ';';
    return lines;
  }

  // DDL simples com uma subquery entre parênteses embutida (ex.: CREATE TEMP
  // TABLE x AS (SELECT ...)) — formata a subquery recursivamente, igual a
  // uma derived table em FROM/JOIN; o resto (fora dos parênteses) é inline.
  for (let i = 0; i < stmtTokens.length; i++) {
    if (stmtTokens[i].text !== '(') {
      continue;
    }
    let p = i + 1;
    while (stmtTokens[p] && (stmtTokens[p].type === 'comment' || stmtTokens[p].type === 'blockComment')) {
      p++;
    }
    const innerKw = stmtTokens[p]?.upper;
    if (innerKw !== 'SELECT' && innerKw !== 'WITH') {
      continue;
    }
    const closeIdx = matchParen(stmtTokens, i) - 1;
    const before = renderTokensInline(stmtTokens.slice(0, i), cfg);
    const inner = stmtTokens.slice(i + 1, closeIdx);
    const after = stmtTokens.slice(closeIdx + 1);
    const lines = [`${pad}${before} (`, ...formatQuery(inner, indent + cfg.indentSize, cfg), `${pad})${after.length ? ' ' + renderTokensInline(after, cfg) : ''};`];
    return lines;
  }

  return [`${pad}${renderTokensInline(stmtTokens, cfg)};`];
}

function formatReturnStatement(tokens: Token[], start: number, indent: number, cfg: Cfg): BodyResult {
  const pad = ' '.repeat(indent);
  let cursor = start + 1;
  let prefix = 'RETURN';
  if (tokens[cursor]?.upper === 'NEXT') {
    prefix = 'RETURN NEXT';
    cursor++;
  } else if (tokens[cursor]?.upper === 'QUERY') {
    prefix = 'RETURN QUERY';
    cursor++;
  }

  const end = findStatementEnd(tokens, cursor);
  const exprTokens = tokens.slice(cursor, end);
  const lines: string[] = [];
  if (exprTokens.length === 0) {
    lines.push(`${pad}${prefix};`);
  } else {
    const fullPrefix = `${pad}${prefix} `;
    const exprLines = renderExpressionLines(exprTokens, fullPrefix.length, cfg);
    exprLines[0] = fullPrefix + exprLines[0];
    exprLines[exprLines.length - 1] += ';';
    lines.push(...exprLines);
  }
  const next = tokens[end]?.text === ';' ? end + 1 : end;
  return { lines, next };
}

/** `IF` cuja condição é uma subquery entre parênteses (`IF (SELECT ...)`)
 * formata recursivamente como uma derived table; senão, uma expressão comum
 * — preserva parênteses explícitos do fonte no estilo `( expr )` do `ON`,
 * mas não inventa parênteses que não estavam lá. */
function renderIfCondition(tokens: Token[], indent: number, cfg: Cfg): string[] {
  const pad = ' '.repeat(indent);
  if (tokens[0]?.text === '(' && matchParen(tokens, 0) === tokens.length) {
    const inner = tokens.slice(1, tokens.length - 1);
    let p = 0;
    while (inner[p] && (inner[p].type === 'comment' || inner[p].type === 'blockComment')) {
      p++;
    }
    const kw = inner[p]?.upper;
    if (kw === 'SELECT' || kw === 'WITH') {
      const innerLines = formatQuery(inner, indent + cfg.indentSize, cfg);
      return [`${pad}IF (`, ...innerLines, `${pad})`];
    }
    return [`${pad}IF ( ${renderTokensInline(inner, cfg)} )`];
  }
  return [`${pad}IF ${renderTokensInline(tokens, cfg)}`];
}

function formatIfStatement(tokens: Token[], start: number, indent: number, cfg: Cfg): BodyResult | null {
  const pad = ' '.repeat(indent);
  let cursor = start + 1;
  const thenIdx = findKeywordAtDepth0(tokens, cursor, 'THEN');
  const condTokens = tokens.slice(cursor, thenIdx);

  const lines: string[] = [...renderIfCondition(condTokens, indent, cfg), `${pad}THEN`];
  cursor = thenIdx + 1;

  const thenBody = formatStatementList(tokens, cursor, indent + cfg.indentSize, cfg);
  if (thenBody === null) {
    return null;
  }
  lines.push(...thenBody.lines);
  cursor = thenBody.next;

  if (tokens[cursor]?.upper === 'ELSE') {
    lines.push(`${pad}ELSE`);
    cursor++;
    const elseBody = formatStatementList(tokens, cursor, indent + cfg.indentSize, cfg);
    if (elseBody === null) {
      return null;
    }
    lines.push(...elseBody.lines);
    cursor = elseBody.next;
  }

  if (tokens[cursor]?.upper !== 'END') {
    // Terminador inesperado — provavelmente um ELSE órfão ou EOF por causa de
    // uma construção não coberta (ou fonte malformada, ex.: comentário `--`
    // que engoliu um IF/THEN inteiro na mesma linha física). Não inventa um
    // `END IF;` que não está no token stream: desiste de estruturar este IF
    // (e, em cascata, o corpo inteiro da função) — quem chamou cai no
    // fallback de linha única em vez de arriscar reescrever o significado.
    return null;
  }
  lines.push(`${pad}END IF;`);
  cursor += tokens[cursor + 1]?.upper === 'IF' ? 2 : 1;
  if (tokens[cursor]?.text === ';') {
    cursor++;
  }
  return { lines, next: cursor };
}

function formatBeginBlock(tokens: Token[], start: number, indent: number, cfg: Cfg): BodyResult | null {
  const pad = ' '.repeat(indent);
  const lines = [`${pad}BEGIN`];
  const body = formatStatementList(tokens, start + 1, indent + cfg.indentSize, cfg);
  if (body === null) {
    return null;
  }
  lines.push(...body.lines);
  let cursor = body.next;
  if (tokens[cursor]?.upper !== 'END') {
    // Idem formatIfStatement: terminador inesperado (ex.: ELSE órfão) — não
    // fabrica `END;`. Desiste e deixa o chamador cair no fallback seguro.
    return null;
  }
  lines.push(`${pad}END;`);
  cursor++; // token END
  if (tokens[cursor]?.text === ';') {
    cursor++;
  }
  return { lines, next: cursor };
}

/** `FOR var IN (query) LOOP ... END LOOP` — a lista após IN reaproveita
 * `formatQuery` igual a uma derived table de FROM/JOIN (mesma convenção:
 * parêntese colado no `(`, corpo indentado `indentSize` a mais). A forma sem
 * parênteses (`FOR var IN expressão LOOP`, ex. range `1..10`) cai numa linha
 * só — rara nas queries de relatório cobertas por este formatter. */
function formatForStatement(tokens: Token[], start: number, indent: number, cfg: Cfg): BodyResult | null {
  const pad = ' '.repeat(indent);
  let cursor = start + 1;
  const inIdx = findKeywordAtDepth0(tokens, cursor, 'IN');
  const varText = renderTokensInline(tokens.slice(cursor, inIdx), cfg);
  cursor = inIdx + 1;

  const lines: string[] = [];
  if (tokens[cursor]?.text === '(') {
    const closeIdx = matchParen(tokens, cursor) - 1;
    const inner = tokens.slice(cursor + 1, closeIdx);
    lines.push(`${pad}FOR ${varText} IN (`);
    lines.push(...formatQuery(inner, indent + cfg.indentSize, cfg));
    lines.push(`${pad})`);
    cursor = closeIdx + 1;
  } else {
    const loopIdx = findKeywordAtDepth0(tokens, cursor, 'LOOP');
    lines.push(`${pad}FOR ${varText} IN ${renderTokensInline(tokens.slice(cursor, loopIdx), cfg)}`);
    cursor = loopIdx;
  }

  if (tokens[cursor]?.upper === 'LOOP') {
    cursor++;
  }
  lines.push(`${pad}LOOP`);

  const body = formatStatementList(tokens, cursor, indent + cfg.indentSize, cfg);
  if (body === null) {
    return null;
  }
  lines.push(...body.lines);
  cursor = body.next;

  if (tokens[cursor]?.upper !== 'END') {
    // Idem formatIfStatement/formatBeginBlock — não fabrica `END LOOP;`.
    return null;
  }
  lines.push(`${pad}END LOOP;`);
  cursor += tokens[cursor + 1]?.upper === 'LOOP' ? 2 : 1;
  if (tokens[cursor]?.text === ';') {
    cursor++;
  }
  return { lines, next: cursor };
}

/** Seção `DECLARE`: cada declaração (`nome TIPO [DEFAULT expr];`) numa
 * linha, indentada `indentSize` a mais que `DECLARE`; comentários standalone
 * ficam na indentação das declarações, não na coluna 1 (regra 8 do river
 * style é só pra SQL de topo — aqui dentro acompanha o bloco). */
function formatDeclareSection(tokens: Token[], start: number, indent: number, cfg: Cfg): BodyResult {
  const pad = ' '.repeat(indent);
  const declIndent = indent + cfg.indentSize;
  const declPad = ' '.repeat(declIndent);
  const lines = [`${pad}DECLARE`];
  let cursor = start + 1;

  while (cursor < tokens.length && tokens[cursor].upper !== 'BEGIN') {
    while (tokens[cursor] && (tokens[cursor].type === 'comment' || tokens[cursor].type === 'blockComment')) {
      lines.push(declPad + tokens[cursor].text);
      cursor++;
    }
    if (cursor >= tokens.length || tokens[cursor].upper === 'BEGIN') {
      break;
    }
    const end = findStatementEnd(tokens, cursor);
    const declTokens = tokens.slice(cursor, end);
    lines.push(`${declPad}${renderTokensInline(declTokens, cfg)};`);
    cursor = tokens[end]?.text === ';' ? end + 1 : end;
  }
  return { lines, next: cursor };
}

/** Corpo entre os delimitadores de dollar-quoting (`$BODY$ ... $BODY$`):
 * comentário de cabeçalho opcional, `DECLARE` opcional, `BEGIN...END`. Devolve
 * `null` se o `BEGIN...END` não pôde ser formatado com segurança (ver
 * `formatBeginBlock`) — `tryFormatCreateFunction` cai no fallback de linha
 * única pra função inteira nesse caso, em vez de arriscar inventar texto. */
function formatPlpgsqlBody(tokens: Token[], indent: number, cfg: Cfg): string[] | null {
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  let cursor = 0;

  while (tokens[cursor] && (tokens[cursor].type === 'comment' || tokens[cursor].type === 'blockComment')) {
    lines.push(pad + tokens[cursor].text);
    cursor++;
  }

  if (tokens[cursor]?.upper === 'DECLARE') {
    const decl = formatDeclareSection(tokens, cursor, indent, cfg);
    lines.push(...decl.lines);
    cursor = decl.next;
  }

  if (tokens[cursor]?.upper === 'BEGIN') {
    const begin = formatBeginBlock(tokens, cursor, indent, cfg);
    if (begin === null) {
      return null;
    }
    lines.push(...begin.lines);
    cursor = begin.next;
  }

  if (cursor < tokens.length) {
    // Sobra inesperada (construção não coberta) — preserva em vez de
    // descartar, sem tentar reformatar.
    lines.push(`${pad}${renderTokensInline(tokens.slice(cursor), cfg)}`);
  }

  return lines;
}

/** `CREATE [OR REPLACE] FUNCTION|PROCEDURE nome (params) RETURNS tipo AS
 * $tag$ ... $tag$ LANGUAGE lang` — cabeçalho numa linha por cláusula, corpo
 * via `formatPlpgsqlBody`. Devolve `null` se `tokens` não é esse tipo de
 * statement (deixa o chamador cair no fallback de sempre). */
function tryFormatCreateFunction(tokens: Token[], cfg: Cfg): string[] | null {
  let cursor = 0;
  while (tokens[cursor] && (tokens[cursor].type === 'comment' || tokens[cursor].type === 'blockComment')) {
    cursor++;
  }
  if (tokens[cursor]?.upper !== 'CREATE') {
    return null;
  }
  let header = 'CREATE';
  cursor++;
  if (tokens[cursor]?.upper === 'OR' && tokens[cursor + 1]?.upper === 'REPLACE') {
    header += ' OR REPLACE';
    cursor += 2;
  }
  const kind = tokens[cursor]?.upper;
  if (kind !== 'FUNCTION' && kind !== 'PROCEDURE') {
    return null;
  }
  header += ` ${kind}`;
  cursor++;

  const nameTok = tokens[cursor++];
  if (!nameTok || tokens[cursor]?.text !== '(') {
    return null;
  }
  const paramsClose = matchParen(tokens, cursor) - 1;
  const paramsInline = renderTokensInline(tokens.slice(cursor, paramsClose + 1), cfg);
  cursor = paramsClose + 1;

  const lines = [`${header} ${nameTok.text} ${paramsInline}`];

  if (tokens[cursor]?.upper === 'RETURNS') {
    cursor++;
    const asIdx = findKeywordAtDepth0(tokens, cursor, 'AS');
    lines.push(`RETURNS ${renderTokensInline(tokens.slice(cursor, asIdx), cfg)}`);
    cursor = asIdx;
  }
  if (tokens[cursor]?.upper !== 'AS' || tokens[cursor + 1]?.type !== 'dollarQuote') {
    // Cabeçalho reconhecido, mas sem corpo dollar-quoted (assinatura só,
    // função em SQL puro sem AS $$...$$, etc.) — fora do subconjunto
    // coberto; deixa o fallback de linha única cuidar do statement inteiro.
    return null;
  }
  cursor++;
  const tag = tokens[cursor].text;
  cursor++;
  lines.push(`AS ${tag}`);

  let bodyEnd = cursor;
  while (bodyEnd < tokens.length && !(tokens[bodyEnd].type === 'dollarQuote' && tokens[bodyEnd].text === tag)) {
    bodyEnd++;
  }
  const bodyTokens = tokens.slice(cursor, bodyEnd);
  const bodyLines = formatPlpgsqlBody(bodyTokens, 0, cfg);
  if (bodyLines === null) {
    // Corpo tem construção não coberta / terminador inesperado — desiste de
    // estruturar a função inteira em vez de arriscar inventar texto; o
    // chamador (formatStatement) cai no fallback de linha única.
    return null;
  }
  lines.push(...bodyLines);
  cursor = bodyEnd + 1; // pula o dollarQuote de fechamento
  lines.push(tag);

  if (tokens[cursor]?.upper === 'LANGUAGE') {
    cursor++;
    const langTokens: Token[] = [];
    while (tokens[cursor] && tokens[cursor].text !== ';') {
      langTokens.push(tokens[cursor]);
      cursor++;
    }
    lines.push(`LANGUAGE ${renderTokensInline(langTokens, cfg)}`);
  }

  return lines;
}

/** `CREATE TYPE nome AS (campo tipo, campo tipo, ...)` — um campo por linha,
 * indentado; tipo de cada campo não é maiusculizado (não é keyword nem cast,
 * é só um identificador — preserva o que veio no fonte). */
function tryFormatCreateType(tokens: Token[], cfg: Cfg): string[] | null {
  let cursor = 0;
  while (tokens[cursor] && (tokens[cursor].type === 'comment' || tokens[cursor].type === 'blockComment')) {
    cursor++;
  }
  if (tokens[cursor]?.upper !== 'CREATE' || tokens[cursor + 1]?.upper !== 'TYPE') {
    return null;
  }
  const nameTok = tokens[cursor + 2];
  if (!nameTok || tokens[cursor + 3]?.upper !== 'AS' || tokens[cursor + 4]?.text !== '(') {
    return null;
  }
  const openIdx = cursor + 4;
  const closeIdx = matchParen(tokens, openIdx) - 1;
  if (closeIdx !== tokens.length - 1) {
    return null;
  }

  const fields = splitTopLevelCommas(tokens.slice(openIdx + 1, closeIdx));
  const lines = [`CREATE TYPE ${nameTok.text} AS (`];
  fields.forEach((field, idx) => {
    const suffix = idx < fields.length - 1 ? ',' : '';
    lines.push(`${' '.repeat(cfg.indentSize)}${renderTokensInline(field, cfg)}${suffix}`);
  });
  lines.push(')');
  return lines;
}
