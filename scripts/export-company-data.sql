-- ============================================================
-- Export Company Data Script
-- Company: Criativa Soluções Impressas LTDA
-- CNPJ: 13.130.399/0001-77
-- ============================================================

-- Step 1: Find company ID
\echo '=== Finding company ==='
SELECT id, name, cnpj, "legalName", email, "createdAt"
FROM companies
WHERE cnpj = '13.130.399/0001-77';

-- Use a temp table to hold the company ID for reuse
CREATE TEMP TABLE _export_company AS
SELECT id FROM companies WHERE cnpj = '13.130.399/0001-77';

-- ============================================================
-- CLIENTES
-- ============================================================
\echo '=== Exporting: Clients ==='
\copy (SELECT c.name, c.email, c.cpf, c.cnpj, c."corporateName", c."tradeName", c.phone, c.mobile, c.type::text, c.status::text, c.notes, c."financialNotes", c.site, c.activity, c.nickname, c.rg, c."createdAt" FROM clients c WHERE c."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_clientes.csv' WITH CSV HEADER ENCODING 'UTF8'

-- Endereços dos clientes
\echo '=== Exporting: Client Addresses ==='
\copy (SELECT cl.name AS cliente, a.street, a.number, a.complement, a.neighborhood, a.city, a.state, a.zipcode, a.country, a.type FROM addresses a JOIN clients cl ON a."ownerId" = cl.id AND a."ownerType" = 'CLIENT' WHERE cl."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_clientes_enderecos.csv' WITH CSV HEADER ENCODING 'UTF8'

-- Contatos dos clientes
\echo '=== Exporting: Client Contacts ==='
\copy (SELECT cl.name AS cliente, co.name AS contato, co.email, co.phone, co.mobile, co.sector, co.notes FROM contacts co JOIN clients cl ON co."clientId" = cl.id WHERE cl."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_clientes_contatos.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- FORNECEDORES
-- ============================================================
\echo '=== Exporting: Suppliers ==='
\copy (SELECT s.name, s.email, s.cpf, s.cnpj, s."corporateName", s."tradeName", s.phone, s.mobile, s.type::text, s.status::text, s.notes, s."financialNotes", s.site, s.activity, s.nickname, s.rg, s."createdAt" FROM suppliers s WHERE s."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_fornecedores.csv' WITH CSV HEADER ENCODING 'UTF8'

-- Endereços dos fornecedores
\echo '=== Exporting: Supplier Addresses ==='
\copy (SELECT su.name AS fornecedor, a.street, a.number, a.complement, a.neighborhood, a.city, a.state, a.zipcode, a.country, a.type FROM addresses a JOIN suppliers su ON a."supplierId" = su.id WHERE su."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_fornecedores_enderecos.csv' WITH CSV HEADER ENCODING 'UTF8'

-- Contatos dos fornecedores
\echo '=== Exporting: Supplier Contacts ==='
\copy (SELECT su.name AS fornecedor, co.name AS contato, co.email, co.phone, co.mobile, co.sector, co.notes FROM contacts co JOIN suppliers su ON co."supplierId" = su.id WHERE su."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_fornecedores_contatos.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- PRODUTOS
-- ============================================================
\echo '=== Exporting: Products ==='
\copy (SELECT p.name, p.code, p.description, p."salePrice", p."unitCost", p.status::text, p."productType"::text, p."imageUrl", p."createdAt" FROM products p WHERE p."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_produtos.csv' WITH CSV HEADER ENCODING 'UTF8'

-- Itens dos produtos
\echo '=== Exporting: Product Items ==='
\copy (SELECT p.name AS produto, pi.name AS item, pi."unitCost", pi."salePrice", pi.quantity, pi."unitKind"::text, pi.height, pi.width, pi.length, pi.weight, pi.volume, pi.duration, pi.distance FROM product_items pi JOIN products p ON pi."productId" = p.id WHERE p."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_produtos_itens.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- ORÇAMENTOS
-- ============================================================
\echo '=== Exporting: Quotations ==='
\copy (SELECT q."quotationNumber", q.status::text, q.description, q."totalValue", q."createdAt", q."approvedAt", q."finishedAt", q."quickSale", cl.name AS cliente, e.name AS vendedor FROM quotations q LEFT JOIN clients cl ON q."clientId" = cl.id LEFT JOIN employees e ON q."sellerId" = e.id WHERE q."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_orcamentos.csv' WITH CSV HEADER ENCODING 'UTF8'

-- Produtos dos orçamentos
\echo '=== Exporting: Quotation Products ==='
\copy (SELECT q."quotationNumber", p.name AS produto, qp.quantity, qp."totalValue", qp."finalValue", qp.discount, qp."discountType", qp.description, qp.notes FROM quotation_products qp JOIN quotations q ON qp."quotationId" = q.id JOIN products p ON qp."productId" = p.id WHERE q."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_orcamentos_produtos.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- ORDENS DE SERVIÇO
-- ============================================================
\echo '=== Exporting: Orders ==='
\copy (SELECT q."quotationNumber", o.status::text, o."createdAt", o."deliveredAt", o."canceledAt", cl.name AS cliente FROM orders o JOIN quotations q ON o."quotationId" = q.id LEFT JOIN clients cl ON q."clientId" = cl.id WHERE q."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_ordens_servico.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- CONTAS A RECEBER
-- ============================================================
\echo '=== Exporting: Receivables ==='
\copy (SELECT r.reference, r.description, r.status::text, r."totalAmount", r."totalValue", r."referenceDate", r."installmentQty", r."financialType"::text, r."createdAt", cl.name AS cliente FROM receivables r LEFT JOIN clients cl ON r."clientId" = cl.id WHERE r."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_contas_receber.csv' WITH CSV HEADER ENCODING 'UTF8'

-- Parcelas de contas a receber
\echo '=== Exporting: Receivable Installments ==='
\copy (SELECT r.reference, r.description, ri."installmentNumber", ri."dueDate", ri.amount, ri."paidAmount", ri.status::text, ri."paidDate", ri."additionalFee" FROM receivable_installments ri JOIN receivables r ON ri."receivableId" = r.id WHERE r."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_contas_receber_parcelas.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- CONTAS A PAGAR
-- ============================================================
\echo '=== Exporting: Payables ==='
\copy (SELECT p.reference, p.description, p.status::text, p."totalAmount", p."totalValue", p."referenceDate", p."installmentQty", p."financialType"::text, p."expenseSource"::text, p."createdAt", su.name AS fornecedor, cl.name AS cliente FROM payables p LEFT JOIN suppliers su ON p."supplierId" = su.id LEFT JOIN clients cl ON p."clientId" = cl.id WHERE p."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_contas_pagar.csv' WITH CSV HEADER ENCODING 'UTF8'

-- Parcelas de contas a pagar
\echo '=== Exporting: Payable Installments ==='
\copy (SELECT p.reference, p.description, pi."installmentNumber", pi."dueDate", pi.amount, pi."paidAmount", pi.status::text, pi."paidDate", pi."additionalFee" FROM payable_installments pi JOIN payables p ON pi."payableId" = p.id WHERE p."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_contas_pagar_parcelas.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- COLABORADORES
-- ============================================================
\echo '=== Exporting: Employees ==='
\copy (SELECT e.name, e.cpf, e.rg, e.phone, e.mobile, e.sallary, e."isActive", e."createdAt", r.name AS cargo, s.name AS setor FROM employees e LEFT JOIN roles r ON e."roleId" = r.id LEFT JOIN sectors s ON e."sectorId" = s.id WHERE e."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_colaboradores.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- NOTAS FISCAIS (NF-e)
-- ============================================================
\echo '=== Exporting: NF-e ==='
\copy (SELECT n.number, n.series, n.status::text, n."accessKey", n."totalValue", n."issuedAt", n."canceledAt", n."createdAt" FROM nfes n WHERE n."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_nfe.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- NOTAS FISCAIS DE SERVIÇO (NFS-e)  
-- ============================================================
\echo '=== Exporting: NFS-e ==='
\copy (SELECT n."rpsNumber", n."rpsSeries", n."nfseNumber", n.status::text, n."totalValue", n."issuedAt", n."canceledAt", n."createdAt" FROM nfses n WHERE n."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_nfse.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- CAIXA
-- ============================================================
\echo '=== Exporting: Cash Registers ==='
\copy (SELECT cr.status::text, cr."openingDate", cr."closingDate", cr."openingBalance", cr."totalIncomes", cr."totalOutcomes", cr."closingBalance", cr.description, ba.name AS conta_bancaria FROM cash_registers cr JOIN bank_accounts ba ON cr."bankAccountId" = ba.id WHERE cr."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_caixa.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- CONTAS BANCÁRIAS
-- ============================================================
\echo '=== Exporting: Bank Accounts ==='
\copy (SELECT ba.name, ba.description, ba."isActive", b.name AS banco, b.code AS codigo_banco FROM bank_accounts ba JOIN banks b ON ba."bankId" = b.id WHERE ba."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_contas_bancarias.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- DESPESAS FIXAS
-- ============================================================
\echo '=== Exporting: Scheduled Expenses ==='
\copy (SELECT se.description, se.amount, se."dueDay", se."recurringType"::text, se."isActive", su.name AS fornecedor FROM scheduled_expenses se LEFT JOIN suppliers su ON se."supplierId" = su.id WHERE se."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_despesas_fixas.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- FOLHA DE PAGAMENTO
-- ============================================================
\echo '=== Exporting: Payroll ==='
\copy (SELECT p.month, p.year, p.status::text, e.name AS colaborador, pi.type::text, pi.description, pi.amount, pi.reference, pi."paidAt" FROM payroll p JOIN employees e ON p."employeeId" = e.id LEFT JOIN payroll_items pi ON pi."payrollId" = p.id WHERE p."companyId" IN (SELECT id FROM _export_company)) TO '/tmp/export_folha_pagamento.csv' WITH CSV HEADER ENCODING 'UTF8'

-- ============================================================
-- DADOS DA EMPRESA
-- ============================================================
\echo '=== Exporting: Company Data ==='
\copy (SELECT c.name, c.cnpj, c."legalName", c.email, c.phone, c.mobile, c."siteUrl", c."stateRegistration", c."municipalRegistration", c.cnae, c."createdAt" FROM companies c WHERE c.id IN (SELECT id FROM _export_company)) TO '/tmp/export_empresa.csv' WITH CSV HEADER ENCODING 'UTF8'

-- Endereço da empresa
\echo '=== Exporting: Company Address ==='
\copy (SELECT a.street, a.number, a.complement, a.neighborhood, a.city, a.state, a.zipcode, a.country FROM addresses a WHERE a."companyId" IN (SELECT id FROM _export_company) AND a."ownerType" = 'COMPANY') TO '/tmp/export_empresa_endereco.csv' WITH CSV HEADER ENCODING 'UTF8'

-- Cleanup
DROP TABLE _export_company;

\echo ''
\echo '============================================================'
\echo '  EXPORT COMPLETE!'
\echo '  Files saved to /tmp/export_*.csv inside the container'
\echo '============================================================'
\echo ''
