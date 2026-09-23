-- ============================================================================
-- JS TRADERS ERP - ASSEMBLY, DISASSEMBLY & BUNDLE SYSTEMS MIGRATION
-- Database: PostgreSQL 14+ / Supabase
-- Description: Schema definitions for Assembly Manufacturing, BOM Recipes,
--              Standalone Disassembly/Breakdown, Assembly Labor Payables & Settlement,
--              and Decoupled Bundle Systems (Fixed Sets & Variable Rules).
-- ============================================================================

-- 1. ASSEMBLY RECIPES (BOM MASTER)
CREATE TABLE IF NOT EXISTS assembly_recipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    recipe_number VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    assembly_type VARCHAR(50) DEFAULT 'MANUFACTURING' CHECK (assembly_type IN ('MANUFACTURING', 'FINISHING')),
    finished_variant_id UUID REFERENCES product_variants(id) ON DELETE RESTRICT,
    default_output_quantity NUMERIC(15, 4) DEFAULT 1,
    default_labor_rate NUMERIC(15, 2) DEFAULT 0,
    labor_rate_type VARCHAR(50) DEFAULT 'per_unit' CHECK (labor_rate_type IN ('per_unit', 'fixed')),
    default_labor_party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    default_source_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    default_output_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assembly_recipe_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipe_id UUID NOT NULL REFERENCES assembly_recipes(id) ON DELETE CASCADE,
    component_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity_per_unit NUMERIC(15, 4) NOT NULL CHECK (quantity_per_unit > 0),
    sequence INT DEFAULT 1,
    unit VARCHAR(20) DEFAULT 'PCS',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recipe_finished_variant ON assembly_recipes(finished_variant_id);
CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe ON assembly_recipe_items(recipe_id);

-- 2. ASSEMBLY ORDERS (PRODUCTION TRANSACTIONS)
CREATE TABLE IF NOT EXISTS assemblies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    assembly_number VARCHAR(50) UNIQUE NOT NULL,
    assembly_date DATE NOT NULL DEFAULT CURRENT_DATE,
    assembly_type VARCHAR(50) DEFAULT 'MANUFACTURING' CHECK (assembly_type IN ('MANUFACTURING', 'FINISHING')),
    recipe_id UUID REFERENCES assembly_recipes(id) ON DELETE SET NULL,
    finished_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    finished_quantity NUMERIC(15, 4) NOT NULL CHECK (finished_quantity > 0),
    source_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    output_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    total_material_cost NUMERIC(15, 2) DEFAULT 0,
    labor_rate NUMERIC(15, 2) DEFAULT 0,
    total_labor_cost NUMERIC(15, 2) DEFAULT 0,
    total_assembly_cost NUMERIC(15, 2) DEFAULT 0,
    unit_finished_cost NUMERIC(15, 2) DEFAULT 0,
    labor_party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
    labor_payable_id UUID,
    journal_entry_id UUID,
    status VARCHAR(50) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Completed', 'Reversed', 'Cancelled')),
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reversed_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reversal_reason TEXT,
    notes TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assembly_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assembly_id UUID NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
    component_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity_consumed NUMERIC(15, 4) NOT NULL CHECK (quantity_consumed > 0),
    unit_cost NUMERIC(15, 2) DEFAULT 0,
    total_cost NUMERIC(15, 2) DEFAULT 0,
    unit VARCHAR(20) DEFAULT 'PCS',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assemblies_status ON assemblies(status);
CREATE INDEX IF NOT EXISTS idx_assemblies_finished_variant ON assemblies(finished_variant_id);
CREATE INDEX IF NOT EXISTS idx_assembly_items_assembly ON assembly_items(assembly_id);

