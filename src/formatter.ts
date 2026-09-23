/**
 * Formatter de SQL no estilo "river" (ver memória
 * feedback-sql-formatting-style). Não é um formatter SQL genérico e
 * configurável: é deliberadamente opinativo, reproduzindo as 9 regras
 * confirmadas pelo usuário. Ver README.md para exemplos e limitações
 * conhecidas.
 *
 * Orquestração de topo: entry point (`formatSql`), split de statements por
 * `;` de nível 0, e roteamento de cada statement pro caminho certo — CREATE
 * FUNCTION/TYPE (plpgsql.ts), SELECT/WITH/INSERT/UPDATE/DELETE (motor de
 * renderização em render.ts) ou fallback de linha única pro resto (DDL,
 * comandos de sessão...). O trabalho de fato — profundidade de
 * parênteses/CASE, quebra em cláusulas, CTEs/UNION, renderização inline de
 * expressão — vive em render.ts, reaproveitado também por plpgsql.ts pro
 * SQL comum embutido num corpo PL/pgSQL.
 */

import { Token, tokenize, FORMATTABLE_STATEMENT_KEYWORDS } from './tokenizer';
import { tryFormatCreateFunction, tryFormatCreateType } from './plpgsql';
import { Cfg, FormatOptions, buildCfg, formatQuery, firstMeaningfulKeyword, renderFallbackLines } from './render';

export type { Cfg, FormatOptions };
export { buildCfg };

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

  const firstKeyword = firstMeaningfulKeyword(rest);
  if (!firstKeyword || !FORMATTABLE_STATEMENT_KEYWORDS.has(firstKeyword)) {
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
