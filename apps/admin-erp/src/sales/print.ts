/**
 * Printable document in a new window (GDN / invoice / vouchers …). Plain HTML so it prints the same on any printer.
 * The company's document template (Settings → Documents) decides the layout; the screen supplies the values.
 */
import { applyTemplate, loadTemplate, renderHtml, templateCompany, type PrintSpecBase } from "../documents/template";

export type PrintSpec = PrintSpecBase;

export function printDocument(p: PrintSpec) {
  // open synchronously (inside the click) so pop-up blockers allow it, then fill it in
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><title>${p.docNo}</title></head><body style="font-family:system-ui;color:#666;padding:40px">Preparing ${p.docNo}…</body></html>`);
  void (async () => {
    const t = await loadTemplate(templateCompany(), p.docType);
    w.document.open();
    w.document.write(renderHtml(applyTemplate(p, t), { autoPrint: true }));
    w.document.close();
  })();
  return true;
}
