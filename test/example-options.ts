/**
 * Diretiva opcional de opções de formatação pra um arquivo de
 * examples/original/ — usada pelo único caso que precisa de uma opção não
 * padrão (`additionalFunctions`, testando `sqlRiverStyle.additionalFunctions`
 * da extensão). Fica na primeira linha do arquivo, antes até do comentário de
 * origem:
 *
 *   -- sql-river-style-options: additionalFunctions=fn_calcula_total
 *
 * Reconhecida e removida do texto antes de chamar `formatSql` (não é SQL de
 * verdade, não deve aparecer no resultado formatado nem ser tratada como
 * comentário comum); múltiplas opções seriam separadas por `;`, e uma lista
 * de nomes de função por `,` — só `additionalFunctions` é suportada porque é
 * a única opção usada nos exemplos até agora.
 */
import { FormatOptions } from '../src/formatter';

const DIRECTIVE = /^-- sql-river-style-options:\s*(.*)$/;

export function extractOptions(source: string): { options: FormatOptions; source: string } {
  const newlineIdx = source.indexOf('\n');
  const firstLine = newlineIdx === -1 ? source : source.slice(0, newlineIdx);
  const match = firstLine.match(DIRECTIVE);
  if (!match) {
    return { options: {}, source };
  }

  const options: FormatOptions = {};
  for (const pair of match[1].split(';')) {
    const [key, value] = pair.split('=').map((s) => s.trim());
    if (key === 'additionalFunctions' && value) {
      options.additionalFunctions = value.split(',').map((s) => s.trim());
    }
  }

  const rest = newlineIdx === -1 ? '' : source.slice(newlineIdx + 1);
  return { options, source: rest };
}
