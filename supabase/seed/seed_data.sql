-- ============================================================================
-- JS TRADERS ERP - SEED DATA SCRIPT
-- ============================================================================

-- 1. Company
INSERT INTO companies (id, code, name, legal_name, base_currency, phone, email, address)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'JST-PK',
    'JS Traders',
    'JS Traders Poultry Equipment & Automation Private Ltd',
    'PKR',
    '+92 42 35789123',
    'info@jstraders.pk',
    'Plot 45-B, Industrial Estate, Multan Road, Lahore, Pakistan'
) ON CONFLICT DO NOTHING;

-- 2. Warehouses
INSERT INTO warehouses (id, company_id, code, name, address, city, contact_person, phone)
VALUES
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'WH-LHR-01', 'Main Warehouse Lahore', 'Plot 45-B Industrial Area, Lahore', 'Lahore', 'Tariq Mehmood', '+92 300 1234567'),
    ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'WH-KHI-01', 'Transit Warehouse Karachi', 'Port Qasim Logistics Park, Karachi', 'Karachi', 'Faisal Qureshi', '+92 321 7654321'),
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'WH-GRW-01', 'Showroom Gujranwala', 'GT Road Bypass, Gujranwala', 'Gujranwala', 'Rizwan Ahmed', '+92 333 9876543')
ON CONFLICT DO NOTHING;

-- Warehouse Locations
INSERT INTO warehouse_locations (id, warehouse_id, code, name, description)
VALUES
    ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'RACK-A1', 'Rack A1 - Heavy Hardware', 'Main rack for motors and pan assemblies'),
    ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'RACK-B2', 'Rack B2 - Nipples & Small Parts', 'Plastic drinking nipples and connectors'),
    ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'YARD-01', 'Open Yard - Pipes & Steel', 'Auger pipes, galvanized tubes, rolls')
ON CONFLICT DO NOTHING;

-- 3. Unit Categories & Units
INSERT INTO unit_categories (id, name) VALUES
    ('d0000000-0000-0000-0000-000000000001', 'Quantity'),
    ('d0000000-0000-0000-0000-000000000002', 'Length'),
    ('d0000000-0000-0000-0000-000000000003', 'Packaging')
ON CONFLICT DO NOTHING;

INSERT INTO units (id, category_id, code, name, symbol) VALUES
    ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'PCS', 'Piece', 'pc'),
    ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', 'CTN', 'Carton', 'ctn'),
    ('e0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', 'BOX', 'Box', 'box'),
    ('e0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000002', 'FT', 'Feet', 'ft'),
    ('e0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000002', 'MTR', 'Meter', 'm'),
    ('e0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000003', 'ROLL', 'Roll', 'roll'),
    ('e0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000001', 'SET', 'Complete Set', 'set')
ON CONFLICT DO NOTHING;

-- 4. Product Categories
INSERT INTO product_categories (id, category_code, name, description) VALUES
    ('f0000000-0000-0000-0000-000000000001', 'CAT-FEED', 'Feeding Equipment', 'Pan feeders, augers, hoppers, drive units'),
    ('f0000000-0000-0000-0000-000000000002', 'CAT-DRINK', 'Drinking Equipment', 'Nipple drinker lines, pressure regulators, flush systems'),
    ('f0000000-0000-0000-0000-000000000003', 'CAT-VENT', 'Ventilation & Fans', 'Exhaust cone fans, air inlets, circulation fans'),
    ('f0000000-0000-0000-0000-000000000004', 'CAT-COOL', 'Evaporative Cooling', 'Cellulose cooling pads, water pumps, gutter systems'),
    ('f0000000-0000-0000-0000-000000000005', 'CAT-ELEC', 'Climate Automation & Electrical', 'Microprocessor shed controllers, sensory panels, cable harness'),
    ('f0000000-0000-0000-0000-000000000006', 'CAT-PIPE', 'Pipes & Fittings', 'Galvanized feeder pipes, PVC water lines, winching cables')
ON CONFLICT DO NOTHING;

-- 5. Dynamic Attribute Definitions & Values
INSERT INTO attribute_definitions (id, name, data_type) VALUES
    ('a1000000-0000-0000-0000-000000000001', 'Origin', 'text'),
    ('a1000000-0000-0000-0000-000000000002', 'Material', 'text'),
    ('a1000000-0000-0000-0000-000000000003', 'Size', 'text')
ON CONFLICT DO NOTHING;

INSERT INTO attribute_values (id, attribute_id, value) VALUES
    ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'China'),
    ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Pakistan'),
    ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002', 'Virgin Polypropylene'),
    ('a2000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002', 'Galvanized Steel 275g'),
    ('a2000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000003', '14-inch (330mm)'),
    ('a2000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000003', '16-inch (400mm)')
ON CONFLICT DO NOTHING;
