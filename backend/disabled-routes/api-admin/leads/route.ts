// backend/app/api/admin/leads/route.ts
// Admin API for listing leads with HubSpot status

import { NextRequest, NextResponse } from "next/server";
import { isCloudflareEnv, getCloudflareEnv, setCloudflareEnv, type CloudflareEnv } from "@/api/lib/storage-cloudflare";

// ----------------------
// Simple admin auth (use proper auth in production)
// ----------------------
function validateAdminKey(request: NextRequest): boolean {
  const adminKey = process.env.ADMIN_API_KEY;

  // In development, allow access without key
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  if (!adminKey) {
    return false;
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }

  return authHeader.slice(7) === adminKey;
}

// ----------------------
// GET /api/admin/leads - List all leads
// ----------------------
export async function GET(request: NextRequest) {
  try {
    // Try to get Cloudflare env
    try {
      const { getRequestContext } = await import("@cloudflare/next-on-pages");
      const ctx = getRequestContext();
      if (ctx?.env) {
        setCloudflareEnv(ctx.env as CloudflareEnv);
      }
    } catch {
      // Not in Cloudflare environment
    }

    // Validate admin access
    if (!validateAdminKey(request)) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const status = url.searchParams.get("status"); // Filter by status
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    // If in Cloudflare, query D1 directly
    if (isCloudflareEnv()) {
      const { DB } = getCloudflareEnv();

      let query = `
        SELECT
          id,
          customer_name,
          customer_phone,
          customer_zip,
          service_type,
          status,
          created_at,
          updated_at,
          full_lead_json
        FROM leads
      `;

      const params: unknown[] = [];

      if (status) {
        query += " WHERE status = ?";
        params.push(status);
      }

      query += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";
      params.push(limit, offset);

      const stmt = DB.prepare(query);
      const result = await stmt.bind(...params).all<{
        id: string;
        customer_name: string | null;
        customer_phone: string | null;
        customer_zip: string | null;
        service_type: string | null;
        status: string;
        created_at: string;
        updated_at: string;
        full_lead_json: string;
      }>();

      const leads = (result.results || []).map(row => {
        const full = JSON.parse(row.full_lead_json);
        return {
          id: row.id,
          customer_name: row.customer_name,
          customer_phone: row.customer_phone,
          customer_zip: row.customer_zip,
          service_type: row.service_type,
          status: row.status,
          created_at: row.created_at,
          updated_at: row.updated_at,
          estimate: full.estimate,
          actual_amount: full.actual_amount,
          hubspot_deal_id: full.hubspot_deal_id,
          photos_count: full.photos?.urls?.length || 0,
        };
      });

      // Get total count
      let countQuery = "SELECT COUNT(*) as count FROM leads";
      if (status) {
        countQuery += " WHERE status = ?";
      }
      const countStmt = DB.prepare(countQuery);
      const countResult = status
        ? await countStmt.bind(status).first<{ count: number }>()
        : await countStmt.first<{ count: number }>();

      return NextResponse.json({
        leads,
        total: countResult?.count || 0,
        limit,
        offset,
      });
    }

    // Local development - return mock or empty
    return NextResponse.json({
      leads: [],
      total: 0,
      limit,
      offset,
      note: "D1 not available - leads stored locally in .sessions/",
    });

  } catch (error) {
    console.error("Admin leads error:", error);
    return NextResponse.json(
      { error: "Failed to fetch leads", details: (error as Error).message },
      { status: 500 }
    );
  }
}

// ----------------------
// OPTIONS (CORS preflight)
// ----------------------
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
