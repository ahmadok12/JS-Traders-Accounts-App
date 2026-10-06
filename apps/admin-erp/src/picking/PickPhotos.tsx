import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, ChevronLeft, ChevronRight, Download, ImagePlus, Images, Loader2, X } from "lucide-react";
import { Button, cn } from "@jst/ui";
import { friendlyError, sb } from "@jst/data-access";
import { formatDateTime } from "@jst/utilities";
import { Thumb, call, isImage, openAttachment, uploadAttachment, useAttachments } from "../attachments/Attachments";
import { useFeature, FEATURES } from "../lib/settings";

export interface PhotoRow {
  id: string; original_file_name: string; mime_type: string; uploaded_at: string;
  uploaded_by: string | null; uploaded_by_name?: string | null; task_doc_no?: string; warehouse_code?: string | null; task_id?: string;
}

/** Full-screen photo viewer with previous / next (keyboard ← → Esc). */
export function PhotoViewer({ photos, index, onClose }: { photos: PhotoRow[]; index: number; onClose: () => void }) {
  const [i, setI] = React.useState(index);
  const p = photos[i];
  const url = useQuery({
    queryKey: ["attachment-full", p?.id],
    enabled: !!p,
    staleTime: 8 * 60_000,
    queryFn: async () => (await call<{ url: string }>({ action: "open", id: p!.id })).url,
  });
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(photos.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [photos.length, onClose]);
  if (!p) return null;
  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex items-center gap-2 px-3 py-2 text-sm text-white" onClick={(e) => e.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate">
          {p.task_doc_no ? `${p.task_doc_no}${p.warehouse_code ? ` · ${p.warehouse_code}` : ""} · ` : ""}
          {p.uploaded_by_name ? `${p.uploaded_by_name} · ` : ""}{formatDateTime(p.uploaded_at)} · {i + 1} / {photos.length}
        </span>
        <button className="rounded p-2 hover:bg-white/10" title="Download" onClick={() => void openAttachment(p.id, true)}><Download className="h-5 w-5" /></button>
        <button className="rounded p-2 hover:bg-white/10" title="Close" onClick={onClose}><X className="h-5 w-5" /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-2" onClick={(e) => e.stopPropagation()}>
        {url.data ? <img src={url.data} alt={p.original_file_name} className="max-h-full max-w-full object-contain" />
          : <Loader2 className="h-8 w-8 animate-spin text-white/70" />}
        {i > 0 && <button className="absolute left-2 rounded-full bg-black/50 p-3 text-white hover:bg-black/70" onClick={() => setI(i - 1)}><ChevronLeft className="h-6 w-6" /></button>}
        {i < photos.length - 1 && <button className="absolute right-2 rounded-full bg-black/50 p-3 text-white hover:bg-black/70" onClick={() => setI(i + 1)}><ChevronRight className="h-6 w-6" /></button>}
      </div>
    </div>
  );
}

function PhotoTile({ p, onOpen, onRemove, caption }: { p: PhotoRow; onOpen: () => void; onRemove?: () => void; caption?: React.ReactNode }) {
  return (
    <div className="group relative overflow-hidden rounded-card border border-line bg-subtle">
      <button className="flex aspect-square w-full items-center justify-center overflow-hidden" onClick={onOpen} title="View">
        <Thumb a={p} />
      </button>
      {caption && <div className="truncate border-t border-line bg-white px-1.5 py-1 text-2xs text-ink-muted">{caption}</div>}
      {onRemove && (
        <button className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white" title="Remove photo" onClick={onRemove}><X className="h-3.5 w-3.5" /></button>
      )}
    </div>
  );
}

