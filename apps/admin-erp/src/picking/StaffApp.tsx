import * as React from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BellRing, CheckCircle2, ChevronRight, ClipboardList, Loader2, LogOut, Radio, RefreshCw, Volume2, VolumeX, Warehouse } from "lucide-react";
import { Badge, Button, ConfirmDialog, Input, cn } from "@jst/ui";
import { friendlyError, sb, useAccess } from "@jst/data-access";
import { formatDate } from "@jst/utilities";
import { PICK_TONE, PickLineCard, PickProgress, pickLabel, usePickingTask } from "./common";
import { alarmReady, askNotificationPermission, chime, keepScreenAwake, startAlarm, stopAlarm, systemNotify, unlockAlarm } from "./alarm";
import { usePickingRealtime, useMyNotifications, type StaffNotification } from "./realtime";

/**
 * Staff phone app (installable web app). Pickers see only the tasks they are on, get a loud
 * buzzer for new work, tick what they picked, report shortages and finish. Everything is live.
 */
export function StaffApp() {
  const { session, sessionLoading, accessLoading, companies, company, can, signOut } = useAccess();
  const [params, setParams] = useSearchParams();
  const taskId = params.get("task");
  const [onDuty, setOnDuty] = React.useState(false);
  const [alarm, setAlarm] = React.useState<StaffNotification[]>([]);
  const userId = session?.user.id ?? null;
  const allowed = companies.length > 0 && can("picking.perform");
  const live = usePickingRealtime(!!session && allowed);

  const onNew = React.useCallback((nt: StaffNotification) => {
    if (nt.urgent) {
      setAlarm((a) => (a.some((x) => x.id === nt.id) ? a : [...a, nt]));
      startAlarm();
      if (document.visibilityState !== "visible") void systemNotify(nt.title, nt.body ?? "", { tag: `task-${nt.task_id}`, urgent: true, url: `/m?task=${nt.task_id}` });
    } else {
      chime();
      toast(nt.title, { description: nt.body ?? undefined, duration: 8000 });
      if (document.visibilityState !== "visible") void systemNotify(nt.title, nt.body ?? "", { tag: nt.id });
    }
  }, []);
  const notes = useMyNotifications(allowed ? userId : null, onNew);

  // urgent work that arrived while the app was closed: ring as soon as the picker is on duty
  React.useEffect(() => {
    if (!onDuty) return;
    const waiting = notes.unread.filter((x) => x.urgent);
    if (waiting.length) {
      setAlarm((a) => [...a, ...waiting.filter((w) => !a.some((x) => x.id === w.id))]);
      startAlarm();
    }
    const info = notes.unread.filter((x) => !x.urgent);
    if (info.length) void notes.ack(info.map((x) => x.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDuty, notes.unread.length]);

  // keep the screen awake while on duty (the lock is dropped whenever the page is hidden)
  React.useEffect(() => {
    if (!onDuty) return;
    const f = () => document.visibilityState === "visible" && void keepScreenAwake();
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [onDuty]);
  React.useEffect(() => () => stopAlarm(), []);

  const accept = async () => {
    stopAlarm();
    const ids = alarm.map((a) => a.id);
    const first = alarm[0]?.task_id;
    setAlarm([]);
    await notes.ack(ids);
    if (first) setParams({ task: first });
  };

  if (sessionLoading || (session && accessLoading)) return <div className="flex h-dvh items-center justify-center bg-page"><Loader2 className="h-6 w-6 animate-spin text-ink-faint" /></div>;
  if (!session) return <Navigate to="/login" replace state={{ from: "/m" }} />;

  const startDuty = async () => {
    const ok = await unlockAlarm();
    const perm = await askNotificationPermission();
    await keepScreenAwake();
    setOnDuty(true);
    if (!ok) toast.error("Sound could not be turned on — check the phone volume and tap again");
    else if (perm === "denied") toast("Phone notifications are blocked — allow them in browser settings for alerts when the app is in the background");
  };

  return (
    <div className="flex min-h-dvh flex-col bg-page">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-surface px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {taskId ? (
          <button className="-ml-1 flex h-10 w-10 items-center justify-center rounded-control hover:bg-subtle" aria-label="Back" onClick={() => setParams({})}><ArrowLeft className="h-5 w-5" /></button>
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-control bg-ink text-xs font-bold text-surface">JS</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{taskId ? "Picking" : "My tasks"}</div>
          <div className="flex items-center gap-1 truncate text-2xs text-ink-muted">
            <Radio className={cn("h-3 w-3", live ? "text-success" : "text-ink-faint")} />{live ? "Live" : "Connecting"} · {company?.company_name}
          </div>
        </div>
        <button className="flex h-10 w-10 items-center justify-center rounded-control hover:bg-subtle" aria-label="Sound" onClick={() => (alarmReady() ? (chime(), toast.success("Sound is on")) : void startDuty())}>
          {onDuty && alarmReady() ? <Volume2 className="h-5 w-5 text-success" /> : <VolumeX className="h-5 w-5 text-danger" />}
        </button>
        <button className="flex h-10 w-10 items-center justify-center rounded-control hover:bg-subtle" aria-label="Sign out" onClick={() => { stopAlarm(); void signOut(); }}><LogOut className="h-4 w-4 text-ink-muted" /></button>
      </header>
      {!allowed ? (
        <p className="m-4 rounded-card border border-line bg-surface p-4 text-sm text-ink-muted">You have no picking work in this app. Ask your warehouse manager to add you as warehouse staff.</p>
      ) : !onDuty ? (
        <DutyGate name={session.user.user_metadata?.full_name as string | undefined} waiting={notes.unread.filter((x) => x.urgent).length} onStart={startDuty} />
      ) : taskId ? <TaskScreen id={taskId} userId={session.user.id} onDone={() => setParams({})} /> : <TaskList userId={session.user.id} onOpen={(id) => setParams({ task: id })} />}
      {alarm.length > 0 && <AlarmOverlay items={alarm} onAccept={accept} />}
    </div>
  );
}

function DutyGate({ name, waiting, onStart }: { name?: string; waiting: number; onStart: () => void }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <BellRing className="h-14 w-14 text-ink" />
      <div>
        <p className="text-lg font-semibold">Welcome{name ? `, ${name}` : ""}</p>
        <p className="mt-1 text-sm text-ink-muted">Tap below to start your duty. This turns on the loud buzzer for new picking work and keeps the screen awake.</p>
      </div>
      {waiting > 0 && <p className="rounded-control bg-danger-soft px-3 py-1.5 text-sm font-medium text-danger">{waiting} new task alert{waiting > 1 ? "s" : ""} waiting</p>}
      <Button variant="primary" className="h-14 w-full max-w-xs text-lg" icon={<Volume2 className="h-5 w-5" />} onClick={onStart}>Start duty</Button>
      <p className="text-2xs text-ink-faint">Keep the phone volume up and this app open while working.</p>
    </main>
  );
}

function AlarmOverlay({ items, onAccept }: { items: StaffNotification[]; onAccept: () => void }) {
  const first = items[0];
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-danger p-6 text-center text-white" role="alertdialog" aria-live="assertive">
      <style>{`@keyframes jstflash{0%,100%{background:#B91C1C}50%{background:#7F1D1D}}`}</style>
      <div className="absolute inset-0 -z-10" style={{ animation: "jstflash 0.7s infinite" }} />
      <BellRing className="h-20 w-20 animate-bounce" />
      <div>
        <p className="text-2xl font-bold">{first.title}</p>
        {first.body && <p className="mt-2 text-lg opacity-90">{first.body}</p>}
        {items.length > 1 && <p className="mt-2 text-sm opacity-80">+ {items.length - 1} more</p>}
      </div>
      <button onClick={onAccept} className="h-20 w-full max-w-sm rounded-2xl bg-white text-2xl font-bold text-danger shadow-lg active:scale-95">ACCEPT</button>
    </div>
  );
}

interface TaskRow { id: string; doc_no: string; so_doc_no: string; status: string; due_date: string | null; notes: string | null; completed_at: string | null; warehouse: { code: string; name: string } | null; lines: { qty_picked: number | null }[] }
function TaskList({ userId, onOpen }: { userId: string; onOpen: (id: string) => void }) {
  const q = useQuery({
    queryKey: ["my-picking", userId],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const since = new Date(); since.setHours(0, 0, 0, 0);
      const { data, error } = await sb().from("picking_tasks")
        .select("id, doc_no, so_doc_no, status, due_date, notes, completed_at, warehouse:warehouses(code, name), lines:picking_task_lines(qty_picked), team:picking_task_assignees!inner(user_id, removed_at)")
        .eq("team.user_id", userId).is("team.removed_at", null)
        .or(`status.in.(OPEN,IN_PROGRESS),completed_at.gte.${since.toISOString()}`)
        .order("created_at", { ascending: true }).limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as TaskRow[];
    },
  });
  const open = (q.data ?? []).filter((t) => ["OPEN", "IN_PROGRESS"].includes(t.status));
  const done = (q.data ?? []).filter((t) => !["OPEN", "IN_PROGRESS"].includes(t.status));
  return (
    <main className="flex-1 space-y-3 p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">To pick ({open.length})</span>
        <button className="flex items-center gap-1 text-xs text-ink-muted" onClick={() => q.refetch()}><RefreshCw className={cn("h-3.5 w-3.5", q.isFetching && "animate-spin")} /> Refresh</button>
      </div>
      {q.isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-ink-faint" /> : q.error ? <p className="text-sm text-danger">{friendlyError(q.error)}</p> : open.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-surface p-6 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-ink-faint" />
          <p className="mt-2 text-sm font-medium">No picking work right now</p>
          <p className="text-xs text-ink-muted">Keep this open — the phone will buzz when work comes.</p>
        </div>
      ) : open.map((t) => <TaskCard key={t.id} t={t} onOpen={() => onOpen(t.id)} />)}
      {done.length > 0 && (
        <>
          <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Finished today</div>
          {done.map((t) => <TaskCard key={t.id} t={t} onOpen={() => onOpen(t.id)} />)}
        </>
      )}
    </main>
  );
}

function TaskCard({ t, onOpen }: { t: TaskRow; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-left shadow-card active:bg-subtle">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{t.doc_no}</span>
          <Badge tone={PICK_TONE[t.status]}>{pickLabel(t.status)}</Badge>
        </div>
        <div className="flex items-center gap-1 text-xs text-ink-muted"><Warehouse className="h-3.5 w-3.5" /> {t.warehouse?.name ?? t.warehouse?.code ?? "Warehouse"} · {t.so_doc_no}{t.due_date && <> · due {formatDate(t.due_date)}</>}</div>
        <PickProgress lines={t.lines} />
      </div>
      <ChevronRight className="h-5 w-5 text-ink-faint" />
    </button>
  );
}

function TaskScreen({ id, userId, onDone }: { id: string; userId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const doc = usePickingTask(id);
  const [confirm, setConfirm] = React.useState(false);
  const [note, setNote] = React.useState("");
  const names = React.useMemo(() => new Map([[userId, "you"]]), [userId]);
  const finish = useMutation({
    mutationFn: async () => { const { error } = await sb().rpc("complete_picking_task", { p_id: id, p_note: note || null }); if (error) throw error; },
    onSuccess: () => { toast.success("Picking finished — the manager has been told"); setConfirm(false); qc.invalidateQueries(); onDone(); },
    onError: (e) => { setConfirm(false); toast.error(friendlyError(e)); },
  });
  if (doc.isLoading) return <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-ink-faint" />;
  if (doc.error || !doc.data) return <p className="m-4 text-sm text-danger">{doc.error ? "This task is no longer yours — the manager may have given it to someone else." : "Task not found."}</p>;
  const h = doc.data.header;
  const lines = doc.data.lines;
  const status = String(h.status);
  const open = ["OPEN", "IN_PROGRESS"].includes(status);
  const mine = doc.data.team.some((m) => m.user_id === userId);
  const todo = lines.filter((l) => l.qty_picked == null);
  const picked = lines.filter((l) => l.qty_picked != null);
  return (
    <>
      <main className="flex-1 space-y-3 p-3 pb-28">
        <div className="rounded-card border border-line bg-surface p-3">
          <div className="flex items-center gap-2"><span className="font-mono text-base font-semibold">{String(h.doc_no)}</span><Badge tone={PICK_TONE[status]}>{pickLabel(status)}</Badge></div>
          <div className="mt-1 flex items-center gap-1 text-sm text-ink-muted"><Warehouse className="h-4 w-4" /> {(h.warehouse as { name: string } | null)?.name ?? ""} · {String(h.so_doc_no)}</div>
          {h.notes ? <p className="mt-2 rounded-control bg-info/10 px-2 py-1.5 text-sm text-info">{String(h.notes)}</p> : null}
          {doc.data.team.length > 1 && <p className="mt-2 text-xs text-ink-muted">{doc.data.team.length} pickers on this task — items ticked by others show up instantly.</p>}
          {!mine && open && <p className="mt-2 text-xs text-warning">You are no longer on this task.</p>}
          <div className="mt-2"><PickProgress lines={lines} /></div>
        </div>
        {todo.length > 0 && <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">To pick ({todo.length})</div>}
        {todo.map((l) => <PickLineCard key={l.id} line={l} editable={open && mine} big names={names} />)}
        {picked.length > 0 && <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Picked ({picked.length})</div>}
        {picked.map((l) => <PickLineCard key={l.id} line={l} editable={open && mine} big names={names} />)}
      </main>
      {open && mine && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button variant="primary" className="h-12 w-full text-base" icon={<CheckCircle2 className="h-5 w-5" />} disabled={todo.length > 0} onClick={() => setConfirm(true)}>
            {todo.length > 0 ? `${todo.length} item${todo.length > 1 ? "s" : ""} left to tick` : "Finish picking"}
          </Button>
        </div>
      )}
      <ConfirmDialog open={confirm} title="Finish picking?" confirmLabel="Finish" loading={finish.isPending}
        message={picked.some((l) => Number(l.qty_picked) < Number(l.qty_requested)) ? "Some items are short — the manager will decide what to do." : "Everything was picked."}
        onCancel={() => setConfirm(false)} onConfirm={() => finish.mutate()}>
        <Input className="mt-3" placeholder="Note for the manager (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}
