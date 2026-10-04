import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Download, ExternalLink, File, FileImage, FileSpreadsheet, FileText, Loader2, Paperclip, Trash2, UploadCloud } from "lucide-react";
import { Button, ConfirmDialog, Input, cn } from "@jst/ui";
import { friendlyError, sb, useAccess, useProfileNames } from "@jst/data-access";
import { P } from "@jst/permissions";
import { formatDateTime } from "@jst/utilities";

export type AttachmentEntity =
  | "journal_entries" | "sales_invoices" | "quotations" | "sales_orders" | "gdns" | "goods_receipts" | "stock_adjustments"
  | "stock_transfers" | "stock_counts" | "assembly_orders" | "reservation_orders" | "price_tasks" | "customers" | "suppliers" | "products" | "purchase_orders" | "supplier_bills" | "purchase_cost_tasks" | "shipments" | "landed_costs";

export interface Attachment {
  id: string; entity_type: string; entity_id: string; original_file_name: string; mime_type: string; file_size: number;
  description: string | null; uploaded_by: string | null; uploaded_at: string;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().functions.invoke("attachments", { body });
  if (error) {
    // the function answers { error } with a 4xx — surface that text
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const j = await ctx.json().catch(() => null) as { error?: string } | null;
      if (j?.error) throw new Error(j.error);
    }
    throw error;
  }
  return data as T;
}

export function useStorageReady() {
  return useQuery({
    queryKey: ["attachments-status"],
    staleTime: 10 * 60_000,
    queryFn: async () => (await call<{ configured: boolean }>({ action: "status" })).configured,
  });
}

