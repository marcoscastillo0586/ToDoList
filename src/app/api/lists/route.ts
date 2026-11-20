import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COMPLETION_NOTES_INCLUDE } from "@/lib/activityHierarchy";

export async function GET() {
  try {
    const lists = await prisma.todoList.findMany({
      include: {
        activities: {
          orderBy: [{ startDate: "asc" }, { position: "asc" }],
          include: COMPLETION_NOTES_INCLUDE,
        },
      },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json(lists);
  } catch (error) {
    console.error("Error al obtener las listas:", error);
    return NextResponse.json(
      { error: "Error al obtener las listas." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body?.name === "string" ? body.name.trim() : "";

    if (!name) {
      return NextResponse.json(
        { error: "El nombre de la lista es obligatorio." },
        { status: 400 }
      );
    }

    const lastList = await prisma.todoList.findFirst({
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const nextPosition = (lastList?.position ?? -1) + 1;

    const newList = await prisma.todoList.create({
      data: { name, position: nextPosition },
      include: {
        activities: true,
      },
    });

    return NextResponse.json(newList, { status: 201 });
  } catch (error) {
    console.error("Error al crear la lista:", error);
    return NextResponse.json(
      { error: "Error al crear la lista." },
      { status: 500 }
    );
  }
}
