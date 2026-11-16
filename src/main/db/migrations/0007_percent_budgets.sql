-- A budget can be a share of the planned income (basis points, 2000 = 20%) instead of a fixed
-- amount; amount_minor is then 0. A percentage applies to later periods until changed.
ALTER TABLE budget_allocations ADD COLUMN percent_bp INTEGER
  CHECK (percent_bp IS NULL OR percent_bp BETWEEN 1 AND 10000);