-- 3. ASSEMBLY LABOR PAYABLES & SETTLEMENTS
CREATE TABLE IF NOT EXISTS assembly_payables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    payable_number VARCHAR(50) UNIQUE NOT NULL,
    assembly_id UUID NOT NULL REFERENCES assemblies(id) ON DELETE RESTRICT,
    labor_party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    payable_amount NUMERIC(15, 2) NOT NULL CHECK (payable_amount >= 0),
    paid_amount NUMERIC(15, 2) DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_balance NUMERIC(15, 2) NOT NULL CHECK (remaining_balance >= 0),
    status VARCHAR(50) DEFAULT 'Unpaid' CHECK (status IN ('Unpaid', 'Partially Paid', 'Paid', 'Reversed')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assembly_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    payment_number VARCHAR(50) UNIQUE NOT NULL,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    labor_party_id UUID NOT NULL REFERENCES parties(id) ON DELETE RESTRICT,
    total_amount NUMERIC(15, 2) NOT NULL CHECK (total_amount > 0),
    payment_mode VARCHAR(50) DEFAULT 'FIFO_BALANCE' CHECK (payment_mode IN ('FIFO_BALANCE', 'SPECIFIC_ASSEMBLIES')),
    payment_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
    journal_entry_id UUID,
    notes TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assembly_payment_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES assembly_payments(id) ON DELETE CASCADE,
    payable_id UUID NOT NULL REFERENCES assembly_payables(id) ON DELETE RESTRICT,
    allocated_amount NUMERIC(15, 2) NOT NULL CHECK (allocated_amount > 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payables_party ON assembly_payables(labor_party_id);
CREATE INDEX IF NOT EXISTS idx_payables_assembly ON assembly_payables(assembly_id);
CREATE INDEX IF NOT EXISTS idx_payments_party ON assembly_payments(labor_party_id);
CREATE INDEX IF NOT EXISTS idx_allocations_payable ON assembly_payment_allocations(payable_id);

-- 4. DISASSEMBLY & BREAKDOWN MODULE (ANY ITEM TEARDOWN)
CREATE TABLE IF NOT EXISTS disassembly_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    template_number VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    source_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disassembly_template_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES disassembly_templates(id) ON DELETE CASCADE,
    component_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    default_recovery_ratio NUMERIC(15, 4) DEFAULT 1,
    cost_allocation_percentage NUMERIC(5, 2) DEFAULT 0,
    unit VARCHAR(20) DEFAULT 'PCS',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disassemblies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    disassembly_number VARCHAR(50) UNIQUE NOT NULL,
    disassembly_date DATE NOT NULL DEFAULT CURRENT_DATE,
    template_id UUID REFERENCES disassembly_templates(id) ON DELETE SET NULL,
    source_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    disassembled_quantity NUMERIC(15, 4) NOT NULL CHECK (disassembled_quantity > 0),
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
    total_source_cost NUMERIC(15, 2) DEFAULT 0,
    total_recovered_value NUMERIC(15, 2) DEFAULT 0,
    variance_amount NUMERIC(15, 2) DEFAULT 0,
    journal_entry_id UUID,
    status VARCHAR(50) DEFAULT 'Completed' CHECK (status IN ('Draft', 'Completed', 'Reversed')),
    completed_at TIMESTAMPTZ DEFAULT NOW(),
    reversed_at TIMESTAMPTZ,
    reversed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reversal_reason TEXT,
    notes TEXT,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS disassembly_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    disassembly_id UUID NOT NULL REFERENCES disassemblies(id) ON DELETE CASCADE,
    component_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    quantity_recovered NUMERIC(15, 4) NOT NULL CHECK (quantity_recovered > 0),
    unit_cost NUMERIC(15, 2) DEFAULT 0,
    total_value NUMERIC(15, 2) DEFAULT 0,
    unit VARCHAR(20) DEFAULT 'PCS',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disassemblies_source ON disassemblies(source_variant_id);
CREATE INDEX IF NOT EXISTS idx_disassembly_items_dis ON disassembly_items(disassembly_id);

-- 5. BUNDLE DEFINITIONS & RULES (DECOUPLED FROM PRODUCT MASTER)
CREATE TABLE IF NOT EXISTS bundle_definitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    bundle_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    bundle_type VARCHAR(50) NOT NULL CHECK (bundle_type IN ('FIXED_SET', 'VARIABLE_SYSTEM')),
    commercial_variant_id UUID REFERENCES product_variants(id) ON DELETE RESTRICT,
    pricing_rule VARCHAR(50) DEFAULT 'fixed_bundle_price' CHECK (pricing_rule IN ('fixed_bundle_price', 'sum_of_components', 'custom')),
    base_unit VARCHAR(50) DEFAULT 'Line',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bundle_components (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bundle_id UUID NOT NULL REFERENCES bundle_definitions(id) ON DELETE CASCADE,
    component_variant_id UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
    rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN ('PER_LINE', 'FIXED_QTY', 'PER_GROUP_CEIL', 'PER_GROUP_FLOOR', 'MANUAL')),
    base_factor NUMERIC(15, 4) NOT NULL DEFAULT 1,
    group_size NUMERIC(15, 4),
    sequence INT DEFAULT 1,
    allow_extra BOOLEAN DEFAULT TRUE,
    unit VARCHAR(20) DEFAULT 'PCS',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bundle_code ON bundle_definitions(bundle_code);
CREATE INDEX IF NOT EXISTS idx_bundle_components_bundle ON bundle_components(bundle_id);
