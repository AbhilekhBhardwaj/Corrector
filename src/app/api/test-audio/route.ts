import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST() {
	try {
		// Test with a simple audio file
		const testAudioUrl = "https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav";
		
		// Download the test audio
		const response = await fetch(testAudioUrl);
		if (!response.ok) {
			throw new Error(`Failed to download test audio: ${response.status}`);
		}
		
		const audioBuffer = await response.arrayBuffer();
		const audioFile = new File([audioBuffer], "test.wav", { type: "audio/wav" });
		
		// Test transcription
		const formData = new FormData();
		formData.append('file', audioFile);
		formData.append('model', 'whisper-1');
		formData.append('response_format', 'text');
		
		const transcriptionResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
			},
			body: formData,
		});
		
		if (!transcriptionResponse.ok) {
			const errorData = await transcriptionResponse.text();
			return NextResponse.json({ 
				error: `Transcription failed: ${transcriptionResponse.status}`,
				details: errorData 
			}, { status: 500 });
		}
		
		const transcript = await transcriptionResponse.text();
		
		return NextResponse.json({ 
			success: true, 
			transcript: transcript.trim(),
			fileSize: audioBuffer.byteLength 
		});
		
	} catch (err: any) {
		console.error("Audio test error:", err);
		return NextResponse.json({ 
			error: err?.message,
			stack: err?.stack 
		}, { status: 500 });
	}
}
