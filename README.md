# JS Traders ERP - Poultry Equipment & Automation System

A multi-portal enterprise resource planning (ERP), inventory management, and financial accounting platform built for **JS Traders** (Poultry Equipment & Automation).

---

## 🏛️ Ecosystem Portals (5 Dedicated Portals)

The application implements a **3-Tier Interaction Model** (App Shell SPA with client-side hash routing, slide-over drawers for contextual inspection, and centered dialogs for quick atomic tasks) across 5 specialized portals:

| Portal | File | Target Audience | Primary Focus | Cost Visibility |
| :--- | :--- | :--- | :--- | :--- |
| **1. Main ERP** | [`index.html`](index.html) | Owner, Accountant, Admin | Chart of Accounts, Journal Entries, Banking Reconciliation, Sales Invoicing, Purchase Bills, Full Profit Margins | ✅ Full (Cost & Profit) |
| **2. Warehouse Portal** | [`warehouse.html`](warehouse.html) | Warehouse Manager & Supervisors | Multi-Facility Stock Balances, Gatepass Issuance, Cargo Deliveries, Assembly/Disassembly, Adjustments | 🔒 **Strictly Redacted** |
| **3. Staff Mobile App** | [`Staff.html`](Staff.html) | Warehouse & Office Floor Staff | Real-Time Pick Tasks, Camera Barcode Scanner, Delivery Sign-off, Screen Wake-Lock, Loud Siren Alerts | 🔒 **Strictly Redacted** |
| **4. Sales Person App** | [`sales.html`](sales.html) | Field Sales Representatives | Assigned Customer Ledgers, Multi-Warehouse Stock Quantities (Retail rates only), Field Order Booking | 🔒 **Supplier Costs Hidden** |
| **5. Management Reports** | [`management-report.html`](management-report.html) | Executive Leadership & Owner | All Customer Ledgers & Aging Analysis, Total Stock Valuation, Import Container Shipments & Tracking | ✅ Full Executive Visibility |

---

## 🚀 Key Features

* **Client-Side Hash Routing:** Deep linking across modules (`#/inventory/products`, `#/sales/orders`, `#/warehouse-gatepasses`) with full browser history support.
* **Contextual Slide-Over Drawer (`components/drawer.js`):** Inspect SKU balances across warehouses or customer ledgers without losing table scroll positions.
* **Universal Portal Switcher:** Seamless one-click modal launcher to switch between all 5 portals from any page.
* **Cost & Margin Isolation:** Role-based UI masking ensuring warehouse and field staff never see supplier purchase prices.
* **Offline-Ready PWA:** Service worker (`sw.js`) and audio alert engine (`utils/soundAlert.js`) for noisy warehouse floors.

---

## 🛠️ Tech Stack

* **Frontend:** Vanilla JavaScript (ES Modules), Tailwind CSS v3/v4, Google Fonts (Plus Jakarta Sans & Inter)
* **Storage & Database:** Supabase Client (`services/supabaseClient.js`) with LocalStorage reactive cache fallback (`services/storageService.js`)
* **Hardware Integrations:** HTML5 Barcode/QR Scanner, Screen WakeLock API, Web Audio synthesizer alerts

---

## 💻 Local Quick Start

Run a local HTTP server:
```bash
# Using Node.js
node server.js

# Or using Python
python -m http.server 8080
```
Open in browser:
* Main ERP: `http://localhost:8080/index.html`
* Warehouse Portal: `http://localhost:8080/warehouse.html`
* Staff Mobile App: `http://localhost:8080/Staff.html`
* Salesperson Portal: `http://localhost:8080/sales.html`
* Management Reports: `http://localhost:8080/management-report.html`
