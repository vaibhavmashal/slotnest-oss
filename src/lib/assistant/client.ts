import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";

let client: Anthropic | null = null;

/** The Anthropic API client for the assistant (only called when config.anthropic is set). */
export function anthropic(): Anthropic {
  if (!config.anthropic) throw new Error("ANTHROPIC_API_KEY is not set");
  return (client ??= new Anthropic({ apiKey: config.anthropic.apiKey }));
}
