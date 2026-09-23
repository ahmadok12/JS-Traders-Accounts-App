-- ============================================================================
-- JS TRADERS ERP - INITIAL SCHEMA MIGRATION
-- Database: PostgreSQL 14+ / Supabase
-- Description: Complete normalized relational schema for import-based poultry
--              equipment trading business with double-entry accounting foundation.
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. COMPANIES & BRANCHES
CREATE TABLE IF NOT EXISTS companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    legal_name VARCHAR(255),
    tax_number VARCHAR(100),
    base_currency VARCHAR(10) DEFAULT 'PKR',
    phone VARCHAR(50),
    email VARCHAR(100),
    address TEXT,
    logo_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. USERS & PROFILES
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id),
    full_name VARCHAR(255) NOT NULL,
    username VARCHAR(100) UNIQUE,
    phone VARCHAR(50),
    avatar_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ROLES & PERMISSIONS
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL, -- 'owner', 'admin', 'warehouse_manager', 'warehouse_staff', 'sales_person', 'accounts', 'purchase', 'management'
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module VARCHAR(50) NOT NULL, -- 'inventory', 'warehouse', 'sales', 'purchasing', 'accounting', 'reports', 'settings'
    action VARCHAR(50) NOT NULL, -- 'view', 'create', 'edit', 'delete', 'approve', 'confirm', 'print', 'export', 'view_cost_profit'
    name VARCHAR(100) NOT NULL,
    description TEXT,
    UNIQUE(module, action)
);

CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE(role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    UNIQUE(user_id, role_id)
);

CREATE TABLE IF NOT EXISTS user_permission_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    is_granted BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE(user_id, permission_id)
);

-- 4. WAREHOUSES & LOCATIONS
CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id),
    code VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'WH-001'
    name VARCHAR(255) NOT NULL,       -- e.g. 'Main Warehouse Lahore'
    address TEXT,
    city VARCHAR(100),
    contact_person VARCHAR(100),
    phone VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS warehouse_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL, -- 'RACK-A', 'YARD', 'SEC-01'
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS user_warehouse_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    UNIQUE(user_id, warehouse_id)
);

-- 5. PARTIES (SHARED CUSTOMER & SUPPLIER ARCHITECTURE)
CREATE TABLE IF NOT EXISTS parties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id),
    party_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    business_name VARCHAR(255),
    is_customer BOOLEAN DEFAULT FALSE,
    is_supplier BOOLEAN DEFAULT FALSE,
    tax_number VARCHAR(100),
    contact_person VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(100),
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100) DEFAULT 'Pakistan',
    default_currency VARCHAR(10) DEFAULT 'PKR',
    payment_terms VARCHAR(100),
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Customer Hierarchy: Customer Owner -> Farm/Branch -> Deal/Account
CREATE TABLE IF NOT EXISTS customer_farms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    farm_code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL, -- e.g. 'Farm 1 - Bhai Pheru'
    location VARCHAR(255),
    contact_person VARCHAR(100),
    phone VARCHAR(50),
    capacity INTEGER,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(customer_party_id, farm_code)
);

CREATE TABLE IF NOT EXISTS customer_deals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farm_id UUID NOT NULL REFERENCES customer_farms(id) ON DELETE CASCADE,
    deal_code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL, -- e.g. 'Complete Broiler Shed Automation #1'
    assigned_salesperson_id UUID REFERENCES profiles(id),
    agreed_budget NUMERIC(15,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'Active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(farm_id, deal_code)
);

-- 6. UNITS OF MEASURE
CREATE TABLE IF NOT EXISTS unit_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL -- 'Quantity', 'Length', 'Weight', 'Packaging'
);

CREATE TABLE IF NOT EXISTS units (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID REFERENCES unit_categories(id),
    code VARCHAR(20) UNIQUE NOT NULL, -- 'PCS', 'BOX', 'CTN', 'FT', 'MTR', 'ROLL', 'SET', 'KG'
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS unit_conversions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_unit_id UUID NOT NULL REFERENCES units(id),
    to_unit_id UUID NOT NULL REFERENCES units(id),
    conversion_factor NUMERIC(15,6) NOT NULL, -- e.g. 1 CTN = 20 PCS => factor 20
    UNIQUE(from_unit_id, to_unit_id)
);

