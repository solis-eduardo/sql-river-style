/**
 * CREATE FUNCTION / PROCEDURE — corpo em PL/pgSQL (dollar-quoted, ex.: $BODY$).
 *
 * Não é um parser PL/pgSQL completo: cobre o subconjunto usado em queries de
 * relatório/funções de negócio comuns — DECLARE, BEGIN...END, IF/THEN/ELSE/
 * END IF, FOR var IN (query) LOOP...END LOOP, atribuição (:=), RETURN/RETURN
 * NEXT/RETURN QUERY, e o SQL comum (SELECT/INSERT/UPDATE/DELETE) embutido em
 * qualquer um desses — reaproveitando o motor de SELECT/CTE/UNION
 * (`formatQuery`) e as primitivas de renderização de expressão
 * (`renderTokensInline`, `renderExpressionLines`, `uppercaseTypeTokens`,
 * `renderFallbackLines`, `firstMeaningfulKeyword`) de formatter.ts.
 *
 * Este módulo NÃO importa essas funções como valor: formatter.ts importa
 * `tryFormatCreateFunction`/`tryFormatCreateType` DESTE módulo, então um
 * import de valor na direção contrária fecharia um require() circular em
 * CommonJS (o `module` alvo deste projeto). Em vez disso, elas chegam via
 * `cfg.render.*`, injetado por `buildCfg` em formatter.ts — a única coisa
 * que este módulo importa de formatter.ts é o TIPO `Cfg` (apagado em tempo
 * de compilação, não gera `require()` nenhum). Construções não cobertas
 * (EXCEPTION, WHILE, CURSOR, EXECUTE dinâmico, ELSIF...) caem no fallback de
 * linha única (`cfg.render.tokensInline`), igual a qualquer DDL fora de
 * escopo — nunca perdem conteúdo, só não ganham reestruturação.
 */

import type { Cfg } from './formatter';
import { Token } from './tokenizer';
import { matchParen, findAtDepth0, findStatementEnd, splitAtCommaDepth0 } from './token-scan';

/** `true` se `tokens[i]` é uma palavra que fecha o bloco atual (ELSE, ou
 * qualquer `END`/`END IF`/`END LOOP`) — quem está formatando uma lista de
 * statements pára aqui e devolve o cursor pra quem a chamou decidir o que
 * fazer com o terminador.
 *
 * EXCEPTION entra na mesma lista por segurança, não porque tenha
 * estruturação própria (handler de EXCEPTION não é modelado — ver
 * comentário no topo desta seção): sem isso, o fallback de linha única do
 * statement seguinte (que varre até o próximo `;` de profundidade 0) podia
 * engolir o `END;` que fecha o BEGIN...EXCEPTION...END quando o handler não
 * tinha nenhum `;` próprio antes dele (ex.: handler "no-op", só com
 * comentário — o idiom "faça de novo o UPDATE" dos docs do Postgres). Esse
 * `END;` roubado desalinhava tudo que vinha depois. Parar em EXCEPTION
 * garante que `formatBeginBlock` vai achar `EXCEPTION` (não `END`) como
 * terminador, desistir com segurança (`return null`) e cair no fallback de
 * linha única do statement inteiro — feio, mas correto. */
function isBodyTerminator(tokens: Token[], i: number): boolean {
  const u = tokens[i]?.upper;
  return u === 'ELSE' || u === 'END' || u === 'EXCEPTION';
}

// findAtDepth0/findStatementEnd: ver token-scan.ts — usados pra achar o
// THEN de um IF, o IN/LOOP de um FOR, o `;` que fecha um statement PL/pgSQL
// simples, etc.

interface BodyResult {
  lines: string[];
  next: number;
}

