/**
 * Tokenizer para SQL bruto (dialeto PostgreSQL).
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
  | 'blockComment'
  | 'dollarQuote';

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

/**
 * Palavras-chave de DDL do PostgreSQL que são "non-reserved" na coluna
 * "PostgreSQL" do mesmo apêndice de `RESERVED_KEYWORDS` (2026-08-18) — ou
 * seja, PODEM em tese ser usadas como identificador sem aspas (por isso
 * ficam fora de `RESERVED_KEYWORDS`, que é só sobre segurança de
 * quoting), mas na prática só aparecem como palavra de comando de DDL
 * (`CREATE`/`ALTER`/`DROP ...`) — construção fora do escopo deste
 * formatter, que cai no fallback genérico (ver `formatStatement` em
 * formatter.ts). Sem essa lista, `normalizeIdentSegment` as tratava como
 * identificador comum e as dobrava pra minúsculo (`DROP TABLE Foo` virava
 * `drop TABLE foo`) — o mesmo bug que a lista de `RESERVED_KEYWORDS`
 * evita para `CREATE`/`TABLE`/etc, só que para a metade "non-reserved" do
 * vocabulário de DDL. Curada (não é a categoria "non-reserved" inteira
 * do apêndice — essa é enorme e cheia de palavras comuns como nome de
 * coluna, ex. `NAME`/`TEXT`/`VALUE`/`ROLE`/`COMMENT`/`LANGUAGE`; incluir
 * essas arriscaria parar de dobrar coluna real assim escrita com
 * maiúscula) — cobre só verbo/objeto de DDL sem ambiguidade plausível
 * como nome de coluna.
 */
const NON_RESERVED_DDL_KEYWORDS = new Set([
  'ALTER', 'DROP', 'INDEX', 'VIEW', 'SCHEMA', 'SEQUENCE', 'TRIGGER',
  'FUNCTION', 'PROCEDURE', 'TYPE', 'DOMAIN', 'EXTENSION', 'MATERIALIZED',
  'TABLESPACE', 'CASCADE', 'RESTRICT', 'TRUNCATE', 'RENAME',
]);

/**
 * true quando `upper` (já em maiúsculas) é uma palavra que este formatter
 * nunca trata como identificador de dado comum quando aparece SEM aspas no
 * fonte — usado só pelo ramo sem aspas de `normalizeIdentSegment` pra
 * decidir se pode dobrar pra minúsculo. Junta os dois motivos possíveis:
 * `RESERVED_KEYWORDS` (reservada de verdade — nem poderia ser identificador
 * sem aspas pro Postgres) e `NON_RESERVED_DDL_KEYWORDS` (tecnicamente
 * poderia, mas na prática só aparece como comando de DDL fora de escopo).
 *
 * NÃO usar em `quoteIdentIfNeeded` nem no ramo COM aspas de
 * `normalizeIdentSegment`: nos dois casos já se sabe, sem ambiguidade, que
 * a palavra está numa posição de identificador de verdade (um alias
 * explícito, ou aspas que o autor do SQL já colocou) — diferente do ramo
 * sem aspas, onde um `DROP` solto no meio do token stream tanto pode ser
 * comando de DDL quanto nome de coluna sem aspas, e não dá pra saber qual
 * sem parsear o statement inteiro (fora do escopo deste formatter — ver
 * `NON_RESERVED_DDL_KEYWORDS`). Nesses outros dois casos misturar as duas
 * listas quotaria/preservaria aspas à toa: Postgres aceita `drop`/`alter`/
 * ... sem aspas como identificador comum — não são reservadas de verdade,
 * só não são o que este formatter espera ver soltas no meio do stream.
 */
export function isProtectedFromCaseFold(upper: string): boolean {
  return RESERVED_KEYWORDS.has(upper) || NON_RESERVED_DDL_KEYWORDS.has(upper);
}

/** Um identificador entre aspas só precisa delas se tiver maiúscula, espaço, acento ou outro caractere fora de `[a-z0-9_]`, ou se colidir com uma palavra reservada do Postgres. */
const SAFE_TO_UNQUOTE = /^[a-z_][a-z0-9_]*$/;

/** Nome "cru" (sem aspas) de identificador -> forma final: sem aspas se for
 * seguro (minúsculo/dígito/`_`, sem colidir com reservada), ou entre aspas
 * duplas (escapando `"` interno) senão. É o inverso de `normalizeIdentSegment`
 * pro caso sem aspas: aqui parte de um nome qualquer e decide se PRECISA de
 * aspas, em vez de decidir se pode TIRAR aspas que já estavam lá. Usado pelo
 * formatter pra alias que chegam como string literal (`AS 'Foo'`, convenção
 * do SQL Server) e precisam virar identificador de verdade. */
export function quoteIdentIfNeeded(name: string): string {
  // Só `RESERVED_KEYWORDS` — `name` já é sabidamente um identificador (um
  // alias explícito), não um token ambíguo solto no meio do stream, então
  // `NON_RESERVED_DDL_KEYWORDS` não se aplica aqui (ver
  // `isProtectedFromCaseFold`).
  return SAFE_TO_UNQUOTE.test(name) && !RESERVED_KEYWORDS.has(name.toUpperCase()) ? name : `"${name.replace(/"/g, '""')}"`;
}

