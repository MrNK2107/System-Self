// A deliberately small markdown reader for the bundled legal documents: headings, paragraphs, bulleted and numbered
// lists, **bold** and [links](url). A pure function from text to blocks, so it is unit-tested and renders anywhere.

export type Inline = { type: "text"; text: string } | { type: "bold"; text: string } | { type: "link"; text: string; href: string };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "ul"; items: Inline[][] }
  | { type: "ol"; items: Inline[][] };

/** Only web, mail, phone and in-app absolute paths are linkable; anything else (javascript:, data:) stays plain text. */
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/)/i;
const TOKEN = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const pushText = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === "text") prev.text += text;
    else out.push({ type: "text", text });
  };
  for (const m of src.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    pushText(src.slice(last, at));
    if (m[1] !== undefined) out.push({ type: "bold", text: m[1] });
    else if (m[3] !== undefined && SAFE_HREF.test(m[3])) out.push({ type: "link", text: m[2]!, href: m[3] });
    else pushText(m[0]);
    last = at + m[0].length;
  }
  pushText(src.slice(last));
  return out;
}

const HEADING = /^(#{1,3})\s+(.*\S)\s*$/;
const BULLET = /^\s*[-*]\s+(.*\S)\s*$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*\S)\s*$/;

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: Inline[][] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", inlines: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  for (const raw of src.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      flushList();
      blocks.push({ type: "heading", level: h[1]!.length as 1 | 2 | 3, inlines: parseInline(h[2]!) });
      continue;
    }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBERED.exec(line);
    const item = b ?? n;
    if (item) {
      flushPara();
      const kind = b ? "ul" : "ol";
      if (list && list.type !== kind) flushList();
      list ??= { type: kind, items: [] };
      list.items.push(parseInline(item[1]!));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}
