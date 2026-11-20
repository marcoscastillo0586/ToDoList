import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COMPLETION_NOTES_INCLUDE } from "@/lib/activityHierarchy";
import { CompletedFilterPeriod, getPeriodBounds } from "@/lib/timeUtils";

const VALID_PERIODS: CompletedFilterPeriod[] = ["day", "week", "month"];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const periodParam = (searchParams.get("period") || "day") as CompletedFilterPeriod;
    const period: CompletedFilterPeriod = VALID_PERIODS.includes(periodParam)
      ? periodParam
      : "day";

    const { start, end, label } = getPeriodBounds(period, new Date());

    const activities = await prisma.activity.findMany({
      where: {
        actualEndDate: {
          not: null,
          gte: start,
          lte: end,
        },
        // Solo tareas finales: las actividades con hijas no se finalizan a mano.
        children: { none: {} },
      },
      include: {
        list: true,
        ...COMPLETION_NOTES_INCLUDE,
      },
      orderBy: {
        actualEndDate: "desc",
      },
    });

    return NextResponse.json({
      period,
      label,
      start: start.toISOString(),
      end: end.toISOString(),
      activities,
    });
  } catch (error) {
    console.error("Error al obtener actividades realizadas:", error);
    return NextResponse.json(
      { error: "Error al obtener las actividades realizadas." },
      { status: 500 }
    );
  }
}