export function useAttachments(entityType: AttachmentEntity, entityId: string | null | undefined) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["attachments", entityType, entityId],
    enabled: !!entityId,
    queryFn: async () => {
      const { data, error } = await sb().from("attachments")
        .select("id, entity_type, entity_id, original_file_name, mime_type, file_size, description, uploaded_by, uploaded_at")
        .eq("entity_type", entityType).eq("entity_id", entityId!).order("uploaded_at");
      if (error) throw error;
      return (data ?? []) as Attachment[];
    },
  });
  React.useEffect(() => {
    if (!entityId) return;
    const ch = sb().channel(`files-${entityId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "attachments", filter: `entity_id=eq.${entityId}` },
        () => qc.invalidateQueries({ queryKey: ["attachments", entityType, entityId] }))
      .subscribe();
    return () => { void sb().removeChannel(ch); };
  }, [entityType, entityId, qc]);
  return q;
}

/** Tab label helper: "Files (3)". */
export const filesLabel = (n: number | undefined) => `Files${n ? ` (${n})` : ""}`;

const humanSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const isImage = (m: string) => m.startsWith("image/");

/** Shrink phone photos before upload: longest side 1920 px, JPEG 82 %. Other files untouched. */
async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size < 350_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new window.File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export async function uploadAttachment(entityType: AttachmentEntity, entityId: string, original: File, description?: string) {
  const file = await shrink(original);
  const mime = file.type || "application/octet-stream";
  const b = await call<{ id: string; url: string }>({ action: "begin", entity_type: entityType, entity_id: entityId, file_name: file.name, mime, size: file.size, description: description || null });
  const put = await fetch(b.url, { method: "PUT", body: file, headers: { "Content-Type": mime } });
  if (!put.ok) throw new Error(`Upload failed (${put.status}) — check the R2 bucket CORS settings`);
  await call({ action: "confirm", id: b.id });
  return b.id;
}

export async function openAttachment(id: string, download = false) {
  // open the tab first (pop-up blockers), then point it at the signed link
  const win = download ? null : window.open("about:blank", "_blank");
  try {
    const r = await call<{ url: string }>({ action: "open", id, download });
    if (win) win.location.href = r.url;
    else window.location.href = r.url;
  } catch (e) {
    win?.close();
    toast.error(friendlyError(e));
  }
}

function Thumb({ a }: { a: Attachment }) {
  const img = isImage(a.mime_type);
  const link = useQuery({
    queryKey: ["attachment-thumb", a.id],
    enabled: img,
    staleTime: 8 * 60_000,
    gcTime: 9 * 60_000,
    queryFn: async () => (await call<{ url: string }>({ action: "open", id: a.id })).url,
  });
  const Icon = img ? FileImage : a.mime_type === "application/pdf" ? FileText : /sheet|excel|csv/.test(a.mime_type) ? FileSpreadsheet : File;
  if (img && link.data) return <img src={link.data} alt={a.original_file_name} className="h-full w-full object-cover" loading="lazy" />;
  return <Icon className={cn("h-8 w-8", a.mime_type === "application/pdf" ? "text-red-500" : "text-ink-faint")} />;
}

/**
 * Files on a document: drag & drop or pick (camera on phones), see thumbnails, open / download / remove.
 * Files are private in Cloudflare R2 and opened through 10-minute links.
 */
export function AttachmentsPanel({ entityType, entityId, readOnly, compact }: { entityType: AttachmentEntity; entityId: string; readOnly?: boolean; compact?: boolean }) {
  const { can, session } = useAccess();
  const qc = useQueryClient();
  const ready = useStorageReady();
  const files = useAttachments(entityType, entityId);
  const names = useProfileNames((files.data ?? []).map((f) => f.uploaded_by));
  const [busy, setBusy] = React.useState<string[]>([]);
  const [drag, setDrag] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [rm, setRm] = React.useState<Attachment | null>(null);
  const pick = React.useRef<HTMLInputElement>(null);
  const cam = React.useRef<HTMLInputElement>(null);
  const mayAdd = !readOnly && (can(P.attachmentsManage) || entityType === "goods_receipts" || entityType === "stock_counts");

  const add = async (list: FileList | File[] | null) => {
    const arr = Array.from(list ?? []);
    if (!arr.length) return;
    setBusy((b) => [...b, ...arr.map((f) => f.name)]);
    let ok = 0;
    for (const f of arr) {
      try { await uploadAttachment(entityType, entityId, f, note); ok++; }
      catch (e) { toast.error(`${f.name}: ${friendlyError(e)}`); }
      finally { setBusy((b) => { const i = b.indexOf(f.name); return i < 0 ? b : [...b.slice(0, i), ...b.slice(i + 1)]; }); }
    }
    if (ok) { toast.success(ok === 1 ? "File added" : `${ok} files added`); setNote(""); }
    qc.invalidateQueries({ queryKey: ["attachments", entityType, entityId] });
  };
  const remove = useMutation({
    mutationFn: async () => { await call({ action: "remove", id: rm!.id }); },
    onSuccess: () => { toast.success("File removed"); setRm(null); qc.invalidateQueries({ queryKey: ["attachments", entityType, entityId] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const list = files.data ?? [];
  const notReady = ready.data === false;
  return (
    <div className="space-y-3">
      {mayAdd && (
        <div
          onDragOver={(e) => { e.preventDefault(); if (!notReady) setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (!notReady) void add(e.dataTransfer.files); }}
          className={cn("flex flex-wrap items-center gap-3 rounded-card border-2 border-dashed px-4 py-3 transition",
            drag ? "border-primary bg-primary/5" : "border-line bg-subtle/50", notReady && "opacity-60")}>
          <UploadCloud className="h-6 w-6 text-ink-faint" />
          <div className="min-w-0 flex-1 text-sm">
            {notReady ? <span className="text-warning">File storage isn't connected yet — add the Cloudflare R2 keys in Supabase to switch it on.</span>
              : <><span className="font-medium">Drop files here</span> <span className="text-ink-muted">— photos, PDF, Excel, Word · up to 25 MB each · photos are shrunk automatically</span></>}
          </div>
          {!compact && <Input className="h-control-sm w-56" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for these files (optional)" disabled={notReady} />}
          <Button size="sm" icon={<Camera className="h-3.5 w-3.5" />} className="sm:hidden" disabled={notReady} onClick={() => cam.current?.click()}>Photo</Button>
          <Button size="sm" variant="primary" icon={<Paperclip className="h-3.5 w-3.5" />} disabled={notReady} onClick={() => pick.current?.click()}>Add files</Button>
          <input ref={pick} type="file" multiple hidden accept="image/*,application/pdf,.xlsx,.xls,.csv,.doc,.docx,.txt,.zip" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          <input ref={cam} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        </div>
      )}
      {busy.length > 0 && (
        <div className="flex flex-wrap gap-2">{busy.map((b, i) => <span key={b + i} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-0.5 text-xs"><Loader2 className="h-3 w-3 animate-spin" />{b}</span>)}</div>
      )}
      {files.isLoading ? <p className="text-sm text-ink-muted">Loading files…</p> : list.length === 0 ? (
        <p className="rounded-card border border-line px-4 py-6 text-center text-sm text-ink-muted">No files on this document yet.</p>
      ) : (
        <div className={cn("grid gap-3", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6")}>
          {list.map((a) => (
            <div key={a.id} className="group flex flex-col overflow-hidden rounded-card border border-line bg-white shadow-card">
              <button className="flex h-32 items-center justify-center overflow-hidden bg-subtle" onClick={() => void openAttachment(a.id)} title="Open">
                <Thumb a={a} />
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-2">
                <span className="truncate text-sm font-medium" title={a.original_file_name}>{a.original_file_name}</span>
                <span className="truncate text-2xs text-ink-muted">{humanSize(Number(a.file_size))} · {a.uploaded_by ? names.data?.[a.uploaded_by] ?? "…" : ""} · {formatDateTime(a.uploaded_at)}</span>
                {a.description && <span className="line-clamp-2 text-2xs text-ink-2">{a.description}</span>}
                <div className="mt-1 flex items-center gap-1">
                  <Button size="icon-sm" variant="ghost" title="Open" onClick={() => void openAttachment(a.id)}><ExternalLink className="h-3.5 w-3.5" /></Button>
                  <Button size="icon-sm" variant="ghost" title="Download" onClick={() => void openAttachment(a.id, true)}><Download className="h-3.5 w-3.5" /></Button>
                  <div className="flex-1" />
                  {!readOnly && (a.uploaded_by === session?.user.id || can(P.attachmentsManage)) && (
                    <Button size="icon-sm" variant="destructive-ghost" title="Remove" onClick={() => setRm(a)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog open={!!rm} title="Remove this file?" tone="destructive" confirmLabel="Remove" loading={remove.isPending}
        message={`${rm?.original_file_name ?? ""} disappears from this document. (It is kept in storage for the audit trail.)`}
        onCancel={() => setRm(null)} onConfirm={() => remove.mutate()} />
    </div>
  );
}
