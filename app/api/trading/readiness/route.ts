import { NextResponse } from "next/server";
import { getLiveTradingReadinessReport } from "@/lib/live-trading-readiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// This endpoint reports capability only. It never submits or modifies orders.
export async function GET() {
  return NextResponse.json(getLiveTradingReadinessReport(), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