/** Normaliza um segmento (qualificado ou não) de identificador: um segmento
 * SEM aspas no fonte é dobrado pra minúsculo — é o que o Postgres faz com
 * identificador sem aspas (`Tabela` sem aspas é exatamente `tabela` pro
 * banco), então preservar a caixa original seria mostrar uma "caixa" que
 * nunca existiu de verdade pro banco. Exceção: um segmento que bate com uma
 * palavra reservada do Postgres (`RESERVED_KEYWORDS`) nunca é dobrado —
 * `CREATE`/`TABLE`/... não são identificadores de dado (nem poderiam ser
 * sem aspas, são reservadas de verdade), então o "Postgres dobra
 * identificador sem aspas" nem se aplica; idem para uma palavra de
 * `NON_RESERVED_DDL_KEYWORDS` (`DROP`/`ALTER`/...) — tecnicamente
 * poderiam ser identificador sem aspas pro Postgres, mas na prática só
 * aparecem como comando de DDL. Ambas são palavras fora do escopo deste
 * formatter (caem no fallback genérico — ver `formatStatement`), e mexer
 * na caixa delas seria arriscar sem necessidade.
 * Um segmento COM aspas no fonte nunca tem sua caixa/conteúdo alterado —
 * aspas são exatamente como se preserva maiúscula/espaço/acento no
 * Postgres — mas as aspas em si são removidas quando ficam supérfluas
 * (minúsculo/dígito/`_`, sem colidir com reservada). */
function normalizeIdentSegment(segment: string): string {
  if (segment[0] !== '"') {
    return isProtectedFromCaseFold(segment.toUpperCase()) ? segment : segment.toLowerCase();
  }
  // Só `RESERVED_KEYWORDS` — `inner` veio de um segmento que JÁ tinha aspas
  // no fonte, então não é o token ambíguo que `isProtectedFromCaseFold`
  // existe pra proteger (ver seu comentário).
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
 * Normaliza cada segmento (entre pontos) de um identificador, qualificado
 * ou não: dobra pra minúsculo os que não tinham aspas no fonte (regra do
 * Postgres — identificador sem aspas é sempre case-folded), e tira as
 * aspas dos que tinham quando elas não fazem falta — minúsculo, sem
 * espaço/acento e sem colidir com keyword reservada. `Tabela.Coluna` vira
 * `tabela.coluna`; `"Tabela"."coluna"` vira `"Tabela".coluna` (só o
 * segundo segmento é seguro de destrinchar); `tabela."Coluna Com Espaço"`
 * fica igual (primeiro segmento já minúsculo, segundo precisa das aspas).
 */
function normalizeQualifiedIdent(raw: string): string {
  return splitQualifiedSegments(raw).map(normalizeIdentSegment).join('.');
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
    // Parâmetro posicional do PL/pgSQL (`$1`, `$2`...) — precisa vir antes
    // do catch-all e antes do padrão de dollar-quote logo abaixo: um `$`
    // seguido de dígito não bate com a tag de dollar-quote (que exige letra
    // depois do `$`), então sem essa regra ele caía no catch-all como um
    // `$` solto de 1 caractere, e o código de dollar-quote tratava esse `$`
    // isolado como se fosse uma tag `$$` vazia — corrompendo `$1` em `$$ 1`.
    /\$\d+/.source,
    // Delimitador de dollar-quoting de corpo de função/procedure (`$$`,
    // `$BODY$`...). Tolera espaço acidental depois do primeiro `$` (`$
    // BODY$`), normalizado na saída — ver `tokenize`. Precisa vir antes do
    // catch-all: sem isso, cada `$`/tag vira token solto e o par
    // abre/fecha nunca é reconhecido, deixando o corpo da função
    // impossível de formatar (ver README, "Definição de função").
    /\$[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]*\$|\$\$/.source,
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
    if (raw[0] === '$') {
      if (/^\$\d+$/.test(raw)) {
        // Parâmetro posicional ($1, $2...) — não é delimitador de corpo,
        // é um valor/identificador comum dentro de uma expressão.
        tokens.push({ type: 'ident', text: raw, upper: raw.toUpperCase() });
        continue;
      }
      // Normaliza espaço interno acidental (`$ BODY$` -> `$BODY$`) — a tag
      // em si (maiúsculas/minúsculas) é preservada como está.
      const tag = raw.slice(1, -1).trim();
      const normalized = `$${tag}$`;
      tokens.push({ type: 'dollarQuote', text: normalized, upper: normalized.toUpperCase() });
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
      if (isKeyword) {
        tokens.push({ type: 'keyword', text: raw, upper });
      } else {
        // Identificador sem aspas no fonte — dobra pra minúsculo (ver
        // `normalizeIdentSegment`), igual o Postgres faz internamente.
        const normalized = normalizeQualifiedIdent(raw);
        tokens.push({ type: 'ident', text: normalized, upper: normalized.toUpperCase() });
      }
      continue;
    }
    // operadores remanescentes (::, <>, <=, >=, !=, ||, =, <, >, +, -, *, /, %)
    tokens.push({ type: 'op', text: raw, upper: raw });
  }

  return tokens;
}
