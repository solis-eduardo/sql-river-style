-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: UPDATE ... FROM (extensão Postgres) reaproveita marker de FROM
    UPDATE ecm_conteudo
       SET nome = origem.nome
      FROM origem
     WHERE ecm_conteudo.id = origem.id
