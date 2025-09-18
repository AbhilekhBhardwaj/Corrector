import { NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";
import { openai } from "@/lib/openai";
import { assertServerEnv, env, isHostAllowed } from "@/lib/env";
import { toFile } from "openai/uploads";

export const runtime = "nodejs";

function isAllowedHost(urlString: string): boolean {
	try {
		const u = new URL(urlString);
		return isHostAllowed(u.hostname);
	} catch {
		return false;
	}
}

async function fetchYouTubeAudioAsUpload(url: string) {
	try {
		console.log("Getting video info for:", url);
		const info = await ytdl.getInfo(url);
		const title = info.videoDetails.title || "audio";
		
		console.log("Video title:", title);
		console.log("Video duration:", info.videoDetails.lengthSeconds, "seconds");
		
		// Use a simpler approach - just get audio stream
		const audioStream = ytdl(url, { 
			filter: "audioonly",
			quality: "highestaudio"
		});
		
		const chunks: Buffer[] = [];
		await new Promise<void>((resolve, reject) => {
			audioStream.on("data", (c: Buffer) => {
				chunks.push(c);
				console.log("Received chunk:", c.length, "bytes");
			});
			audioStream.on("end", () => {
				console.log("Stream ended, total chunks:", chunks.length);
				resolve();
			});
			audioStream.on("error", (err) => {
				console.error("Stream error:", err);
				reject(err);
			});
		});
		
		const buffer = Buffer.concat(chunks);
		console.log("Total audio buffer size:", buffer.length, "bytes");
		
		if (buffer.length === 0) {
			throw new Error("Empty audio buffer");
		}
		
		// Create a proper File object for OpenAI
		const blob = new Blob([buffer], { type: "audio/mp4" });
		return new File([blob], `${title}.mp4`, { type: "audio/mp4" });
	} catch (err) {
		console.error("Error fetching YouTube audio:", err);
		throw err;
	}
}

async function fetchContentType(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, { method: "HEAD" });
		const ct = res.headers.get("content-type");
		if (ct) return ct.toLowerCase();
		return null;
	} catch {
		return null;
	}
}

function guessFilenameFromUrl(urlString: string, fallback: string): string {
	try {
		const u = new URL(urlString);
		const base = u.pathname.split("/").pop() || fallback;
		return base;
	} catch {
		return fallback;
	}
}

async function downloadAsUpload(url: string, expectedType?: string) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Failed to download media: ${res.status}`);
	const ct = expectedType || res.headers.get("content-type") || "application/octet-stream";
	const ab = await res.arrayBuffer();
	const filename = guessFilenameFromUrl(url, ct.startsWith("video/") ? "video" : ct.startsWith("image/") ? "image" : "file");
	return await toFile(new Uint8Array(ab), filename, { type: ct });
}

function extractOgContent(html: string, property: string): string | null {
	const re = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
	const m = html.match(re);
	return m?.[1] ?? null;
}

async function resolveMediaFromPage(url: string): Promise<{ type: "video" | "image"; url: string } | null> {
	const res = await fetch(url);
	if (!res.ok) return null;
	const ct = res.headers.get("content-type")?.toLowerCase() || "";
	if (ct.startsWith("video/")) return { type: "video", url };
	if (ct.startsWith("image/")) return { type: "image", url };
	if (!ct.includes("text/html")) return null;
	const html = await res.text();
	const ogVideo = extractOgContent(html, "og:video") || extractOgContent(html, "og:video:url") || extractOgContent(html, "twitter:player:stream");
	if (ogVideo && !/m3u8/i.test(ogVideo)) return { type: "video", url: ogVideo };
	const ogImage = extractOgContent(html, "og:image") || extractOgContent(html, "og:image:url");
	if (ogImage) return { type: "image", url: ogImage };
	return null;
}

async function transcribeAudio(file: File | Blob) {
	try {
		console.log("File details:", {
			name: file instanceof File ? file.name : "unknown",
			size: file.size,
			type: file.type
		});
		
		// Ensure file size is within limits (25MB max for Whisper)
		if (file.size > 25 * 1024 * 1024) {
			throw new Error("Audio file too large (max 25MB)");
		}
		
		const formData = new FormData();
		formData.append('file', file);
		formData.append('model', env.OPENAI_TRANSCRIBE_MODEL);
		formData.append('response_format', 'text');
		formData.append('language', 'en'); // Specify language for better accuracy
		
		const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
			},
			body: formData,
		});
		
		if (!response.ok) {
			const errorData = await response.text();
			console.error("OpenAI API error:", response.status, errorData);
			throw new Error(`OpenAI API error: ${response.status} - ${errorData}`);
		}
		
		const transcript = await response.text();
		console.log("Transcription successful, length:", transcript.length);
		return transcript.trim();
	} catch (err: unknown) {
		const error = err as Error;
		console.error("Transcription error:", error);
		throw new Error(`Transcription failed: ${error.message}`);
	}
}

async function analyzeTextClaim(text: string, source: string) {
	const system = `You are a fact-checking assistant. Analyze the given text from a social media post and assess whether it likely contains misinformation. 