-- 7. PRODUCT MASTER & CATEGORIES
CREATE TABLE IF NOT EXISTS product_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parent_category_id UUID REFERENCES product_categories(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id),
    category_id UUID REFERENCES product_categories(id),
    product_code VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'PROD-00001'
    business_name VARCHAR(255) NOT NULL,      -- e.g. 'FP-CN-150'
    customer_name VARCHAR(255) NOT NULL,      -- e.g. 'Feed Pan 16"'
    urdu_name VARCHAR(255),                   -- e.g. 'فیڈ پین'
    description TEXT,
    product_type VARCHAR(50) DEFAULT 'Stock', -- 'Stock', 'Non-Stock', 'Service'
    base_unit_id UUID REFERENCES units(id),
    multi_unit_enabled BOOLEAN DEFAULT FALSE,
    low_stock_level NUMERIC(15,2) DEFAULT 10,
    enable_roll_tracking BOOLEAN DEFAULT FALSE,
    negative_stock_allowed VARCHAR(20) DEFAULT 'system_default', -- 'system_default', 'allow', 'disallow'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dynamic Variant Attributes (e.g. Origin, Material, Size, Quality, Voltage)
CREATE TABLE IF NOT EXISTS attribute_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL, -- 'Origin', 'Material', 'Size', 'Quality'
    data_type VARCHAR(50) DEFAULT 'text',
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS attribute_values (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attribute_id UUID NOT NULL REFERENCES attribute_definitions(id) ON DELETE CASCADE,
    value VARCHAR(100) NOT NULL, -- 'China', 'Pakistan', 'PVC', 'Galvanized Steel'
    UNIQUE(attribute_id, value)
);

CREATE TABLE IF NOT EXISTS product_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_code VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'VAR-00001'
    sku VARCHAR(100) UNIQUE NOT NULL,          -- e.g. 'FP-CN-16'
    variant_name VARCHAR(255) NOT NULL,        -- e.g. 'Feed Pan - Made in China'
    barcode VARCHAR(100),
    description TEXT,
    costing_method VARCHAR(50) DEFAULT 'FIFO',
    standard_cost NUMERIC(15,2) DEFAULT 0,
    selling_price NUMERIC(15,2) DEFAULT 0,
    low_stock_setting NUMERIC(15,2),
    negative_stock_setting VARCHAR(20) DEFAULT 'system_default',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS variant_attribute_values (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    attribute_id UUID NOT NULL REFERENCES attribute_definitions(id),
    attribute_value_id UUID NOT NULL REFERENCES attribute_values(id),
    UNIQUE(variant_id, attribute_id)
);

-- Roll / Cut-to-length tracking
CREATE TABLE IF NOT EXISTS physical_rolls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    location_id UUID REFERENCES warehouse_locations(id),
    roll_code VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'ROLL-001'
    initial_length_feet NUMERIC(15,2) NOT NULL,
    remaining_length_feet NUMERIC(15,2) NOT NULL,
    is_full_roll BOOLEAN DEFAULT TRUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. CENTRAL STOCK LEDGER ENGINE
-- Stock Balance Table (Derived Cache from Stock Movements)
CREATE TABLE IF NOT EXISTS stock_balances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    location_id UUID REFERENCES warehouse_locations(id),
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    quantity NUMERIC(15,4) NOT NULL DEFAULT 0,
    average_cost NUMERIC(15,4) NOT NULL DEFAULT 0,
    last_movement_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(warehouse_id, variant_id)
);

-- Stock Movements (Authoritative Source of Truth)
CREATE TABLE IF NOT EXISTS stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    movement_number VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'MOV-00001'
    movement_type VARCHAR(50) NOT NULL,          -- 'opening_balance', 'purchase_receipt', 'delivery', 'adjustment_increase', 'adjustment_decrease', 'assembly_consumption', 'assembly_output', 'disassembly_consumption', 'disassembly_output', 'transfer_in', 'transfer_out', 'return'
    reference_document_type VARCHAR(50),         -- 'delivery', 'stock_adjustment', 'assembly', 'disassembly', 'purchase_bill'
    reference_document_id UUID,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    movement_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_movement_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    movement_id UUID NOT NULL REFERENCES stock_movements(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    location_id UUID REFERENCES warehouse_locations(id),
    quantity NUMERIC(15,4) NOT NULL, -- Positive for in, negative for out
    unit_id UUID REFERENCES units(id),
    unit_rate NUMERIC(15,4) DEFAULT 0,
    total_cost NUMERIC(15,4) DEFAULT 0,
    roll_id UUID REFERENCES physical_rolls(id),
    notes TEXT
);

