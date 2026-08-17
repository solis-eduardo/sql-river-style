-- Fonte: PostgreSQL Documentation, "6.5. Updating Data"
-- https://www.postgresql.org/docs/current/dml-update.html (PostgreSQL License)
-- UPDATE atualizando três colunas de uma vez, tudo numa linha só no fonte.
    UPDATE mytable
       SET a = 5,
           b = 3,
           c = 1
     WHERE a > 0
