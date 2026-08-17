-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: keyword interval sai maiúscula
    SELECT a.id
      FROM tabela a
     WHERE a.criado_em <= CURRENT_TIMESTAMP - INTERVAL '0 days'
