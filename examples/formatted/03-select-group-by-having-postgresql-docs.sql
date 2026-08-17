-- Fonte: PostgreSQL Documentation, "3.7. Aggregate Functions"
-- https://www.postgresql.org/docs/current/tutorial-agg.html (PostgreSQL License)
-- GROUP BY com HAVING filtrando pelo resultado do agregado.
    SELECT city,
           COUNT(*),
           MAX(temp_lo)
      FROM weather
  GROUP BY city
    HAVING MAX(temp_lo) < 40
