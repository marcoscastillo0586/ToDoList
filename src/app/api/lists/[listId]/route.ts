import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COMPLETION_NOTES_INCLUDE } from "@/lib/activityHierarchy";

type RouteParams = { params: Promise<{ listId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { listId } = await params;
    const id = Number(listId);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "ID de lista inválido." }, { status: 400 });
    }

    const list = await prisma.todoList.findUnique({
      where: { id },
      include: {
        activities: {
          orderBy: [{ startDate: "asc" }, { position: "asc" }],
          include: COMPLETION_NOTES_INCLUDE,
        },
      },
    });

    if (!list) {
      return NextResponse.json({ error: "Lista no encontrada." }, { status: 404 });
    }

    return NextResponse.json(list);
  } catch (error) {
    console.error("Error al obtener la lista:", error);
    return NextResponse.json(
      { error: "Error al obtener la lista." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { listId } = await params;
    const id = Number(listId);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "ID de lista inválido." }, { status: 400 });
    }

    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    if (!name) {
      return NextResponse.json(
        { error: "El nombre de la lista es obligatorio." },
        { status: 400 }
      );
    }

    const existing = await prisma.todoList.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Lista no encontrada." }, { status: 404 });
    }

    const updated = await prisma.todoList.update({
      where: { id },
      data: { name },
      include: {
        activities: {
          orderBy: [{ startDate: "asc" }, { position: "asc" }],
          include: COMPLETION_NOTES_INCLUDE,
        },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error al actualizar la lista:", error);
    return NextResponse.json(
      { error: "Error al actualizar la lista." },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { listId } = await params;
    const id = Number(listId);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "ID de lista inválido." }, { status: 400 });
    }

    const existing = await prisma.todoList.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Lista no encontrada." }, { status: 404 });
    }

    // Primero se sueltan las relaciones padre-hija de la lista para que el
    // borrado en cascada no choque con la relación de la tabla consigo misma.
    await prisma.$transaction([
      prisma.activity.updateMany({
        where: { listId: id },
        data: { parentId: null },
      }),
      prisma.todoList.delete({ where: { id } }),
    ]);

    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    console.error("Error al eliminar la lista:", error);
    return NextResponse.json(
      { error: "Error al eliminar la lista." },
      { status: 500 }
    );
  }
}
