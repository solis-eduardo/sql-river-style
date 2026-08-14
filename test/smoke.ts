/* Script de inspeção manual — não faz parte da suíte automatizada. */
import { formatSql } from '../src/formatter';

const samples: string[] = [
  `select tabela.coluna1, tabela.coluna2 from tabela where tabela.coluna1 = 1 and tabela.coluna2 = 2 order by tabela.coluna1`,

  `SELECT ecm_conteudo.id,
          ecm_conteudo.nome,
          count(ecm_assinatura.id) as total_assinaturas
     FROM ecm_conteudo
     INNER JOIN ecm_assinatura on ecm_assinatura.ecm_conteudo_id = ecm_conteudo.id
    WHERE ecm_conteudo.categoria_id = 10
      AND ecm_conteudo.ativo = true
    GROUP BY ecm_conteudo.id, ecm_conteudo.nome
    ORDER BY ecm_conteudo.nome`,

  `with primeira_cte as (
      select a.id, a.valor::numeric from tabela_a a
  ), segunda_cte as (
      select b.id from tabela_b b
  )
  select primeira_cte.id, segunda_cte.id from primeira_cte inner join segunda_cte on primeira_cte.id = segunda_cte.id`,

  `select a.id from tabela_a a where a.total between 1 and 10
   union all
   select b.id from tabela_b b`,

  `-- total de assinaturas por categoria
  select categoria.nome, count(*) as total
  from categoria
  left join assinatura on assinatura.categoria_id = categoria.id -- só ativas
  where categoria.ativo = true
  group by categoria.nome`,
  `select t.id,
          -- comentário entre colunas
          t.nome
   from tabela t
   where t.saldo < -1000
   limit 10 offset 5`,

  `select
     case when a.status = 1 then 'ativo' else 'inativo' end as status_desc,
     a.id
   from tabela_a a`,

  `select id from (select tabela.id from tabela where tabela.ativo = true) sub where sub.id > 0`,

  `select distinct on (tabela.categoria_id) tabela.id, tabela.categoria_id from tabela order by tabela.categoria_id`,

  `select 1;

   select 2`,
];

for (const [i, sql] of samples.entries()) {
  console.log(`\n===== amostra ${i + 1} =====`);
  console.log(formatSql(sql));
}
