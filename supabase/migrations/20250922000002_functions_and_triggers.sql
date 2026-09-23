-- ============================================================================
-- JS TRADERS ERP - FUNCTIONS, TRIGGERS & RLS POLICIES
-- ============================================================================

-- Function: Post Stock Movement & Update Stock Balance atomically
CREATE OR REPLACE FUNCTION post_stock_movement(
    p_movement_type VARCHAR,
    p_reference_doc_type VARCHAR,
    p_reference_doc_id UUID,
    p_warehouse_id UUID,
    p_user_id UUID,
    p_lines JSONB, -- Array of objects: {variant_id, location_id, quantity, unit_id, unit_rate, roll_id}
    p_notes TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_movement_id UUID;
    v_movement_num VARCHAR;
    v_line RECORD;
    v_curr_qty NUMERIC;
    v_curr_avg_cost NUMERIC;
    v_new_qty NUMERIC;
    v_new_avg_cost NUMERIC;
    v_neg_allowed VARCHAR;
    v_sys_neg_allowed BOOLEAN := FALSE;
BEGIN
    -- Generate movement number
    v_movement_num := 'MOV-' || LPAD(FLOOR(RANDOM()*1000000)::TEXT, 6, '0');

    -- Insert movement header
    INSERT INTO stock_movements (
        movement_number,
        movement_type,
        reference_document_type,
        reference_document_id,
        warehouse_id,
        movement_date,
        created_by,
        notes
    ) VALUES (
        v_movement_num,
        p_movement_type,
        p_reference_doc_type,
        p_reference_doc_id,
        p_warehouse_id,
        NOW(),
        p_user_id,
        p_notes
    ) RETURNING id INTO v_movement_id;

    -- Process lines
    FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
        variant_id UUID,
        location_id UUID,
        quantity NUMERIC,
        unit_id UUID,
        unit_rate NUMERIC,
        roll_id UUID,
        notes TEXT
    ) LOOP
        -- Negative stock verification for outgoing movements
        IF v_line.quantity < 0 THEN
            SELECT p.negative_stock_allowed, pv.negative_stock_setting
            INTO v_neg_allowed
            FROM product_variants pv
            JOIN products p ON pv.product_id = p.id
            WHERE pv.id = v_line.variant_id;

            -- Check current balance
            SELECT COALESCE(quantity, 0), COALESCE(average_cost, 0)
            INTO v_curr_qty, v_curr_avg_cost
            FROM stock_balances
            WHERE warehouse_id = p_warehouse_id AND variant_id = v_line.variant_id;

            IF (v_curr_qty + v_line.quantity) < 0 THEN
                IF v_neg_allowed = 'disallow' OR (v_neg_allowed = 'system_default' AND NOT v_sys_neg_allowed) THEN
                    RAISE EXCEPTION 'Insufficient stock in warehouse for variant %. Current: %, Requested: %',
                        v_line.variant_id, v_curr_qty, ABS(v_line.quantity);
                END IF;
            END IF;
        END IF;

        -- Insert movement line
        INSERT INTO stock_movement_lines (
            movement_id,
            variant_id,
            location_id,
            quantity,
            unit_id,
            unit_rate,
            total_cost,
            roll_id,
            notes
        ) VALUES (
            v_movement_id,
            v_line.variant_id,
            v_line.location_id,
            v_line.quantity,
            v_line.unit_id,
            COALESCE(v_line.unit_rate, 0),
            (v_line.quantity * COALESCE(v_line.unit_rate, 0)),
            v_line.roll_id,
            v_line.notes
        );

        -- Update or Insert stock_balances cache
        INSERT INTO stock_balances (warehouse_id, variant_id, quantity, average_cost, last_movement_at)
        VALUES (p_warehouse_id, v_line.variant_id, v_line.quantity, COALESCE(v_line.unit_rate, 0), NOW())
        ON CONFLICT (warehouse_id, variant_id) DO UPDATE
        SET quantity = stock_balances.quantity + EXCLUDED.quantity,
            average_cost = CASE
                WHEN (stock_balances.quantity + EXCLUDED.quantity) > 0 AND EXCLUDED.quantity > 0 THEN
                    ((stock_balances.quantity * stock_balances.average_cost) + (EXCLUDED.quantity * EXCLUDED.average_cost)) / (stock_balances.quantity + EXCLUDED.quantity)
                ELSE stock_balances.average_cost
            END,
            last_movement_at = NOW();

        -- If roll tracking is present, adjust physical roll remaining length
        IF v_line.roll_id IS NOT NULL THEN
            UPDATE physical_rolls
            SET remaining_length_feet = GREATEST(0, remaining_length_feet + v_line.quantity),
                is_full_roll = CASE WHEN (remaining_length_feet + v_line.quantity) >= initial_length_feet THEN TRUE ELSE FALSE END,
                updated_at = NOW()
            WHERE id = v_line.roll_id;
        END IF;
    END LOOP;

    RETURN v_movement_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Atomic Delivery Confirmation
