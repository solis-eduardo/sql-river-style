/**
 * Tokenizer para SQL bruto (dialeto PostgreSQL, o usado no Competo).
 *
 * Não é um parser SQL completo — é deliberadamente simples: reconhece
 * comentários, strings, identificadores (incluindo `tabela.coluna` e
 * `tabela.*` como um único token), números, pontuação e operadores.
 * Isso é suficiente para o formatter, que trabalha em cima de fluxo de
 * tokens e profundidade de parênteses, não de uma AST completa.
 */

export type TokenType =
  | 'keyword'
  | 'ident'
  | 'string'
  | 'number'
  | 'punct'
  | 'op'
  | 'comment'
  | 'blockComment';

export interface Token {
  type: TokenType;
  /** Texto original, exatamente como apareceu no arquivo fonte. */
  text: string;
  /** Forma maiúscula de `text` — útil para comparar keywords sem alocar de novo. */
  upper: string;
  /**
   * Apenas para comentários de linha (`--`): true quando nada além de
   * espaço em branco precedeu o comentário na mesma linha do fonte.
   * Comentários "standalone" viram sua própria linha na coluna 1 (regra 8);
   * comentários "trailing" ficam grudados no fim da linha de código que
   * os precede.
   */
  standalone?: boolean;
}

/**
 * Palavras reservadas reconhecidas como keyword SQL (maiúsculas na saída).
 * Propositalmente NÃO inclui nomes de função (CAST, COALESCE, EXTRACT...):
 * essas são tratadas como identificadores e maiusculizadas apenas quando
 * batem com a lista de "funções nativas" do formatter — ver formatter.ts.
 */
export const KEYWORD_SET = new Set([
  'SELECT', 'DISTINCT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL',
  'LIKE', 'ILIKE', 'SIMILAR', 'BETWEEN', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL',
  'OUTER', 'CROSS', 'ON', 'USING', 'AS', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT',
  'OFFSET', 'UNION', 'ALL', 'EXCEPT', 'INTERSECT', 'WITH', 'RECURSIVE', 'CASE',
  'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST', 'EXISTS',
  'OVER', 'PARTITION', 'WINDOW', 'FILTER', 'WITHIN', 'LATERAL', 'INTO', 'VALUES',
  'INSERT', 'UPDATE', 'DELETE', 'SET', 'RETURNING', 'TRUE', 'FALSE', 'ANY', 'SOME',
  'UNKNOWN', 'DEFAULT', 'COLLATE', 'CONFLICT', 'DO', 'NOTHING', 'FOR', 'OF', 'INTERVAL',
]);

/**
 * Palavras reservadas do PostgreSQL — TODAS as variantes de "reserved" na
 * coluna "PostgreSQL" de https://www.postgresql.org/docs/current/sql-keywords-appendix.html
 * (extraídas da tabela em 2026-08-14; reconferir se a extensão for
 * atualizada para uma versão nova do Postgres). É uma lista bem mais ampla
 * que `KEYWORD_SET` — inclui palavras de DDL (CREATE, CONSTRAINT, TABLE...)
 * que nunca viram marcador de cláusula neste formatter, mas que NÃO podem
 * aparecer como identificador sem aspas em SQL válido. Usada só pela
 * checagem de segurança de `unquoteIfSafe` — não usar para decidir
 * maiúsculas/marcador de cláusula, isso é papel de `KEYWORD_SET`.
 */
const RESERVED_KEYWORDS = new Set([
  'ALL', 'ANALYSE', 'ANALYZE', 'AND', 'ANY', 'ARRAY', 'AS', 'ASC',
  'ASYMMETRIC', 'AUTHORIZATION', 'BINARY', 'BOTH', 'CASE', 'CAST', 'CHECK', 'COLLATE',
  'COLLATION', 'COLUMN', 'CONCURRENTLY', 'CONSTRAINT', 'CREATE', 'CROSS', 'CURRENT_CATALOG', 'CURRENT_DATE',
  'CURRENT_ROLE', 'CURRENT_SCHEMA', 'CURRENT_TIME', 'CURRENT_TIMESTAMP', 'CURRENT_USER', 'DEFAULT', 'DEFERRABLE', 'DESC',
  'DISTINCT', 'DO', 'ELSE', 'END', 'EXCEPT', 'FALSE', 'FETCH', 'FOR',
  'FOREIGN', 'FREEZE', 'FROM', 'FULL', 'GRANT', 'GROUP', 'HAVING', 'ILIKE',
  'IN', 'INITIALLY', 'INNER', 'INTERSECT', 'INTO', 'IS', 'ISNULL', 'JOIN',
  'LATERAL', 'LEADING', 'LEFT', 'LIKE', 'LIMIT', 'LOCALTIME', 'LOCALTIMESTAMP', 'NATURAL',
  'NOT', 'NOTNULL', 'NULL', 'OFFSET', 'ON', 'ONLY', 'OR', 'ORDER',
  'OUTER', 'OVERLAPS', 'PLACING', 'PRIMARY', 'REFERENCES', 'RETURNING', 'RIGHT', 'SELECT',
  'SESSION_USER', 'SIMILAR', 'SOME', 'SYMMETRIC', 'SYSTEM_USER', 'TABLE', 'TABLESAMPLE', 'THEN',
  'TO', 'TRAILING', 'TRUE', 'UNION', 'UNIQUE', 'USER', 'USING', 'VARIADIC',
  'VERBOSE', 'WHEN', 'WHERE', 'WINDOW', 'WITH',
]);

