import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildActivityTree,
  formatElapsedEs,
  formatHoursAndDays,
  isOverdue,
  overdueMs,
  wouldCreateCycle,
  type ActivityLike,
  type ActivityTimeUnit,
} from "./activityTree.ts";

const HOUR = 60 * 60 * 1000;
const UNIT_MS: Record<ActivityTimeUnit, number> = {
  MINUTES: 60 * 1000,
  HOURS: HOUR,
  DAYS: 24 * HOUR,
};

let nextId = 1;
let nextPos = 0;

function node(
  name: string,
  parentId: number | null,
  schedule?: { start: string; amount: number; unit: ActivityTimeUnit; done?: boolean }
): ActivityLike {
  const start = schedule ? new Date(schedule.start) : null;
  return {
    id: nextId++,
    parentId,
    name,
    position: nextPos++,
    startDate: start,
    estimatedAmount: schedule?.amount ?? null,
    estimatedUnit: schedule?.unit ?? null,
    estimatedEndDate:
      start && schedule
        ? new Date(start.getTime() + schedule.amount * UNIT_MS[schedule.unit])
        : null,
    actualEndDate: schedule?.done ? new Date(start!.getTime() + HOUR) : null,
  };
}

/** Ejemplo del VPS: 3 fases, 11 tareas finales. */
function buildVpsExample(opts: { phase1Done?: boolean; allDone?: boolean } = {}) {
  nextId = 1;
  nextPos = 0;
  const d1 = !!(opts.phase1Done || opts.allDone);
  const d = !!opts.allDone;
  const root = node("Configurar el VPS", null);
  const f1 = node("Fase 1: Seguridad base", root.id);
  const f2 = node("Fase 2: Entorno de desarrollo", root.id);
  const f3 = node("Fase 3: Base de datos", root.id);
  const acts: ActivityLike[] = [
    root,
    f1,
    node("Firewall de Hostinger", f1.id, { start: "2026-11-02T09:00:00", amount: 30, unit: "MINUTES", done: d1 }),
    node("Actualizar sistema", f1.id, { start: "2026-11-02T10:00:00", amount: 1, unit: "HOURS", done: d1 }),
    node("Asignar usuario admin", f1.id, { start: "2026-11-02T11:00:00", amount: 1.5, unit: "HOURS", done: d1 }),
    node("Actualizaciones automáticas", f1.id, { start: "2026-11-02T14:00:00", amount: 1, unit: "HOURS", done: d1 }),
    f2,
    node("Instalar Node", f2.id, { start: "2026-11-03T09:00:00", amount: 2, unit: "HOURS", done: d }),
    node("Instalar PM2", f2.id, { start: "2026-11-03T11:00:00", amount: 1, unit: "HOURS", done: d }),
    node("Configurar rotación de logs de PM2", f2.id, { start: "2026-11-03T14:00:00", amount: 1, unit: "HOURS", done: d }),
    f3,
    node("Instalar MySQL", f3.id, { start: "2026-11-04T09:00:00", amount: 2, unit: "HOURS", done: d }),
    node("Asegurar la instalación", f3.id, { start: "2026-11-04T11:00:00", amount: 1, unit: "HOURS", done: d }),
    // 1 día estimado = 8 h de trabajo
    node("Crear base de datos y usuarios", f3.id, { start: "2026-11-05T09:00:00", amount: 1, unit: "DAYS", done: d }),
    node("Acceso exclusivo local", f3.id, { start: "2026-11-06T09:00:00", amount: 1, unit: "HOURS", done: d }),
  ];
  return { acts, root, f1, f2, f3 };
}

test("tiempo total por fase y total general (1 día = 8 h)", () => {
  const { acts, root, f1, f2, f3 } = buildVpsExample();
  const { byId } = buildActivityTree(acts);

  assert.equal(byId.get(f1.id)!.totalHours, 4); // 0,5 + 1 + 1,5 + 1
  assert.equal(byId.get(f2.id)!.totalHours, 4); // 2 + 1 + 1
  assert.equal(byId.get(f3.id)!.totalHours, 12); // 2 + 1 + 8 + 1
  assert.equal(byId.get(root.id)!.totalHours, 20);
  assert.equal(byId.get(root.id)!.totalDays, 2.5);
  assert.equal(formatHoursAndDays(20), "20 h · 2,5 días");
  assert.equal(byId.get(root.id)!.leafCount, 11);
});

test("período = inicio más temprano y fin más tardío de las tareas finales", () => {
  const { acts, root, f3 } = buildVpsExample();
  const { byId } = buildActivityTree(acts);
  const r = byId.get(root.id)!;
  assert.deepEqual(r.periodStart, new Date("2026-11-02T09:00:00"));
  assert.deepEqual(r.periodEnd, new Date("2026-11-06T10:00:00"));
  // "Crear base de datos" dura 1 día de calendario en el período (fin estimado real).
  const p3 = byId.get(f3.id)!;
  assert.deepEqual(p3.periodStart, new Date("2026-11-04T09:00:00"));
  assert.deepEqual(p3.periodEnd, new Date("2026-11-06T10:00:00"));
});

