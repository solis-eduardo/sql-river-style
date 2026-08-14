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
    if (depth !== 0 || t.type !== 'keyword') {
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

function mergeOnConditions(lines: ClauseLine[]): ClauseLine[] {
  const result: ClauseLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.kind === 'ON' || line.kind === 'USING') {
      const body = line.body.slice();
      let j = i + 1;
      while (j < lines.length && (lines[j].kind === 'AND' || lines[j].kind === 'OR')) {
        body.push({ type: 'keyword', text: lines[j].label, upper: lines[j].label });
        body.push(...lines[j].body);
        j++;
      }
      result.push({ ...line, body });
      i = j - 1;
    } else {
      result.push(line);
    }
  }
  return result;
}

function parseSelectBlock(tokens: Token[]): ClauseLine[] {
  const markers = findMarkers(tokens);
  const raw: ClauseLine[] = markers.map((m, k) => {
    const bodyStart = m.end;
    const bodyEnd = k + 1 < markers.length ? markers[k + 1].start : tokens.length;
    return { label: m.label, kind: m.kind, body: tokens.slice(bodyStart, bodyEnd) };
  });
  return mergeOnConditions(raw);
}

function renderSelectBlock(clauseLines: ClauseLine[], indent: number, width: number, cfg: Cfg): string[] {
  const out: string[] = [];
  for (const line of clauseLines) {
    out.push(...renderClauseLine(line, indent, width, cfg));
  }
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

  out.push(`${pad}${line.label} ${renderTokensInline(clean, cfg)}`);
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
    const rendered = renderTokensInline(body, cfg) + suffix + renderTrailingComments(trailing);
    out.push(idx === 0 ? `${pad}${label} ${rendered}` : `${contentIndent}${rendered}`);
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
    const noSpace =
      t.text === ')' ||
      t.text === ',' ||
      t.text === '::' ||
      (t.text === '(' && prev?.type === 'ident') ||
      prev?.text === '(' ||
      prev?.text === '::' ||
      prevIsUnary;

    out += noSpace ? text : ' ' + text;
  }

  return out;
}
