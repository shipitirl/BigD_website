// backend/app/api/upload/route.ts

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { loadSession, saveSession } from "@/api/lib/utils";
import { createNewSession } from "@/api/lib/chatbot";
import type { UploadResponseBody } from "@/api/lib/types";
import type { SessionState } from "@/api/lib/session";

// ----------------------
// CONFIG
// ----------------------
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_PHOTOS_PER_SESSION = 10;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

// Track uploaded file hashes per session (in-memory, for idempotency)
const uploadedHashes = new Map<string, Set<string>>();

// ----------------------
// POST /api/upload
// ----------------------
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const sessionId = formData.get("sessionId") as string;
    const files = formData.getAll("photos") as File[];

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No photos provided" },
        { status: 400 }
      );
    }

    // Get or create session
    let session = await loadSession(sessionId);
    if (!session) {
      // Session doesn't exist (e.g., server restarted) - create a new one
      console.log(`[Upload] Creating new session for ${sessionId} (was not found)`);
      session = createNewSession(sessionId);
      await saveSession(sessionId, session);
    }

    // Check photo limit
    const currentPhotoCount = session.photos?.urls?.length || 0;
    if (currentPhotoCount >= MAX_PHOTOS_PER_SESSION) {
      return NextResponse.json(
        {
          error: "Photo limit reached",
          message: `Maximum of ${MAX_PHOTOS_PER_SESSION} photos per session`,
          currentCount: currentPhotoCount,
        },
        { status: 400 }
      );
    }

    // Ensure upload directory exists
    const sessionDir = path.join(UPLOAD_DIR, sessionId);
    if (!existsSync(sessionDir)) {
      await mkdir(sessionDir, { recursive: true });
    }

    // Get or create hash set for this session
    if (!uploadedHashes.has(sessionId)) {
      uploadedHashes.set(sessionId, new Set());
    }
    const sessionHashes = uploadedHashes.get(sessionId)!;

    const uploadedUrls: string[] = [];
    const skipped: { reason: string; filename: string }[] = [];
    const remainingSlots = MAX_PHOTOS_PER_SESSION - currentPhotoCount;

    for (let i = 0; i < files.length && uploadedUrls.length < remainingSlots; i++) {
      const file = files[i];

      // Validate file type
      if (!ALLOWED_TYPES.includes(file.type)) {
        skipped.push({ reason: "invalid_type", filename: file.name });
        continue;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        skipped.push({ reason: "too_large", filename: file.name });
        continue;
      }

      // Read file and compute hash for idempotency
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const fileHash = crypto.createHash("md5").update(buffer).digest("hex");

      // Check if already uploaded (idempotency)
      if (sessionHashes.has(fileHash)) {
        skipped.push({ reason: "duplicate", filename: file.name });
        continue;
      }

      // Generate unique filename
      const ext = file.name.split(".").pop() || "jpg";
      const filename = `${uuidv4()}.${ext}`;
      
      // Local file system upload
      const filepath = path.join(sessionDir, filename);
      await writeFile(filepath, buffer);
      const url = `/uploads/${sessionId}/${filename}`;
      console.log(`[Upload] Local: ${url}`);

      uploadedUrls.push(url);

      // Mark as uploaded for idempotency
      sessionHashes.add(fileHash);
    }

    // Update session with photo URLs
    if (!session.photos) {
      session.photos = { urls: [], count: 0 };
    }
    if (!session.photos.urls) {
      session.photos.urls = [];
    }
    session.photos.urls.push(...uploadedUrls);
    session.photos.count = session.photos.urls.length;
    session.photos_uploaded = session.photos.urls.length > 0;
    session.updated_at = new Date().toISOString();

    // Update status if we now have photos
    if (session.photos_uploaded && session.status === "awaiting_photos") {
      session.status = "ready_for_estimate";
    }

    await saveSession(sessionId, session);

    console.log(`[Upload] Session ${sessionId}: ${uploadedUrls.length} photos uploaded, total: ${session.photos.urls.length}`);

    const response: UploadResponseBody = {
      success: true,
      uploaded: uploadedUrls.length,
      totalPhotos: session.photos.urls.length,
      maxPhotos: MAX_PHOTOS_PER_SESSION,
      urls: uploadedUrls,
      skipped: skipped.length > 0 ? skipped : undefined,
    };

    return NextResponse.json(response, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Upload error:", error);
    console.error("Upload error stack:", (error as Error).stack);
    return NextResponse.json(
      { error: "Upload failed", details: (error as Error).message },
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
