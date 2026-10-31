-- =============================================================================
-- Faatix — multi-business management system: database schema (MySQL 8 / MariaDB 10.4+)
--
-- Run with:  npm run db:init   (from the project root or /server)
-- Safe to re-run: every statement uses IF NOT EXISTS.
--
-- Conventions
--   * Every business-owned table has `business_id` (tenant id) + an index on it.
--     The API filters EVERY query by the signed-in user's business_id.
--   * Money is DECIMAL(14,4) (4 decimals so 5% VAT is exact); quantities DECIMAL(14,3).
--   * Balances (cash, bank, receivables, payables, stock) are DERIVED from
--     transactions — no duplicated running totals without reconciliation.
--   * Timestamps are UTC (DATETIME).
-- =============================================================================

CREATE DATABASE IF NOT EXISTS faatix
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE faatix;

-- -----------------------------------------------------------------------------
-- Platform (Super Admin) — isolated from business users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_admins (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(60)  NOT NULL UNIQUE,
  email         VARCHAR(190) NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  status        ENUM('active','disabled') NOT NULL DEFAULT 'active',
  last_login_at DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Businesses (tenants) and their users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businesses (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,
  owner_name    VARCHAR(150) NOT NULL,
  email         VARCHAR(190) NULL,
  phone         VARCHAR(30)  NOT NULL,
  business_type VARCHAR(60)  NOT NULL,
  address       VARCHAR(255) NULL,
  logo_path     VARCHAR(255) NULL,
  status        ENUM('active','suspended','deactivated') NOT NULL DEFAULT 'active',
  terms_accepted_at DATETIME NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_businesses_status (status),
  INDEX idx_businesses_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id   INT UNSIGNED NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  username      VARCHAR(60)  NOT NULL UNIQUE,
  email         VARCHAR(190) NULL,
  phone         VARCHAR(30)  NULL,
  password_hash VARCHAR(255) NOT NULL,
  status        ENUM('active','disabled') NOT NULL DEFAULT 'active',
  language      ENUM('en','so') NOT NULL DEFAULT 'en',
  last_login_at DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_business (business_id),
  CONSTRAINT fk_users_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS business_user_roles (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  role        VARCHAR(20) NOT NULL,                -- 'owner', or 'staff' with a business role below
  role_id     INT UNSIGNED NULL,                   -- roles.id (NULL for the owner)
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_user (business_id, user_id),
  CONSTRAINT fk_roles_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_roles_user     FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

-- Business roles created by the owner (Staff & roles → Roles). permissions = JSON list of
-- permission keys (see server/src/lib/permissions.js). New businesses start with
-- Manager, Cashier and Stockkeeper (template_key keeps where a role came from).
CREATE TABLE IF NOT EXISTS roles (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id  INT UNSIGNED NOT NULL,
  name         VARCHAR(60)  NOT NULL,
  description  VARCHAR(200) NULL,
  permissions  TEXT NOT NULL,
  template_key VARCHAR(20)  NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_name (business_id, name),
  CONSTRAINT fk_role_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

-- Uploaded images (logos, product photos) kept in the database so they survive redeploys.
-- Served at /files/<file_key>.
CREATE TABLE IF NOT EXISTS stored_files (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  file_key    CHAR(32)     NOT NULL UNIQUE,
  business_id INT UNSIGNED NULL,
  kind        VARCHAR(20)  NOT NULL,
  mime        VARCHAR(40)  NOT NULL,
  size        INT UNSIGNED NOT NULL,
  data        MEDIUMBLOB   NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_files_business (business_id)
) ENGINE=InnoDB;

-- Unfinished work saved to continue later (POS cart, invoice, purchase, stock entry, transfer, new product).
-- Belongs to the user who saved it; data = the form state as JSON. Nothing is posted until the real form is submitted.
CREATE TABLE IF NOT EXISTS drafts (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  module      VARCHAR(30)  NOT NULL,
  title       VARCHAR(120) NOT NULL,
  data        MEDIUMTEXT   NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_drafts_user (business_id, user_id, module, updated_at),
  CONSTRAINT fk_drafts_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_drafts_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS business_settings (
  business_id      INT UNSIGNED PRIMARY KEY,
  currency         CHAR(3)     NOT NULL DEFAULT 'USD',
  default_language ENUM('en','so') NOT NULL DEFAULT 'en',
  invoice_prefix   VARCHAR(10) NOT NULL DEFAULT 'INV-',
  receipt_prefix   VARCHAR(10) NOT NULL DEFAULT 'RC-',
  purchase_prefix  VARCHAR(10) NOT NULL DEFAULT 'PO-',
  invoice_footer   VARCHAR(255) NULL,
  allow_duplicate_codes TINYINT(1) NOT NULL DEFAULT 0,  -- products may share a SKU / barcode
  spec_fields      TEXT NULL,
  weight_decimals  TINYINT UNSIGNED NOT NULL DEFAULT 3,  -- jewelry: decimals shown / entered for weights                            -- extra technical specification fields per product type (JSON)
  timezone         VARCHAR(40) NOT NULL DEFAULT 'Africa/Mogadishu',
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trial_records (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  status      ENUM('active','expired','converted','cancelled') NOT NULL DEFAULT 'active',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_trial_business (business_id),
  CONSTRAINT fk_trial_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Catalogue and stock
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  UNIQUE KEY uq_category (business_id, name),
  CONSTRAINT fk_categories_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS brands (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  UNIQUE KEY uq_brand (business_id, name),
  CONSTRAINT fk_brands_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id     INT UNSIGNED NOT NULL,
  category_id     INT UNSIGNED NULL,
  brand_id        INT UNSIGNED NULL,
  subcategory     VARCHAR(120) NULL,
  name            VARCHAR(190) NOT NULL,          -- names may repeat; size / barcode / SKU tell products apart
  generic_name    VARCHAR(190) NULL,              -- pharmacy: generic name, dosage form, manufacturer, default supplier,
  dosage_form     VARCHAR(40)  NULL,              --   prescription required, storage instructions
  manufacturer    VARCHAR(150) NULL,
  supplier_id     INT UNSIGNED NULL,
  rx_required     TINYINT(1)   NOT NULL DEFAULT 0,
  storage_instructions VARCHAR(255) NULL,
  product_type    VARCHAR(60)  NULL,              -- electronics: product type (Smartphone, Laptop, USB Cable…), model number, country of origin
  model_number    VARCHAR(80)  NULL,              -- clothing: model / style
  collection      VARCHAR(80)  NULL,              -- clothing: collection and season
  season          VARCHAR(40)  NULL,
  metal           VARCHAR(20)  NULL,              -- jewelry: gold / silver, purity (22K, 925…), weights in grams
  purity          VARCHAR(20)  NULL,
  gross_weight    DECIMAL(14,4) NULL,
  stone_weight    DECIMAL(14,4) NULL,             -- net metal weight = gross − stone
  pricing_mode    VARCHAR(10)  NOT NULL DEFAULT 'fixed',   -- fixed | weight (net weight × rate + making + extra)
  making_charge   DECIMAL(14,4) NULL,
  making_type     VARCHAR(10)  NOT NULL DEFAULT 'per_gram', -- per_gram | fixed
  extra_charge    DECIMAL(14,4) NULL,
  unique_item     TINYINT(1)   NOT NULL DEFAULT 0, -- one individual piece (stock 0 or 1)
  item_status     VARCHAR(20)  NOT NULL DEFAULT 'active', -- active, sold, returned, damaged
  country_of_origin VARCHAR(60) NULL,
  size            VARCHAR(40)  NULL,              -- e.g. 400ml, 1kg — shown after the name everywhere
  shade           VARCHAR(60)  NULL,              -- variant fields (cosmetics): shown after the name too
  fragrance       VARCHAR(60)  NULL,
  formula         VARCHAR(60)  NULL,
  pack_size       VARCHAR(40)  NULL,
  variant_of      INT UNSIGNED NULL,              -- variant group: the first product of the group
  description     TEXT NULL,
  sku             VARCHAR(80)  NULL,
  barcode         VARCHAR(80)  NULL,
  image_path      VARCHAR(255) NULL,                 -- product photo, /uploads/products/...
  unit            VARCHAR(20)  NOT NULL DEFAULT 'pcs',    -- base unit: stock is always kept in it
  packaging       TEXT NULL,                          -- packs above the base unit (JSON, lib/packaging.js), e.g. carton → box → strip
  cost_price      DECIMAL(14,4) NOT NULL DEFAULT 0,
  selling_price   DECIMAL(14,4) NOT NULL DEFAULT 0,
  wholesale_price DECIMAL(14,4) NULL,
  stock_qty       DECIMAL(14,3) NOT NULL DEFAULT 0,  -- maintained only inside stock-movement transactions
  min_stock       DECIMAL(14,3) NOT NULL DEFAULT 0,  -- Low Stock Alert Level (per location: product_stock.alert_level)
  tracking        VARCHAR(12) NOT NULL DEFAULT 'qty', -- qty | serial | imei | serial_imei (devices table)
  warranty_months INT UNSIGNED NULL,                 -- warranty policy for sales (warranties table)
  warranty_provider VARCHAR(100) NULL,
  warranty_terms  VARCHAR(255) NULL,
  notes           TEXT NULL,
  specs           TEXT NULL,                         -- technical specifications (JSON, by product type)
  min_price       DECIMAL(14,4) NULL,                -- lowest price a sale may use
  track_batches   TINYINT(1) NOT NULL DEFAULT 0,     -- batch number + expiry per stock entry (product_batches)
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_products_sku (business_id, sku),         -- unique per business unless allow_duplicate_codes (checked by the app)
  INDEX idx_products_barcode (business_id, barcode),
  INDEX idx_products_variant (business_id, variant_of),
  INDEX idx_products_name (business_id, name),
  CONSTRAINT fk_products_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT fk_products_brand    FOREIGN KEY (brand_id)    REFERENCES brands(id)
) ENGINE=InnoDB;

-- Stock locations (shops, warehouses). Every business has one default location;
-- sales, invoices and purchases use it.
CREATE TABLE IF NOT EXISTS stock_locations (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  name        VARCHAR(100) NOT NULL,
  kind        VARCHAR(20)  NOT NULL DEFAULT 'shop',   -- shop | warehouse | other
  address     VARCHAR(200) NULL,
  is_default  TINYINT(1) NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_location_name (business_id, name),
  CONSTRAINT fk_location_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

-- Stock per product and location. products.stock_qty = SUM(qty) (kept in step by the API).
CREATE TABLE IF NOT EXISTS product_stock (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  product_id  INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  qty         DECIMAL(14,3) NOT NULL DEFAULT 0,
  alert_level DECIMAL(14,3) NULL,                 -- own low-stock level at this location (NULL = product level)
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_product_location (product_id, location_id),
  INDEX idx_stock_business (business_id, location_id),
  CONSTRAINT fk_ps_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_ps_product  FOREIGN KEY (product_id)  REFERENCES products(id),
  CONSTRAINT fk_ps_location FOREIGN KEY (location_id) REFERENCES stock_locations(id)
) ENGINE=InnoDB;

-- Stock movement ledger: every stock change, never edited or deleted (mistakes are reversed).
-- type: opening, purchase, sale, invoice, return_in, return_out, purchase_return, stock_in,
--       transfer_out, transfer_in, damaged, adjustment, count, reversal
CREATE TABLE IF NOT EXISTS stock_movements (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id    INT UNSIGNED NOT NULL,
  product_id     INT UNSIGNED NOT NULL,
  location_id    INT UNSIGNED NULL,
  type           VARCHAR(30) NOT NULL,
  qty_change     DECIMAL(14,3) NOT NULL,          -- + into stock, − out of stock
  balance_before DECIMAL(14,3) NULL,              -- location balance before / after
  balance_after  DECIMAL(14,3) NULL,
  unit           VARCHAR(20) NULL,
  unit_cost      DECIMAL(14,4) NULL,              -- cost price at the time (valuation of gains / losses)
  ref_type       VARCHAR(30) NULL,                -- sale, invoice, purchase, stock (manual), transfer
  ref_id         BIGINT UNSIGNED NULL,
  reason         VARCHAR(120) NULL,
  reference      VARCHAR(80) NULL,
  supplier_id    INT UNSIGNED NULL,
  transfer_ref   VARCHAR(40) NULL,                -- links the two lines of a transfer
  reversal_of    BIGINT UNSIGNED NULL,            -- the movement this one reverses
  note           VARCHAR(255) NULL,
  user_id        INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_moves_product (business_id, product_id, created_at),
  INDEX idx_moves_location (business_id, location_id, created_at),
  INDEX idx_moves_reversal (reversal_of),
  CONSTRAINT fk_moves_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_moves_product  FOREIGN KEY (product_id)  REFERENCES products(id)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Parties
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  name        VARCHAR(150) NOT NULL,
  phone       VARCHAR(30)  NULL,
  email       VARCHAR(190) NULL,
  address     VARCHAR(255) NULL,
  notes       VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_customers_name (business_id, name),
  CONSTRAINT fk_customers_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS suppliers (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  name        VARCHAR(150) NOT NULL,
  phone       VARCHAR(30)  NULL,
  email       VARCHAR(190) NULL,
  address     VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_suppliers_name (business_id, name),
  CONSTRAINT fk_suppliers_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Money accounts (balances are derived from cash_transactions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_accounts (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  name        VARCHAR(100) NOT NULL,
  is_default  TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cash_account (business_id, name),
  CONSTRAINT fk_cash_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bank_accounts (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id    INT UNSIGNED NOT NULL,
  bank_name      VARCHAR(120) NOT NULL,
  account_name   VARCHAR(120) NOT NULL,
  account_number VARCHAR(60)  NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bank_business (business_id),
  CONSTRAINT fk_bank_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cash_transactions (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id     INT UNSIGNED NOT NULL,
  cash_account_id INT UNSIGNED NULL,
  bank_account_id INT UNSIGNED NULL,
  direction       ENUM('in','out') NOT NULL,
  amount          DECIMAL(14,4) NOT NULL,
  ref_type        VARCHAR(30) NOT NULL,   -- customer_payment, supplier_payment, expense, other_income, transfer, opening
  ref_id          BIGINT UNSIGNED NULL,
  description     VARCHAR(255) NULL,
  user_id         INT UNSIGNED NULL,
  occurred_at     DATETIME NOT NULL,
  INDEX idx_ctx_business_date (business_id, occurred_at),
  CONSTRAINT fk_ctx_business FOREIGN KEY (business_id)     REFERENCES businesses(id),
  CONSTRAINT fk_ctx_cash     FOREIGN KEY (cash_account_id) REFERENCES cash_accounts(id),
  CONSTRAINT fk_ctx_bank     FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id)
) ENGINE=InnoDB;

-- POS payment methods set up by each business (Settings → Payment methods),
-- e.g. "E-Dahab (136227)". Each pays into its own cash or bank account.
CREATE TABLE IF NOT EXISTS payment_methods (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id     INT UNSIGNED NOT NULL,
  name            VARCHAR(80)  NOT NULL,
  number          VARCHAR(60)  NULL,
  kind            ENUM('cash','mobile_money','bank') NOT NULL,
  cash_account_id INT UNSIGNED NULL,
  bank_account_id INT UNSIGNED NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pm_business (business_id, sort_order),
  CONSTRAINT fk_pm_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_pm_cash     FOREIGN KEY (cash_account_id) REFERENCES cash_accounts(id),
  CONSTRAINT fk_pm_bank     FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Retail sales (POS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id    INT UNSIGNED NOT NULL,
  receipt_no     VARCHAR(30) NOT NULL,
  customer_id    INT UNSIGNED NULL,
  user_id        INT UNSIGNED NOT NULL,
  subtotal       DECIMAL(14,4) NOT NULL,
  discount       DECIMAL(14,4) NOT NULL DEFAULT 0,
  vat_rate       DECIMAL(5,2)  NOT NULL DEFAULT 0,  -- optional VAT (5%) on the amount after discount
  vat_amount     DECIMAL(14,4) NOT NULL DEFAULT 0,  -- included in total; not counted as sales income
  total          DECIMAL(14,4) NOT NULL,
  amount_paid    DECIMAL(14,4) NOT NULL DEFAULT 0,  -- informational; money in = customer_payments
  change_amount  DECIMAL(14,4) NOT NULL DEFAULT 0,  -- change given back (receipt)
  payment_method ENUM('cash','mobile_money','bank','credit') NOT NULL,
  status         ENUM('completed','cancelled','returned','partially_returned') NOT NULL DEFAULT 'completed',
  sold_at        DATETIME NOT NULL,
  UNIQUE KEY uq_receipt (business_id, receipt_no),
  INDEX idx_sales_date (business_id, sold_at),
  CONSTRAINT fk_sales_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_sales_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_sales_user     FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sale_items (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  sale_id     BIGINT UNSIGNED NOT NULL,
  product_id  INT UNSIGNED NOT NULL,
  qty         DECIMAL(14,3) NOT NULL,
  unit_price  DECIMAL(14,4) NOT NULL,
  unit_cost   DECIMAL(14,4) NOT NULL,   -- cost at time of sale (for COGS / gross profit)
  discount    DECIMAL(14,4) NOT NULL DEFAULT 0,
  line_total  DECIMAL(14,4) NOT NULL,
  sell_unit   VARCHAR(30) NULL,            -- sold in a pack (box, strip…): the pack, how many, price per pack; qty / unit_price stay in base units
  sell_qty    DECIMAL(14,3) NULL,
  sell_price  DECIMAL(14,4) NULL,
  price_detail TEXT NULL,                  -- jewelry: rate, purity, weights and charges used (JSON)
  INDEX idx_sale_items_sale (sale_id),
  INDEX idx_sale_items_product (business_id, product_id),
  CONSTRAINT fk_sale_items_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_sale_items_sale     FOREIGN KEY (sale_id)     REFERENCES sales(id),
  CONSTRAINT fk_sale_items_product  FOREIGN KEY (product_id)  REFERENCES products(id)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Wholesale sales (invoices)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  invoice_no  VARCHAR(30) NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  bill_phone   VARCHAR(30)  NULL,    -- customer business phone / address printed on this invoice
  bill_address VARCHAR(255) NULL,
  user_id     INT UNSIGNED NOT NULL,
  issue_date  DATE NOT NULL,
  due_date    DATE NULL,
  subtotal    DECIMAL(14,4) NOT NULL,
  discount    DECIMAL(14,4) NOT NULL DEFAULT 0,
  discount_label VARCHAR(80) NULL,  -- e.g. "10%" or "Eid offer"
  vat_rate    DECIMAL(5,2)  NOT NULL DEFAULT 0,
  vat_amount  DECIMAL(14,4) NOT NULL DEFAULT 0,
  total       DECIMAL(14,4) NOT NULL,
  amount_paid DECIMAL(14,4) NOT NULL DEFAULT 0,  -- sum of linked customer_payments, updated in the same transaction
  status      ENUM('draft','unpaid','partially_paid','paid','overdue','cancelled') NOT NULL DEFAULT 'unpaid',
  notes       VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invoice_no (business_id, invoice_no),
  INDEX idx_invoices_date (business_id, issue_date),
  INDEX idx_invoices_status (business_id, status),
  CONSTRAINT fk_invoices_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_invoices_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_invoices_user     FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_items (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  invoice_id  BIGINT UNSIGNED NOT NULL,
  product_id  INT UNSIGNED NOT NULL,
  description VARCHAR(190) NULL,
  qty         DECIMAL(14,3) NOT NULL,
  unit_price  DECIMAL(14,4) NOT NULL,
  unit_cost   DECIMAL(14,4) NOT NULL,
  discount    DECIMAL(14,4) NOT NULL DEFAULT 0,
  line_total  DECIMAL(14,4) NOT NULL,
  sell_unit   VARCHAR(30) NULL,            -- sold in a pack (box, strip…): the pack, how many, price per pack; qty / unit_price stay in base units
  sell_qty    DECIMAL(14,3) NULL,
  sell_price  DECIMAL(14,4) NULL,
  price_detail TEXT NULL,                  -- jewelry: rate, purity, weights and charges used (JSON)
  INDEX idx_inv_items_invoice (invoice_id),
  INDEX idx_inv_items_product (business_id, product_id),
  CONSTRAINT fk_inv_items_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_inv_items_invoice  FOREIGN KEY (invoice_id)  REFERENCES invoices(id),
  CONSTRAINT fk_inv_items_product  FOREIGN KEY (product_id)  REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customer_payments (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id     INT UNSIGNED NOT NULL,
  customer_id     INT UNSIGNED NULL,
  invoice_id      BIGINT UNSIGNED NULL,
  sale_id         BIGINT UNSIGNED NULL,
  amount          DECIMAL(14,4) NOT NULL,
  method          ENUM('cash','mobile_money','bank') NOT NULL,
  payment_method_id INT UNSIGNED NULL,               -- business payment method (E-Dahab, ...)
  cash_account_id INT UNSIGNED NULL,
  bank_account_id INT UNSIGNED NULL,
  reference       VARCHAR(80) NULL,
  paid_at         DATETIME NOT NULL,
  user_id         INT UNSIGNED NOT NULL,
  INDEX idx_cpay_date (business_id, paid_at),
  INDEX idx_cpay_customer (business_id, customer_id),
  CONSTRAINT fk_cpay_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_cpay_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_cpay_invoice  FOREIGN KEY (invoice_id)  REFERENCES invoices(id),
  CONSTRAINT fk_cpay_sale     FOREIGN KEY (sale_id)     REFERENCES sales(id),
  CONSTRAINT fk_cpay_user     FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Purchases and suppliers
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id  INT UNSIGNED NOT NULL,
  purchase_no  VARCHAR(30) NOT NULL,
  supplier_id  INT UNSIGNED NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  total        DECIMAL(14,4) NOT NULL,
  amount_paid  DECIMAL(14,4) NOT NULL DEFAULT 0,  -- sum of linked supplier_payments
  status       ENUM('draft','ordered','partial','received','cancelled','returned') NOT NULL DEFAULT 'received',  -- draft / ordered = no stock yet; partial = backorder outstanding
  discount     DECIMAL(14,4) NOT NULL DEFAULT 0,
  extra_costs  DECIMAL(14,4) NOT NULL DEFAULT 0,   -- additional purchase costs (shipping, customs…)
  ordered_total DECIMAL(14,4) NULL,                -- value of the order; total = what is owed for the goods received
  expected_date DATE NULL,
  payment_terms VARCHAR(80) NULL,
  notes        VARCHAR(255) NULL,
  location_id  INT UNSIGNED NULL,
  purchased_at DATETIME NOT NULL,
  received_at  DATETIME NULL,                      -- goods receipt of an ordered purchase
  UNIQUE KEY uq_purchase_no (business_id, purchase_no),
  INDEX idx_purchases_date (business_id, purchased_at),
  CONSTRAINT fk_purchases_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_purchases_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_purchases_user     FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS purchase_items (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  purchase_id BIGINT UNSIGNED NOT NULL,
  product_id  INT UNSIGNED NOT NULL,
  qty         DECIMAL(14,3) NOT NULL,
  unit_cost   DECIMAL(14,4) NOT NULL,
  line_total  DECIMAL(14,4) NOT NULL,
  received_qty DECIMAL(14,3) NOT NULL DEFAULT 0,  -- base units received so far (partial receipts)
  damaged_qty DECIMAL(14,3) NOT NULL DEFAULT 0,   -- arrived damaged / defective (not added to stock)
  returned_qty DECIMAL(14,3) NOT NULL DEFAULT 0,  -- returned to the supplier
  buy_unit    VARCHAR(30) NULL,            -- bought in a pack (carton, box…): the pack, how many, cost per pack; qty / unit_cost stay in base units
  buy_qty     DECIMAL(14,3) NULL,
  buy_cost    DECIMAL(14,4) NULL,
  batch_no    VARCHAR(60) NULL,            -- batch / expiry of the goods (used when an ordered purchase is received)
  expiry_date DATE NULL,
  price_detail TEXT NULL,                  -- jewelry: rate at the time of purchase (JSON)
  INDEX idx_pitems_purchase (purchase_id),
  CONSTRAINT fk_pitems_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_pitems_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  CONSTRAINT fk_pitems_product  FOREIGN KEY (product_id)  REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS supplier_payments (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id     INT UNSIGNED NOT NULL,
  supplier_id     INT UNSIGNED NOT NULL,
  purchase_id     BIGINT UNSIGNED NULL,
  amount          DECIMAL(14,4) NOT NULL,
  method          ENUM('cash','mobile_money','bank') NOT NULL,
  cash_account_id INT UNSIGNED NULL,
  bank_account_id INT UNSIGNED NULL,
  reference       VARCHAR(80) NULL,
  paid_at         DATETIME NOT NULL,
  user_id         INT UNSIGNED NOT NULL,
  INDEX idx_spay_date (business_id, paid_at),
  CONSTRAINT fk_spay_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_spay_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_spay_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  CONSTRAINT fk_spay_user     FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Expenses and other income
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id     INT UNSIGNED NOT NULL,
  category        VARCHAR(60) NOT NULL,     -- rent, salaries, electricity, internet, transport, repairs, marketing, other
  amount          DECIMAL(14,4) NOT NULL,
  expense_date    DATE NOT NULL,
  method          ENUM('cash','mobile_money','bank') NOT NULL,
  cash_account_id INT UNSIGNED NULL,
  bank_account_id INT UNSIGNED NULL,
  description     VARCHAR(255) NULL,
  user_id         INT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_expenses_date (business_id, expense_date),
  CONSTRAINT fk_expenses_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_expenses_user     FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS other_income (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id     INT UNSIGNED NOT NULL,
  category        VARCHAR(60) NOT NULL,
  amount          DECIMAL(14,4) NOT NULL,
  income_date     DATE NOT NULL,
  method          ENUM('cash','mobile_money','bank') NOT NULL,
  cash_account_id INT UNSIGNED NULL,
  bank_account_id INT UNSIGNED NULL,
  description     VARCHAR(255) NULL,
  user_id         INT UNSIGNED NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_income_date (business_id, income_date),
  CONSTRAINT fk_income_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_income_user     FOREIGN KEY (user_id)     REFERENCES users(id)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Returns
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS returns (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  type        ENUM('sale','invoice','purchase') NOT NULL,
  sale_id     BIGINT UNSIGNED NULL,
  invoice_id  BIGINT UNSIGNED NULL,
  purchase_id BIGINT UNSIGNED NULL,
  total       DECIMAL(14,4) NOT NULL,
  refund_amount DECIMAL(14,4) NOT NULL DEFAULT 0,
  reason      VARCHAR(255) NULL,
  user_id     INT UNSIGNED NOT NULL,
  approved_by INT UNSIGNED NULL,
  returned_at DATETIME NOT NULL,
  INDEX idx_returns_date (business_id, returned_at),
  CONSTRAINT fk_returns_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS return_items (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  return_id   BIGINT UNSIGNED NOT NULL,
  product_id  INT UNSIGNED NOT NULL,
  qty         DECIMAL(14,3) NOT NULL,
  unit_price  DECIMAL(14,4) NOT NULL,
  unit_cost   DECIMAL(14,4) NOT NULL,
  line_total  DECIMAL(14,4) NOT NULL,
  CONSTRAINT fk_ritems_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_ritems_return   FOREIGN KEY (return_id)   REFERENCES returns(id),
  CONSTRAINT fk_ritems_product  FOREIGN KEY (product_id)  REFERENCES products(id)
) ENGINE=InnoDB;

-- -----------------------------------------------------------------------------
-- Notifications and audit trail
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NULL,          -- NULL = everyone with permission
  type        VARCHAR(40) NOT NULL,       -- low_stock, out_of_stock, invoice_overdue, payment_due, supplier_due
  title       VARCHAR(190) NOT NULL,
  body        VARCHAR(255) NULL,
  ref_type    VARCHAR(30) NULL,
  ref_id      BIGINT UNSIGNED NULL,
  is_read     TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notif_business (business_id, is_read, created_at),
  CONSTRAINT fk_notif_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_barcodes (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  product_id  INT UNSIGNED NOT NULL,
  barcode     VARCHAR(80)  NOT NULL,
  pack_label  VARCHAR(60)  NULL,                 -- e.g. Box, Carton, Gift set
  pack_qty    DECIMAL(14,3) NOT NULL DEFAULT 1,  -- units in this packaging (scanning it sells / adds this many)
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pb_barcode (business_id, barcode),
  INDEX idx_pb_product (product_id),
  CONSTRAINT fk_pb_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_pb_product  FOREIGN KEY (product_id)  REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_batches (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  product_id  INT UNSIGNED NOT NULL,
  location_id INT UNSIGNED NOT NULL,
  batch_no    VARCHAR(60)  NOT NULL DEFAULT '',  -- '' = stock without a batch number
  expiry_date DATE NULL,
  qty         DECIMAL(14,3) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_batch_lookup (product_id, location_id, batch_no, expiry_date),
  INDEX idx_batch_expiry (business_id, expiry_date),
  CONSTRAINT fk_batch_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_batch_product  FOREIGN KEY (product_id)  REFERENCES products(id),
  CONSTRAINT fk_batch_location FOREIGN KEY (location_id) REFERENCES stock_locations(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_movement_batches (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  movement_id BIGINT UNSIGNED NOT NULL,
  batch_id    INT UNSIGNED NOT NULL,
  qty         DECIMAL(14,3) NOT NULL,            -- + into the batch, − out of it
  INDEX idx_smb_movement (movement_id),
  INDEX idx_smb_batch (batch_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS devices (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id   INT UNSIGNED NOT NULL,
  product_id    INT UNSIGNED NOT NULL,                -- the product / variant
  serial_no     VARCHAR(80) NULL,
  imei1         VARCHAR(20) NULL,
  imei2         VARCHAR(20) NULL,                     -- dual-SIM
  location_id   INT UNSIGNED NULL,                    -- where it is (NULL once it left the business)
  status        VARCHAR(20) NOT NULL DEFAULT 'available',  -- available, reserved, sold, returned_supplier, defective, lost, removed
  purchase_id   BIGINT UNSIGNED NULL,
  supplier_id   INT UNSIGNED NULL,
  cost          DECIMAL(14,4) NULL,
  sold_ref_type VARCHAR(10) NULL,                     -- sale | invoice
  sold_ref_id   BIGINT UNSIGNED NULL,
  sold_item_id  BIGINT UNSIGNED NULL,
  customer_id   INT UNSIGNED NULL,
  sold_at       DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_dev_product (business_id, product_id, status, location_id),
  INDEX idx_dev_serial (business_id, serial_no),
  INDEX idx_dev_imei1 (business_id, imei1),
  INDEX idx_dev_imei2 (business_id, imei2),
  INDEX idx_dev_sold (business_id, sold_ref_type, sold_ref_id),
  CONSTRAINT fk_dev_business FOREIGN KEY (business_id) REFERENCES businesses(id),
  CONSTRAINT fk_dev_product  FOREIGN KEY (product_id)  REFERENCES products(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS device_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id   INT UNSIGNED NOT NULL,
  event       VARCHAR(30) NOT NULL,                   -- received, opening, transferred, sold, returned, returned_supplier, defective, lost, removed, warranty
  ref_type    VARCHAR(20) NULL,
  ref_id      BIGINT UNSIGNED NULL,
  location_id INT UNSIGNED NULL,
  note        VARCHAR(255) NULL,
  user_id     INT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_devev_device (device_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS warranties (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id   INT UNSIGNED NOT NULL,
  product_id    INT UNSIGNED NOT NULL,
  device_id     INT UNSIGNED NULL,
  customer_id   INT UNSIGNED NULL,
  ref_type      VARCHAR(10) NOT NULL,                  -- sale | invoice
  ref_id        BIGINT UNSIGNED NOT NULL,
  qty           DECIMAL(14,3) NOT NULL DEFAULT 1,
  provider      VARCHAR(100) NULL,                     -- shop, manufacturer, supplier…
  months        INT UNSIGNED NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  terms         VARCHAR(255) NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'active', -- active, under_review, claim_submitted, resolved, rejected, void (expired is shown from end_date)
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_war_business (business_id, end_date),
  INDEX idx_war_ref (business_id, ref_type, ref_id),
  CONSTRAINT fk_war_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS warranty_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  warranty_id INT UNSIGNED NOT NULL,
  changes     TEXT NULL,                              -- JSON [{ field, from, to }]
  note        VARCHAR(255) NULL,
  user_id     INT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_warev (warranty_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS catalog_options (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  kind        VARCHAR(20)  NOT NULL,      -- subcategory, color, size, collection, season, unit
  name        VARCHAR(80)  NOT NULL,
  parent      VARCHAR(120) NULL,          -- subcategory: its category · size: its size system
  code        VARCHAR(20)  NULL,          -- color: #rrggbb swatch
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_catalog (business_id, kind, parent, name),
  CONSTRAINT fk_catalog_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS metal_rates (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id INT UNSIGNED NOT NULL,
  metal       VARCHAR(20)  NOT NULL,           -- gold, silver, …
  purity      VARCHAR(20)  NOT NULL,           -- 22K, 18K, 925…
  rate        DECIMAL(14,4) NOT NULL,          -- price per gram of that purity
  user_id     INT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rates (business_id, metal, purity, id),
  CONSTRAINT fk_rates_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gold_buys (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id     INT UNSIGNED NOT NULL,
  ref_no          VARCHAR(30)  NOT NULL,
  customer_id     INT UNSIGNED NULL,
  customer_name   VARCHAR(150) NULL,
  customer_phone  VARCHAR(30)  NULL,
  id_document     VARCHAR(80)  NULL,           -- ID card / passport no., when required
  description     VARCHAR(255) NOT NULL,
  metal           VARCHAR(20)  NOT NULL,
  gross_weight    DECIMAL(14,4) NOT NULL,
  stone_weight    DECIMAL(14,4) NOT NULL DEFAULT 0,
  declared_purity VARCHAR(20)  NULL,
  tested_purity   VARCHAR(20)  NULL,
  inspection      VARCHAR(500) NULL,
  valuation       VARCHAR(10)  NOT NULL DEFAULT 'weight',  -- weight | manual
  rate_used       DECIMAL(14,4) NULL,
  deduction_pct   DECIMAL(6,2) NOT NULL DEFAULT 0,          -- buying margin / melting loss
  suggested_value DECIMAL(14,4) NULL,
  offer_amount    DECIMAL(14,4) NULL,
  agreed_price    DECIMAL(14,4) NULL,
  approved_by     INT UNSIGNED NULL,
  approved_at     DATETIME NULL,
  payment_method  VARCHAR(20)  NULL,
  paid_amount     DECIMAL(14,4) NOT NULL DEFAULT 0,
  status          VARCHAR(20)  NOT NULL DEFAULT 'pending_inspection',
    -- pending_inspection → offered → approved → paid (held) → for_resale | scrap ;  rejected
  product_id      INT UNSIGNED NULL,           -- the stock item made from it (for resale)
  user_id         INT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gold_buy (business_id, ref_no),
  CONSTRAINT fk_gb_business FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gold_buy_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  gold_buy_id INT UNSIGNED NOT NULL,
  event       VARCHAR(30)  NOT NULL,
  detail      TEXT NULL,                       -- JSON
  user_id     INT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_gbe (gold_buy_id, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  business_id       INT UNSIGNED NULL,
  user_id           INT UNSIGNED NULL,
  platform_admin_id INT UNSIGNED NULL,
  action            VARCHAR(60) NOT NULL,   -- e.g. business.registered, auth.login, sale.created
  entity            VARCHAR(40) NULL,
  entity_id         BIGINT UNSIGNED NULL,
  meta              JSON NULL,
  ip                VARCHAR(45) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_business (business_id, created_at),
  INDEX idx_audit_action (action, created_at)
) ENGINE=InnoDB;
