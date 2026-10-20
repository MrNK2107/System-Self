import { router } from "expo-router";
import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { space, type } from "@/constants/type";
import { useColors } from "@/hooks/useColors";
import { parseMarkdown, type Block, type Inline } from "@/lib/legal/markdown";

function openLink(href: string) {
  // Absolute paths are screens inside the app (for example the Terms linking to the Privacy Policy).
  if (href.startsWith("/")) router.push(href as never);
  else void Linking.openURL(href).catch(() => {});
}

function Inlines({ items }: { items: Inline[] }) {
  const colors = useColors();
  return (
    <>
      {items.map((it, i) => {
        if (it.type === "bold") return <Text key={i} style={[s.bold, { color: colors.foreground }]}>{it.text}</Text>;
        if (it.type === "link") {
          return (
            <Text key={i} style={[s.link, { color: colors.primary }]} accessibilityRole="link" onPress={() => openLink(it.href)}>
              {it.text}
            </Text>
          );
        }
        return <Text key={i}>{it.text}</Text>;
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  const colors = useColors();
  const body = [type.body, { color: colors.mutedForeground }];
  switch (block.type) {
    case "heading":
      return (
        <Text accessibilityRole="header" style={[type.title, block.level === 1 ? s.h1 : s.h2, { color: colors.foreground }]}>
          <Inlines items={block.inlines} />
        </Text>
      );
    case "paragraph":
      return (
        <Text style={body}>
          <Inlines items={block.inlines} />
        </Text>
      );
    case "ul":
    case "ol":
      return (
        <View style={s.list}>
          {block.items.map((item, i) => (
            <View key={i} style={s.item}>
              <Text style={[body, s.marker]}>{block.type === "ul" ? "\u2022" : `${i + 1}.`}</Text>
              <Text style={[body, s.itemText]}>
                <Inlines items={item} />
              </Text>
            </View>
          ))}
        </View>
      );
  }
}

/** Renders markdown (headings, paragraphs, lists, bold, links) with the app's colours. */
export function MarkdownView({ source }: { source: string }) {
  const blocks = React.useMemo(() => parseMarkdown(source), [source]);
  return (
    <View style={s.root}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: space.md },
  // More space above a heading than below it.
  h1: { marginTop: space.sm },
  h2: { marginTop: space.md },
  bold: { fontWeight: "600" as const },
  link: { textDecorationLine: "underline" as const },
  list: { gap: space.sm },
  item: { flexDirection: "row" as const, gap: space.sm },
  marker: { width: 20, textAlign: "right" as const },
  itemText: { flex: 1 },
});
