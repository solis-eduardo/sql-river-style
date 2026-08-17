/**
 * Gera examples/formatted/ a partir de examples/original/ — roda formatSql
 * em cada arquivo de examples/original/ e grava o resultado no diretório
 * irmão (examples/formatted/, mesmo nome de arquivo).
 *
 * Não é um teste (não falha o build): é a ferramenta usada pra (re)gerar os
 * exemplos "corretamente formatados" que servem de golden file pro teste de
 * regressão em test/examples.ts. Depois de rodar, os arquivos gerados devem
 * ser conferidos manualmente antes de serem commitados — é essa checagem
 * humana que torna o conteúdo de examples/formatted/ confiável como
 * "formatação correta" pra comparar.
 *
 * Uso: npm run generate-examples
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { formatSql } from '../src/formatter';
import { extractOptions } from './example-options';

const ORIGINAL_DIR = path.join(__dirname, '..', '..', 'examples', 'original');
const FORMATTED_DIR = path.join(__dirname, '..', '..', 'examples', 'formatted');

fs.mkdirSync(FORMATTED_DIR, { recursive: true });

const files = fs.readdirSync(ORIGINAL_DIR).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  const raw = fs.readFileSync(path.join(ORIGINAL_DIR, file), 'utf8');
  const { options, source } = extractOptions(raw);
  const formatted = formatSql(source, options);
  fs.writeFileSync(path.join(FORMATTED_DIR, file), formatted, 'utf8');
  console.log(`gerado - ${file}`);
}

console.log(`\n${files.length} arquivo(s) gerado(s) em ${path.relative(process.cwd(), FORMATTED_DIR)}.`);
