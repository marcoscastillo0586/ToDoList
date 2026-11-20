/**
 * Cálculo único de jerarquía, tiempo y estado de actividades.
 *
 * La lista, el calendario, el dashboard, la vista de árbol y las validaciones
 * del backend usan este módulo, para que todos muestren siempre lo mismo.
 *
 * Reglas:
 * - Tarea final = actividad sin hijas. Solo ellas tienen horario propio.
 * - Duración de una tarea final = tiempo ESTIMADO (cantidad × unidad), contando
 *   1 día = 8 horas de trabajo. Sin horario cuenta 0 horas.
 * - Actividad con hijas: tiempo total = suma de sus tareas finales (todos los
 *   niveles); período = inicio más temprano → fin estimado más tardío.
 * - Estado: tarea final "Finalizada" si tiene finalización real. Actividad con
 *   hijas "Finalizada" solo si todas sus tareas finales lo están.
 *
 * Este archivo no importa nada (solo tipos) para poder probarse con `node --test`.
 */

export type ActivityTimeUnit = "MINUTES" | "HOURS" | "DAYS";
export type ActivityStatus = "PENDIENTE" | "FINALIZADA";

export const WORK_HOURS_PER_DAY = 8;

const HOURS_PER_UNIT: Record<ActivityTimeUnit, number> = {
  MINUTES: 1 / 60,
  HOURS: 1,
  DAYS: WORK_HOURS_PER_DAY,
};

type DateLike = string | Date | null | undefined;

export interface ActivityLike {
  id: number;
  parentId: number | null;
  name: string;
  position: number;
  startDate: DateLike;
  estimatedAmount: number | null;
  estimatedUnit: ActivityTimeUnit | null;
  estimatedEndDate: DateLike;
  actualEndDate: DateLike;
  /** Observación libre (opcional). No interviene en los cálculos. */
  observation?: string | null;
  /** Observaciones cargadas al finalizar (una por renglón). No intervienen en los cálculos. */
  completionNotes?: { id: number; text: string }[];
}

export interface ActivityNode<T extends ActivityLike = ActivityLike> {
  activity: T;
  children: ActivityNode<T>[];
  /** 0 = actividad principal. */
  depth: number;
  /** Nombres de los ancestros, de la raíz hacia abajo. */
  path: string[];
  isLeaf: boolean;
  /** Solo tareas finales: si tienen horario cargado. */
  hasSchedule: boolean;
  totalHours: number;
  totalDays: number;
  periodStart: Date | null;
  periodEnd: Date | null;
  status: ActivityStatus;
  leafCount: number;
  finishedLeafCount: number;
  /** Tareas finales sin horario dentro de la rama (incluida ella misma si es final). */
  unscheduledLeafCount: number;
}

export interface ActivityForest<T extends ActivityLike = ActivityLike> {
  roots: ActivityNode<T>[];
  byId: Map<number, ActivityNode<T>>;
}

function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function activityHasSchedule(a: ActivityLike): boolean {
  return (
    toDate(a.startDate) !== null &&
    toDate(a.estimatedEndDate) !== null &&
    typeof a.estimatedAmount === "number" &&
    a.estimatedAmount > 0 &&
    a.estimatedUnit !== null &&
    a.estimatedUnit !== undefined
  );
}

/** Horas de trabajo estimadas de una tarea final (1 día = 8 h). */
export function leafWorkHours(a: ActivityLike): number {
  if (!activityHasSchedule(a)) return 0;
  return a.estimatedAmount! * HOURS_PER_UNIT[a.estimatedUnit!];
}

export function hoursToWorkDays(hours: number): number {
  return hours / WORK_HOURS_PER_DAY;
}

/**
 * Mismo criterio que la lista de hoy: por inicio (período en los padres),
 * las que no tienen horario al final, y luego por posición manual.
 */
function sortSiblings<T extends ActivityLike>(nodes: ActivityNode<T>[]): void {
  nodes.sort((x, y) => {
    const xs = x.periodStart?.getTime() ?? Number.POSITIVE_INFINITY;
    const ys = y.periodStart?.getTime() ?? Number.POSITIVE_INFINITY;
    if (xs !== ys) return xs < ys ? -1 : 1;
    if (x.activity.position !== y.activity.position) {
      return x.activity.position - y.activity.position;
    }
    return x.activity.id - y.activity.id;
  });
}

/**
 * Arma el árbol y calcula tiempo, período y estado de cada actividad.
 * Una actividad cuyo padre no está en el conjunto se trata como principal.
 * Si los datos tuvieran un ciclo, se corta para no entrar en un bucle infinito.
 */
