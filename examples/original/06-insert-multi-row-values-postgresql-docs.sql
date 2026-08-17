-- Fonte: PostgreSQL Documentation, "6.4. Inserting Data"
-- https://www.postgresql.org/docs/current/dml-insert.html (PostgreSQL License)
-- INSERT INTO com lista de colunas e múltiplas tuplas em VALUES.
INSERT INTO products (product_no, name, price) VALUES
    (1, 'Cheese', 9.99),
    (2, 'Bread', 1.99),
    (3, 'Milk', 2.99);