/** `query`: SELECT/WITH/INSERT/UPDATE/DELETE embutido (via `formatQuery`) —
 * ganha uma linha em branco depois, e também antes se vier logo após uma
 * atribuição/DDL simples (`other`). `return`: RETURN/RETURN NEXT/RETURN
 * QUERY — ganha uma linha em branco antes E depois (a "depois" só aparece
 * de fato quando vem mais statement na sequência — um RETURN NEXT no meio
 * de um LOOP, por exemplo; o último RETURN antes do END do bloco não sobra
 * linha em branco à toa, já que não há próximo statement pra empurrar).
 * `block`: IF/FOR/BEGIN aninhado — mesma regra de "antes"/"depois" que
 * `query`. `call`: RAISE/EXECUTE/PERFORM/OPEN/FETCH/CLOSE (ver
 * `PLPGSQL_LEAF_KEYWORDS`) — toda chamada desse tipo é isolada com linha em
 * branco ao redor, mesma regra de "antes"/"depois" que `query`/`block`
 * (inclusive entre duas chamadas seguidas, ex.: um `RAISE NOTICE` logo
 * antes de um `EXECUTE`). `other`: atribuição/DDL simples — sem
 * espaçamento extra ao redor. */
type BodyStmtKind = 'query' | 'return' | 'block' | 'call' | 'other';

interface OneStmtResult extends BodyResult {
  kind: BodyStmtKind;
}

/** Formata uma sequência de statements PL/pgSQL a partir de `start`, parando
 * ao encontrar um terminador de bloco (ELSE/END) que pertence a quem chamou.
 * Devolve `null` se algum statement da lista não pôde ser formatado com
 * segurança (ver `formatOneBodyStatement`) — propaga pra quem chamou em vez
 * de tentar continuar com o que sobrou. */
export function formatStatementList(tokens: Token[], start: number, indent: number, cfg: Cfg): BodyResult | null {
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
    if (
      prevKind === 'query' ||
      prevKind === 'block' ||
      prevKind === 'return' ||
      prevKind === 'call' ||
      // RETURN só ganha linha em branco antes quando vem depois de outro
      // statement de verdade — sendo o primeiro do bloco (logo após
      // BEGIN/THEN/ELSE), não sobra linha em branco à toa ali.
      (r.kind === 'return' && prevKind !== null) ||
      ((r.kind === 'query' || r.kind === 'block' || r.kind === 'call') && prevKind === 'other')
    ) {
      lines.push('');
    }
    lines.push(...r.lines);
    cursor = r.next;
    prevKind = r.kind;
  }
  return { lines, next: cursor };
}

/** Palavra que abre um statement PL/pgSQL com bloco filho estruturado ->
 * formatter dedicado (mesma assinatura pros quatro: `formatIfStatement`,
 * `formatForStatement`, `formatLoopStatement`, `formatBeginBlock`) —
 * `formatOneBodyStatement` despacha por aqui em vez de um `if`/`if`/`if`
 * repetindo a mesma chamada+checagem de `null`+wrap pra cada palavra;
 * adicionar um quinto tipo de bloco é só uma entrada nova aqui. */
const BLOCK_STATEMENT_HANDLERS: Record<string, (tokens: Token[], start: number, indent: number, cfg: Cfg) => BodyResult | null> = {
  IF: formatIfStatement,
  FOR: formatForStatement,
  LOOP: formatLoopStatement,
  BEGIN: formatBeginBlock,
};

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
  const blockHandler = BLOCK_STATEMENT_HANDLERS[kw];
  if (blockHandler) {
    const r = blockHandler(tokens, cursor, indent, cfg);
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
  const stmtFirstKeyword = cfg.render.firstKeyword(stmtTokens);
  const isQuery = !!stmtFirstKeyword && EMBEDDED_QUERY_KEYWORDS.has(stmtFirstKeyword);
  const isCall = !!stmtFirstKeyword && PLPGSQL_LEAF_KEYWORDS.has(stmtFirstKeyword);
  lines.push(...renderSimpleBodyStatement(stmtTokens, indent, cfg));
  const next = tokens[end]?.text === ';' ? end + 1 : end;
  return { lines, next, kind: isQuery ? 'query' : isCall ? 'call' : 'other' };
}

const EMBEDDED_QUERY_KEYWORDS = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE']);

