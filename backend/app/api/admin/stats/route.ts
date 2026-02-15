// backend/app/api/admin/stats/route.ts
// Admin API for dashboard stats and conversion metrics

import { NextRequest, NextResponse } from "next/server";
import { isCloudflareEnv, getCloudflareEnv, setCloudflareEnv, type CloudflareEnv } from "@/api/lib/storage-cloudflare";

// ----------------------
// Simple admin auth
// ----------------------
function validateAdminKey(request: NextRequest): boolean {
  const adminKey = process.env.ADMIN_API_KEY;

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
// GET /api/admin/stats - Dashboard statistics
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
    const days = parseInt(url.searchParams.get("days") || "30", 10);

    // Calculate date range
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString();

    if (isCloudflareEnv()) {
      const { DB } = getCloudflareEnv();

      // Get status counts
      const statusCounts = await DB.prepare(`
        SELECT status, COUNT(*) as count
        FROM leads
        WHERE created_at >= ?
        GROUP BY status
      `).bind(sinceStr).all<{ status: string; count: number }>();

      // Get total revenue (from completed deals)
      const revenueResult = await DB.prepare(`
        SELECT
          COUNT(*) as completed_count,
          SUM(json_extract(full_lead_json, '$.actual_amount')) as total_revenue,
          AVG(json_extract(full_lead_json, '$.actual_amount')) as avg_revenue
        FROM leads
        WHERE status = 'completed'
          AND created_at >= ?
      `).bind(sinceStr).first<{
        completed_count: number;
        total_revenue: number | null;
        avg_revenue: number | null;
      }>();

      // Get estimated vs actual comparison
      const estimateAccuracy = await DB.prepare(`
        SELECT
          json_extract(full_lead_json, '$.estimate.min') as est_min,
          json_extract(full_lead_json, '$.estimate.max') as est_max,
          json_extract(full_lead_json, '$.actual_amount') as actual
        FROM leads
        WHERE status = 'completed'
          AND json_extract(full_lead_json, '$.actual_amount') IS NOT NULL
          AND created_at >= ?
        LIMIT 100
      `).bind(sinceStr).all<{
        est_min: number;
        est_max: number;
        actual: number;
      }>();

      // Calculate estimate accuracy
      let withinEstimate = 0;
      let belowEstimate = 0;
      let aboveEstimate = 0;

      for (const row of estimateAccuracy.results || []) {
        if (row.actual >= row.est_min && row.actual <= row.est_max) {
          withinEstimate++;
        } else if (row.actual < row.est_min) {
          belowEstimate++;
        } else {
          aboveEstimate++;
        }
      }

      // Get leads by service type
      const serviceTypes = await DB.prepare(`
        SELECT service_type, COUNT(*) as count
        FROM leads
        WHERE created_at >= ?
        GROUP BY service_type
        ORDER BY count DESC
      `).bind(sinceStr).all<{ service_type: string; count: number }>();

      // Get leads by day (for chart)
      const dailyLeads = await DB.prepare(`
        SELECT
          date(created_at) as day,
          COUNT(*) as count
        FROM leads
        WHERE created_at >= ?
        GROUP BY date(created_at)
        ORDER BY day DESC
        LIMIT 30
      `).bind(sinceStr).all<{ day: string; count: number }>();

      // Build response
      const statusMap: Record<string, number> = {};
      for (const row of statusCounts.results || []) {
        statusMap[row.status] = row.count;
      }

      const totalLeads = Object.values(statusMap).reduce((a, b) => a + b, 0);
      const completedLeads = statusMap["completed"] || 0;
      const lostLeads = statusMap["lost"] || 0;
      const conversionRate = totalLeads > 0
        ? ((completedLeads / (completedLeads + lostLeads)) * 100).toFixed(1)
        : "0";

      return NextResponse.json({
        period: {
          days,
          since: sinceStr,
        },
        overview: {
          total_leads: totalLeads,
          completed: completedLeads,
          lost: lostLeads,
          in_progress: totalLeads - completedLeads - lostLeads,
          conversion_rate: parseFloat(conversionRate),
        },
        revenue: {
          total: revenueResult?.total_revenue || 0,
          average: Math.round(revenueResult?.avg_revenue || 0),
          completed_jobs: revenueResult?.completed_count || 0,
        },
        estimate_accuracy: {
          within_range: withinEstimate,
          below_estimate: belowEstimate,
          above_estimate: aboveEstimate,
          total_compared: withinEstimate + belowEstimate + aboveEstimate,
        },
        by_status: statusMap,
        by_service_type: (serviceTypes.results || []).reduce((acc, row) => {
          acc[row.service_type || "unknown"] = row.count;
          return acc;
        }, {} as Record<string, number>),
        daily_leads: (dailyLeads.results || []).reverse(),
      });
    }

    // Local development - return mock stats
    return NextResponse.json({
      period: { days, since: sinceStr },
      overview: {
        total_leads: 0,
        completed: 0,
        lost: 0,
        in_progress: 0,
        conversion_rate: 0,
      },
      revenue: {
        total: 0,
        average: 0,
        completed_jobs: 0,
      },
      estimate_accuracy: {
        within_range: 0,
        below_estimate: 0,
        above_estimate: 0,
        total_compared: 0,
      },
      by_status: {},
      by_service_type: {},
      daily_leads: [],
      note: "D1 not available - stats require Cloudflare deployment",
    });

  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats", details: (error as Error).message },
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
