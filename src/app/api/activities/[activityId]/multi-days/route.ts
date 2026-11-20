import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { calculateEstimatedEndDate } from "@/lib/timeUtils";
import { getSessionUser, unauthorized } from "@/lib/auth/currentUser";

type RouteParams = { params: Promise<{ activityId: string }> };

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeStr(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

    const { activityId } = await params;
    const id = Number(activityId);
    if (Number.isNaN(id)) {
      return NextResponse.json(
        { error: "ID de actividad inválido." },
        { status: 400 }
      );
    }

    const found = await prisma.activity.findFirst({
      where: { id, userId: user.userId },
      include: { _count: { select: { children: true } } },
    });
    if (!found) {
      return NextResponse.json(
        { error: "Actividad no encontrada." },
        { status: 404 }
      );
    }
    if (
      found._count.children > 0 ||
      found.startDate === null ||
      found.estimatedAmount === null ||
      found.estimatedUnit === null
    ) {
      return NextResponse.json(
        {
          error:
            "Solo se puede tildar en varios días una tarea final (sin actividades hijas) que tenga horario.",
        },
        { status: 400 }
      );
    }
    const baseActivity = {
      ...found,
      startDate: found.startDate,
      estimatedAmount: found.estimatedAmount,
      estimatedUnit: found.estimatedUnit,
    };

    const body = await request.json();
    const dates: string[] = Array.isArray(body?.dates)
      ? body.dates.filter((d: unknown) => typeof d === "string")
      : [];

    if (dates.length === 0) {
      return NextResponse.json(
        { error: "Debe seleccionar al menos un día del calendario." },
        { status: 400 }
      );
    }

    // Las copias de una actividad son sus hermanas con el mismo nombre:
    // misma tarjeta (lista) y misma madre. Solo tareas finales con horario.
    const normBaseName = normalizeStr(baseActivity.name);
    const candidates = await prisma.activity.findMany({
      where: {
        listId: baseActivity.listId,
        parentId: baseActivity.parentId,
        children: { none: {} },
        startDate: { not: null },
      },
    });
    const siblingActivities = candidates
      .filter((a) => normalizeStr(a.name) === normBaseName)
      .flatMap((a) => (a.startDate ? [{ ...a, startDate: a.startDate }] : []));

    const existingByDateKey = new Map<string, typeof siblingActivities>();
    for (const act of siblingActivities) {
      const key = toLocalDateKey(act.startDate);
      const arr = existingByDateKey.get(key) || [];
      arr.push(act);
      existingByDateKey.set(key, arr);
    }

    const baseHours = baseActivity.startDate.getHours();
    const baseMinutes = baseActivity.startDate.getMinutes();

    const uniqueSelectedKeys = Array.from(new Set(dates));
    const newDatesToCreate: Date[] = [];

    for (const dateKey of uniqueSelectedKeys) {
      if (existingByDateKey.has(dateKey)) continue;
      const parts = dateKey.split("-").map(Number);
      if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) continue;
      const [y, m, d] = parts;
      const dt = new Date(y, m - 1, d, baseHours, baseMinutes, 0, 0);
      if (!Number.isNaN(dt.getTime())) {
        newDatesToCreate.push(dt);
      }
    }

    // Si se destildaron días pendientes adicionales (distintos de la actividad base y no finalizados), eliminarlos
    const selectedSet = new Set(uniqueSelectedKeys);
    const idsToDelete: number[] = [];
    for (const [key, acts] of existingByDateKey.entries()) {
      if (!selectedSet.has(key)) {
        for (const act of acts) {
          if (act.id !== baseActivity.id && act.actualEndDate === null) {
            idsToDelete.push(act.id);
          }
        }
      }
    }

    if (idsToDelete.length > 0) {
      await prisma.activity.deleteMany({ where: { id: { in: idsToDelete } } });
    }

    let createdCount = 0;

    const lastActInList = await prisma.activity.findFirst({
      where: { listId: baseActivity.listId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    let nextActPos = (lastActInList?.position ?? -1) + 1;

    for (const dt of newDatesToCreate) {
      await prisma.activity.create({
        data: {
          listId: baseActivity.listId,
          userId: user.userId,
          parentId: baseActivity.parentId,
          name: baseActivity.name,
          observation: baseActivity.observation,
          position: nextActPos++,
          startDate: dt,
          estimatedAmount: baseActivity.estimatedAmount,
          estimatedUnit: baseActivity.estimatedUnit,
          estimatedEndDate: calculateEstimatedEndDate(
            dt,
            baseActivity.estimatedAmount,
            baseActivity.estimatedUnit
          ),
          actualEndDate: null,
        },
      });
      createdCount += 1;
    }

    return NextResponse.json({
      createdCount,
      removedCount: idsToDelete.length,
    });
  } catch (error) {
    console.error("Error al asignar actividad a varios días:", error);
    return NextResponse.json(
      { error: "Error al asignar la actividad a varios días." },
      { status: 500 }
    );
  }
}
