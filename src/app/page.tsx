"use client";

import { useState, useRef, useEffect } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Bonjour ! Je suis Kiraa. Vous souhaitez réserver un véhicule, ou avez-vous une question sur nos politiques ?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setAttachedFile(file);
  };

  const handleRemoveFile = () => {
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!input.trim() && !attachedFile) || isLoading) return;

    const displayContent = input.trim() || (attachedFile ? `📄 Fichier joint : ${attachedFile.name}` : "");
    const userMessage: Message = { role: "user", content: displayContent };
    setMessages((prev) => [...prev, userMessage]);
    const currentInput = input;
    const currentFile = attachedFile;
    setInput("");
    setAttachedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsLoading(true);

    try {
      let response: Response;
      const allMessages = [...messages, userMessage];

      if (currentFile) {
        // Use FormData when there's a file
        const formData = new FormData();
        formData.append("messages", JSON.stringify(
          allMessages.map((m) => ({
            role: m.role,
            content: m.role === "user" && m === userMessage && currentInput
              ? currentInput
              : m.content,
          }))
        ));
        formData.append("file", currentFile);
        response = await fetch("/api/chat", { method: "POST", body: formData });
      } else {
        // Use JSON for text-only messages
        response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: allMessages }),
        });
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Erreur serveur (${response.status})`);
      }
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setMessages((prev) => [...prev, { role: "assistant", content: data.content }]);
    } catch (error: unknown) {
      console.error("Erreur chat:", error);
      const msg = error instanceof Error ? error.message : "Erreur de communication avec le serveur.";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${msg}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-8">
      <div className="max-w-4xl w-full text-center space-y-8">
        <h1 className="text-5xl font-extrabold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent drop-shadow-sm">
          Kiraa - Agent Intelligent
        </h1>
        <p className="text-slate-300 text-lg">
          L&apos;application de location de véhicules gérée par l&apos;IA (Architecture Zero-Hallucination).
        </p>

        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-700/50">
          <div className="flex flex-col space-y-4">
            {/* Chat messages */}
            <div className="bg-slate-900/50 rounded-lg p-6 h-96 overflow-y-auto border border-slate-700 text-left flex flex-col gap-4">
              <div className="text-slate-400 italic text-sm mb-2 text-center">La conversation avec Kiraa commencera ici...</div>

              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-xl max-w-[85%] shadow-sm whitespace-pre-wrap leading-relaxed text-sm ${
                    msg.role === "assistant"
                      ? "bg-blue-950/60 border border-blue-700/50 text-blue-100 rounded-tl-none self-start"
                      : "bg-emerald-950/60 border border-emerald-700/50 text-emerald-100 rounded-tr-none self-end"
                  }`}
                >
                  {msg.content}
                </div>
              ))}

              {isLoading && (
                <div className="bg-blue-900/40 border border-blue-800/50 text-blue-200 p-3 rounded-xl rounded-tl-none self-start max-w-[80%] shadow-sm flex items-center gap-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* File preview badge */}
            {attachedFile && (
              <div className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2 text-sm text-slate-300 border border-slate-600 self-start">
                <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <span className="truncate max-w-xs">{attachedFile.name}</span>
                <button
                  onClick={handleRemoveFile}
                  className="ml-1 text-slate-400 hover:text-red-400 transition-colors flex-shrink-0"
                  title="Retirer le fichier"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Input row */}
            <form onSubmit={handleSubmit} className="flex space-x-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                placeholder="Ex: Je veux louer une voiture compacte pour 3 jours..."
                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading || (!input.trim() && !attachedFile)}
                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-medium transition-colors shadow-lg shadow-blue-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Envoyer
              </button>
            </form>

            {/* Footer row */}
            <div className="flex items-center justify-between text-sm text-slate-400 pt-2 border-t border-slate-700/50 mt-4">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.json"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className={`flex items-center gap-1 cursor-pointer transition-colors ${
                  attachedFile ? "text-emerald-400 hover:text-emerald-300" : "hover:text-white"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                {attachedFile ? `Fichier prêt : ${attachedFile.name}` : "Joindre un document (Permis, CIN, PDF, Image, TXT, JSON)"}
              </label>
              <span className="text-emerald-400 font-medium flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
                Agent en ligne
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm mt-12">
          <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/30">
            <span className="block text-blue-400 font-bold mb-1">Architecture</span>
            LangGraph.js (7 Couches)
          </div>
          <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/30">
            <span className="block text-emerald-400 font-bold mb-1">Fiabilité</span>
            Moteur Déterministe TypeScript
          </div>
          <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/30">
            <span className="block text-purple-400 font-bold mb-1">Données</span>
            PostgreSQL + pgvector
          </div>
        </div>
      </div>
    </div>
  );
}
