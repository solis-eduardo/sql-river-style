-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: identificador sem aspas no fonte é dobrado pra minúsculo (Customers
-- -> customers), entre aspas continua intocado
    SELECT customers.contactname,
           "Customers"."Country"
      FROM customers
     WHERE customers.country = 'Mexico'
