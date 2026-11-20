import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateEstimatedEndDate, TimeUnit } from "@/lib/timeUtils";
import {
  CLEARED_SCHEDULE,
  clearScheduleOfNewParent,
  COMPLETION_NOTES_INCLUDE,
  parseCompletionNotes,
  parseObservation,
  parseParentId,
  validateParent,
} from "@/lib/activityHierarchy";

type RouteParams = { params: Promise<{ activityId: string }> };

const VALID_UNITS: TimeUnit[] = ["MINUTES", "HOURS", "DAYS"];

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { activityId } = await params;
    const id = Number(activityId);
    if (Number.isNaN(id)) {
      return badRequest("ID de actividad inválido.");
    }

    const existing = await prisma.activity.findUnique({
      where: { id },
      include: { _count: { select: { children: true } } },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Actividad no encontrada." },
        { status: 404 }
      );
    }

    const body = await request.json();
    const hasChildren = existing._count.children > 0;

    const nextName =
      body.name !== undefined
        ? typeof body.name === "string"
          ? body.name.trim()
          : ""
        : existing.name;

    if (!nextName) {
      return badRequest("El nombre de la actividad es obligatorio.");
    }

    // Observación opcional: undefined = sin cambios
    const parsedObservation = parseObservation(body.observation);
    const nextObservation =
      parsedObservation === undefined ? existing.observation : parsedObservation;

    // Observaciones de finalización (solo tareas finales): undefined = sin cambios
    const completionNotes = parseCompletionNotes(body.completionNotes);
    if (completionNotes === "invalid") {
      return badRequest("Las observaciones de finalización son inválidas.");
    }
    const notesToSave: string[] | undefined = completionNotes;

    // --- Padre ---
    const parsedParent = parseParentId(body.parentId);
    if (parsedParent === "invalid") {
      return badRequest("La actividad padre es inválida.");
    }
    const parentChanged =
      parsedParent !== undefined && parsedParent !== existing.parentId;
    if (parentChanged && parsedParent !== null) {
      const parentError = await validateParent(
        prisma,
        existing.listId,
        parsedParent,
        id
      );
      if (parentError) return badRequest(parentError);
    }
    const nextParentId = parsedParent === undefined ? existing.parentId : parsedParent;

    // --- Actividad con hijas: sin horario ni finalización manual ---
    if (hasChildren) {
      const touchesSchedule =
        (body.startDate !== undefined && body.startDate !== null && body.startDate !== "") ||
        (body.actualEndDate !== undefined && body.actualEndDate !== null) ||
        (completionNotes !== undefined && completionNotes.length > 0);
      if (touchesSchedule) {
        return badRequest(
          "Una actividad con actividades hijas no tiene horario propio ni se finaliza a mano: su tiempo y su estado se calculan a partir de sus tareas finales."
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        if (parentChanged && nextParentId !== null) {
          await clearScheduleOfNewParent(tx, nextParentId);
        }
        return tx.activity.update({
          where: { id },
          data: {
            name: nextName,
            parentId: nextParentId,
            observation: nextObservation,
            ...CLEARED_SCHEDULE,
          },
          include: { list: true },
        });
      });
      return NextResponse.json(updated);
    }

    // --- Tarea final ---
    // No permitir volver a estado pendiente si ya estaba finalizada
    if (existing.actualEndDate !== null && body.actualEndDate === null) {
      return badRequest("Una actividad finalizada no puede volver a estado pendiente.");
    }

    // startDate: undefined = sin cambios; null / "" = quitar horario ("sin horario")
    const clearSchedule = body.startDate === null || body.startDate === "";
    let nextStartDate: Date | null = existing.startDate;
    let nextEstimatedAmount: number | null = existing.estimatedAmount;
    let nextEstimatedUnit: TimeUnit | null = existing.estimatedUnit as TimeUnit | null;
    let nextEstimatedEndDate: Date | null = existing.estimatedEndDate;

    if (clearSchedule) {
      nextStartDate = null;
      nextEstimatedAmount = null;
      nextEstimatedUnit = null;
      nextEstimatedEndDate = null;
    } else {
      if (body.startDate !== undefined) {
        nextStartDate = new Date(body.startDate);
        if (Number.isNaN(nextStartDate.getTime())) {
          return badRequest("La fecha y hora de inicio es inválida.");
        }
      }
      if (body.estimatedAmount !== undefined) {
        nextEstimatedAmount = Number(body.estimatedAmount);
      }
      if (body.estimatedUnit !== undefined) {
        nextEstimatedUnit = body.estimatedUnit as TimeUnit;
      }

      if (nextStartDate !== null) {
        if (
          nextEstimatedAmount === null ||
          Number.isNaN(nextEstimatedAmount) ||
          nextEstimatedAmount <= 0
        ) {
          return badRequest("La cantidad del tiempo estimado debe ser mayor a 0.");
        }
        if (nextEstimatedUnit === null || !VALID_UNITS.includes(nextEstimatedUnit)) {
          return badRequest("El tipo de tiempo estimado debe ser minutos, horas o días.");
        }
        nextEstimatedEndDate = calculateEstimatedEndDate(
          nextStartDate,
          nextEstimatedAmount,
          nextEstimatedUnit
        );
      }
    }

    let nextActualEndDate: Date | null = existing.actualEndDate;
    if (body.actualEndDate !== undefined) {
      if (body.actualEndDate === null || body.actualEndDate === "") {
        return badRequest("Debe ingresar una fecha y hora de finalización real válida.");
      }
      const parsedActual = new Date(body.actualEndDate);
      if (Number.isNaN(parsedActual.getTime())) {
        return badRequest("La fecha y hora de finalización real es inválida.");
      }
      nextActualEndDate = parsedActual;
    }

    if (
      nextActualEndDate !== null &&
      nextStartDate !== null &&
      nextActualEndDate.getTime() < nextStartDate.getTime()
    ) {
      return badRequest(
        "La fecha de finalización real no puede ser anterior a la fecha de inicio."
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (parentChanged && nextParentId !== null) {
        await clearScheduleOfNewParent(tx, nextParentId);
      }
      await tx.activity.update({
        where: { id },
        data: {
          name: nextName,
          parentId: nextParentId,
          observation: nextObservation,
          startDate: nextStartDate,
          estimatedAmount: nextEstimatedAmount,
          estimatedUnit: nextEstimatedUnit,
          estimatedEndDate: nextEstimatedEndDate,
          actualEndDate: nextActualEndDate,
        },
      });
      if (notesToSave !== undefined) {
        // Se reemplazan todas, en el orden recibido
        await tx.completionNote.deleteMany({ where: { activityId: id } });
        if (notesToSave.length > 0) {
          await tx.completionNote.createMany({
            data: notesToSave.map((text, position) => ({
              activityId: id,
              text,
              position,
            })),
          });
        }
      }
      return tx.activity.findUniqueOrThrow({
        where: { id },
        include: { list: true, ...COMPLETION_NOTES_INCLUDE },
      });
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error al actualizar actividad:", error);
    return NextResponse.json(
      { error: "Error al actualizar la actividad." },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { activityId } = await params;
    const id = Number(activityId);
    if (Number.isNaN(id)) {
      return badRequest("ID de actividad inválido.");
    }

    const existing = await prisma.activity.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Actividad no encontrada." },
        { status: 404 }
      );
    }

    // Las hijas suben un nivel: quedan bajo el padre de la actividad borrada
    // (o como principales si la borrada era principal).
    const { count: movedChildren } = await prisma.$transaction(async (tx) => {
      const moved = await tx.activity.updateMany({
        where: { parentId: id },
        data: { parentId: existing.parentId },
      });
      await tx.activity.delete({ where: { id } });
      return moved;
    });

    return NextResponse.json({ deleted: true, id, movedChildren });
  } catch (error) {
    console.error("Error al eliminar actividad:", error);
    return NextResponse.json(
      { error: "Error al eliminar la actividad." },
      { status: 500 }
    );
  }
}