-- 9. STOCK ADJUSTMENTS
CREATE TABLE IF NOT EXISTS stock_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    adjustment_number VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'ADJ-00001'
    adjustment_type VARCHAR(20) NOT NULL,          -- 'increase', 'decrease'
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    adjustment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reason VARCHAR(255) NOT NULL,
    status VARCHAR(50) DEFAULT 'Draft',            -- 'Draft', 'Confirmed', 'Cancelled'
    created_by UUID REFERENCES profiles(id),
    approved_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_adjustment_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    adjustment_id UUID NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    quantity NUMERIC(15,4) NOT NULL,
    unit_id UUID REFERENCES units(id),
    unit_rate NUMERIC(15,4) DEFAULT 0,
    notes TEXT
);

-- 10. ASSEMBLY & DISASSEMBLY
CREATE TABLE IF NOT EXISTS assemblies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assembly_number VARCHAR(50) UNIQUE NOT NULL, -- 'ASM-00001'
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    finished_variant_id UUID NOT NULL REFERENCES product_variants(id),
    finished_quantity NUMERIC(15,4) NOT NULL,
    total_cost NUMERIC(15,4) DEFAULT 0,
    unit_finished_cost NUMERIC(15,4) DEFAULT 0,
    assembly_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(50) DEFAULT 'Draft',          -- 'Draft', 'Confirmed', 'Cancelled'
    created_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assembly_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assembly_id UUID NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
    component_variant_id UUID NOT NULL REFERENCES product_variants(id),
    quantity_consumed NUMERIC(15,4) NOT NULL,
    unit_id UUID REFERENCES units(id),
    unit_cost NUMERIC(15,4) DEFAULT 0,
    total_cost NUMERIC(15,4) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS disassemblies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    disassembly_number VARCHAR(50) UNIQUE NOT NULL, -- 'DIS-00001'
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    finished_variant_id UUID NOT NULL REFERENCES product_variants(id),
    finished_quantity NUMERIC(15,4) NOT NULL,
    disassembly_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(50) DEFAULT 'Draft',             -- 'Draft', 'Confirmed', 'Cancelled'
    created_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disassembly_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    disassembly_id UUID NOT NULL REFERENCES disassemblies(id) ON DELETE CASCADE,
    component_variant_id UUID NOT NULL REFERENCES product_variants(id),
    quantity_restored NUMERIC(15,4) NOT NULL,
    unit_id UUID REFERENCES units(id),
    unit_cost NUMERIC(15,4) DEFAULT 0
);

-- 11. SALES ORDERS, DELIVERIES & INVOICES
CREATE TABLE IF NOT EXISTS sales_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number VARCHAR(50) UNIQUE NOT NULL, -- 'SO-00001'
    customer_party_id UUID NOT NULL REFERENCES parties(id),
    farm_id UUID REFERENCES customer_farms(id),
    deal_id UUID REFERENCES customer_deals(id),
    assigned_salesperson_id UUID REFERENCES profiles(id),
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    currency VARCHAR(10) DEFAULT 'PKR',
    subtotal NUMERIC(15,2) DEFAULT 0,
    discount_amount NUMERIC(15,2) DEFAULT 0,
    tax_amount NUMERIC(15,2) DEFAULT 0,
    total_amount NUMERIC(15,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'Draft', -- 'Draft', 'Confirmed', 'Partially Delivered', 'Delivered', 'Cancelled'
    created_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_order_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sales_order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    ordered_quantity NUMERIC(15,4) NOT NULL,
    delivered_quantity NUMERIC(15,4) DEFAULT 0,
    unit_id UUID REFERENCES units(id),
    unit_price NUMERIC(15,2) NOT NULL,
    discount_percent NUMERIC(5,2) DEFAULT 0,
    line_total NUMERIC(15,2) NOT NULL
);

-- DELIVERIES (Atomic Stock Deduction Document)
CREATE TABLE IF NOT EXISTS deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delivery_number VARCHAR(50) UNIQUE NOT NULL, -- 'DEL-00001'
    sales_order_id UUID REFERENCES sales_orders(id),
    customer_party_id UUID NOT NULL REFERENCES parties(id),
    farm_id UUID REFERENCES customer_farms(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
    vehicle_number VARCHAR(50),
    driver_name VARCHAR(100),
    driver_phone VARCHAR(50),
    status VARCHAR(50) DEFAULT 'Draft', -- 'Draft', 'Confirmed', 'Cancelled'
    created_by UUID REFERENCES profiles(id),
    confirmed_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
    sales_order_line_id UUID REFERENCES sales_order_lines(id),
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    delivered_quantity NUMERIC(15,4) NOT NULL,
    unit_id UUID REFERENCES units(id),
    notes TEXT
);

