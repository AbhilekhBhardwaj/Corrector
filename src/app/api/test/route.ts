import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { assertServerEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
	try {
		assertServerEnv();
		
		// Test simple text completion
		const res = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			messages: [
				{ role: "user", content: "Say 'Hello, test successful!'" }
			],
			max_tokens: 50,
		});
		
		return NextResponse.json({ 
			success: true, 
			response: res.choices[0]?.message?.content 
		});
	} catch (err: any) {
		console.error("Test error:", err);
		return NextResponse.json({ 
			error: err?.message, 
			detail: err?.response?.data,
			stack: err?.stack 
		}, { status: 500 });
	}
}
