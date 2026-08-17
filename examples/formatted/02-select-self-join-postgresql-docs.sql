-- Fonte: PostgreSQL Documentation, "3.2. Joins Between Tables"
-- https://www.postgresql.org/docs/current/tutorial-join.html (PostgreSQL License)
-- Self-join de "weather" contra ela mesma, com aliases w1/w2 e duas colunas
-- repetidas usando o mesmo AS ("low"/"high") em cada lado.
    SELECT w1.city,
           w1.temp_lo as low,
           w1.temp_hi as high,
           w2.city,
           w2.temp_lo as low,
           w2.temp_hi as high
      FROM weather w1
      JOIN weather w2
        ON ( w1.temp_lo < w2.temp_lo
         AND w1.temp_hi > w2.temp_hi )
