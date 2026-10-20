-- As unidades do tipo folha (Papéis no LITE, decisão do PO de 13/10/2026),
-- uma por variante, com o mesmo código da variante e do formato do papel
-- (SheetFormat): o /unit-of-measure as lista em by-kind/SHEET e no padrão da
-- empresa. A medida (mm) sai das variantes, em variants/SHEET. Idempotente:
-- o código que já existe fica como está.

INSERT INTO "default_unit_measures" ("id", "name", "code", "description", "isActive", "kind")
VALUES
  ('unit-sheet-a4', 'Folha A4', 'A4', 'Folha A4, 210 × 297 mm', true, 'SHEET'),
  ('unit-sheet-a3', 'Folha A3', 'A3', 'Folha A3, 297 × 420 mm', true, 'SHEET'),
  ('unit-sheet-sra3', 'Folha SRA3', 'SRA3', 'Folha SRA3, 320 × 450 mm', true, 'SHEET'),
  ('unit-sheet-a3-plus', 'Folha A3+', 'A3_PLUS', 'Folha A3+, 329 × 483 mm', true, 'SHEET'),
  ('unit-sheet-custom', 'Folha personalizada', 'CUSTOM', 'Folha na medida informada', true, 'SHEET')
ON CONFLICT ("code") DO NOTHING;
