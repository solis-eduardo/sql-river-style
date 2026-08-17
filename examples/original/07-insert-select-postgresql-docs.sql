-- Fonte: PostgreSQL Documentation, "6.4. Inserting Data"
-- https://www.postgresql.org/docs/current/dml-insert.html (PostgreSQL License)
-- INSERT INTO ... SELECT, copiando linhas de outra tabela com filtro.
INSERT INTO products (product_no, name, price)
  SELECT product_no, name, price FROM new_products
    WHERE release_date = 'today';
