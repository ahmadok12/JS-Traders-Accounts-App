# JS Traders ERP - Integration Contract & Architectural Specification
## Phase 1 Warehouse & Inventory Subsystem to Central Double-Entry ERP

**Document Version**: 1.0.0  
**Status**: Authoritative Architectural Contract  
**Target Organization**: JS Traders (Poultry Equipment Trading & Assembly, Pakistan)  
**Database Schema**: Normalized PostgreSQL (Supabase Compatible)  
**Frontend Architecture**: Vanilla JavaScript ES Modules, Reactive In-Memory Bus, Responsive Tailwind CSS  

---

## 1. Executive Summary & Foundational Principles

The **Phase 1 Warehouse & Inventory Management System** is designed not as an isolated silo, but as the **authoritative operational core** of the full double-entry ERP for JS Traders.

### Cardinal Architectural Rules:
1. **Single Source of Truth**: There is only one canonical data definition for Products, Variants, Units, Warehouses, Storage Locations, and Stock Movements. The ERP never duplicates inventory records.
2. **Movements-Only Authoritative Stock**: Physical stock is never directly incremented or decremented via raw numbers on product records. All stock balances are derived strictly from immutable, verified records in `stock_movements`.
3. **Invoices NEVER Move Stock**: Sales Invoices create legal accounting receivables and financial turnover; they **never** adjust physical warehouse stock. Physical warehouse stock is modified exclusively by confirmed `deliveries` (outward) or verified `goods_received_notes` (inward).
4. **Strict Cost Redaction**: Operational roles (Warehouse Staff, Gate Security, Field Technicians) have `viewCostProfit: false`. All purchase costs, landed costs, moving average costs, and total stock valuations are cryptographically or procedurally redacted before rendering.
5. **Roll / Length Segregation**: Continuous equipment (nipple drinking pipes, environmental curtain rolls) maintains discrete roll identity (`roll_tracking`), tracking original length and remaining footage to prevent fractional mismatch.

---

## 2. Canonical Shared Entities Matrix

| Entity | Canonical Table | Primary Key | Foreign Keys | Authoritative Owner | ERP Consumption Scope |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Product Category** | `product_categories` | `id` (UUID) | `parent_id` | Phase 1 Inventory | Cataloging, Financial reporting by category |
| **Product Master** | `products` | `id` (UUID) | `category_id`, `base_unit_id` | Phase 1 Inventory | Quotations, Sales Orders, Supplier Pricing |
| **Product Variant / SKU** | `product_variants` | `id` (UUID) | `product_id`, `unit_id` | Phase 1 Inventory | Order Lines, Landed Cost Lines, COGS Calculation |
| **Unit of Measure** | `units_of_measure` | `id` (UUID) | None | Phase 1 Settings | Billing Units, Dimension Conversion, Weight checks |
| **Warehouse** | `warehouses` | `id` (UUID) | None | Phase 1 Warehouse | Profit Center Branching, Delivery Points |
| **Storage Location** | `warehouse_locations` | `id` (UUID) | `warehouse_id` | Phase 1 Warehouse | Pick Lists, Bin allocation, Yard staging |
| **Stock Movement** | `stock_movements` | `id` (UUID) | `warehouse_id`, `created_by` | Phase 1 Stock Engine | Stock Valuation, General Ledger Postings |
| **Stock Movement Line** | `stock_movement_lines`| `id` (UUID) | `movement_id`, `variant_id` | Phase 1 Stock Engine | Valuation detail, Roll cuts, Component traces |
| **Stock Balance Cache**| `stock_balances` | `id` (UUID) | `warehouse_id`, `variant_id` | Phase 1 Computed Cache | Order Availability Checks, Fast Reorder Thresholds |
| **Gatepass** | `gatepasses` | `id` (UUID) | `warehouse_id`, `assigned_salesperson_id` | Phase 1 Logistics | Vehicle Security, Gate exit audit, Transit tracking |
| **Delivery Note** | `deliveries` | `id` (UUID) | `sales_order_id`, `warehouse_id` | Phase 1 Warehouse | Invoicing match (3-way check), COGS posting |
| **Assembly / BOM** | `assemblies` | `id` (UUID) | `warehouse_id`, `finished_variant_id` | Phase 1 Assembly | Production Work Orders, Manufacturing Costing |

---

## 3. Stock Movement Engine Integration Contract

### Stored Procedure & Method Contract: `postStockMovement()`

Whenever any operational or future module modifies physical inventory, it must invoke the central engine:

```typescript
interface StockMovementPayload {
  movementType: 
    | 'opening_balance'
    | 'purchase_receipt'
    | 'delivery'
    | 'delivery_return'
    | 'transfer_out'
    | 'transfer_in'
    | 'adjustment_increase'
    | 'adjustment_decrease'
    | 'assembly_consumption'
    | 'assembly_output'
    | 'disassembly_consumption'
    | 'disassembly_output'
    | 'damage_write_off';
  referenceDocType: 'delivery' | 'purchase_bill' | 'import_shipment' | 'assembly' | 'adjustment' | 'manual';
  referenceDocId: string; // UUID of triggering operational document
  warehouseId: string;    // Target warehouse UUID
  lines: Array<{
    variantId: string;
    quantity: number;     // POSITIVE for INWARD, NEGATIVE for OUTWARD
    unitRate: number;     // Purchase / Valuation rate per unit in PKR
    rollId?: string;      // Optional specific roll identity
    notes?: string;
  }>;
  notes?: string;
  userId: string;
}
```

