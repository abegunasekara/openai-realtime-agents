import { NextResponse } from "next/server";
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

const TASKS_FILE_PATH = path.join(process.cwd(), "tasks.json");

async function readTasksFromFile() {
  try {
    const fileContent = await fs.readFile(TASKS_FILE_PATH, "utf-8");
    return JSON.parse(fileContent);
  } catch {
    // If file doesn't exist or is invalid, return empty array
    return { tasks: [] };
  }
}

async function saveTasksToFile(tasks: any) {
  await fs.writeFile(TASKS_FILE_PATH, JSON.stringify({ tasks }, null, 2));
}

export async function GET() {
  try {
    const tasksData = await readTasksFromFile();
    return NextResponse.json(tasksData);
  } catch (error) {
    console.error("Error reading task list:", error);
    return NextResponse.json(
      { error: "Failed to read task list" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Create the body for the API call
    const body = {
      model: "gpt-4.1",
      input: [
        {
          type: "message",
          role: "system",
          content: `You are a task management assistant. Your response must be a valid JSON array of tasks.
Each task must have these exact fields:
{
  "taskId": "TASK-1",
  "title": "Task title",
  "description": "Detailed task description",
  "estimatedMinutes": 30
}
Do not include any other text or explanation in your response, only the JSON array.`,
        },
        {
          type: "message",
          role: "user",
          content: "Generate a list of 3 example tasks",
        },
      ],
    };

    console.log("Making API call to OpenAI...");
    // Make the API call
    const response = await openai.responses.create({
      ...(body as any),
      stream: false,
    } as any);

    if (!response) {
      console.error("No response from OpenAI");
      return NextResponse.json(
        { error: "Failed to get response" },
        { status: 500 }
      );
    }

    console.log("Got response from OpenAI:", response);

    // Parse the response and format it as tasks
    try {
      const outputItems = response.output ?? [];
      const messages = outputItems.filter(
        (item: any) => item.type === "message"
      );
      const text = messages
        .map((msg: any) => {
          const contentArr = msg.content ?? [];
          return contentArr
            .filter((c: any) => c.type === "output_text")
            .map((c: any) => c.text)
            .join("");
        })
        .join("\n");

      console.log("Extracted text from response:", text);

      // Parse the text as JSON
      const tasks = JSON.parse(text);

      if (!Array.isArray(tasks)) {
        console.error("Parsed result is not an array:", tasks);
        throw new Error("Response is not a JSON array");
      }

      // Validate each task has required fields
      tasks.forEach((task: any, index: number) => {
        if (
          !task.taskId ||
          !task.title ||
          !task.description ||
          !task.estimatedMinutes
        ) {
          console.error("Invalid task at index", index, ":", task);
          throw new Error(`Task at index ${index} is missing required fields`);
        }
      });

      // Add completed field to each task
      const formattedTasks = tasks.map((task: any) => ({
        ...task,
        completed: "active",
      }));

      console.log("Final formatted tasks:", formattedTasks);

      // Save tasks to file
      await saveTasksToFile(formattedTasks);
      console.log("Tasks saved to file:", TASKS_FILE_PATH);

      return NextResponse.json({ tasks: formattedTasks });
    } catch (error) {
      console.error("Error parsing response:", error);
      return NextResponse.json(
        { error: "Failed to parse tasks" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error fetching task list:", error);
    return NextResponse.json(
      { error: "Failed to fetch task list" },
      { status: 500 }
    );
  }
}
