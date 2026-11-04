/** "Save as PDF" + "WhatsApp" for any printed document (invoice, quotation …) — same file as the printout. */
import * as React from "react";
import { toast } from "sonner";
import { FileDown, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@jst/ui";
import { friendlyError } from "@jst/data-access";
import { buildPdf, downloadBlob, openWhatsApp, pdfFileName, sendPdfToWhatsApp, type PdfSpec } from "./pdf";

const mb = (b: Blob) => (b.size >= 1_000_000 ? `${(b.size / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(b.size / 1000))} KB`);

export function ShareButtons({ spec, docNo, customerName, phone, message, disabled }: {
  /** the same spec the Print button uses (may load data first) */ spec: () => PdfSpec | Promise<PdfSpec>;
  docNo: string; customerName?: string | null; phone?: string | null; message: string; disabled?: boolean;
}) {
  const [busy, setBusy] = React.useState<null | "pdf" | "wa">(null);
  const fileName = pdfFileName(docNo, customerName);
  const toPdf = async () => {
    setBusy("pdf");
    try { const blob = await buildPdf(await spec()); downloadBlob(blob, fileName); toast.success(`Saved ${fileName} (${mb(blob)}) to your Downloads`); }
    catch (e) { toast.error(`PDF not made: ${friendlyError(e)}`); }
    finally { setBusy(null); }
  };
  const toWhatsApp = async () => {
    setBusy("wa");
    try {
      const s = await spec();
      const blob = await buildPdf(s);
      const r = await sendPdfToWhatsApp(s, fileName, phone ?? null, message, false, blob);
      if (r === "opened") {
        toast.success(`PDF saved to Downloads (${fileName}). WhatsApp is opening${phone ? ` on ${customerName ?? "the customer"}'s chat` : ""} — drag the PDF into the chat or attach it with the 📎, then send.`, {
          duration: 12000, action: { label: "Use WhatsApp Web", onClick: () => openWhatsApp(phone ?? null, message, true) },
        });
        if (!phone) toast.info("This customer has no phone / WhatsApp number — choose the chat in WhatsApp. Add the number on the customer to open the chat directly next time.");
      }
    } catch (e) { toast.error(`Not sent: ${friendlyError(e)}`); }
    finally { setBusy(null); }
  };
  return (
    <>
      <Button icon={busy === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />} disabled={!!busy || disabled} onClick={() => void toPdf()}>Save as PDF</Button>
      <Button className="border-[#25D366] text-[#128C7E] hover:bg-[#25D366]/10" title={phone ? `Send to ${customerName ?? ""} (${phone}) on WhatsApp` : "Send on WhatsApp"}
        icon={busy === "wa" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageCircle className="h-3.5 w-3.5" />} disabled={!!busy || disabled} onClick={() => void toWhatsApp()}>WhatsApp</Button>
    </>
  );
}
