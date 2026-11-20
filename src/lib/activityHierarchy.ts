import type { Prisma, PrismaClient } from "@prisma/client";
import { wouldCreateCycle } from "@/lib/activityTree";

type Db = PrismaClient | Prisma.TransactionClient;

/** Campos de horario y finalización en blanco (una actividad con hijas no los tiene). */
export const CLEARED_SCHEDULE = {
  startDate: null,
  estimatedAmount: null,
  estimatedUnit: null,
  estimatedEndDate: null,
  actualEndDate: null,
} as const;

/** Incluir en las consultas: observaciones de finalización en orden. */
export const COMPLETION_NOTES_INCLUDE = {
  completionNotes: {
    select: { id: true, text: true },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
  },
};

/**
 * Observaciones de finalización del body (una por renglón):
 * undefined = sin cambios; se descartan las vacías. "invalid" si no es una lista de textos.
 */
export function parseCompletionNotes(raw: unknown): string[] | undefined | "invalid" {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((n) => typeof n !== "string")) return "invalid";
  return (raw as string[]).map((n) => n.trim()).filter((n) => n !== "");
}

/** Observación del body: undefined = sin cambios; vacía = null. */
export function parseObservation(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Interpreta `parentId` del body:
 * - undefined → no viene (sin cambios)
 * - null / "" → actividad principal
 * - número    → id del padre
 * Devuelve "invalid" si no es un id válido.
 */
export function parseParentId(raw: unknown): number | null | undefined | "invalid" {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : "invalid";
}

/**
 * Valida que `parentId` pueda ser padre de `activityId` (null = actividad nueva):
 * debe existir, estar en la misma lista y no generar un ciclo.
 * Devuelve un mensaje de error o null si es válido.
 */
export async function validateParent(
  db: Db,
  listId: number,
  parentId: number,
  activityId: number | null
): Promise<string | null> {
  const parent = await db.activity.findUnique({
    where: { id: parentId },
    select: { id: true, listId: true },
  });
  if (!parent) return "La actividad padre no existe.";
  if (parent.listId !== listId) {
    return "La actividad padre debe pertenecer a la misma lista.";
  }
  if (activityId !== null) {
    const listActivities = await db.activity.findMany({
      where: { listId },
      select: { id: true, parentId: true },
    });
    if (wouldCreateCycle(activityId, parentId, listActivities)) {
      return "No se puede mover una actividad dentro de sí misma ni de una de sus actividades hijas.";
    }
  }
  return null;
}

/**
 * Cuando una tarea final recibe su primera hija pasa a ser actividad con hijas:
 * su horario, su finalización y las observaciones de finalización se borran
 * (su tiempo y estado pasan a calcularse). Su observación general se mantiene.
 */
export async function clearScheduleOfNewParent(db: Db, parentId: number): Promise<void> {
  await db.activity.update({
    where: { id: parentId },
    data: CLEARED_SCHEDULE,
  });
  await db.completionNote.deleteMany({ where: { activityId: parentId } });
}
