import { NextRequest, NextResponse } from "next/server";
import { hasSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownerEmail } from "@/lib/owner";
import { watchPhotoError } from "@/lib/watch-photo";

type PhotoRow = { photo: Buffer | null; photo_mime: string | null };

async function ownedPhoto(id: string) {
  return db.query<PhotoRow>("SELECT photo, photo_mime FROM watches WHERE id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)", [id, ownerEmail]);
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return new NextResponse(null, { status: 401 });
  const photo = (await ownedPhoto((await context.params).id)).rows[0];
  if (!photo?.photo || !photo.photo_mime) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(photo.photo), { headers: { "Cache-Control": "private, no-store", "Content-Type": photo.photo_mime, "X-Content-Type-Options": "nosniff" } });
}

export async function HEAD(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return new NextResponse(null, { status: 401 });
  const photo = (await ownedPhoto((await context.params).id)).rows[0];
  return new NextResponse(null, { status: photo?.photo && photo.photo_mime ? 200 : 404 });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await request.formData();
  const photo = form.get("photo");
  if (!(photo instanceof File)) return NextResponse.json({ error: "Choose an image to upload." }, { status: 400 });
  const error = watchPhotoError(photo);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const { id } = await context.params;
  const result = await db.query("UPDATE watches SET photo = $1, photo_mime = $2, updated_at = now() WHERE id = $3 AND user_id = (SELECT id FROM users WHERE email = $4) RETURNING id", [Buffer.from(await photo.arrayBuffer()), photo.type, id, ownerEmail]);
  if (!result.rowCount) return NextResponse.json({ error: "Watch not found." }, { status: 404 });
  return NextResponse.json({ id });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!(await hasSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const result = await db.query("UPDATE watches SET photo = NULL, photo_mime = NULL, updated_at = now() WHERE id = $1 AND user_id = (SELECT id FROM users WHERE email = $2) RETURNING id", [id, ownerEmail]);
  if (!result.rowCount) return NextResponse.json({ error: "Watch not found." }, { status: 404 });
  return NextResponse.json({ id });
}