/** Pickers: take photos with the camera or choose from the gallery (staff phone app). */
export function PickPhotoCapture({ taskId, editable, userId }: { taskId: string; editable: boolean; userId: string }) {
  const qc = useQueryClient();
  const files = useAttachments("picking_tasks", taskId);
  const required = useFeature(FEATURES.pickingPhotosRequired);
  const cam = React.useRef<HTMLInputElement>(null);
  const gal = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(0);
  const [view, setView] = React.useState<number | null>(null);
  const photos = (files.data ?? []).filter((f) => isImage(f.mime_type)) as PhotoRow[];

  const add = async (list: FileList | null) => {
    const arr = Array.from(list ?? []);
    if (!arr.length) return;
    setBusy((b) => b + arr.length);
    let ok = 0;
    for (const f of arr) {
      try { await uploadAttachment("picking_tasks", taskId, f); ok++; }
      catch (e) { toast.error(friendlyError(e)); }
      finally { setBusy((b) => b - 1); }
    }
    if (ok) toast.success(ok === 1 ? "Photo added" : `${ok} photos added`);
    qc.invalidateQueries({ queryKey: ["attachments", "picking_tasks", taskId] });
  };
  const remove = async (id: string) => {
    try { await call({ action: "remove", id }); qc.invalidateQueries({ queryKey: ["attachments", "picking_tasks", taskId] }); }
    catch (e) { toast.error(friendlyError(e)); }
  };

  return (
    <div className="rounded-card border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <Images className="h-4 w-4 text-ink-muted" />
        <span className="text-sm font-semibold">Photos{photos.length ? ` (${photos.length})` : ""}</span>
        {editable && required.enabled && photos.length === 0 && <span className="text-xs text-warning">at least 1 needed to finish</span>}
      </div>
      {editable && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Button className="h-12 text-base" variant="primary" icon={<Camera className="h-5 w-5" />} disabled={busy > 0} onClick={() => cam.current?.click()}>Take photo</Button>
          <Button className="h-12 text-base" icon={<ImagePlus className="h-5 w-5" />} disabled={busy > 0} onClick={() => gal.current?.click()}>From gallery</Button>
          <input ref={cam} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          <input ref={gal} type="file" hidden multiple accept="image/*" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        </div>
      )}
      {busy > 0 && <p className="mb-2 flex items-center gap-1.5 text-sm text-ink-muted"><Loader2 className="h-4 w-4 animate-spin" /> Uploading {busy} photo{busy > 1 ? "s" : ""}…</p>}
      {photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <PhotoTile key={p.id} p={p} onOpen={() => setView(i)} onRemove={editable && p.uploaded_by === userId ? () => void remove(p.id) : undefined} />
          ))}
        </div>
      ) : !editable && <p className="text-xs text-ink-muted">No photos.</p>}
      {view != null && <PhotoViewer photos={photos} index={view} onClose={() => setView(null)} />}
    </div>
  );
}

/** Photos taken by pickers on every picking task of one sales order — updates live. */
export function useSoPickingPhotos(soId: string | null) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["so-picking-photos", soId],
    enabled: !!soId,
    queryFn: async () => {
      const { data, error } = await sb().rpc("so_picking_photos", { p_so_id: soId! });
      if (error) throw error;
      return (data ?? []) as PhotoRow[];
    },
  });
  React.useEffect(() => {
    if (!soId) return;
    const ch = sb().channel(`so-photos-${soId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "attachments", filter: "entity_type=eq.picking_tasks" },
        () => qc.invalidateQueries({ queryKey: ["so-picking-photos", soId] }))
      .subscribe();
    return () => { void sb().removeChannel(ch); };
  }, [soId, qc]);
  return q;
}

export function SoPickingPhotos({ photos, loading }: { photos: PhotoRow[]; loading?: boolean }) {
  const [view, setView] = React.useState<number | null>(null);
  if (loading) return <p className="text-sm text-ink-muted">Loading photos…</p>;
  if (!photos.length) return <p className="rounded-card border border-line px-4 py-6 text-center text-sm text-ink-muted">No picking photos yet — they appear here the moment a picker adds them.</p>;
  const groups: { key: string; title: string; items: { p: PhotoRow; i: number }[] }[] = [];
  photos.forEach((p, i) => {
    const key = p.task_id ?? "";
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, title: `${p.task_doc_no ?? ""}${p.warehouse_code ? ` · ${p.warehouse_code}` : ""}`, items: [] }; groups.push(g); }
    g.items.push({ p, i });
  });
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">{g.title} · {g.items.length} photo{g.items.length > 1 ? "s" : ""}</div>
          <div className={cn("grid gap-2", "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8")}>
            {g.items.map(({ p, i }) => (
              <PhotoTile key={p.id} p={p} onOpen={() => setView(i)} caption={`${p.uploaded_by_name ?? ""} · ${formatDateTime(p.uploaded_at)}`} />
            ))}
          </div>
        </div>
      ))}
      {view != null && <PhotoViewer photos={photos} index={view} onClose={() => setView(null)} />}
    </div>
  );
}
