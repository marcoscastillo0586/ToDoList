import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ listId: string }> };

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { listId } = await params;
    const id = Number(listId);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "ID de lista inválido." }, { status: 400 });
    }

    const body = await request.json();
    const orderedIds: number[] = Array.isArray(body?.orderedIds)
      ? body.orderedIds.map(Number).filter((aid: number) => !Number.isNaN(aid))
      : [];

    if (orderedIds.length === 0) {
      return NextResponse.json(
        { error: "Se requiere la lista de IDs de actividades ordenadas." },
        { status: 400 }
      );
    }

    await prisma.$transaction(
      orderedIds.map((activityId, index) =>
        prisma.activity.updateMany({
          where: { id: activityId, listId: id },
          data: { position: index },
        })
      )
    );

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error("Error al reordenar actividades:", error);
    return NextResponse.json(
      { error: "Error al guardar el nuevo orden de las actividades." },
      { status: 500 }
    );
  }
}

