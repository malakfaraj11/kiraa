import { NextResponse } from "next/server";
import { createAgentGraph } from "@/agent/graph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { z } from "zod";
import path from "path";

// Zod contracts for API chat request validation
const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1, "Au moins un message est requis."),
});

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo
const ALLOWED_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".json", ".txt"]);

export const maxDuration = 60; // 60-second timeout for Vercel Serverless Functions
export const dynamic = "force-dynamic";

// Helper: Run OCR with a strict timeout to prevent 504 Gateway Timeouts on Vercel
async function runOcrWithTimeout(buffer: Buffer, timeoutMs = 3500): Promise<string> {
  const ocrTask = (async () => {
    try {
      const Tesseract = (await import("tesseract.js")).default;
      const { data: { text } } = await Tesseract.recognize(buffer, "eng", {
        logger: () => {},
      });
      return text ? text.trim() : "";
    } catch {
      return "";
    }
  })();

  const timeoutTask = new Promise<string>((resolve) =>
    setTimeout(() => resolve(""), timeoutMs)
  );

  return Promise.race([ocrTask, timeoutTask]);
}

// Helper: extract readable text from a PDF buffer using PDFParse with fallback
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    if (result && result.text && result.text.trim()) {
      return result.text.trim();
    }
  } catch (e) {
    console.warn("PDFParse fallback:", e);
  }

  const raw = buffer.toString("latin1");
  const textBlocks: string[] = [];
  const regex = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const block = match[1];
    const tdRegex = /\(([^)]+)\)\s*Tj/g;
    let td;
    while ((td = tdRegex.exec(block)) !== null) {
      textBlocks.push(td[1]);
    }
  }
  return textBlocks.join(" ").trim();
}

export async function POST(req: Request) {
  try {
    let lastMessageContent = "";
    let messagesHistory: { role: "user" | "assistant" | "system"; content: string }[] = [];

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const messagesRaw = formData.get("messages") as string;
      const file = formData.get("file") as File | null;

      try {
        messagesHistory = JSON.parse(messagesRaw || "[]");
      } catch {
        return NextResponse.json({ error: "Format JSON invalide pour 'messages'." }, { status: 400 });
      }

      if (file) {
        // Enforce maximum file size limit (10MB)
        if (file.size > MAX_FILE_SIZE_BYTES) {
          return NextResponse.json(
            { error: "Fichier trop volumineux. La taille maximale autorisée est de 10 Mo." },
            { status: 400 }
          );
        }

        const fileName = file.name || "document";
        const fileExt = path.extname(fileName).toLowerCase();

        // Enforce strict file extension whitelist
        if (fileExt && !ALLOWED_EXTENSIONS.has(fileExt)) {
          return NextResponse.json(
            {
              error: `Format de fichier non autorisé (${fileExt}). Formats acceptés : PDF, PNG, JPG, JPEG, WEBP, JSON, TXT.`,
            },
            { status: 400 }
          );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const fileType = file.type || "";

        let fileContext = "";

        if (fileType === "application/pdf" || fileExt === ".pdf") {
          let extractedText = await extractTextFromPdf(buffer);
          if (!extractedText || extractedText.trim().length < 10) {
            extractedText = await runOcrWithTimeout(buffer, 3500);
          }
          fileContext = extractedText
            ? `[Document PDF "${fileName}"] :\n${extractedText}`
            : `[Document PDF "${fileName}"] : Fichier joint reçu (vérification de permis en cours).`;
        } else if (fileType.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(fileName)) {
          const ocrText = await runOcrWithTimeout(buffer, 3500);
          fileContext = ocrText
            ? `[Image "${fileName}" analysée par OCR] :\n${ocrText}`
            : `[Image "${fileName}"] : Document permis/CIN reçu (vérification visuelle).`;
        } else if (fileType === "application/json" || fileExt === ".json") {
          const content = buffer.toString("utf-8");
          fileContext = `[Données structurées JSON "${fileName}"] :\n${content}`;
        } else if (fileType.startsWith("text/") || fileExt === ".txt") {
          const content = buffer.toString("utf-8");
          fileContext = `[Fichier texte "${fileName}"] :\n${content}`;
        } else {
          const content = buffer.toString("utf-8");
          fileContext = `[Fichier joint "${fileName}"] :\n${content}`;
        }

        const lastMsg = messagesHistory[messagesHistory.length - 1];
        lastMessageContent = (lastMsg?.content || "") + `\n\n${fileContext}`;
      } else {
        const lastMsg = messagesHistory[messagesHistory.length - 1];
        lastMessageContent = lastMsg?.content || "";
      }
    } else {
      const body = await req.json();
      messagesHistory = body.messages || [];
      const lastMsg = messagesHistory[messagesHistory.length - 1];
      lastMessageContent = lastMsg?.content || "";
    }

    // Zero-Trust validation using Zod
    const validation = chatRequestSchema.safeParse({ messages: messagesHistory });
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Requête invalide",
          details: validation.error.issues.map((i) => i.message),
        },
        { status: 400 }
      );
    }

    if (!lastMessageContent.trim()) {
      return NextResponse.json({ error: "Message manquant ou vide." }, { status: 400 });
    }

    // Keep only the last 6 exchanges to avoid token overflow
    const MAX_HISTORY = 6;
    const trimmedHistory = messagesHistory.slice(-(MAX_HISTORY + 1));

    // Build LangChain message history with correct message types
    const langChainMessages = trimmedHistory.slice(0, -1).map((m) =>
      m.role === "assistant"
        ? new AIMessage(m.content)
        : new HumanMessage(m.content)
    );
    // Last message gets the (potentially document-enriched) content
    langChainMessages.push(new HumanMessage(lastMessageContent));

    const threadId = "kiraa-session-default";
    const graph = createAgentGraph();
    const result = await graph.invoke(
      { messages: langChainMessages },
      { configurable: { thread_id: threadId } }
    );

    const reply = result.finalResponse || "Je n'ai pas pu formuler de réponse.";

    return NextResponse.json({ role: "assistant", content: reply });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error("Erreur API Chat:", errorMsg);
    return NextResponse.json(
      { error: "Une erreur s'est produite côté serveur: " + errorMsg },
      { status: 500 }
    );
  }
}
