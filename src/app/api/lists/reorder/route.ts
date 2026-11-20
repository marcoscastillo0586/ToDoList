import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, unauthorized } from "@/lib/auth/currentUser";

export async function PUT(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return unauthorized();

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
        // updateMany con el dueño: las listas de otros usuarios se ignoran
        prisma.todoList.updateMany({
          where: { id, userId: user.userId },
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