/** Um identificador entre aspas só precisa delas se tiver maiúscula, espaço, acento ou outro caractere fora de `[a-z0-9_]`, ou se colidir com uma palavra reservada do Postgres. */
const SAFE_TO_UNQUOTE = /^[a-z_][a-z0-9_]*$/;

function unquoteIfSafe(segment: string): string {
  if (segment[0] !== '"') {
    return segment;
  }
  const inner = segment.slice(1, -1).replace(/""/g, '"');
  return SAFE_TO_UNQUOTE.test(inner) && !RESERVED_KEYWORDS.has(inner.toUpperCase()) ? inner : segment;
}

/** Separa `raw` (já casado pelo TOKEN_REGEX) em segmentos entre pontos, sem quebrar um ponto literal dentro de um segmento entre aspas. */
function splitQualifiedSegments(raw: string): string[] {
  const segments: string[] = [];
  let i = 0;
  while (i < raw.length) {
    let j: number;
    if (raw[i] === '"') {
      j = i + 1;
      while (j < raw.length) {
        if (raw[j] === '"') {
          if (raw[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
    } else {
      j = i;
      while (j < raw.length && raw[j] !== '.') {
        j++;
      }
    }
    segments.push(raw.slice(i, j));
    i = raw[j] === '.' ? j + 1 : j;
  }
  return segments;
}

/**
 * Tira as aspas de cada segmento entre aspas de um identificador
 * (qualificado ou não) quando elas não fazem falta — minúsculo, sem
 * espaço/acento e sem colidir com keyword reservada. `"tabela"."coluna"`
 * vira `tabela.coluna`; `"Tabela"."coluna"` vira `"Tabela".coluna` (só o
 * segundo segmento é seguro de destrinchar).
 */
function normalizeQualifiedIdent(raw: string): string {
  if (!raw.includes('"')) {
    return raw;
  }
  return splitQualifiedSegments(raw).map(unquoteIfSafe).join('.');
}

/** Um segmento de identificador: `nome` ou `"nome com espaço/maiúsculas"`. */
const IDENT_SEGMENT = /(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)/.source;

const TOKEN_REGEX = new RegExp(
  [
    /--[^\n]*/.source, // comentário de linha
    /\/\*[\s\S]*?\*\//.source, // comentário de bloco
    /'(?:[^']|'')*'/.source, // string literal ('' escapa aspa simples)
    /\d+\.\d+\b/.source, // número decimal
    /\d+\b/.source, // número inteiro
    /::/.source,
    /<>|<=|>=|!=|\|\|/.source,
    /[(),;]/.source,
    /[=<>+\-*/%]/.source,
    // identificador — aceita tabela.coluna, tabela.*, e qualquer combinação de
    // segmentos com/sem aspas: "tabela"."coluna", tabela."coluna", "tabela".coluna.
    // Precisa vir antes do catch-all para não deixar o "." entre dois
    // identificadores entre aspas cair nele (regra 3: tabela.coluna por extenso).
    `${IDENT_SEGMENT}(?:\\.(?:${IDENT_SEGMENT}|\\*))*`,
    /\n/.source,
    /[ \t\r]+/.source,
    // Catch-all: qualquer caractere não reconhecido pelas regras acima (`?`
    // de bind parameter, operadores específicos do Postgres como `?|`/`@>`,
    // etc.) vira um token 'op' isolado em vez de ser silenciosamente
    // descartado — nunca perder conteúdo do SQL original é mais importante
    // que reconhecer todo operador possível.
    /[^]/.source,
  ].join('|'),
  'g',
);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let atLineStart = true;
  let match: RegExpExecArray | null;
  TOKEN_REGEX.lastIndex = 0;

  while ((match = TOKEN_REGEX.exec(source)) !== null) {
    const raw = match[0];

    if (raw === '\n') {
      atLineStart = true;
      continue;
    }
    if (raw[0] === ' ' || raw[0] === '\t' || raw[0] === '\r') {
      continue;
    }

    if (raw.startsWith('--')) {
      tokens.push({
        type: 'comment',
        text: raw.replace(/\s+$/, ''),
        upper: '',
        standalone: atLineStart,
      });
      atLineStart = false;
      continue;
    }

    if (raw.startsWith('/*')) {
      tokens.push({ type: 'blockComment', text: raw, upper: '', standalone: atLineStart });
      atLineStart = false;
      continue;
    }

    atLineStart = false;

    if (raw[0] === "'") {
      tokens.push({ type: 'string', text: raw, upper: raw });
      continue;
    }
    if (raw[0] === '"') {
      const normalized = normalizeQualifiedIdent(raw);
      tokens.push({ type: 'ident', text: normalized, upper: normalized.toUpperCase() });
      continue;
    }
    if (/^\d/.test(raw)) {
      tokens.push({ type: 'number', text: raw, upper: raw });
      continue;
    }
    if (raw === '(' || raw === ')' || raw === ',' || raw === ';') {
      tokens.push({ type: 'punct', text: raw, upper: raw });
      continue;
    }
    if (/^[A-Za-z_]/.test(raw)) {
      const isQualified = raw.includes('.');
      const first = isQualified ? raw.slice(0, raw.indexOf('.')) : raw;
      const upper = first.toUpperCase();
      const isKeyword = !isQualified && KEYWORD_SET.has(upper);
      tokens.push({ type: isKeyword ? 'keyword' : 'ident', text: raw, upper: raw.toUpperCase() });
      continue;
    }
    // operadores remanescentes (::, <>, <=, >=, !=, ||, =, <, >, +, -, *, /, %)
    tokens.push({ type: 'op', text: raw, upper: raw });
  }

  return tokens;
}
