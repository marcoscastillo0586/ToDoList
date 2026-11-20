import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const orderedIds: number[] = Array.isArray(body?.orderedIds)
      ? body.orderedIds.map(Number).filter((id: number) => !Number.isNaN(id))
      : [];

    if (orderedIds.length === 0) {
      return NextResponse.json(
        { error: "Se requiere la lista de IDs ordenados." },
        { status: 400 }
      );
    }

    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.todoList.update({
          where: { id },
          data: { position: index },
        })
      )
    );

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error("Error al reordenar listas:", error);
    return NextResponse.json(
      { error: "Error al guardar el nuevo orden de las listas." },
      { status: 500 }
    );
  }
}

