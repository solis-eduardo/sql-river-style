-- Fonte: caso sintético do formatter sql-river-style (não vem de fonte
-- externa) — isola uma regra específica de formatação, uma por arquivo.
-- Testa: identificador sem aspas no fonte é dobrado pra minúsculo (Customers
-- -> customers), entre aspas continua intocado
select Customers.ContactName, "Customers"."Country" from Customers where Customers.Country = 'Mexico'
