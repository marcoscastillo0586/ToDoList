import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateEstimatedEndDate, TimeUnit } from "@/lib/timeUtils";
import {
  clearScheduleOfNewParent,
  parseObservation,
  parseParentId,
  validateParent,
} from "@/lib/activityHierarchy";
import { getSessionUser, unauthorized } from "@/lib/auth/currentUser";
import { MAX_ACTIVITY_NAME_LENGTH } from "@/lib/limits";

type RouteParams = { params: Promise<{ listId: string }> };

const VALID_UNITS: TimeUnit[] = ["MINUTES", "HOURS", "DAYS"];

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const { listId } = await params;
    const id = Number(listId);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "ID de lista inválido." }, { status: 400 });
    }

    const list = await prisma.todoList.findFirst({ where: { id, userId: user.userId } });
    if (!list) {
      return NextResponse.json({ error: "Lista no encontrada." }, { status: 404 });
    }

    const activities = await prisma.activity.findMany({
      where: { listId: id },
      orderBy: [{ startDate: "asc" }, { position: "asc" }],
    });

    return NextResponse.json(activities);
  } catch (error) {
    console.error("Error al obtener actividades:", error);
    return NextResponse.json(
      { error: "Error al obtener actividades." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const { listId } = await params;
    const id = Number(listId);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "ID de lista inválido." }, { status: 400 });
    }

    const list = await prisma.todoList.findFirst({ where: { id, userId: user.userId } });
    if (!list) {
      return NextResponse.json({ error: "Lista no encontrada." }, { status: 404 });
    }

    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const startDateRaw = body?.startDate;
    const estimatedAmount = Number(body?.estimatedAmount);
    const estimatedUnit = body?.estimatedUnit as TimeUnit;
    const additionalDates: string[] = Array.isArray(body?.additionalDates)
      ? body.additionalDates.filter((d: unknown) => typeof d === "string")
      : [];
    const parentId = parseParentId(body?.parentId);
    const observation = parseObservation(body?.observation) ?? null;

    if (!name) {
      return NextResponse.json(
        { error: "El nombre de la actividad es obligatorio." },
        { status: 400 }
      );
    }

    if (name.length > MAX_ACTIVITY_NAME_LENGTH) {
      return NextResponse.json(
        { error: `El nombre de la actividad no puede superar los ${MAX_ACTIVITY_NAME_LENGTH} caracteres.` },
        { status: 400 }
      );
    }

    if (parentId === "invalid") {
      return NextResponse.json(
        { error: "La actividad padre es inválida." },
        { status: 400 }
      );
    }

    if (parentId) {
      const parentError = await validateParent(prisma, id, parentId, null);
      if (parentError) {
        return NextResponse.json({ error: parentError }, { status: 400 });
      }
    }

    // El horario es opcional: sin fecha de inicio la tarea queda "sin horario".
    const hasSchedule =
      startDateRaw !== undefined && startDateRaw !== null && startDateRaw !== "";

    if (hasSchedule) {
      if (Number.isNaN(new Date(startDateRaw).getTime())) {
        return NextResponse.json(
          { error: "La fecha y hora de inicio es inválida." },
          { status: 400 }
        );
      }

      if (Number.isNaN(estimatedAmount) || estimatedAmount <= 0) {
        return NextResponse.json(
          { error: "La cantidad del tiempo estimado debe ser mayor a 0." },
          { status: 400 }
        );
      }

      if (!VALID_UNITS.includes(estimatedUnit)) {
        return NextResponse.json(
          { error: "El tipo de tiempo estimado debe ser minutos, horas o días." },
          { status: 400 }
        );
      }
    }

    const lastActivity = await prisma.activity.findFirst({
      where: { listId: id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const nextPos = (lastActivity?.position ?? -1) + 1;

    // Crear la actividad en la lista actual. Si su padre era una tarea final,
    // el padre pierde su horario propio (su tiempo pasa a calcularse).
    const primaryActivity = await prisma.$transaction(async (tx) => {
      if (parentId) {
        await clearScheduleOfNewParent(tx, parentId);
      }
      return tx.activity.create({
        data: {
          listId: id,
          userId: user.userId,
          parentId: parentId ?? null,
          name,
          observation,
          position: nextPos,
          ...(hasSchedule
            ? {
                startDate: new Date(startDateRaw),
                estimatedAmount,
                estimatedUnit,
                estimatedEndDate: calculateEstimatedEndDate(
                  new Date(startDateRaw),
                  estimatedAmount,
                  estimatedUnit
                ),
              }
            : {}),
          actualEndDate: null,
        },
      });
    });

    if (!hasSchedule) {
      return NextResponse.json(primaryActivity, { status: 201 });
    }

    const startDate = new Date(startDateRaw);
    const baseDateKey = toLocalDateKey(startDate);
    const baseHours = startDate.getHours();
    const baseMinutes = startDate.getMinutes();

    // Si se tildaron días adicionales al crearla, replicarla en esos días
    const seenKeys = new Set<string>([baseDateKey]);
    const extraDates: Date[] = [];

    for (const dateKey of additionalDates) {
      if (seenKeys.has(dateKey)) continue;
      const parts = dateKey.split("-").map(Number);
      if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) continue;
      const [y, m, d] = parts;
      const extraStart = new Date(y, m - 1, d, baseHours, baseMinutes, 0, 0);
      if (!Number.isNaN(extraStart.getTime())) {
        seenKeys.add(dateKey);
        extraDates.push(extraStart);
      }
    }

    // Las copias de los días adicionales quedan agrupadas junto a la original:
    // misma tarjeta (lista) y misma madre. Nunca se crean ni se usan otras tarjetas.
    if (extraDates.length > 0) {
      const lastActInList = await prisma.activity.findFirst({
        where: { listId: id },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      let nextActPos = (lastActInList?.position ?? -1) + 1;

      for (const dt of extraDates) {
        await prisma.activity.create({
          data: {
            listId: id,
            userId: user.userId,
            parentId: parentId ?? null,
            name,
            observation,
            position: nextActPos++,
            startDate: dt,
            estimatedAmount,
            estimatedUnit,
            estimatedEndDate: calculateEstimatedEndDate(
              dt,
              estimatedAmount,
              estimatedUnit
            ),
            actualEndDate: null,
          },
        });
      }
    }

    return NextResponse.json(primaryActivity, { status: 201 });
  } catch (error) {
    console.error("Error al crear actividad:", error);
    return NextResponse.json(
      { error: "Error al crear la actividad." },
      { status: 500 }
    );
  }
}
