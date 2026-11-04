/**
 * Customer view of an invoice: items that came from a calculator package are folded into ONE row
 * ("Branch Feeding Line — 4 lines × price per line"), with the package discount already taken off.
 * Everything else prints as normal item rows. The money adds up to the same invoice total.
 */
export interface InvoicePackages {
  packages: { id: string; name: string; unit_label: string; quantity: number; billed: number; full: number; discount: number }[];
  parts: { line_no: number; package_id: string; qty: number }[];
}
export interface InvLineLite { line_no: number; label: string; quantity: number; uom: string; unit_price: number | null }
export interface PrintRow { kind: "package" | "item"; label: string; quantity: number; uom: string; unit_price: number | null; amount: number | null }

const r2 = (v: number) => Math.round(v * 100) / 100;

export function customerRows(lines: InvLineLite[], pk: InvoicePackages | null | undefined, invoiceDiscount: number, subtotal: number) {
  if (!pk || !pk.packages.length) {
    return {
      rows: lines.map((l): PrintRow => ({ kind: "item", label: l.label, quantity: l.quantity, uom: l.uom, unit_price: l.unit_price, amount: l.unit_price == null ? null : r2(l.quantity * l.unit_price) })),
      subtotal, discount: invoiceDiscount, packageDiscount: 0,
    };
  }
  // the part of each package discount that belongs to this invoice (never more than the invoice's discount)
  const share = new Map<string, number>();
  for (const p of pk.packages) share.set(p.id, r2(Number(p.discount) * (Number(p.full) > 0 ? Math.min(1, Number(p.billed) / Number(p.full)) : 1)));
  const wanted = [...share.values()].reduce((a, v) => a + v, 0);
  if (wanted > invoiceDiscount + 0.005 && wanted > 0) {
    const k = Math.max(0, invoiceDiscount) / wanted;
    for (const [id, v] of share) share.set(id, r2(v * k));
  }
  const pkgDisc = [...share.values()].reduce((a, v) => a + v, 0);

  const inPkg = new Map<number, number>();
  for (const x of pk.parts) inPkg.set(x.line_no, (inPkg.get(x.line_no) ?? 0) + Number(x.qty));
  const firstLine = new Map<string, number>();
  for (const x of pk.parts) firstLine.set(x.package_id, Math.min(firstLine.get(x.package_id) ?? Infinity, x.line_no));

  const rows: (PrintRow & { at: number })[] = [];
  for (const l of lines) {
    const rest = Math.round((l.quantity - (inPkg.get(l.line_no) ?? 0)) * 10000) / 10000;
    if (rest > 0) rows.push({ kind: "item", label: l.label, quantity: rest, uom: l.uom, unit_price: l.unit_price, amount: l.unit_price == null ? null : r2(rest * l.unit_price), at: l.line_no });
  }
  for (const p of pk.packages) {
    const frac = Number(p.full) > 0 ? Math.min(1, Number(p.billed) / Number(p.full)) : 1;
    const qty = Math.abs(frac - 1) < 1e-6 ? Number(p.quantity) : Math.round(Number(p.quantity) * frac * 100) / 100;
    const amount = r2(Number(p.billed) - (share.get(p.id) ?? 0));
    rows.push({ kind: "package", label: p.name, quantity: qty, uom: `${p.unit_label}${qty === 1 ? "" : "s"}`, unit_price: qty > 0 ? r2(amount / qty) : amount, amount, at: (firstLine.get(p.id) ?? 0) - 0.5 });
  }
  rows.sort((a, b) => a.at - b.at);
  return { rows: rows.map(({ at: _at, ...r }) => r), subtotal: r2(subtotal - pkgDisc), discount: r2(invoiceDiscount - pkgDisc), packageDiscount: pkgDisc };
}