### Inviolable Invariant Rules:
1. **Negative Stock Enforcement**: If `variant.negativeStockSetting === 'disallow'`, the engine calculates `currentBalance + line.quantity`. If result `< 0`, transaction **aborts with a hard exception**.
2. **Moving Average Cost (MAC)**:
   $$\text{New Average Cost} = \frac{(\text{Old Qty} \times \text{Old MAC}) + (\text{Inward Qty} \times \text{Inward Rate})}{\text{Old Qty} + \text{Inward Qty}}$$
   *Outward movements do NOT change the moving average cost; they consume inventory at the current average cost.*

---

## 4. Module Consumption Specifications

### 4.1 Deliveries & Gatepass (Logistics Engine)
- **Trigger**: Warehouse Manager clicks **Confirm Delivery**.
- **Action**:
  1. Compares delivery line quantities against the parent `sales_orders.lines.remainingDeliveryQty`.
  2. Invokes `postStockMovement()` with `movementType: 'delivery'`, deducting quantities from the specified warehouse.
  3. Updates delivery status to `confirmed`.
  4. Generates a verifiable `gatepasses` document linked to the delivery, recording driver name, vehicle CNIC, and assigned salesperson.
- **Reversal Safety**: If a delivery is cancelled prior to gate departure, `movementType: 'delivery_return'` restores the exact deducted inventory.

### 4.2 Invoicing & Accounts Receivable (Financial ERP)
- **Decoupled Architecture**: Invoices reflect financial debt; Deliveries reflect physical movement.
- **Validation Rule**: An invoice may reference one or more `deliveries` (Proof of Delivery matching) or be issued as an advance proforma.
- **Financial Postings**:
  - `Debit`: 11000 - Accounts Receivable (Customer Ledger)
  - `Credit`: 41000 - Sales Revenue (Poultry Equipment Sales)
- **Stock Guard**: The invoicing function **never calls** `postStockMovement()`.

### 4.3 Purchasing, Import Shipments & Landed Cost
- **Workflow**:
  1. Purchase Order placed with international equipment supplier (USD / RMB / EUR).
  2. Import Shipment created (`tracking_number`, `vessel_name`, `bl_number`, `customs_gd_number`).
  3. Landed Cost Worksheet absorbs all incidental expenses (Ocean Freight, Marine Insurance, Customs Duty, Port Demurrage, Inland Trucking).
  4. Incidental expenses are distributed across variant lines using either **Weight-based** or **Value-based** apportionment.
  5. Upon arrival at warehouse, Goods Receipt Note triggers `postStockMovement()` with `movementType: 'purchase_receipt'`, passing the calculated **Landed Cost Per Unit** as `unitRate`.

### 4.4 Assembly & Disassembly (Flexible BOM)
- **Flexible Bill of Materials**:
  - Does not lock the user into rigid multi-level subassemblies.
  - Allows ad-hoc component adjustments during real-world assembly (e.g. replacing a 1.5 kW motor with a 2.0 kW motor due to stock availability).
- **Atomic Double-Movement**:
  1. Line 1: `movementType: 'assembly_consumption'` (Deducts components from warehouse stock).
  2. Line 2: `movementType: 'assembly_output'` (Increments finished equipment in warehouse stock with unit cost = $\sum$ component costs + overhead allocation).

### 4.5 Double-Entry Accounting Subledger Postings
When the accounting ledger synchronizes with inventory operations:

| Event | Debit Account | Credit Account | Rate Basis |
| :--- | :--- | :--- | :--- |
| **Inward Purchase** | `13000 - Inventory Asset` | `21000 - Accounts Payable` | Landed Cost Rate |
| **Delivery Outward** | `51000 - Cost of Goods Sold` | `13000 - Inventory Asset` | Moving Average Cost |
| **Adjustment Gain (+)** | `13000 - Inventory Asset` | `54000 - Stock Variance Gain` | Variant Cost Price |
| **Adjustment Loss (-)** | `54000 - Stock Variance Loss` | `13000 - Inventory Asset` | Moving Average Cost |
| **Assembly Build** | `13000 - Finished Goods Asset`| `13000 - Raw Components Asset`| Sum of Component Costs |

---

## 5. Security & Cost Guard Specification

To prevent sensitive import margins and supplier pricing from leaking to warehouse workers:

```javascript
// Applied in all inventory, stock by warehouse, and movement views
if (!authService.canViewCostProfit()) {
  row.costPrice = 'REDACTED';
  row.averageCost = 'REDACTED';
  row.stockValue = 'REDACTED';
}
```

The database schema reinforces this with Row Level Security (RLS) views in PostgreSQL:
- Operational roles query `v_operational_stock_balances` (omits `average_cost`).
- Financial roles query `v_financial_stock_balances` (includes full valuation).

---

## 6. Verification and Compliance Checklist

- [x] Canonical product tables referenced without duplicate schemas.
- [x] Normalized PostgreSQL tables with UUIDs and audit timestamps.
- [x] Zero-stock-deduction rule enforced for Sales Invoices.
- [x] Standalone operational workflows for Gatepass and Delivery.
- [x] Multi-warehouse matrix and rack-level storage bin management.
- [x] Full-screen layout with edge-to-edge desktop experience.
- [x] 100% local persistence and simulation engine ready for seamless backend pairing.
