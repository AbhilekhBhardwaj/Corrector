"use client";

import { useState } from "react";

export default function Home() {
	const [url, setUrl] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<any>(null);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setResult(null);
		setLoading(true);
		try {
			const res = await fetch("/api/analyze", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ url }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error || "Failed to analyze");
			setResult(data);
		} catch (err: any) {
			setError(err?.message || "Unknown error");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="max-w-2xl mx-auto p-6 space-y-6">
			<h1 className="text-2xl font-semibold">Social Post Verifier</h1>
			<p className="text-gray-600">Analyze social media posts for misinformation using AI</p>
			
			<form onSubmit={onSubmit} className="space-y-3">
				<input
					type="url"
					value={url}
					onChange={(e) => setUrl(e.target.value)}
					placeholder="Paste YouTube, Instagram, TikTok, or image URL"
					className="w-full border rounded px-3 py-2"
					required
				/>
				<button
					type="submit"
					disabled={loading}
					className="bg-black text-white px-4 py-2 rounded disabled:opacity-60"
				>
					{loading ? "Analyzing..." : "Analyze"}
				</button>
			</form>
			
			<div className="text-sm text-gray-500 space-y-1">
				<p><strong>Supported platforms:</strong></p>
				<ul className="list-disc list-inside space-y-1 ml-4">
					<li>YouTube videos & shorts (analyzes title & description)</li>
					<li>Instagram posts & reels (extracts images & text)</li>
					<li>TikTok videos (extracts content)</li>
					<li>Twitter/X posts (extracts images & text)</li>
					<li>Direct image URLs (OCR + analysis)</li>
				</ul>
			</div>
			{error && (
				<div className="text-red-600 text-sm">{error}</div>
			)}
			{result && (
				<div className="space-y-2">
					<div className="text-sm text-gray-600 break-all">Source: {result.source}</div>
					{result.transcript && (
						<div>
							<h2 className="font-medium">Transcript</h2>
							<pre className="whitespace-pre-wrap text-sm bg-gray-50 p-3 rounded">{result.transcript}</pre>
						</div>
					)}
					{result.ocrText && (
						<div>
							<h2 className="font-medium">Extracted Text</h2>
							<pre className="whitespace-pre-wrap text-sm bg-gray-50 p-3 rounded">{result.ocrText}</pre>
						</div>
					)}
					{result.analysis && (
						<div>
							<h2 className="font-medium">Analysis</h2>
							<pre className="whitespace-pre-wrap text-sm bg-gray-50 p-3 rounded">{result.analysis}</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