export function buildActivityTree<T extends ActivityLike>(
  activities: readonly T[]
): ActivityForest<T> {
  const byId = new Map<number, ActivityNode<T>>();
  for (const a of activities) {
    byId.set(a.id, {
      activity: a,
      children: [],
      depth: 0,
      path: [],
      isLeaf: true,
      hasSchedule: false,
      totalHours: 0,
      totalDays: 0,
      periodStart: null,
      periodEnd: null,
      status: "PENDIENTE",
      leafCount: 0,
      finishedLeafCount: 0,
      unscheduledLeafCount: 0,
    });
  }

  const roots: ActivityNode<T>[] = [];
  for (const node of byId.values()) {
    const parentId = node.activity.parentId;
    const parent =
      parentId !== null && parentId !== undefined ? byId.get(parentId) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const visited = new Set<number>();

  const compute = (node: ActivityNode<T>, depth: number, path: string[]) => {
    visited.add(node.activity.id);
    node.depth = depth;
    node.path = path;
    // Un hijo ya visitado indicaría un ciclo: se descarta.
    node.children = node.children.filter((c) => !visited.has(c.activity.id));
    node.isLeaf = node.children.length === 0;

    if (node.isLeaf) {
      const a = node.activity;
      node.hasSchedule = activityHasSchedule(a);
      node.totalHours = leafWorkHours(a);
      node.periodStart = node.hasSchedule ? toDate(a.startDate) : null;
      node.periodEnd = node.hasSchedule ? toDate(a.estimatedEndDate) : null;
      node.leafCount = 1;
      node.finishedLeafCount = toDate(a.actualEndDate) !== null ? 1 : 0;
      node.unscheduledLeafCount = node.hasSchedule ? 0 : 1;
    } else {
      const childPath = [...path, node.activity.name];
      let hours = 0;
      let start: Date | null = null;
      let end: Date | null = null;
      let leaves = 0;
      let finished = 0;
      let unscheduled = 0;
      for (const child of node.children) {
        compute(child, depth + 1, childPath);
        hours += child.totalHours;
        leaves += child.leafCount;
        finished += child.finishedLeafCount;
        unscheduled += child.unscheduledLeafCount;
        if (child.periodStart && (!start || child.periodStart < start)) {
          start = child.periodStart;
        }
        if (child.periodEnd && (!end || child.periodEnd > end)) {
          end = child.periodEnd;
        }
      }
      sortSiblings(node.children);
      node.hasSchedule = false;
      node.totalHours = hours;
      node.periodStart = start;
      node.periodEnd = end;
      node.leafCount = leaves;
      node.finishedLeafCount = finished;
      node.unscheduledLeafCount = unscheduled;
    }

    node.totalDays = hoursToWorkDays(node.totalHours);
    node.status =
      node.leafCount > 0 && node.finishedLeafCount === node.leafCount
        ? "FINALIZADA"
        : "PENDIENTE";
  };

  for (const root of roots) compute(root, 0, []);

  // Nodos atrapados en un ciclo (sin llegar desde ninguna raíz): pasan a principales.
  for (const node of byId.values()) {
    if (!visited.has(node.activity.id)) {
      roots.push(node);
      compute(node, 0, []);
    }
  }

  sortSiblings(roots);
  return { roots, byId };
}

/** Recorre el árbol en profundidad (orden de visualización con sangría). */
export function flattenActivityTree<T extends ActivityLike>(
  roots: readonly ActivityNode<T>[]
): ActivityNode<T>[] {
  const out: ActivityNode<T>[] = [];
  const walk = (n: ActivityNode<T>) => {
    out.push(n);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return out;
}

export function getDescendantIds(
  activityId: number,
  activities: readonly Pick<ActivityLike, "id" | "parentId">[]
): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const a of activities) {
    if (a.parentId === null || a.parentId === undefined) continue;
    const arr = childrenOf.get(a.parentId) ?? [];
    arr.push(a.id);
    childrenOf.set(a.parentId, arr);
  }
  const result = new Set<number>();
  const stack = [...(childrenOf.get(activityId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return result;
}

/** true si poner `newParentId` como padre de `activityId` crearía un ciclo. */
export function wouldCreateCycle(
  activityId: number,
  newParentId: number | null,
  activities: readonly Pick<ActivityLike, "id" | "parentId">[]
): boolean {
  if (newParentId === null) return false;
  if (newParentId === activityId) return true;
  return getDescendantIds(activityId, activities).has(newParentId);
}

function formatDecimalEs(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (Number.isInteger(rounded)) return rounded.toString();
  return rounded.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

/** Ej.: 20 → "20 h · 2,5 días" */
export function formatHoursAndDays(hours: number): string {
  const days = hoursToWorkDays(hours);
  const dayLabel = Math.round(days * 100) / 100 === 1 ? "día" : "días";
  return `${formatDecimalEs(hours)} h · ${formatDecimalEs(days)} ${dayLabel}`;
}

/**
 * Milisegundos de atraso de una tarea final pendiente cuyo fin estimado ya pasó.
 * 0 si no está vencida (finalizada, sin horario, actividad con hijas o aún en plazo).
 * "Vencida" es una marca visual: el estado sigue siendo PENDIENTE en los cálculos.
 */
export function overdueMs(node: ActivityNode, now: Date = new Date()): number {
  if (!node.isLeaf || node.status !== "PENDIENTE" || !node.periodEnd) return 0;
  const diff = now.getTime() - node.periodEnd.getTime();
  return diff > 0 ? diff : 0;
}

export function isOverdue(node: ActivityNode, now: Date = new Date()): boolean {
  return overdueMs(node, now) > 0;
}

/** Ej.: 45 min → "45 minutos"; 135 min → "2 h 15 min"; 2 d 4 h → "2 días 4 h". */
export function formatElapsedEs(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes} ${totalMinutes === 1 ? "minuto" : "minutos"}`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    if (minutes === 0) return `${totalHours} ${totalHours === 1 ? "hora" : "horas"}`;
    return `${totalHours} h ${minutes} min`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const dayText = `${days} ${days === 1 ? "día" : "días"}`;
  return hours === 0 ? dayText : `${dayText} ${hours} h`;
}

export const STATUS_LABEL: Record<ActivityStatus, string> = {
  PENDIENTE: "Pendiente",
  FINALIZADA: "Finalizada",
};
