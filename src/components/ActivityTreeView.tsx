"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  FolderTree,
  Layers,
  Network,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import {
  formatElapsedEs,
  formatHoursAndDays,
  overdueMs,
  STATUS_LABEL,
  type ActivityLike,
  type ActivityNode,
  type ActivityStatus,
} from "@/lib/activityTree";
import { formatDateTimeDisplay } from "@/lib/timeUtils";

interface ActivityTreeViewProps<T extends ActivityLike> {
  listName: string;
  roots: ActivityNode<T>[];
  onRefresh: () => void;
  refreshing?: boolean;
}

/* ---------- Paleta (mismos tonos que la imagen de referencia) ---------- */

type Tone = "slate" | "violet" | "blue" | "emerald" | "amber" | "rose";

const TONE: Record<
  Tone,
  { border: string; bg: string; port: string; dot: string; line: string; shadow: string; chip: string }
> = {
  // Raíz del árbol general (todas las listas)
  slate: {
    border: "border-slate-400",
    bg: "bg-white",
    port: "border-slate-500",
    dot: "bg-slate-500",
    line: "#64748b",
    shadow: "shadow-[0_6px_18px_-8px_rgba(71,85,105,0.45)]",
    chip: "bg-slate-100 text-slate-700",
  },
  violet: {
    border: "border-violet-400",
    bg: "bg-white",
    port: "border-violet-500",
    dot: "bg-violet-500",
    line: "#8b5cf6",
    shadow: "shadow-[0_6px_18px_-8px_rgba(139,92,246,0.45)]",
    chip: "bg-violet-100 text-violet-700",
  },
  blue: {
    border: "border-blue-400",
    bg: "bg-white",
    port: "border-blue-500",
    dot: "bg-blue-500",
    line: "#3b82f6",
    shadow: "shadow-[0_6px_18px_-8px_rgba(59,130,246,0.45)]",
    chip: "bg-blue-100 text-blue-700",
  },
  emerald: {
    border: "border-emerald-300",
    bg: "bg-emerald-50/50",
    port: "border-emerald-500",
    dot: "bg-emerald-500",
    line: "#10b981",
    shadow: "shadow-[0_4px_14px_-8px_rgba(16,185,129,0.45)]",
    chip: "bg-emerald-100 text-emerald-700",
  },
  amber: {
    border: "border-amber-300",
    bg: "bg-amber-50/50",
    port: "border-amber-500",
    dot: "bg-amber-500",
    line: "#f59e0b",
    shadow: "shadow-[0_4px_14px_-8px_rgba(245,158,11,0.45)]",
    chip: "bg-amber-100 text-amber-700",
  },
  rose: {
    border: "border-rose-300",
    bg: "bg-rose-50/50",
    port: "border-rose-500",
    dot: "bg-rose-500",
    line: "#f43f5e",
    shadow: "shadow-[0_4px_14px_-8px_rgba(244,63,94,0.45)]",
    chip: "bg-rose-100 text-rose-700",
  },
};

/** Ancho de la zona donde se dibujan las curvas entre una tarjeta y sus ramas. */
const GUTTER = 64;

/* ---------- Piezas pequeñas ---------- */

function StatusPill({ status, overdue }: { status: ActivityStatus; overdue?: boolean }) {
  const cls = overdue
    ? "bg-rose-50 text-rose-600 border-rose-200"
    : status === "FINALIZADA"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <span
      className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {overdue ? "Vencida" : STATUS_LABEL[status]}
    </span>
  );
}

/** Punto de conexión sobre el borde de una tarjeta. */
function Port({ tone, side }: { tone: Tone; side: "left" | "right" }) {
  return (
    <span
      className={`absolute top-1/2 -translate-y-1/2 ${side === "left" ? "-left-[8px]" : "-right-[8px]"} flex h-[15px] w-[15px] items-center justify-center rounded-full border-2 bg-white ${TONE[tone].port}`}
    >
      <span className={`h-[5px] w-[5px] rounded-full ${TONE[tone].dot}`} />
    </span>
  );
}