/** Palavras que abrem um statement PL/pgSQL "folha" (sem estruturação
 * própria neste formatter — ver comentário no topo da seção CREATE
 * FUNCTION/PROCEDURE) mas que, dentro de um corpo BEGIN...END, deveriam
 * sair maiúsculas igual DECLARE/BEGIN/RETURN/IF/LOOP saem (que têm
 * tratamento próprio hardcoded). Fora do `KEYWORD_SET` global de propósito:
 * essas palavras não têm papel nenhum numa query SQL comum, e colocá-las
 * no set usado por `findMarkers`/river style arriscaria forçar maiúscula
 * num identificador comum que só coincide de nome (ex.: uma coluna
 * chamada "raise", de aumento salarial). Só maiusculiza quando é
 * literalmente a PRIMEIRA palavra de um statement dentro de um corpo de
 * função — ver `withUppercasedLeadingPlpgsqlKeyword`. */
const PLPGSQL_LEAF_KEYWORDS = new Set(['RAISE', 'EXECUTE', 'PERFORM', 'EXIT', 'CONTINUE', 'OPEN', 'FETCH', 'CLOSE']);

/** Nível de severidade do `RAISE` (`RAISE NOTICE '...'`, `RAISE WARNING
 * '...'`...) — segunda palavra do statement, só faz sentido maiusculizar
 * junto quando a primeira já é `RAISE` (ver `withUppercasedLeadingPlpgsqlKeyword`). */
const RAISE_LEVELS = new Set(['DEBUG', 'LOG', 'INFO', 'NOTICE', 'WARNING', 'EXCEPTION']);

/** Se o primeiro token de `tokens` for uma das `PLPGSQL_LEAF_KEYWORDS`,
 * devolve uma cópia com esse token maiusculizado (e, se for `RAISE`
 * seguido de um nível reconhecido em `RAISE_LEVELS`, esse também);
 * senão devolve `tokens` sem alteração (mesma referência). */
function withUppercasedLeadingPlpgsqlKeyword(tokens: Token[]): Token[] {
  const first = tokens[0];
  if (!(first?.type === 'ident' && PLPGSQL_LEAF_KEYWORDS.has(first.upper))) {
    return tokens;
  }
  const out = [{ ...first, text: first.upper }, ...tokens.slice(1)];
  const second = out[1];
  if (first.upper === 'RAISE' && second?.type === 'ident' && RAISE_LEVELS.has(second.upper)) {
    out[1] = { ...second, text: second.upper };
  }
  return out;
}

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
    const lines = cfg.render.expressionLines(exprTokens, prefix.length, cfg);
    lines[0] = prefix + lines[0];
    lines[lines.length - 1] += ';';
    return lines;
  }

  const firstKeyword = cfg.render.firstKeyword(stmtTokens);
  if (firstKeyword && EMBEDDED_QUERY_KEYWORDS.has(firstKeyword)) {
    const lines = cfg.render.query(stmtTokens, indent, cfg);
    lines[lines.length - 1] += ';';
    return lines;
  }

  // Dali em diante não tem mais chance de ser atribuição nem SQL embutido
  // (já checados acima) — se começar com RAISE/EXECUTE/PERFORM/EXIT/
  // CONTINUE, maiusculiza igual DECLARE/BEGIN/RETURN/etc. saem.
  const leaf = withUppercasedLeadingPlpgsqlKeyword(stmtTokens);

  // DDL simples com uma subquery entre parênteses embutida (ex.: CREATE TEMP
  // TABLE x AS (SELECT ...)) — formata a subquery recursivamente, igual a
  // uma derived table em FROM/JOIN; o resto (fora dos parênteses) é inline.
  for (let i = 0; i < leaf.length; i++) {
    if (leaf[i].text !== '(') {
      continue;
    }
    let p = i + 1;
    while (leaf[p] && (leaf[p].type === 'comment' || leaf[p].type === 'blockComment')) {
      p++;
    }
    const innerKw = leaf[p]?.upper;
    if (innerKw !== 'SELECT' && innerKw !== 'WITH') {
      continue;
    }
    const closeIdx = matchParen(leaf, i) - 1;
    const before = cfg.render.tokensInline(leaf.slice(0, i), cfg);
    const inner = leaf.slice(i + 1, closeIdx);
    const after = leaf.slice(closeIdx + 1);
    const lines = [`${pad}${before} (`, ...cfg.render.query(inner, indent + cfg.indentSize, cfg, true), `${pad})${after.length ? ' ' + cfg.render.tokensInline(after, cfg) : ''};`];
    return lines;
  }

  return [`${pad}${cfg.render.tokensInline(leaf, cfg)};`];
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
    const exprLines = cfg.render.expressionLines(exprTokens, fullPrefix.length, cfg);
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
      const innerLines = cfg.render.query(inner, indent + cfg.indentSize, cfg, true);
      return [`${pad}IF (`, ...innerLines, `${pad})`];
    }
    return [`${pad}IF ( ${cfg.render.tokensInline(inner, cfg)} )`];
  }
  return [`${pad}IF ${cfg.render.tokensInline(tokens, cfg)}`];
}