CREATE OR REPLACE FUNCTION confirm_delivery(
    p_delivery_id UUID,
    p_user_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_delivery RECORD;
    v_line RECORD;
    v_movement_lines JSONB := '[]'::JSONB;
    v_so_line RECORD;
BEGIN
    SELECT * INTO v_delivery FROM deliveries WHERE id = p_delivery_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Delivery % not found', p_delivery_id;
    END IF;

    IF v_delivery.status = 'Confirmed' THEN
        RAISE EXCEPTION 'Delivery % is already confirmed', p_delivery_id;
    END IF;

    -- Validate remaining ordered quantities and build movement lines
    FOR v_line IN SELECT * FROM delivery_lines WHERE delivery_id = p_delivery_id LOOP
        IF v_line.sales_order_line_id IS NOT NULL THEN
            SELECT * INTO v_so_line FROM sales_order_lines WHERE id = v_line.sales_order_line_id;
            IF (v_so_line.delivered_quantity + v_line.delivered_quantity) > v_so_line.ordered_quantity THEN
                RAISE EXCEPTION 'Delivered quantity % exceeds remaining ordered quantity % for line %',
                    v_line.delivered_quantity, (v_so_line.ordered_quantity - v_so_line.delivered_quantity), v_line.id;
            END IF;

            -- Update sales_order_lines delivered quantity
            UPDATE sales_order_lines
            SET delivered_quantity = delivered_quantity + v_line.delivered_quantity
            WHERE id = v_line.sales_order_line_id;
        END IF;

        -- Negative quantity for stock deduction
        v_movement_lines := v_movement_lines || jsonb_build_object(
            'variant_id', v_line.variant_id,
            'quantity', -v_line.delivered_quantity,
            'unit_id', v_line.unit_id,
            'unit_rate', 0,
            'notes', 'Delivery ' || v_delivery.delivery_number
        );
    END LOOP;

    -- Post stock movement
    PERFORM post_stock_movement(
        'delivery',
        'delivery',
        v_delivery.id,
        v_delivery.warehouse_id,
        p_user_id,
        v_movement_lines,
        'Stock deduction for Delivery ' || v_delivery.delivery_number
    );

    -- Mark delivery confirmed
    UPDATE deliveries
    SET status = 'Confirmed',
        confirmed_by = p_user_id,
        updated_at = NOW()
    WHERE id = p_delivery_id;

    -- Update sales order status
    IF v_delivery.sales_order_id IS NOT NULL THEN
        UPDATE sales_orders
        SET status = CASE
            WHEN NOT EXISTS (
                SELECT 1 FROM sales_order_lines
                WHERE sales_order_id = v_delivery.sales_order_id AND delivered_quantity < ordered_quantity
            ) THEN 'Delivered'
            ELSE 'Partially Delivered'
        END,
        updated_at = NOW()
        WHERE id = v_delivery.sales_order_id;
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- RLS Security Policies
ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE gatepasses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;

-- User warehouse restriction policy
CREATE POLICY user_warehouse_isolation ON stock_balances
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM user_warehouse_assignments uwa
            WHERE uwa.warehouse_id = stock_balances.warehouse_id
            AND uwa.user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.code IN ('owner', 'admin')
        )
    );
