/**
 * Printable document in a new window (GDN / invoice / vouchers …). Plain HTML so it prints the same on any printer.
 * The company's document template (Settings → Documents) decides the layout; the screen supplies the values.
 */
import { applyTemplate, loadTemplate, renderHtml, templateCompany, type PrintSpecBase } from "../documents/template";

export type PrintSpec = PrintSpecBase;

/**
 * opts.preview: show the page with a Print / Close bar instead of printing at once.
 * opts.prepare: build the final spec after the window is open (e.g. photos that take a moment to load).
 */
export function printDocument(p: PrintSpec, opts: { preview?: boolean; prepare?: () => Promise<PrintSpec> } = {}) {
  // open synchronously (inside the click) so pop-up blockers allow it, then fill it in
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><title>${p.docNo}</title></head><body style="font-family:system-ui;color:#666;padding:40px">Preparing ${p.docNo}…</body></html>`);
  void (async () => {
    let spec = p;
    try { if (opts.prepare) spec = await opts.prepare(); }
    catch (e) { console.error(e); }
    const t = await loadTemplate(templateCompany(), spec.docType);
    w.document.open();
    w.document.write(renderHtml(applyTemplate(spec, t), opts.preview ? { toolbar: true } : { autoPrint: true }));
    w.document.close();
  })();
  return true;
}