test("estado: actividades con hijas se calculan desde sus tareas finales", () => {
  let { acts, root, f1, f2 } = buildVpsExample();
  let { byId } = buildActivityTree(acts);
  assert.equal(byId.get(f1.id)!.status, "PENDIENTE");
  assert.equal(byId.get(root.id)!.status, "PENDIENTE");

  ({ acts, root, f1, f2 } = buildVpsExample({ phase1Done: true }));
  ({ byId } = buildActivityTree(acts));
  assert.equal(byId.get(f1.id)!.status, "FINALIZADA");
  assert.equal(byId.get(f2.id)!.status, "PENDIENTE");
  assert.equal(byId.get(root.id)!.status, "PENDIENTE");

  ({ acts, root } = buildVpsExample({ allDone: true }));
  ({ byId } = buildActivityTree(acts));
  assert.equal(byId.get(root.id)!.status, "FINALIZADA");
});

test("agregar una tarea pendiente vuelve pendiente a una actividad finalizada", () => {
  const { acts, root, f1 } = buildVpsExample({ allDone: true });
  assert.equal(buildActivityTree(acts).byId.get(f1.id)!.status, "FINALIZADA");

  acts.push(node("Instalar fail2ban", f1.id, { start: "2026-11-07T09:00:00", amount: 1, unit: "HOURS" }));
  const { byId } = buildActivityTree(acts);
  assert.equal(byId.get(f1.id)!.status, "PENDIENTE");
  assert.equal(byId.get(root.id)!.status, "PENDIENTE");
  assert.equal(byId.get(root.id)!.totalHours, 21);
});

test("tarea final sin horario cuenta 0 horas y se marca", () => {
  const { acts, root, f2 } = buildVpsExample();
  const sin = node("Documentar configuración", f2.id);
  acts.push(sin);
  const { byId } = buildActivityTree(acts);
  const leaf = byId.get(sin.id)!;
  assert.equal(leaf.isLeaf, true);
  assert.equal(leaf.hasSchedule, false);
  assert.equal(leaf.totalHours, 0);
  assert.equal(byId.get(f2.id)!.totalHours, 4);
  assert.equal(byId.get(f2.id)!.unscheduledLeafCount, 1);
  assert.equal(byId.get(root.id)!.totalHours, 20);
});

test("niveles sin límite: más de 3 niveles", () => {
  nextId = 1;
  nextPos = 0;
  const a = node("N1", null);
  const b = node("N2", a.id);
  const c = node("N3", b.id);
  const d = node("N4", c.id);
  const e = node("N5", d.id, { start: "2026-11-02T09:00:00", amount: 3, unit: "HOURS" });
  const { byId } = buildActivityTree([a, b, c, d, e]);
  assert.equal(byId.get(e.id)!.depth, 4);
  assert.deepEqual(byId.get(e.id)!.path, ["N1", "N2", "N3", "N4"]);
  assert.equal(byId.get(a.id)!.totalHours, 3);
});

test("detección de ciclos", () => {
  const { acts, root, f1 } = buildVpsExample();
  const firewall = acts.find((x) => x.name === "Firewall de Hostinger")!;
  assert.equal(wouldCreateCycle(root.id, root.id, acts), true); // dentro de sí misma
  assert.equal(wouldCreateCycle(root.id, f1.id, acts), true); // dentro de una hija
  assert.equal(wouldCreateCycle(root.id, firewall.id, acts), true); // dentro de una nieta
  assert.equal(wouldCreateCycle(firewall.id, root.id, acts), false);
  assert.equal(wouldCreateCycle(f1.id, null, acts), false);
});

test("datos con ciclo no cuelgan el cálculo", () => {
  nextId = 1;
  const a = { ...node("A", null), parentId: 2 };
  const b = node("B", 1);
  const { roots, byId } = buildActivityTree([a, b]);
  assert.equal(roots.length, 1);
  assert.equal(byId.size, 2);
});

test("vencida: tarea pendiente con fin estimado pasado (marca visual)", () => {
  const { acts, root, f1 } = buildVpsExample({ phase1Done: true });
  const { byId } = buildActivityTree(acts);
  const instalarNode = acts.find((x) => x.name === "Instalar Node")!; // fin 03/11 11:00
  const firewall = acts.find((x) => x.name === "Firewall de Hostinger")!; // finalizada
  const now = new Date("2026-11-03T11:45:00");

  assert.equal(isOverdue(byId.get(instalarNode.id)!, now), true);
  assert.equal(overdueMs(byId.get(instalarNode.id)!, now), 45 * 60 * 1000);
  assert.equal(isOverdue(byId.get(firewall.id)!, now), false); // finalizada
  assert.equal(isOverdue(byId.get(f1.id)!, now), false); // actividad con hijas
  assert.equal(isOverdue(byId.get(root.id)!, now), false);
  assert.equal(isOverdue(byId.get(instalarNode.id)!, new Date("2026-11-03T10:00:00")), false); // en plazo
  // El estado calculado no cambia
  assert.equal(byId.get(instalarNode.id)!.status, "PENDIENTE");
});

test("formato del atraso", () => {
  assert.equal(formatElapsedEs(45 * 60000), "45 minutos");
  assert.equal(formatElapsedEs(60 * 60000), "1 hora");
  assert.equal(formatElapsedEs(135 * 60000), "2 h 15 min");
  assert.equal(formatElapsedEs((2 * 24 + 4) * 3600000), "2 días 4 h");
});
