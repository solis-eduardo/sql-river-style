-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: CURRENT_TIMESTAMP e afins saem maiúsculos mesmo sem parênteses e
-- mesmo digitados em minúsculo
    SELECT a.id
      FROM tabela a
     WHERE a.criado_em <= CURRENT_TIMESTAMP
