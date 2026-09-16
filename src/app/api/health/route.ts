import { NextResponse } from "next/server";
import { db } from "@/db/index";
import { sql } from "drizzle-orm";

export async function GET() {
  const startTime = Date.now();
  try {
    // Perform a genuine SQL query against PostgreSQL to test actual connectivity
    await db.execute(sql`SELECT 1 as health_check`);
    const latencyMs = Date.now() - startTime;

    return NextResponse.json(
      {
        status: "ok",
        database: "connected",
        latencyMs,
        timestamp: new Date().toISOString(),
        version: "0.1.0",
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Healthcheck error (PostgreSQL unavailable):", message);

    return NextResponse.json(
      {
        status: "error",
        database: "disconnected",
        error: message,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
