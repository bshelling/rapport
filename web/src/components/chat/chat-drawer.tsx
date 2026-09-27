"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { MessageCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useReport } from "@/components/report/report-provider";
import { ApiError, type ChatAction, sendChat } from "@/lib/api";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  actions?: ChatAction[];
  error?: boolean;
};

const SESSION_KEY = "rapport.chatSession";
const MESSAGES_KEY = "rapport.chatMessages";

const GREETING: Message = {
  id: "greeting",
  role: "assistant",
  text: "Hi! Tell me what you're seeing (a pothole, a clogged catch basin, a flooded street) and where. I'll draft the report for you to review. I can also check on your reports.",
};

const STARTERS = [
  "There's a pothole at Magazine and Napoleon",
  "The catch basin on my block is clogged",
  "What's the status of my reports?",
];

function newId() {
  return crypto.randomUUID().replaceAll("-", "");
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable; the chat just won't survive a reload
  }
}

export function ChatDrawer() {
  const auth = useAuth();
  const { openReport } = useReport();
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  // Restore this tab's conversation (sessionStorage is client-only).
  useEffect(() => {
    setSessionId(load(SESSION_KEY, "") || newId());
    setMessages(load<Message[]>(MESSAGES_KEY, []));
  }, []);

  useEffect(() => {
    if (sessionId) save(SESSION_KEY, sessionId);
  }, [sessionId]);

  useEffect(() => {
    save(MESSAGES_KEY, messages);
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (auth.status === "unavailable") return null;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || sending) return;
    setInput("");
    setSending(true);
    setMessages((m) => [...m, { id: newId(), role: "user", text: message }]);
    try {
      const res = await sendChat(sessionId, message);
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "assistant",
          text: res.reply,
          actions: res.actions,
        },
      ]);
    } catch (err) {
      const detail =
        err instanceof ApiError && err.status === 429
          ? String((err.detail as { detail?: string })?.detail ?? "")
          : "";
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "assistant",
          error: true,
          text:
            detail ||
            "Sorry, I couldn't answer just now. Please try again, or use the report form.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const newChat = () => {
    setSessionId(newId());
    setMessages([]);
  };

  const review = (draftId: string) => {
    setOpen(false);
    openReport(draftId);
  };

  const shown = [GREETING, ...messages];

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="fixed right-4 bottom-4 z-30 flex items-center gap-2 rounded-full bg-accent px-5 py-3 font-semibold text-background shadow-lg hover:opacity-90 sm:right-6 sm:bottom-6"
        >
          <MessageCircle className="size-5" aria-hidden /> Ask Rapport
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 sm:bg-transparent" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col rounded-t-3xl border border-border bg-background shadow-2xl outline-none sm:inset-x-auto sm:right-6 sm:bottom-6 sm:h-[min(40rem,calc(100dvh-3rem))] sm:w-[26rem] sm:rounded-3xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
            <Dialog.Title className="font-semibold">Ask Rapport</Dialog.Title>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={newChat}
                  className="rounded-full px-3 py-1 text-sm text-muted hover:bg-brand/10"
                >
                  New chat
                </button>
              )}
              <Dialog.Close
                className="rounded-full p-1.5 text-muted hover:bg-brand/10"
                aria-label="Close chat"
              >
                <X className="size-5" aria-hidden />
              </Dialog.Close>
            </div>
          </div>

          {auth.status === "signedIn" ? (
            <>
              <div
                className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
                role="log"
                aria-live="polite"
                aria-label="Conversation"
              >
                <AnimatePresence initial={false}>
                  {shown.map((m) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className={
                        m.role === "user"
                          ? "max-w-[85%] self-end rounded-2xl rounded-br-md bg-brand px-4 py-2 text-background"
                          : "max-w-[90%] self-start"
                      }
                    >
                      {m.role === "user" ? (
                        m.text
                      ) : (
                        <AssistantMessage message={m} onReview={review} />
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
                {sending && <Typing />}
                {messages.length === 0 && (
                  <div className="mt-1 flex flex-col items-start gap-2">
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="rounded-full border border-border px-3 py-1.5 text-left text-sm hover:bg-brand/10"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                <div ref={bottom} />
              </div>
              <form
                className="flex gap-2 border-t border-border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
              >
                <label htmlFor="chat-input" className="sr-only">
                  Message
                </label>
                <input
                  id="chat-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  maxLength={2000}
                  autoComplete="off"
                  placeholder="Describe the problem and where it is"
                  className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim()}
                  className="rounded-full bg-brand px-4 py-2 font-semibold text-background disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-1 flex-col gap-4 p-5">
              <p>{GREETING.text}</p>
              <button
                type="button"
                onClick={() => auth.status === "signedOut" && auth.signIn()}
                className="self-start rounded-full bg-brand px-5 py-2 font-semibold text-background"
              >
                Sign in to chat
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AssistantMessage({
  message,
  onReview,
}: {
  message: Message;
  onReview: (draftId: string) => void;
}) {
  const drafts = (message.actions ?? []).filter(
    (a) => a.type === "review_draft",
  );
  return (
    <div className="flex flex-col gap-2">
      <p
        className={`whitespace-pre-wrap rounded-2xl rounded-bl-md px-4 py-2 ${message.error ? "bg-red-500/10" : "bg-border/40"}`}
      >
        <Emphasis text={message.text} />
      </p>
      {drafts.map((a) => (
        <div
          key={a.draft_id}
          className="rounded-2xl border border-brand/40 p-4"
          data-testid="draft-card"
        >
          <p className="font-medium">Your report is drafted</p>
          <p className="mt-1 text-sm text-muted">
            Check the details, add photos if you have them, then submit.
          </p>
          <button
            type="button"
            onClick={() => onReview(a.draft_id)}
            className="mt-3 rounded-full bg-brand px-4 py-1.5 font-semibold text-background"
          >
            Review &amp; submit
          </button>
        </div>
      ))}
    </div>
  );
}

/** Replies are plain text; render stray **bold** instead of showing asterisks. */
function Emphasis({ text }: { text: string }) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder
      <strong key={i}>{part}</strong>
    ) : (
      part
    ),
  );
}

function Typing() {
  return (
    <output
      className="flex gap-1 self-start rounded-2xl rounded-bl-md bg-border/40 px-4 py-3"
      aria-label="Rapport is typing"
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block size-2 rounded-full bg-muted"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </output>
  );
}