-- GATEPASS (Warehouse Operational Logistics Document)
CREATE TABLE IF NOT EXISTS gatepasses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gatepass_number VARCHAR(50) UNIQUE NOT NULL, -- 'GP-00001'
    sales_order_id UUID REFERENCES sales_orders(id),
    delivery_id UUID REFERENCES deliveries(id),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id),
    customer_party_id UUID NOT NULL REFERENCES parties(id),
    farm_id UUID REFERENCES customer_farms(id),
    assigned_salesperson_id UUID REFERENCES profiles(id),
    gatepass_date DATE NOT NULL DEFAULT CURRENT_DATE,
    vehicle_number VARCHAR(50),
    driver_name VARCHAR(100),
    driver_contact VARCHAR(50),
    status VARCHAR(50) DEFAULT 'Draft', -- 'Draft', 'Submitted', 'Assigned', 'Rates Pending', 'Ready for Invoice', 'Completed', 'Cancelled'
    created_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gatepass_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gatepass_id UUID NOT NULL REFERENCES gatepasses(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    quantity NUMERIC(15,4) NOT NULL,
    unit_id UUID REFERENCES units(id),
    negotiated_rate NUMERIC(15,2), -- Entered by Salesperson during Rates Pending workflow
    notes TEXT
);

-- SALES INVOICES (Financial Document - Does NOT Deduct Stock)
CREATE TABLE IF NOT EXISTS sales_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL, -- 'INV-00001'
    sales_order_id UUID REFERENCES sales_orders(id),
    delivery_id UUID REFERENCES deliveries(id),
    customer_party_id UUID NOT NULL REFERENCES parties(id),
    farm_id UUID REFERENCES customer_farms(id),
    deal_id UUID REFERENCES customer_deals(id),
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    currency VARCHAR(10) DEFAULT 'PKR',
    exchange_rate NUMERIC(15,4) DEFAULT 1.0,
    subtotal NUMERIC(15,2) DEFAULT 0,
    discount_amount NUMERIC(15,2) DEFAULT 0,
    tax_amount NUMERIC(15,2) DEFAULT 0,
    total_amount NUMERIC(15,2) DEFAULT 0,
    paid_amount NUMERIC(15,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'Draft', -- 'Draft', 'Confirmed', 'Partially Paid', 'Paid', 'Cancelled'
    created_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_invoice_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    quantity NUMERIC(15,4) NOT NULL,
    unit_id UUID REFERENCES units(id),
    unit_price NUMERIC(15,2) NOT NULL,
    discount_amount NUMERIC(15,2) DEFAULT 0,
    line_total NUMERIC(15,2) NOT NULL
);

-- 12. PURCHASING, IMPORT SHIPMENTS & LANDED COSTS
CREATE TABLE IF NOT EXISTS purchase_bills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bill_number VARCHAR(50) UNIQUE NOT NULL, -- 'PUR-00001'
    supplier_party_id UUID NOT NULL REFERENCES parties(id),
    bill_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE,
    currency VARCHAR(10) DEFAULT 'USD',
    exchange_rate NUMERIC(15,4) DEFAULT 280.0,
    subtotal NUMERIC(15,2) DEFAULT 0,
    tax_amount NUMERIC(15,2) DEFAULT 0,
    freight_amount NUMERIC(15,2) DEFAULT 0,
    total_amount NUMERIC(15,2) DEFAULT 0,
    paid_amount NUMERIC(15,2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Approved', 'Paid', 'Cancelled'
    created_by UUID REFERENCES profiles(id),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_bill_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_bill_id UUID NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES product_variants(id),
    quantity NUMERIC(15,4) NOT NULL,
    unit_id UUID REFERENCES units(id),
    unit_price NUMERIC(15,4) NOT NULL,
    line_total NUMERIC(15,4) NOT NULL
);

