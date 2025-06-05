import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const TASKS_FILE_PATH = path.join(process.cwd(), "tasks.json");

// CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// Read tasks
export async function GET() {
  try {
    const fileContent = await fs.readFile(TASKS_FILE_PATH, "utf-8");
    const tasks = JSON.parse(fileContent);
    return NextResponse.json(tasks, { headers: corsHeaders });
  } catch (error) {
    if ((error as any).code === "ENOENT") {
      return NextResponse.json({ tasks: [] }, { headers: corsHeaders });
    }
    return NextResponse.json(
      { error: "Failed to read tasks" },
      { status: 500, headers: corsHeaders }
    );
  }
}

// Save tasks
export async function POST(request: Request) {
  try {
    const body = await request.json();
    await fs.writeFile(TASKS_FILE_PATH, JSON.stringify(body, null, 2));
    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save tasks" },
      { status: 500, headers: corsHeaders }
    );
  }
}
