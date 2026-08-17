-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: comentário standalone na coluna 1 + comentário trailing não engole o
-- fechamento do ON
-- total de assinaturas por categoria
      select categoria.nome, count(*) as total
      from categoria
      left join assinatura on assinatura.categoria_id = categoria.id -- só ativas
      where categoria.ativo = true
      group by categoria.nome
