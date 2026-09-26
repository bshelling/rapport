"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

// Only formatting the API keeps (see api/app/html.py).
const extensions = [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: false,
  }),
];

export function RichText({
  id,
  value,
  onChange,
  labelledBy,
}: {
  id: string;
  value: string;
  onChange: (html: string, text: string) => void;
  labelledBy: string;
}) {
  const editor = useEditor({
    extensions,
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        id,
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelledBy,
        class:
          "min-h-32 px-3 py-2 outline-none [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML(), e.getText()),
  });

  const tool = (
    label: string,
    active: boolean,
    run: () => void,
    glyph: React.ReactNode,
  ) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
      className={`rounded-lg px-2.5 py-1 text-sm ${active ? "bg-brand/15 text-brand" : "hover:bg-brand/10"}`}
    >
      {glyph}
    </button>
  );

  return (
    <div className="rounded-xl border border-border focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
      <div className="flex gap-1 border-b border-border p-1.5">
        {tool(
          "Bold",
          !!editor?.isActive("bold"),
          () => editor?.chain().focus().toggleBold().run(),
          <b>B</b>,
        )}
        {tool(
          "Italic",
          !!editor?.isActive("italic"),
          () => editor?.chain().focus().toggleItalic().run(),
          <i>I</i>,
        )}
        {tool(
          "Bulleted list",
          !!editor?.isActive("bulletList"),
          () => editor?.chain().focus().toggleBulletList().run(),
          "• List",
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
