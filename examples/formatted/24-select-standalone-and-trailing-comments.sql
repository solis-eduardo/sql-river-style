-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: comentário standalone na coluna 1 + comentário trailing não engole o
-- fechamento do ON
-- total de assinaturas por categoria
    SELECT categoria.nome,
           COUNT(*) as total
      FROM categoria
 LEFT JOIN assinatura
        ON ( assinatura.categoria_id = categoria.id ) -- só ativas
     WHERE categoria.ativo = TRUE
  GROUP BY categoria.nome