function formatIfStatement(tokens: Token[], start: number, indent: number, cfg: Cfg): BodyResult | null {
  const pad = ' '.repeat(indent);
  let cursor = start + 1;
  const thenIdx = findAtDepth0(tokens, cursor, 'THEN');
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

/**
 * `BEGIN ... [EXCEPTION WHEN cond THEN ...]* END` — cada `WHEN cond THEN`
 * é um handler; o primeiro gruda em `EXCEPTION ` (mesma convenção do
 * primeiro `WHEN` de um `CASE` grudar em `CASE `), os seguintes (raro —
 * `EXCEPTION` com múltiplos `WHEN`) ganham linha própria alinhada com
 * `EXCEPTION`. `cond` pode ser uma condição só (`unique_violation`) ou
 * várias separadas por `OR` (`foreign_key_violation OR unique_violation`)
 * — sai inline via `renderTokensInline`, sem quebra especial (raro demais
 * pra justificar o mesmo tratamento de `AND`/`OR` do `WHERE`/`ON`/`THEN`).
 */
function formatBeginBlock(tokens: Token[], start: number, indent: number, cfg: Cfg): BodyResult | null {
  const pad = ' '.repeat(indent);
  const lines = [`${pad}BEGIN`];
  const body = formatStatementList(tokens, start + 1, indent + cfg.indentSize, cfg);
  if (body === null) {
    return null;
  }
  lines.push(...body.lines);
  let cursor = body.next;

  if (tokens[cursor]?.upper === 'EXCEPTION') {
    cursor++;
    let firstHandler = true;
    while (tokens[cursor]?.upper === 'WHEN') {
      cursor++;
      const thenIdx = findAtDepth0(tokens, cursor, 'THEN');
      if (thenIdx >= tokens.length) {
        return null;
      }
      const condText = cfg.render.tokensInline(tokens.slice(cursor, thenIdx), cfg);
      lines.push(`${pad}${firstHandler ? 'EXCEPTION ' : ''}WHEN ${condText} THEN`);
      firstHandler = false;
      cursor = thenIdx + 1;

      const handlerBody = formatStatementList(tokens, cursor, indent + cfg.indentSize, cfg);
      if (handlerBody === null) {
        return null;
      }
      lines.push(...handlerBody.lines);
      cursor = handlerBody.next;
    }
    if (firstHandler) {
      // "EXCEPTION" sem nenhum "WHEN" depois — não é EXCEPTION válido
      // (fonte malformado ou construção fora do que reconhecemos aqui).
      return null;
    }
  }

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

/** Corpo + terminador compartilhado por `formatLoopStatement` e
 * `formatForStatement`, que só diferem no cabeçalho antes do `LOOP`
 * (nenhum vs. `FOR var IN ...`): formata a lista de statements a partir
 * de `bodyStart` (indentada `indentSize` a mais que `indent`, o nível do
 * `LOOP`/`FOR` em si) e, se houver um `END` fechando o bloco, empilha
 * `END LOOP;` em `lines` — mesma convenção de "não fabrica terminador"
 * de `formatIfStatement`/`formatBeginBlock`: sem `END`, devolve `null` e
 * deixa o chamador cair no fallback seguro. */
function finishLoopBody(tokens: Token[], bodyStart: number, indent: number, cfg: Cfg, lines: string[]): { next: number } | null {
  const pad = ' '.repeat(indent);
  const body = formatStatementList(tokens, bodyStart, indent + cfg.indentSize, cfg);
  if (body === null) {
    return null;
  }
  lines.push(...body.lines);
  let cursor = body.next;

  if (tokens[cursor]?.upper !== 'END') {
    return null;
  }
  lines.push(`${pad}END LOOP;`);
  cursor += tokens[cursor + 1]?.upper === 'LOOP' ? 2 : 1;
  if (tokens[cursor]?.text === ';') {
    cursor++;
  }
  return { next: cursor };
}

/** `LOOP ... END LOOP` incondicional (sem `FOR var IN`) — idiom comum de
 * "tenta de novo": mesma estrutura de corpo/terminador de
 * `formatForStatement`, só sem cabeçalho nenhum antes do `LOOP`. */
function formatLoopStatement(tokens: Token[], start: number, indent: number, cfg: Cfg): BodyResult | null {
  const lines = [`${' '.repeat(indent)}LOOP`];
  const result = finishLoopBody(tokens, start + 1, indent, cfg, lines);
  if (result === null) {
    return null;
  }
  return { lines, next: result.next };
}

/** `FOR var IN (query) LOOP ... END LOOP` — a lista após IN reaproveita
 * `formatQuery` igual a uma derived table de FROM/JOIN (mesma convenção:
 * parêntese colado no `(`, corpo indentado `indentSize` a mais). A forma sem
 * parênteses (`FOR var IN expressão LOOP`, ex. range `1..10`) cai numa linha
 * só — rara nas queries de relatório cobertas por este formatter. */
function formatForStatement(tokens: Token[], start: number, indent: number, cfg: Cfg): BodyResult | null {
  const pad = ' '.repeat(indent);
  let cursor = start + 1;
  const inIdx = findAtDepth0(tokens, cursor, 'IN');
  const varText = cfg.render.tokensInline(tokens.slice(cursor, inIdx), cfg);
  cursor = inIdx + 1;

  const lines: string[] = [];
  if (tokens[cursor]?.text === '(') {
    const closeIdx = matchParen(tokens, cursor) - 1;
    const inner = tokens.slice(cursor + 1, closeIdx);
    lines.push(`${pad}FOR ${varText} IN (`);
    lines.push(...cfg.render.query(inner, indent + cfg.indentSize, cfg, true));
    lines.push(`${pad})`);
    cursor = closeIdx + 1;
  } else {
    const loopIdx = findAtDepth0(tokens, cursor, 'LOOP');
    lines.push(`${pad}FOR ${varText} IN ${cfg.render.tokensInline(tokens.slice(cursor, loopIdx), cfg)}`);
    cursor = loopIdx;
  }

  if (tokens[cursor]?.upper === 'LOOP') {
    cursor++;
  }
  lines.push(`${pad}LOOP`);

  const result = finishLoopBody(tokens, cursor, indent, cfg, lines);
  if (result === null) {
    return null;
  }
  return { lines, next: result.next };
}

/** Renderiza uma declaração de `DECLARE` (`nome TIPO [NOT NULL] [DEFAULT
 * expr | := expr]`) maiusculizando só a região do TIPO — entre o nome da
 * variável e o primeiro de `NOT`/`DEFAULT`/`:=` (ou o fim, sem valor
 * default). O nome da variável e a expressão default passam pelo
 * `renderTokensInline` de sempre, sem esse tratamento — ver
 * `POSTGRES_TYPE_NAMES` sobre por que isso fica restrito a essa posição. */
function renderDeclareLine(tokens: Token[], cfg: Cfg): string {
  let typeEnd = tokens.length;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].upper === 'NOT' || tokens[i].upper === 'DEFAULT' || tokens[i].text === ':=') {
      typeEnd = i;
      break;
    }
  }
  const withUppercasedType = [...tokens.slice(0, 1), ...cfg.render.uppercaseTypes(tokens.slice(1, typeEnd)), ...tokens.slice(typeEnd)];
  return cfg.render.tokensInline(withUppercasedType, cfg);
}