function formatPeriod(start: Date, end: Date): string {
  const s = formatDateTimeDisplay(start);
  const e = formatDateTimeDisplay(end);
  // Mismo día: "18/11/2026 08:00 → 12:00"
  return s.slice(0, 10) === e.slice(0, 10) ? `${s} → ${e.slice(11)}` : `${s} → ${e}`;
}

function ObservationBox({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] leading-snug text-slate-600 whitespace-pre-line break-words">
      <span className="font-semibold text-slate-700">Obs.:</span> {text}
    </div>
  );
}

function ToggleButton({
  expanded,
  count,
  onClick,
}: {
  expanded: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={expanded ? "Contraer" : `Expandir (${count})`}
      className="relative z-10 shrink-0 inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-slate-300 bg-white px-1 text-[11px] font-bold text-slate-600 shadow-sm hover:border-slate-400 hover:text-slate-900 transition"
    >
      {expanded ? (
        <ChevronLeft className="h-3.5 w-3.5" />
      ) : (
        <>
          {count}
          <ChevronRight className="h-3.5 w-3.5" />
        </>
      )}
    </button>
  );
}

/* ---------- Ramas con curvas ---------- */

interface BranchItem {
  key: string;
  color: string;
  dashed?: boolean;
  content: React.ReactNode;
}

/**
 * Columna de ramas. Mide la posición de cada rama y dibuja una curva desde el
 * centro izquierdo (donde está la tarjeta madre) hasta el punto de conexión de cada hija.
 */
