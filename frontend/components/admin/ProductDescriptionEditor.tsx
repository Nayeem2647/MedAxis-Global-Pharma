"use client";

import { useEffect, useId, useRef } from "react";
import { Bold, Heading3, Italic, List, ListOrdered } from "lucide-react";

// No pasted HTML, inline styles, event handlers or embedded media enter the editor.
function safeEditorHtml(value: string) {
  const document = new DOMParser().parseFromString(value, "text/html");
  document
    .querySelectorAll("script,style,iframe,object")
    .forEach((node) => node.remove());
  const allowed = new Set(["P", "BR", "STRONG", "EM", "H3", "UL", "OL", "LI"]);
  for (const node of [...document.body.querySelectorAll("*")].reverse()) {
    if (node.tagName === "DIV") {
      const replacement = document.createElement("p"); replacement.append(...node.childNodes); node.replaceWith(replacement);
    } else if (node.tagName === "B") {
      const replacement = document.createElement("strong");
      replacement.append(...node.childNodes);
      node.replaceWith(replacement);
    } else if (node.tagName === "I") {
      const replacement = document.createElement("em");
      replacement.append(...node.childNodes);
      node.replaceWith(replacement);
    } else if (!allowed.has(node.tagName)) node.replaceWith(...node.childNodes);
    else
      for (const attribute of [...node.attributes])
        node.removeAttribute(attribute.name);
  }
  return document.body.innerHTML;
}

export function ProductDescriptionEditor({
  label,
  value,
  onChange,
  disabled,
  lang,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  lang: string;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (editor.current && document.activeElement !== editor.current)
      editor.current.innerHTML = safeEditorHtml(value);
  }, [value]);

  function changed() {
    if (editor.current) onChange(safeEditorHtml(editor.current.innerHTML));
  }
  function format(tag: "strong" | "em" | "h3" | "ul" | "ol") {
    if (!editor.current) return;
    const selection = window.getSelection();
    if (
      !selection?.rangeCount ||
      !editor.current.contains(selection.anchorNode)
    ) {
      editor.current.focus();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.current.contains(range.commonAncestorContainer)) return;
    const wrapper = document.createElement(tag);
    const contents = range.extractContents();
    if (tag === "ul" || tag === "ol") {
      const item = document.createElement("li");
      item.append(contents);
      if (!item.textContent) item.textContent = "List item";
      wrapper.append(item);
    } else {
      wrapper.append(contents);
      if (!wrapper.textContent) wrapper.textContent = "Text";
    }
    range.insertNode(wrapper);
    range.selectNodeContents(wrapper);
    selection.removeAllRanges();
    selection.addRange(range);
    changed();
  }

  return (
    <div className="product-description-field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <div
        className="product-description-toolbar"
        role="toolbar"
        aria-label={`${label} formatting`}
      >
        {(
          [
            ["strong", Bold, "Bold"],
            ["em", Italic, "Italic"],
            ["h3", Heading3, "Heading"],
            ["ul", List, "Bullet list"],
            ["ol", ListOrdered, "Numbered list"],
          ] as const
        ).map(([tag, Icon, title]) => (
          <button
            key={tag}
            type="button"
            aria-label={title}
            title={title}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format(tag)}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
      <div
        ref={editor}
        id={id}
        lang={lang}
        className="product-description-input"
        role="textbox"
        aria-multiline="true"
        aria-labelledby={`${id}-label`}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={changed}
        onBlur={(event) => {
          event.currentTarget.innerHTML = safeEditorHtml(
            event.currentTarget.innerHTML,
          );
          changed();
        }}
        onPaste={(event) => {
          event.preventDefault();
          const selection = window.getSelection();
          if (
            !selection?.rangeCount ||
            !editor.current?.contains(selection.anchorNode)
          )
            return;
          const range = selection.getRangeAt(0);
          range.deleteContents();
          const text = document.createTextNode(
            event.clipboardData.getData("text/plain"),
          );
          range.insertNode(text);
          range.setStartAfter(text);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          changed();
        }}
      />
      <p className="product-field-help">
        Use verified product information. {value.length}/5000 characters
        including formatting.
      </p>
    </div>
  );
}
