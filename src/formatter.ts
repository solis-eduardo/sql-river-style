/**
 * Formatter de SQL no estilo "river" usado no Competo (ver memória
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
  const rendered = statements.map((stmt) => formatStatement(stmt, cfg)).filter((s) => s.trim().length > 0);

  if (rendered.length === 0) {
    return '';
  }
  // Regra 9: sem `;` no final. Entre statements (arquivo com múltiplas
  // queries) o `;` é mantido, pois é necessário para a validade do SQL.
  return rendered.join(';\n\n') + '\n';
}

function formatStatement(tokens: Token[], cfg: Cfg): string {
  if (tokens.length === 0) {
    return '';
  }

  const FORMATTABLE = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE']);
  const firstKeyword = firstMeaningfulKeyword(tokens);
  if (!firstKeyword || !FORMATTABLE.has(firstKeyword)) {
    // Statements que não são consulta/DML básico (DDL, MERGE, comandos de
    // sessão...) ficam fora do escopo das regras de river style.
    // Maiusculiza palavras-chave e devolve em uma linha só, sem arriscar
    // reestruturar o que não é modelado por este formatter.
    return renderTokensInline(tokens, cfg);
  }

  const lines = formatQuery(tokens, 0, cfg);
  while (lines.length > 0 && lines[0] === '') {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.join('\n');
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
  let current: Token[] = [];
  for (const t of tokens) {
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
        // Regra 6: linha em branco só separando uma definição de CTE da
        // próxima — não no topo/rodapé de cada corpo (a primeira CTE cola
        // no `AS (` e a última cola no fechamento).
        lines.push('');
        cursor++;
        continue;
      }
      break;
    }
    lines.push(`${' '.repeat(indent)})`);
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
  const width = computeWidth(parsedBlocks, ops);

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

function computeWidth(blocks: ClauseLine[][], ops: string[]): number {
  let max = 0;
  for (const block of blocks) {
    for (const line of block) {
      max = Math.max(max, line.label.length);
    }
  }
  for (const op of ops) {
    max = Math.max(max, op.length);
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
      markers.push(mk(i, i + 1, 'SELECT', 'SELECT'));
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
    curr.text === ',' ||
    curr.text === '::' ||
    (curr.text === '(' && prev?.type === 'ident') ||
    prev?.text === '(' ||
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
