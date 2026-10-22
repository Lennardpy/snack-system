import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSss } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// Images are stored on a Railway persistent volume mounted at /data.
// Served via GET /api/images/products/[filename].
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/data/uploads/products";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireSss();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("image") as File | null;

  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: "Only JPG, PNG, WebP or GIF allowed" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() ?? "jpg";
  const filename = `${id}.${ext}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, filename), Buffer.from(await file.arrayBuffer()));

  const imageUrl = `/api/images/products/${filename}`;

  await prisma.product.update({ where: { id }, data: { imageUrl } });

  return NextResponse.json({ imageUrl });
}
