/**
 * Varredura de `Token[]` sensível a profundidade: parênteses, `CASE...END`
 * (que não usa parênteses, mas se comporta como um nível de aninhamento
 * pra fins de achar limite de cláusula/conector) e a exceção do `AND` que
 * fecha um `BETWEEN` (não é um conector `AND`/`OR` de encadeamento).
 *
 * Antes deste módulo, cada função de formatter.ts que precisava achar um
 * limite "no nível de topo" da expressão (vírgula de lista de colunas,
 * `AND`/`OR` de WHERE, palavra-chave de cláusula, par de parênteses...)
 * reimplementava esse loop de profundidade à mão — eram ~12 cópias
 * independentes, duas delas (`findMarkers`, `splitTopLevelAndOr`)
 * duplicando literalmente a mesma lógica de `CASE`+`BETWEEN`. `DepthCursor`
 * é a única implementação: quem faz varredura simples (achar palavra,
 * dividir por separador) usa as funções de conveniência abaixo; quem
 * precisa reagir a várias palavras-chave diferentes por token
 * (`findMarkers`, `splitTopLevelAndOr`, `splitCaseBranches`,
 * `findTopLevelCase`, em formatter.ts) dirige o cursor diretamente.
 */

import { Token } from './tokenizer';

export class DepthCursor {
  depth = 0;
  caseDepth = 0;
  private betweenDepth = -1;

  /** true quando o cursor está no nível de topo de parênteses E de CASE — o
   * nível onde vírgula de lista, `AND`/`OR` de encadeamento e marcador de
   * cláusula (`FROM`/`WHERE`/...) de fato vivem. */
  atTop(): boolean {
    return this.depth === 0 && this.caseDepth === 0;
  }

  /** Alimenta um token ao cursor, atualizando `depth`/`caseDepth` e o
   * estado pendente de `BETWEEN`. Precisa ser chamado pra TODO token do
   * stream, em ordem (inclusive o que está sendo testado — chame
   * `advance` antes de `atTop`/`consumeBetweenAnd` pro mesmo token). */
  advance(t: Token): void {
    if (t.text === '(') {
      this.depth++;
      return;
    }
    if (t.text === ')') {
      this.depth--;
      return;
    }
    if (t.type === 'keyword' && t.upper === 'CASE') {
      this.caseDepth++;
      return;
    }
    if (t.type === 'keyword' && t.upper === 'END' && this.caseDepth > 0) {
      this.caseDepth--;
      return;
    }
    if (this.atTop() && t.type === 'keyword' && t.upper === 'BETWEEN') {
      this.betweenDepth = this.depth;
    }
  }

  /** true quando `t` é o `AND` que fecha um `BETWEEN` visto antes no mesmo
   * nível (`x BETWEEN 1 AND 10`) — não um conector de encadeamento de
   * verdade. Consome o estado pendente de `BETWEEN` quando bate. Chamar
   * depois de `advance(t)` pro mesmo token. */
  consumeBetweenAnd(t: Token): boolean {
    if (t.type === 'keyword' && t.upper === 'AND' && this.betweenDepth === this.depth) {
      this.betweenDepth = -1;
      return true;
    }
    return false;
  }
}

/** Índice logo depois do `)` que fecha o `(` em `tokens[openIdx]`. Devolve
 * `tokens.length` se não fechar (parênteses desbalanceados). Não precisa de
 * `DepthCursor` — casar parênteses independe de `CASE`/`BETWEEN`. */
export function matchParen(tokens: Token[], openIdx: number): number {
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

/** Acha `keyword` no nível de topo (fora de parênteses e de `CASE...END`
 * aninhado) a partir de `start`. Devolve `tokens.length` se não achar. */
export function findAtDepth0(tokens: Token[], start: number, keyword: string): number {
  const cursor = new DepthCursor();
  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i];
    cursor.advance(t);
    if (cursor.atTop() && t.upper === keyword) {
      return i;
    }
  }
  return tokens.length;
}

/** Acha o fim do statement atual a partir de `start`: o `;` no nível de
 * topo seguinte, ou o fim do array. */
export function findStatementEnd(tokens: Token[], start: number): number {
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

/** true se existir alguma `,` no nível de topo de `tokens`. */
export function hasCommaAtDepth0(tokens: Token[]): boolean {
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

/** Divide `tokens` em cada `,` do nível de topo, descartando a vírgula.
 * Segmentos vazios são descartados; se sobrar nenhum, devolve `[[]]` (nunca
 * um array vazio de itens) — mesma convenção de sempre ter pelo menos um
 * item pra renderizar. */
export function splitAtCommaDepth0(tokens: Token[]): Token[][] {
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

/** Divide `tokens` em blocos separados por `UNION [ALL]`/`EXCEPT`/
 * `INTERSECT` no nível de topo — os operadores em si não entram nos blocos,
 * saem à parte em `ops` (na mesma ordem, um por fronteira). */
export function splitAtSetOpDepth0(tokens: Token[]): { blocks: Token[][]; ops: string[] } {
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

/** Remove um único par de parênteses que envolve `tokens` inteiro,
 * recursivamente (`((x))` -> `x`). Devolve `tokens` sem alteração se não
 * houver esse par (inclusive quando um `(` interno já fecha antes do fim). */
export function stripOuterParens(tokens: Token[]): Token[] {
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
