import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMarkdown, parseInline } from "./markdown";

test("headings by level, paragraphs joined across lines, blank lines separate", () => {
  const blocks = parseMarkdown("# Title\n\n## Section\nline one\nline two\n\nsecond para\n");
  assert.deepEqual(blocks, [
    { type: "heading", level: 1, inlines: [{ type: "text", text: "Title" }] },
    { type: "heading", level: 2, inlines: [{ type: "text", text: "Section" }] },
    { type: "paragraph", inlines: [{ type: "text", text: "line one line two" }] },
    { type: "paragraph", inlines: [{ type: "text", text: "second para" }] },
  ]);
});

test("bulleted and numbered lists", () => {
  const blocks = parseMarkdown("- one\n- **two**\n* three\n\n1. first\n2. second");
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0]!.type, "ul");
  assert.equal((blocks[0] as { items: unknown[] }).items.length, 3);
  assert.deepEqual((blocks[0] as { items: unknown[][] }).items[1], [{ type: "bold", text: "two" }]);
  assert.equal(blocks[1]!.type, "ol");
  assert.equal((blocks[1] as { items: unknown[] }).items.length, 2);
});

test("bold and links inline, with surrounding text kept", () => {
  assert.deepEqual(parseInline("a **b** c [site](https://x.test/p?q=1) d"), [
    { type: "text", text: "a " },
    { type: "bold", text: "b" },
    { type: "text", text: " c " },
    { type: "link", text: "site", href: "https://x.test/p?q=1" },
    { type: "text", text: " d" },
  ]);
});

test("unterminated markers stay literal text and nothing throws", () => {
  assert.deepEqual(parseInline("2 ** 3 and [not a link]"), [{ type: "text", text: "2 ** 3 and [not a link]" }]);
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("\n\n  \n"), []);
});

test("CRLF input parses like LF; a list ends at the next paragraph", () => {
  const blocks = parseMarkdown("- a\r\n- b\r\ntext\r\n");
  assert.deepEqual(blocks.map((b) => b.type), ["ul", "paragraph"]);
});

test("html and scripts are plain text, never interpreted", () => {
  const [p] = parseMarkdown("<b>x</b> [x](javascript:alert(1))");
  assert.equal(p!.type, "paragraph");
  const links = (p as { inlines: { type: string; href?: string }[] }).inlines.filter((i) => i.type === "link");
  assert.deepEqual(links, []);
});
