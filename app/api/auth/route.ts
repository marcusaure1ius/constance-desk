import { NextRequest, NextResponse } from "next/server";
import { verifyPin } from "@/lib/services/auth";

export async function POST(request: NextRequest) {
  const { pin } = await request.json();
  const valid = await verifyPin(pin);
  if (!valid) {
    return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
  }
  return NextResponse.json({ success: true });
}
