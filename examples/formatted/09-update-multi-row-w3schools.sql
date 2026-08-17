-- Fonte: W3Schools, "SQL UPDATE Statement"
-- https://www.w3schools.com/sql/sql_update.asp
-- UPDATE afetando várias linhas de uma vez através da condição no WHERE.
    UPDATE customers
       SET contactname = 'Juan'
     WHERE country = 'Mexico'
