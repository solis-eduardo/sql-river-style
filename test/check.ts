/**
 * `check()`/contagem de falhas compartilhada entre os test/*.ts que rodam
 * fora de examples.ts (tokenizer.ts, plpgsql.ts, token-scan.ts) — os três
 * tinham a mesma implementação copiada, sem nenhum jeito de mudar o formato
 * de saída (ou adicionar algo como contagem de sucesso) num lugar só.
 */
import assert from 'node:assert/strict';

export class Checker {
  failures = 0;

  check(name: string, actual: unknown, expected: unknown): void {
    try {
      assert.deepEqual(actual, expected);
      console.log(`ok - ${name}`);
    } catch (err) {
      this.failures++;
      console.error(`FALHOU - ${name}`);
      console.error(err);
    }
  }

  /** Chamar no fim do arquivo: sai com código 1 se algum `check` falhou. */
  finish(suiteName: string): void {
    if (this.failures > 0) {
      console.error(`\n${this.failures} teste(s) de ${suiteName} falharam.`);
      process.exit(1);
    }
    console.log(`\n${suiteName}: todos os testes bateram.`);
  }
}
