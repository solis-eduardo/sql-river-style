-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: INSERT INTO ... SELECT compartilha o mesmo river do INSERT INTO
    INSERT INTO ecm_conteudo (nome, categoria_id)
         SELECT origem.nome,
                origem.categoria_id
           FROM origem
          WHERE origem.ativo = TRUE
