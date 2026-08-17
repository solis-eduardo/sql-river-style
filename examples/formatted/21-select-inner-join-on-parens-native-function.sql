-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: INNER JOIN define a coluna do river + ON entre parênteses + função
-- nativa maiúscula
    SELECT ecm_conteudo.id,
           ecm_conteudo.nome,
           COUNT(ecm_assinatura.id) as total_assinaturas
      FROM ecm_conteudo
INNER JOIN ecm_assinatura
        ON ( ecm_assinatura.ecm_conteudo_id = ecm_conteudo.id )
     WHERE ecm_conteudo.categoria_id = 10
       AND ecm_conteudo.ativo = TRUE
  GROUP BY ecm_conteudo.id,
           ecm_conteudo.nome
  ORDER BY ecm_conteudo.nome
