import { NextResponse } from "next/server";
import OpenAI from "openai";

export async function GET() {
  const provider = (process.env.LLM_PROVIDER || (process.env.MINIMAX_API_KEY ? "minimax" : "openai")).toLowerCase();
  const hasMinimaxKey = !!process.env.MINIMAX_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  
  let result = { provider, hasMinimaxKey, hasOpenAIKey, testResult: null as any };
  
  try {
    if (provider === "minimax" && hasMinimaxKey) {
      const client = new OpenAI({
        apiKey: process.env.MINIMAX_API_KEY,
        baseURL: process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1",
      });
      const model = process.env.MINIMAX_MODEL || "MiniMax-M2.5";
      const resp = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 10,
      });
      result.testResult = { success: true, response: resp.choices[0].message.content?.substring(0, 50) };
    } else if (hasOpenAIKey) {
      const client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      const model = process.env.LLM_MODEL || "gpt-5.1";
      const resp = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 10,
      });
      result.testResult = { success: true, response: resp.choices[0].message.content?.substring(0, 50) };
    } else {
      result.testResult = { success: false, error: "No valid API key found" };
    }
  } catch (err: any) {
    result.testResult = { success: false, error: err?.message || String(err) };
  }
  
  return NextResponse.json(result);
}
