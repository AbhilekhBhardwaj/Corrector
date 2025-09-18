export const env = {
	OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
	OPENAI_TRANSCRIBE_MODEL: process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1",
	OPENAI_REASONING_MODEL: process.env.OPENAI_REASONING_MODEL ?? "gpt-4o-mini",
	OPENAI_VISION_MODEL: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
	OPENAI_MAX_OUTPUT_TOKENS: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? 800),
	ALLOWED_HOSTS: (process.env.ALLOWED_HOSTS ?? "youtube.com,youtu.be,twitter.com,x.com,instagram.com,facebook.com,tiktok.com")
		.split(",")
		.map((h) => h.trim())
		.filter(Boolean),
};

export function assertServerEnv() {
	if (!env.OPENAI_API_KEY) {
		throw new Error("OPENAI_API_KEY is not set. Add it to your .env.local");
	}
}

export function isHostAllowed(hostname: string): boolean {
	if (env.ALLOWED_HOSTS.includes("*")) return true;
	return env.ALLOWED_HOSTS.some((h) => hostname.includes(h));
}