/** Renderiza a lista de parâmetros de `CREATE FUNCTION`/`PROCEDURE`
 * (`(nome tipo, nome tipo DEFAULT expr, ...)`) reaproveitando
 * `renderDeclareLine` por parâmetro — cada um é `nome TIPO [DEFAULT
 * expr]`, mesma forma de uma declaração de `DECLARE`, então o tipo
 * maiusculiza pela mesma regra. Modo explícito (`IN`/`OUT`/`INOUT`/
 * `VARIADIC` antes do nome) não é tratado à parte — raro o bastante nas
 * queries de relatório cobertas por este formatter pra não valer a
 * complexidade extra; um parâmetro assim tem o modo (já maiúsculo, é
 * keyword) tratado como se fosse o nome, então o nome de verdade que vem
 * depois pode acabar maiusculizado à toa se coincidir com um nome de tipo
 * reconhecido — cosmético, não perde nem quebra nada. */
function renderParamsInline(tokens: Token[], cfg: Cfg): string {
  if (tokens[0]?.text !== '(' || tokens[tokens.length - 1]?.text !== ')') {
    return cfg.render.tokensInline(tokens, cfg);
  }
  const inner = tokens.slice(1, tokens.length - 1);
  if (inner.length === 0) {
    return '()';
  }
  const rendered = splitAtCommaDepth0(inner).map((param) => renderDeclareLine(param, cfg));
  return `(${rendered.join(', ')})`;
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
    lines.push(`${declPad}${renderDeclareLine(declTokens, cfg)};`);
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

  let sawDeclareOrBegin = false;

  if (tokens[cursor]?.upper === 'DECLARE') {
    sawDeclareOrBegin = true;
    const decl = formatDeclareSection(tokens, cursor, indent, cfg);
    lines.push(...decl.lines);
    cursor = decl.next;
  }

  if (tokens[cursor]?.upper === 'BEGIN') {
    sawDeclareOrBegin = true;
    const begin = formatBeginBlock(tokens, cursor, indent, cfg);
    if (begin === null) {
      return null;
    }
    lines.push(...begin.lines);
    cursor = begin.next;
  }

  if (cursor < tokens.length) {
    // `LANGUAGE SQL` (corpo em SQL puro, sem DECLARE/BEGIN...END): uma
    // sequência comum de statements (INSERT/UPDATE/DELETE/SELECT),
    // reaproveitando a mesma lista de statements usada dentro de um
    // BEGIN...END. Só tenta quando não viu DECLARE/BEGIN nenhum — se viu e
    // sobrou algo depois, é sobra inesperada mesmo (ver fallback abaixo).
    if (!sawDeclareOrBegin) {
      const plain = formatStatementList(tokens, cursor, indent, cfg);
      if (plain !== null && plain.next >= tokens.length) {
        lines.push(...plain.lines);
        return lines;
      }
    }
    // Sobra inesperada (construção não coberta) — preserva em vez de
    // descartar, sem tentar reformatar (ver `renderFallbackLines` sobre por
    // que isso é mais de uma linha quando tem comentário no meio).
    lines.push(...cfg.render.fallbackLines(tokens.slice(cursor), cfg).map((l: string) => pad + l));
  }

  return lines;
}

