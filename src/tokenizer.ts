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
  'UNKNOWN', 'DEFAULT', 'COLLATE', 'CONFLICT', 'DO', 'NOTHING', 'FOR', 'OF',
]);

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
      tokens.push({ type: 'ident', text: raw, upper: raw.toUpperCase() });
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