-- Import Shipments (FOB vs EXW)
CREATE TABLE IF NOT EXISTS import_shipments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_number VARCHAR(50) UNIQUE NOT NULL, -- 'IMP-00001'
    supplier_party_id UUID NOT NULL REFERENCES parties(id),
    shipping_term VARCHAR(10) NOT NULL,          -- 'FOB', 'EXW'
    origin_country VARCHAR(100) DEFAULT 'China',
    origin_port VARCHAR(100),                    -- 'Ningbo', 'Qingdao', 'Shanghai'
    destination_port VARCHAR(100) DEFAULT 'Karachi Port',
    container_number VARCHAR(100),
    bl_number VARCHAR(100),                      -- Bill of Lading
    carrier_name VARCHAR(100),                   -- 'Maersk', 'COSCO', 'MSC'
    etd DATE,
    eta DATE,
    actual_arrival_date DATE,
    clearing_agent VARCHAR(100),
    tracking_provider VARCHAR(50) DEFAULT 'Tracktainer',
    tracking_number VARCHAR(100),
    tracking_mode VARCHAR(20) DEFAULT 'Manual',  -- 'Automatic', 'Manual', 'Disabled'
    current_status VARCHAR(100) DEFAULT 'In Transit',
    current_location VARCHAR(100),
    status VARCHAR(50) DEFAULT 'Draft',          -- 'Draft', 'Booked', 'Shipped', 'Customs Clearing', 'Delivered', 'Cancelled'
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipment_expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES import_shipments(id) ON DELETE CASCADE,
    expense_name VARCHAR(255) NOT NULL, -- 'International Ocean Freight', 'Import Duty & Customs', 'Clearing Charges', 'Port to Lahore Trucking'
    vendor_party_id UUID REFERENCES parties(id),
    amount_pkr NUMERIC(15,2) NOT NULL,
    is_landed_cost_eligible BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS landed_cost_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shipment_id UUID NOT NULL REFERENCES import_shipments(id) ON DELETE CASCADE,
    allocation_method VARCHAR(50) NOT NULL, -- 'Value', 'Quantity', 'Weight', 'Volume'
    total_landed_cost_pkr NUMERIC(15,2) NOT NULL,
    allocated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. DOUBLE-ENTRY ACCOUNTING & BANKING
CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id),
    account_code VARCHAR(50) UNIQUE NOT NULL, -- e.g. '1001-01'
    name VARCHAR(255) NOT NULL,
    account_type VARCHAR(50) NOT NULL,       -- 'Asset', 'Liability', 'Equity', 'Income', 'Expense'
    level INTEGER NOT NULL DEFAULT 1,         -- 1 to 4
    parent_account_id UUID REFERENCES chart_of_accounts(id),
    is_reconciliation_account BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_number VARCHAR(50) UNIQUE NOT NULL, -- 'JE-00001'
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    reference_type VARCHAR(50),               -- 'sales_invoice', 'purchase_bill', 'payment', 'receipt', 'adjustment'
    reference_id UUID,
    memo TEXT,
    is_posted BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
    party_id UUID REFERENCES parties(id),
    debit NUMERIC(15,2) NOT NULL DEFAULT 0,
    credit NUMERIC(15,2) NOT NULL DEFAULT 0,
    description TEXT
);

-- Bank Accounts & Statements
CREATE TABLE IF NOT EXISTS bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id),
    account_name VARCHAR(255) NOT NULL, -- e.g. 'Meezan Bank - Main Commercial Account'
    bank_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(100) NOT NULL,
    iban VARCHAR(100),
    currency VARCHAR(10) DEFAULT 'PKR',
    gl_account_id UUID REFERENCES chart_of_accounts(id),
    current_balance NUMERIC(15,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. COMMON ATTACHMENTS, TAGS, CUSTOM FIELDS, NOTIFICATIONS
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    color VARCHAR(20) DEFAULT '#138FCB'
);

CREATE TABLE IF NOT EXISTS tag_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL, -- 'customer', 'supplier', 'product', 'invoice'
    entity_id UUID NOT NULL,
    UNIQUE(tag_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS custom_field_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module VARCHAR(50) NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    field_label VARCHAR(100) NOT NULL,
    field_type VARCHAR(50) NOT NULL, -- 'text', 'number', 'date', 'select'
    options JSONB,
    UNIQUE(module, field_name)
);

CREATE TABLE IF NOT EXISTS custom_field_values (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    definition_id UUID NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL,
    field_value TEXT,
    UNIQUE(definition_id, entity_id)
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) DEFAULT 'info', -- 'info', 'warning', 'success', 'error'
    link_url TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_stock_movements_wh ON stock_movements(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_movement_lines_variant ON stock_movement_lines(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_balances_wh_var ON stock_balances(warehouse_id, variant_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(customer_party_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_order ON deliveries(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_gatepasses_wh ON gatepasses(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON sales_invoices(customer_party_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);