/** `CREATE [OR REPLACE] FUNCTION|PROCEDURE nome (params) RETURNS tipo AS
 * $tag$ ... $tag$ LANGUAGE lang` — cabeçalho numa linha por cláusula, corpo
 * via `formatPlpgsqlBody`. Devolve `null` se `tokens` não é esse tipo de
 * statement (deixa o chamador cair no fallback de sempre). */
export function tryFormatCreateFunction(tokens: Token[], cfg: Cfg): string[] | null {
  // `tokens` chega aqui já sem comentário de cabeçalho — `formatStatement`
  // extrai isso antes de chamar (o `prefix` que ele prefixa no resultado
  // final), então não há necessidade de coletar comentário aqui também.
  let cursor = 0;
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
  const paramsInline = renderParamsInline(tokens.slice(cursor, paramsClose + 1), cfg);
  cursor = paramsClose + 1;

  const lines = [`${header} ${nameTok.text}${paramsInline}`];

  // RETURNS e LANGUAGE, nessa ordem ou na outra, antes do corpo — sintaxe
  // válida em qualquer uma das duas ordens (os docs do Postgres usam as
  // duas: RETURNS/AS $$/LANGUAGE no fim é comum, mas RETURNS/LANGUAGE/AS $$
  // também aparece, e PROCEDURE — que não tem RETURNS — normalmente é só
  // LANGUAGE/AS $$). Sem isso, tudo que viesse depois de RETURNS até o AS
  // (LANGUAGE incluso) virava texto inline colado na mesma linha de
  // RETURNS, e um LANGUAGE antes do AS sem RETURNS (caso comum de
  // PROCEDURE) fazia a função inteira cair no fallback de linha única, já
  // que o token logo após os parâmetros não era nem RETURNS nem AS.
  for (let guard = 0; guard < 2; guard++) {
    if (tokens[cursor]?.upper === 'RETURNS') {
      cursor++;
      const stopIdx = Math.min(findAtDepth0(tokens, cursor, 'AS'), findAtDepth0(tokens, cursor, 'LANGUAGE'));
      lines.push(`RETURNS ${cfg.render.tokensInline(cfg.render.uppercaseTypes(tokens.slice(cursor, stopIdx)), cfg)}`);
      cursor = stopIdx;
      continue;
    }
    if (tokens[cursor]?.upper === 'LANGUAGE') {
      cursor++;
      const stopIdx = Math.min(findAtDepth0(tokens, cursor, 'AS'), findAtDepth0(tokens, cursor, 'RETURNS'));
      lines.push(`LANGUAGE ${cfg.render.tokensInline(tokens.slice(cursor, stopIdx), cfg)}`);
      cursor = stopIdx;
      continue;
    }
    break;
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
    lines.push(`LANGUAGE ${cfg.render.tokensInline(langTokens, cfg)}`);
  }

  return lines;
}

