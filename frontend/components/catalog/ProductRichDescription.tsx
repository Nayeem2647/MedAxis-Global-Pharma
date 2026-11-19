import { createElement, type ReactNode } from "react";

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
function decode(value: string) {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity: string) => {
      if (!entity.startsWith("#"))
        return entities[entity.toLowerCase()] ?? match;
      const number =
        entity[1]?.toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return number > 0 &&
        number <= 0x10ffff &&
        !(number >= 0xd800 && number <= 0xdfff)
        ? String.fromCodePoint(number)
        : "";
    },
  );
}

/** Build React elements from an allowlist, never execute HTML or copy its attributes. */
export function ProductRichDescription({ html }: { html: string }) {
  const root: { tag: string; children: ReactNode[] } = {
    tag: "div",
    children: [],
  };
  const stack = [root];
  const safe = html.replace(
    /<(script|style|iframe|object)\b[^>]*>[\s\S]*?<\/\1>/gi,
    "",
  );
  const allowed = new Set(["p", "br", "strong", "em", "h3", "ul", "ol", "li"]);
  let key = 0;
  for (const token of safe.matchAll(
    /<\/?([a-z][a-z\d]*)\b[^>]*>|([^<]+)|</gi,
  )) {
    const current = stack[stack.length - 1]!;
    if (!token[1]) {
      current.children.push(decode(token[2] ?? "<"));
      continue;
    }
    const tag = token[1].toLowerCase();
    if (!allowed.has(tag)) continue;
    if (tag === "br") {
      current.children.push(createElement("br", { key: key++ }));
      continue;
    }
    if (token[0].startsWith("</")) {
      if (stack.length > 1 && current.tag === tag) {
        stack.pop();
        stack[stack.length - 1]!.children.push(
          createElement(current.tag, { key: key++ }, ...current.children),
        );
      }
    } else if (stack.length < 25) stack.push({ tag, children: [] });
  }
  while (stack.length > 1) {
    const current = stack.pop()!;
    stack[stack.length - 1]!.children.push(
      createElement(current.tag, { key: key++ }, ...current.children),
    );
  }
  return createElement('div', { className: 'product-rich-description' }, ...root.children);
}
