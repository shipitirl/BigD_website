// backend/app/api/quote/route.ts
// Simple quote form handler - sends email to owner with photos

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const OWNER_EMAIL = process.env.OWNER_EMAIL || "shipithon@gmail.com";
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

const serviceLabels: Record<string, string> = {
  tree_removal: "Tree Removal",
  tree_trimming: "Tree Pruning/Trimming",
  stump_grinding: "Stump Grinding",
  emergency_storm: "Emergency/Storm Damage",
  land_clearing: "Land Clearing",
  tree_planting: "Tree Planting",
  other: "Other",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    // Extract form fields
    const name = formData.get("name") as string;
    const phone = formData.get("phone") as string;
    const email = formData.get("email") as string || "";
    const address = formData.get("address") as string || "";
    const service = formData.get("service") as string || "";
    const details = formData.get("details") as string;
    
    // Validate required fields
    if (!name || !phone || !details) {
      return NextResponse.json(
        { error: "Name, phone, and details are required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }
    
    // Handle photo uploads
    const photos = formData.getAll("photos") as File[];
    const savedPhotos: string[] = [];
    
    if (photos.length > 0) {
      // Create upload directory
      const timestamp = Date.now();
      const uploadPath = path.join(UPLOAD_DIR, `quote_${timestamp}`);
      await mkdir(uploadPath, { recursive: true });
      
      for (const photo of photos) {
        if (photo.size > 0) {
          const buffer = Buffer.from(await photo.arrayBuffer());
          const filename = `${Date.now()}_${photo.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
          const filepath = path.join(uploadPath, filename);
          await writeFile(filepath, buffer);
          savedPhotos.push(filepath);
        }
      }
    }
    
    // Build email content
    const serviceLabel = serviceLabels[service] || service || "Not specified";
    const subject = `🌳 New Quote Request: ${serviceLabel} - ${name}`;
    
    const textContent = `
NEW QUOTE REQUEST
=================

Name: ${name}
Phone: ${phone}
Email: ${email || "Not provided"}
Address: ${address || "Not provided"}
Service: ${serviceLabel}

Details:
${details}

Photos: ${savedPhotos.length > 0 ? savedPhotos.length + " attached" : "None"}
${savedPhotos.length > 0 ? savedPhotos.join("\n") : ""}

---
Submitted: ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })}
Source: Website Quote Form
    `.trim();
    
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background: #1a365d; color: white; padding: 20px; text-align: center; }
    .content { padding: 20px; }
    .field { margin-bottom: 15px; }
    .label { font-weight: bold; color: #1a365d; }
    .value { margin-top: 5px; }
    .details-box { background: #f7fafc; padding: 15px; border-radius: 8px; border-left: 4px solid #c53030; }
    .photos { margin-top: 20px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 0.9em; color: #718096; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌳 New Quote Request</h1>
  </div>
  <div class="content">
    <div class="field">
      <div class="label">Name</div>
      <div class="value">${name}</div>
    </div>
    <div class="field">
      <div class="label">Phone</div>
      <div class="value"><a href="tel:${phone.replace(/\D/g, "")}">${phone}</a></div>
    </div>
    <div class="field">
      <div class="label">Email</div>
      <div class="value">${email ? `<a href="mailto:${email}">${email}</a>` : "Not provided"}</div>
    </div>
    <div class="field">
      <div class="label">Address</div>
      <div class="value">${address || "Not provided"}</div>
    </div>
    <div class="field">
      <div class="label">Service Requested</div>
      <div class="value" style="color: #c53030; font-weight: bold;">${serviceLabel}</div>
    </div>
    <div class="field">
      <div class="label">Details</div>
      <div class="details-box">${details.replace(/\n/g, "<br>")}</div>
    </div>
    ${savedPhotos.length > 0 ? `
    <div class="photos">
      <div class="label">📷 ${savedPhotos.length} Photo(s) Attached</div>
      <div class="value" style="font-size: 0.9em; color: #718096;">
        Photos saved to: ${savedPhotos[0].split("/").slice(0, -1).join("/")}
      </div>
    </div>
    ` : ""}
    <div class="footer">
      Submitted: ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })}<br>
      Source: Website Quote Form
    </div>
  </div>
</body>
</html>
    `.trim();
    
    // Send email
    let emailSent = false;
    if (GMAIL_USER && GMAIL_APP_PASSWORD) {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: GMAIL_USER,
          pass: GMAIL_APP_PASSWORD,
        },
      });
      
      // Prepare attachments
      const attachments = [];
      for (const photoPath of savedPhotos) {
        attachments.push({
          filename: path.basename(photoPath),
          path: photoPath,
        });
      }
      
      await transporter.sendMail({
        from: `"Big D's Tree Service" <${GMAIL_USER}>`,
        to: OWNER_EMAIL,
        subject,
        text: textContent,
        html: htmlContent,
        attachments,
      });
      
      emailSent = true;
      console.log(`[Quote] Email sent to ${OWNER_EMAIL} with ${savedPhotos.length} photos`);
    } else {
      console.log("[Quote] Email skipped (no Gmail config)");
      console.log(textContent);
    }
    
    // Log the submission
    console.log(`[Quote] New request from ${name} (${phone}) - ${serviceLabel}`);
    
    return NextResponse.json(
      {
        success: true,
        message: "Quote request received",
        emailSent,
      },
      { headers: CORS_HEADERS }
    );
    
  } catch (error) {
    console.error("[Quote] Error:", error);
    return NextResponse.json(
      { error: "Failed to process quote request" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// ----------------------
// OPTIONS (CORS preflight)
// ----------------------
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: CORS_HEADERS,
  });
}
