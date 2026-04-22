import { NextRequest, NextResponse } from "next/server";
import { openai } from "@/lib/openai";

const SYSTEM_PROMPT = `You are a civic issue classifier for the Nexa platform. Given a photo and/or text description of a neighborhood issue, you must return a JSON object with these fields:

- issueType: one of "ROAD_DAMAGE", "STREETLIGHT_OUTAGE", "ILLEGAL_DUMPING", "VEHICLE_EMISSIONS", "OTHER"
- aiDescription: a clear, concise structured description of the issue (2-3 sentences) written in the style a government intake form expects. Include observable details like size, severity, and location context.
- severity: one of "low", "medium", "high"

Return ONLY valid JSON, no markdown fences or extra text.`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, description } = body as {
      image?: string;
      description?: string;
    };

    if (!image && !description) {
      return NextResponse.json(
        { error: "Provide at least a photo or text description." },
        { status: 400 },
      );
    }

    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [];

    if (description) {
      userContent.push({
        type: "text",
        text: `User description: ${description}`,
      });
    }

    if (image) {
      userContent.push({
        type: "image_url",
        image_url: { url: image },
      });
    }

    if (!description && image) {
      userContent.push({
        type: "text",
        text: "Classify this civic issue based on the photo.",
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      max_tokens: 500,
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json\n?|```\n?/g, "").trim();
    const result = JSON.parse(cleaned);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Classification error:", error);
    return NextResponse.json(
      { error: "Failed to classify the issue. Please try again." },
      { status: 500 },
    );
  }
}