Provide your analysis in this exact format:
VERDICT: [likely_true/uncertain/likely_false]
CONFIDENCE: [0.0-1.0]
KEY_POINTS: [bullet points of main claims]
RATIONALE: [brief explanation of your assessment]

Be objective and focus on verifiable claims.`;
	
	const messages = [
		{ role: "system" as const, content: system },
		{ role: "user" as const, content: `Source: ${source}\n\nText to analyze:\n${text.slice(0, 8000)}` },
	];
	
	const res = await openai.chat.completions.create({
		model: env.OPENAI_REASONING_MODEL,
		messages,
		max_tokens: env.OPENAI_MAX_OUTPUT_TOKENS,
		temperature: 0.1,
	});
	return res.choices[0]?.message?.content?.trim() || "";
}

async function ocrImageFromUrl(imageUrl: string): Promise<string> {
	const messages = [
		{ 
			role: "user" as const, 
			content: [
				{ type: "text" as const, text: "Extract all visible text from this image. Return only the text content, no explanations or commentary." },
				{ type: "image_url" as const, image_url: { url: imageUrl } },
			],
		},
	];
	
	const res = await openai.chat.completions.create({
		model: env.OPENAI_VISION_MODEL,
		messages,
		max_tokens: 600,
		temperature: 0,
	});
	return res.choices[0]?.message?.content?.trim() || "";
}

export async function POST(req: Request) {
	try {
		assertServerEnv();
		const { url } = await req.json();
		if (!url || typeof url !== "string") {
			return NextResponse.json({ error: "Missing url" }, { status: 400 });
		}
		if (!isAllowedHost(url)) {
			return NextResponse.json({ error: "URL host not allowed" }, { status: 400 });
		}

		const u = new URL(url);
		const isYouTube = u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be");

		let transcript: string | null = null;
		let ocrText: string | null = null;
		let analysis: string | null = null;

		if (isYouTube) {
			try {
				console.log("Starting YouTube processing for:", url);
				
				// Download and transcribe audio
				const upload = await fetchYouTubeAudioAsUpload(url);
				console.log("Audio file created, starting transcription");
				transcript = await transcribeAudio(upload);
				console.log("Transcription complete, starting analysis");
				analysis = await analyzeTextClaim(transcript, url);
				console.log("Analysis complete");
			} catch (err: unknown) {
				const error = err as Error;
				console.error("YouTube processing error:", error);
				if (error.message?.includes("Video unavailable") || error.message?.includes("Private video")) {
					return NextResponse.json({ error: "Video is unavailable or private" }, { status: 400 });
				}
				// Fallback to video metadata if audio fails
				try {
					const info = await ytdl.getInfo(url);
					const title = info.videoDetails.title || "Unknown Video";
					const description = info.videoDetails.description || "";
					
					transcript = `Video Title: ${title}\n\nDescription: ${description}\n\nNote: Audio transcription failed, analyzing title and description only.`;
					analysis = await analyzeTextClaim(transcript, url);
				} catch {
					transcript = "Unable to process this YouTube video. The content may contain claims that require verification.";
					analysis = await analyzeTextClaim(transcript, url);
				}
			}
		} else {
			const ct = await fetchContentType(url);
			if (ct?.startsWith("video/")) {
				const upload = await downloadAsUpload(url, ct);
				transcript = await transcribeAudio(upload);
				analysis = await analyzeTextClaim(transcript, url);
			} else if (ct?.startsWith("image/")) {
				ocrText = await ocrImageFromUrl(url);
				analysis = await analyzeTextClaim(ocrText, url);
			} else {
				const media = await resolveMediaFromPage(url);
				if (media?.type === "video") {
					const upload = await downloadAsUpload(media.url);
					if (!upload.type.startsWith("video/")) throw new Error("Resolved media is not a direct video file");
					transcript = await transcribeAudio(upload);
					analysis = await analyzeTextClaim(transcript, url);
				} else if (media?.type === "image") {
					ocrText = await ocrImageFromUrl(media.url);
					analysis = await analyzeTextClaim(ocrText, url);
				} else {
					return NextResponse.json({ error: "Could not resolve media from URL" }, { status: 400 });
				}
			}
		}

		return NextResponse.json({
			source: url,
			transcript,
			ocrText,
			analysis,
		});
	} catch (err: unknown) {
		const error = err as Error;
		console.error("/api/analyze error", error);
		return NextResponse.json({ error: error?.message ?? "Unknown error", stack: process.env.NODE_ENV !== "production" ? error?.stack : undefined }, { status: 500 });
	}
}