/** `CREATE TYPE nome AS (campo tipo, campo tipo, ...)` — um campo por linha,
 * indentado; tipo de cada campo não é maiusculizado (não é keyword nem cast,
 * é só um identificador — preserva o que veio no fonte). */
export function tryFormatCreateType(tokens: Token[], cfg: Cfg): string[] | null {
  // Idem `tryFormatCreateFunction`: `tokens` já chega sem comentário de
  // cabeçalho, `formatStatement` cuida disso antes de chamar.
  if (tokens[0]?.upper !== 'CREATE' || tokens[1]?.upper !== 'TYPE') {
    return null;
  }
  const nameTok = tokens[2];
  if (!nameTok || tokens[3]?.upper !== 'AS' || tokens[4]?.text !== '(') {
    return null;
  }
  const openIdx = 4;
  const closeIdx = matchParen(tokens, openIdx) - 1;
  if (closeIdx !== tokens.length - 1) {
    return null;
  }

  const fields = splitAtCommaDepth0(tokens.slice(openIdx + 1, closeIdx));
  const lines = [`CREATE TYPE ${nameTok.text} AS (`];
  fields.forEach((field, idx) => {
    const suffix = idx < fields.length - 1 ? ',' : '';
    lines.push(`${' '.repeat(cfg.indentSize)}${cfg.render.tokensInline(field, cfg)}${suffix}`);
  });
  lines.push(')');
  return lines;
}