function Branches({ items }: { items: BranchItem[] }) {
  const colRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ h: number; ys: number[] }>({ h: 0, ys: [] });
  const itemsSignature = items.map((i) => i.key).join("|");

  useLayoutEffect(() => {
    const col = colRef.current;
    if (!col) return;
    const measure = () => {
      const rows = Array.from(col.children) as HTMLElement[];
      const next = {
        h: col.offsetHeight,
        ys: rows.map((r) => r.offsetTop + r.offsetHeight / 2),
      };
      setGeo((prev) =>
        prev.h === next.h &&
        prev.ys.length === next.ys.length &&
        prev.ys.every((y, i) => y === next.ys[i])
          ? prev
          : next
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(col);
    Array.from(col.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, [itemsSignature]);

  const mid = geo.h / 2;

  return (
    <div className="relative flex">
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={GUTTER}
        height={geo.h}
        aria-hidden="true"
      >
        {geo.ys.map((y, i) => {
          const item = items[i];
          if (!item) return null;
          return (
            <path
              key={item.key}
              d={`M 0 ${mid} C ${GUTTER * 0.55} ${mid}, ${GUTTER * 0.45} ${y}, ${GUTTER} ${y}`}
              fill="none"
              stroke={item.color}
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeDasharray={item.dashed ? "4 4" : undefined}
            />
          );
        })}
      </svg>
      <div ref={colRef} className="relative flex flex-col" style={{ marginLeft: GUTTER }}>
        {items.map((item) => (
          <div key={item.key} className="flex items-center py-2">
            {item.content}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Tarjetas ---------- */

function leafTone(node: ActivityNode, now: Date): Tone {
  if (node.status === "FINALIZADA") return "emerald";
  return overdueMs(node, now) > 0 ? "rose" : "amber";
}

function toneOf(node: ActivityNode, now: Date): Tone {
  return node.isLeaf ? leafTone(node, now) : "blue";
}

/** Línea corta entre el punto de salida de la tarjeta y el botón de expandir. */
function Stub({ tone }: { tone: Tone }) {
  return <span className="h-0.5 w-3 shrink-0" style={{ backgroundColor: TONE[tone].line }} />;
}

function GroupCard({
  title,
  level,
  icon,
  tone,
  status,
  totalHours,
  periodStart,
  periodEnd,
  progress,
  unscheduled,
  observation,
  hasIncoming,
  hasOutgoing,
  toggle,
}: {
  title: string;
  level: string;
  icon: React.ReactNode;
  tone: Tone;
  status: ActivityStatus;
  totalHours: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  progress?: { done: number; total: number };
  unscheduled: number;
  observation?: string | null;
  hasIncoming: boolean;
  hasOutgoing: boolean;
  /** Botón para mostrar u ocultar las ramas desde la propia tarjeta. */
  toggle?: { expanded: boolean; count: number; label: string; onClick: () => void };
}) {
  const t = TONE[tone];
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className={`relative w-[270px] rounded-2xl border-2 ${t.border} ${t.bg} ${t.shadow}`}>
      {hasIncoming && <Port tone={tone} side="left" />}
      <div className="px-4 pt-3.5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${t.chip}`}>
              {icon}
            </span>
            <span
              className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${t.chip}`}
            >
              {level}
            </span>
          </div>
          <StatusPill status={status} />
        </div>
        <h4 className="mt-2.5 text-[15px] font-bold leading-snug text-slate-900 break-words">
          {title}
        </h4>
      </div>
      <div className="space-y-1.5 border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>Total:</span>
          <span className="font-mono font-semibold text-slate-800">
            {formatHoursAndDays(totalHours)}
          </span>
        </div>
        {periodStart && periodEnd && (
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono">{formatPeriod(periodStart, periodEnd)}</span>
          </div>
        )}
        {unscheduled > 0 && (
          <div className="italic text-slate-400">
            {unscheduled} {unscheduled === 1 ? "tarea sin horario" : "tareas sin horario"}
          </div>
        )}
        {progress && progress.total > 0 && (
          <div className="pt-1.5">
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="text-slate-600">Progreso</span>
              <span className="font-semibold text-emerald-600">
                {pct}% ({progress.done}/{progress.total})
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
        <ObservationBox text={observation} />
      </div>
      {toggle && toggle.count > 0 && (
        <button
          type="button"
          onClick={toggle.onClick}
          className={`flex w-full items-center justify-center gap-1 rounded-b-2xl border-t border-slate-100 px-4 py-2 text-xs font-semibold transition ${
            toggle.expanded
              ? "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              : `${t.chip} hover:brightness-95`
          }`}
        >
          {toggle.expanded ? (
            <ChevronLeft className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {toggle.expanded ? "Ocultar" : "Mostrar"} {toggle.count} {toggle.label}
        </button>
      )}
      {hasOutgoing && <Port tone={tone} side="right" />}
    </div>
  );
}

function LeafCard({
  node,
  now,
  hasOutgoing,
}: {
  node: ActivityNode;
  now: Date;
  hasOutgoing: boolean;
}) {
  const tone = leafTone(node, now);
  const t = TONE[tone];
  const late = overdueMs(node, now);
  return (
    <div className={`relative w-[250px] rounded-xl border-[1.5px] ${t.border} ${t.bg} ${t.shadow} px-3.5 py-3`}>
      <Port tone={tone} side="left" />
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-start gap-1.5 text-[13px] font-semibold leading-snug text-slate-900 break-words min-w-0">
          {late > 0 && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />}
          {node.activity.name}
        </span>
        <StatusPill status={node.status} overdue={late > 0} />
      </div>
      {node.hasSchedule ? (
        <div className="mt-1.5 space-y-0.5 font-mono text-[11px]">
          <div className="text-slate-500">{formatHoursAndDays(node.totalHours)}</div>
          {node.periodStart && node.periodEnd && (
            <div className={late > 0 ? "font-semibold text-rose-600" : "text-slate-500"}>
              {formatPeriod(node.periodStart, node.periodEnd)}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-1.5 text-[11px] italic text-slate-400">sin horario</div>
      )}
      {late > 0 && (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-rose-600">
          <TriangleAlert className="h-3 w-3 shrink-0" />
          Plazo superado por {formatElapsedEs(late)}
        </div>
      )}
      <ObservationBox text={node.activity.observation} />
      {hasOutgoing && <Port tone={tone} side="right" />}
    </div>
  );
}

/** Observación de finalización: tarjeta chica conectada a su tarea. */
function CompletionNoteCard({ text }: { text: string }) {
  return (
    <div className="relative min-w-[150px] max-w-[320px] rounded-lg border-[1.5px] border-emerald-200 bg-white px-3 py-1.5 text-xs leading-snug text-slate-700 shadow-sm whitespace-pre-line break-words">
      <Port tone="emerald" side="left" />
      {text}
    </div>
  );
}

/* ---------- Nodo del árbol ---------- */

function TreeNode<T extends ActivityLike>({
  node,
  isExpanded,
  onToggle,
  now,
}: {
  node: ActivityNode<T>;
  isExpanded: (node: ActivityNode<T>) => boolean;
  onToggle: (node: ActivityNode<T>) => void;
  now: Date;
}) {
  const expanded = isExpanded(node);
  const notes = node.activity.completionNotes ?? [];
  // Ramas: actividades hijas y, después, las observaciones de finalización
  const branchCount = node.children.length + notes.length;
  const tone = toneOf(node, now);

  const items: BranchItem[] = [
    ...node.children.map((child) => ({
      key: `a-${child.activity.id}`,
      color: TONE[toneOf(child, now)].line,
      content: (
        <TreeNode node={child} isExpanded={isExpanded} onToggle={onToggle} now={now} />
      ),
    })),
    ...notes.map((n) => ({
      key: `n-${n.id}`,
      color: TONE.emerald.line,
      dashed: true,
      content: <CompletionNoteCard text={n.text} />,
    })),
  ];

  return (
    <div className="flex items-center">
      {node.isLeaf ? (
        <LeafCard node={node} now={now} hasOutgoing={branchCount > 0} />
      ) : (
        <GroupCard
          title={node.activity.name}
          level={`L${node.depth + 2} · ${node.depth === 0 ? "FASE" : "SUBFASE"}`}
          icon={<Layers className="h-4 w-4" />}
          tone="blue"
          status={node.status}
          totalHours={node.totalHours}
          periodStart={node.periodStart}
          periodEnd={node.periodEnd}
          progress={{ done: node.finishedLeafCount, total: node.leafCount }}
          unscheduled={node.unscheduledLeafCount}
          observation={node.activity.observation}
          hasIncoming
          hasOutgoing={branchCount > 0}
          toggle={{
            expanded,
            count: node.children.length,
            label: node.children.length === 1 ? "actividad" : "actividades",
            onClick: () => onToggle(node),
          }}
        />
      )}

      {branchCount > 0 && (
        <>
          <Stub tone={tone} />
          <ToggleButton expanded={expanded} count={branchCount} onClick={() => onToggle(node)} />
          {expanded && <Branches items={items} />}
        </>
      )}
    </div>
  );
}

/**
 * Vista de árbol horizontal (mapa mental): la lista como raíz a la izquierda
 * y sus actividades como ramas hacia la derecha. Se arma con los datos ya
 * cargados; "Actualizar" vuelve a pedirlos al servidor.
 */
export default function ActivityTreeView<T extends ActivityLike>({
  listName,
  roots,
  onRefresh,
  refreshing = false,
}: ActivityTreeViewProps<T>) {
  // Las actividades con hijas arrancan contraídas (se ven las fases y se abre la que interesa).
  // Las observaciones de finalización de una tarea se ven por defecto.
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set());
  const [collapsedNotes, setCollapsedNotes] = useState<Set<number>>(() => new Set());
  const [rootExpanded, setRootExpanded] = useState(true);
  // "Vencida" depende de la hora actual: se recalcula cada minuto
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const { groupIds, leafWithNotesIds } = useMemo(() => {
    const groups: number[] = [];
    const leaves: number[] = [];
    const walk = (n: ActivityNode<T>) => {
      if (!n.isLeaf) groups.push(n.activity.id);
      else if ((n.activity.completionNotes?.length ?? 0) > 0) leaves.push(n.activity.id);
      n.children.forEach(walk);
    };
    roots.forEach(walk);
    return { groupIds: groups, leafWithNotesIds: leaves };
  }, [roots]);

  const isExpanded = (n: ActivityNode<T>) =>
    n.isLeaf ? !collapsedNotes.has(n.activity.id) : expandedGroups.has(n.activity.id);

  const toggleIn =
    (setter: React.Dispatch<React.SetStateAction<Set<number>>>) => (id: number) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });

  const toggle = (n: ActivityNode<T>) =>
    (n.isLeaf ? toggleIn(setCollapsedNotes) : toggleIn(setExpandedGroups))(n.activity.id);

  const summary = useMemo(() => {
    let hours = 0;
    let leaves = 0;
    let finished = 0;
    let unscheduled = 0;
    let start: Date | null = null;
    let end: Date | null = null;
    for (const r of roots) {
      hours += r.totalHours;
      leaves += r.leafCount;
      finished += r.finishedLeafCount;
      unscheduled += r.unscheduledLeafCount;
      if (r.periodStart && (!start || r.periodStart < start)) start = r.periodStart;
      if (r.periodEnd && (!end || r.periodEnd > end)) end = r.periodEnd;
    }
    const status: ActivityStatus =
      leaves > 0 && finished === leaves ? "FINALIZADA" : "PENDIENTE";
    return { hours, leaves, finished, unscheduled, start, end, status };
  }, [roots]);

  const rootItems: BranchItem[] = roots.map((r) => ({
    key: `a-${r.activity.id}`,
    color: TONE[toneOf(r, now)].line,
    content: <TreeNode node={r} isExpanded={isExpanded} onToggle={toggle} now={now} />,
  }));

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-500">
          {summary.finished} de {summary.leaves} tareas finales finalizadas
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRootExpanded(true);
              setExpandedGroups(new Set(groupIds));
              setCollapsedNotes(new Set());
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            Expandir todo
          </button>
          <button
            type="button"
            onClick={() => {
              setExpandedGroups(new Set());
              setCollapsedNotes(new Set(leafWithNotesIds));
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            Contraer todo
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {roots.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">
          Esta lista aún no tiene actividades.
        </p>
      ) : (
        /* Lienzo con grilla de puntos */
        <div className="overflow-auto bg-slate-50 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:18px_18px] p-8">
          <div className="flex w-max items-center">
            <GroupCard
              title={listName}
              level="L1 · MASTER"
              icon={<Network className="h-4 w-4" />}
              tone="violet"
              status={summary.status}
              totalHours={summary.hours}
              periodStart={summary.start}
              periodEnd={summary.end}
              unscheduled={summary.unscheduled}
              hasIncoming={false}
              hasOutgoing
            />
            <Stub tone="violet" />
            <ToggleButton
              expanded={rootExpanded}
              count={roots.length}
              onClick={() => setRootExpanded((v) => !v)}
            />
            {rootExpanded && <Branches items={rootItems} />}
          </div>
        </div>
      )}
    </div>
  );
}

/* ======================================================================
 * Árbol general del dashboard: todas las listas y sus actividades.
 * Raíz "Todas las listas" → cada lista (L1 · MASTER) → sus actividades.
 * Reutiliza las mismas tarjetas y conexiones que el árbol de cada lista.
 * ==================================================================== */

/** Totales de un conjunto de actividades principales. */
function summarizeRoots(roots: ActivityNode[]) {
  let hours = 0;
  let leaves = 0;
  let finished = 0;
  let unscheduled = 0;
  let start: Date | null = null;
  let end: Date | null = null;
  for (const r of roots) {
    hours += r.totalHours;
    leaves += r.leafCount;
    finished += r.finishedLeafCount;
    unscheduled += r.unscheduledLeafCount;
    if (r.periodStart && (!start || r.periodStart < start)) start = r.periodStart;
    if (r.periodEnd && (!end || r.periodEnd > end)) end = r.periodEnd;
  }
  const status: ActivityStatus =
    leaves > 0 && finished === leaves ? "FINALIZADA" : "PENDIENTE";
  return { hours, leaves, finished, unscheduled, start, end, status };
}

export interface TreeListInput<T extends ActivityLike> {
  id: number;
  name: string;
  roots: ActivityNode<T>[];
}

export function AllListsTreeView<T extends ActivityLike>({
  lists,
  onRefresh,
  refreshing = false,
}: {
  lists: TreeListInput<T>[];
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  // Todo arranca contraído: se ven las listas y se abre la que interesa.
  const [rootExpanded, setRootExpanded] = useState(true);
  const [expandedLists, setExpandedLists] = useState<Set<number>>(() => new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set());
  const [collapsedNotes, setCollapsedNotes] = useState<Set<number>>(() => new Set());
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const summaries = useMemo(
    () => new Map(lists.map((l) => [l.id, summarizeRoots(l.roots)])),
    [lists]
  );
  const total = useMemo(() => summarizeRoots(lists.flatMap((l) => l.roots)), [lists]);

  const { groupIds, leafWithNotesIds } = useMemo(() => {
    const groups: number[] = [];
    const leaves: number[] = [];
    const walk = (n: ActivityNode<T>) => {
      if (!n.isLeaf) groups.push(n.activity.id);
      else if ((n.activity.completionNotes?.length ?? 0) > 0) leaves.push(n.activity.id);
      n.children.forEach(walk);
    };
    lists.forEach((l) => l.roots.forEach(walk));
    return { groupIds: groups, leafWithNotesIds: leaves };
  }, [lists]);

  const flip =
    (setter: React.Dispatch<React.SetStateAction<Set<number>>>) => (id: number) =>
      setter((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });

  const isExpanded = (n: ActivityNode<T>) =>
    n.isLeaf ? !collapsedNotes.has(n.activity.id) : expandedGroups.has(n.activity.id);
  const toggleNode = (n: ActivityNode<T>) =>
    (n.isLeaf ? flip(setCollapsedNotes) : flip(setExpandedGroups))(n.activity.id);
  const toggleList = flip(setExpandedLists);

  const listItems: BranchItem[] = lists.map((list) => {
    const s = summaries.get(list.id)!;
    const open = expandedLists.has(list.id);
    const count = list.roots.length;
    return {
      key: `l-${list.id}`,
      color: TONE.violet.line,
      content: (
        <div className="flex items-center">
          <GroupCard
            title={list.name}
            level="L1 · MASTER"
            icon={<Network className="h-4 w-4" />}
            tone="violet"
            status={s.status}
            totalHours={s.hours}
            periodStart={s.start}
            periodEnd={s.end}
            progress={{ done: s.finished, total: s.leaves }}
            unscheduled={s.unscheduled}
            hasIncoming
            hasOutgoing={count > 0}
            toggle={{
              expanded: open,
              count,
              label: count === 1 ? "actividad" : "actividades",
              onClick: () => toggleList(list.id),
            }}
          />
          {count > 0 && (
            <>
              <Stub tone="violet" />
              <ToggleButton expanded={open} count={count} onClick={() => toggleList(list.id)} />
              {open && (
                <Branches
                  items={list.roots.map((r) => ({
                    key: `a-${r.activity.id}`,
                    color: TONE[toneOf(r, now)].line,
                    content: (
                      <TreeNode node={r} isExpanded={isExpanded} onToggle={toggleNode} now={now} />
                    ),
                  }))}
                />
              )}
            </>
          )}
        </div>
      ),
    };
  });

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-500">
          {lists.length} {lists.length === 1 ? "lista" : "listas"} · {total.finished} de{" "}
          {total.leaves} tareas finales finalizadas
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRootExpanded(true);
              setExpandedLists(new Set(lists.map((l) => l.id)));
              setExpandedGroups(new Set(groupIds));
              setCollapsedNotes(new Set());
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            Expandir todo
          </button>
          <button
            type="button"
            onClick={() => {
              setExpandedLists(new Set());
              setExpandedGroups(new Set());
              setCollapsedNotes(new Set(leafWithNotesIds));
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
          >
            Contraer todo
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 transition"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {lists.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500">Todavía no hay listas creadas.</p>
      ) : (
        <div className="overflow-auto bg-slate-50 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:18px_18px] p-8">
          <div className="flex w-max items-center">
            <GroupCard
              title="Todas las listas"
              level="GENERAL"
              icon={<FolderTree className="h-4 w-4" />}
              tone="slate"
              status={total.status}
              totalHours={total.hours}
              periodStart={total.start}
              periodEnd={total.end}
              progress={{ done: total.finished, total: total.leaves }}
              unscheduled={total.unscheduled}
              hasIncoming={false}
              hasOutgoing
            />
            <Stub tone="slate" />
            <ToggleButton
              expanded={rootExpanded}
              count={lists.length}
              onClick={() => setRootExpanded((v) => !v)}
            />
            {rootExpanded && <Branches items={listItems} />}
          </div>
        </div>
      )}
    </div>
  );
}
