"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, LoaderCircle, Search, X } from "lucide-react";
import {
  masterRecord,
  resourceList,
  type MasterRecord,
} from "../../lib/admin-management";
import { apiRequest } from "../../lib/api-client";
import {
  AdminFeedback,
  feedbackValue,
  type AdminFeedbackValue,
} from "./AdminFeedback";

type Selection = { id: string; label?: string };

/** A bounded, paginated combobox. Hidden IDs retain the registered form contract. */
export function MasterPicker({
  kind,
  name,
  label,
  initial = [],
  multiple = false,
}: {
  kind: "manufacturers" | "generics" | "categories";
  name: string;
  label: string;
  initial?: Selection[];
  multiple?: boolean;
}) {
  const [selected, setSelected] = useState(initial);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<MasterRecord[]>([]);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AdminFeedbackValue>();
  const [active, setActive] = useState(-1);
  const [retry, setRetry] = useState(0);
  const [above, setAbove] = useState(false);
  const root = useRef<HTMLFieldSetElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const firstPosition = useRef<"first" | "last">("first");
  const id = useId();
  const selectedIds = new Set(selected.map((item) => item.id));
  const searchLabel = `Search ${label.toLowerCase()}`;
  const display = multiple
    ? selected
        .map((item) => item.label ?? "Loading selected record…")
        .join(", ")
    : (selected[0]?.label ??
      (selected.length ? "Loading selected record…" : ""));
  useEffect(() => setReady(true), []);

  useEffect(() => {
    const unknown = selected.filter((item) => !item.label);
    if (!unknown.length) return;
    const controller = new AbortController();
    void Promise.allSettled(
      unknown.map(async (item) => {
        const result = await apiRequest(
          `/v1/admin/catalog/${kind}/${item.id}`,
          masterRecord,
          { signal: controller.signal },
        );
        return { id: item.id, label: result.data.translations.en.name };
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const labels = new Map(
        results.map((result, index) =>
          result.status === "fulfilled"
            ? [result.value.id, result.value.label]
            : [unknown[index]!.id, "Unavailable record"],
        ),
      );
      setSelected((current) =>
        current.map((item) => ({
          ...item,
          label: item.label ?? labels.get(item.id),
        })),
      );
    });
    return () => controller.abort();
  }, [kind, selected]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void resourceList(
        kind,
        new URLSearchParams({
          page: String(page),
          limit: "20",
          is_active: "true",
          ...(q.trim() ? { q: q.trim() } : {}),
        }),
        controller.signal,
      )
        .then((result) => {
          if (controller.signal.aborted) return;
          const items = result.items.map((item) =>
            masterRecord.parse({ ...item, _id: item.id }),
          );
          setRows(items);
          setPages(result.pagination.total_pages);
          setTotal(result.pagination.total_items);
          setActive(
            items.length
              ? firstPosition.current === "last"
                ? items.length - 1
                : 0
              : -1,
          );
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setProblem(feedbackValue(error));
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, open, page, q, retry]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    const position = () => {
      const rect = input.current?.getBoundingClientRect();
      if (rect)
        setAbove(
          window.innerHeight - rect.bottom < 300 &&
            rect.top > window.innerHeight - rect.bottom,
        );
    };
    position();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && active >= 0)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  function loading() {
    setRows([]);
    setActive(-1);
    setBusy(true);
    setProblem(undefined);
  }
  function show(position: "first" | "last" = "first") {
    if (open || !ready || input.current?.matches(":disabled")) return;
    firstPosition.current = position;
    setQ("");
    setPage(1);
    loading();
    setOpen(true);
  }
  function choose(row: MasterRecord) {
    const chosen = selectedIds.has(row.id);
    if (multiple && !chosen && selected.length >= 100) return;
    setSelected((items) =>
      multiple
        ? chosen
          ? items.filter((item) => item.id !== row.id)
          : [...items, { id: row.id, label: row.translations.en.name }]
        : [{ id: row.id, label: row.translations.en.name }],
    );
    if (!multiple) setOpen(false);
    input.current?.focus();
  }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        show(event.key === "ArrowUp" ? "last" : "first");
        return;
      }
      if (!rows.length || busy) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      for (let offset = 1; offset <= rows.length; offset++) {
        const next =
          (active + direction * offset + rows.length * 2) % rows.length;
        if (
          !multiple ||
          selected.length < 100 ||
          selectedIds.has(rows[next]!.id)
        ) {
          setActive(next);
          break;
        }
      }
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      if (!busy && rows[active]) choose(rows[active]);
    }
    if (event.key === "Tab") setOpen(false);
  }

  return (
    <fieldset
      ref={root}
      className="admin-picker admin-search-picker"
      onBlur={(event) => {
        if (
          !event.relatedTarget ||
          !event.currentTarget.contains(event.relatedTarget as Node)
        )
          setOpen(false);
      }}
    >
      <legend>{label}</legend>
      {selected.map((item) => (
        <input key={item.id} type="hidden" name={name} value={item.id} />
      ))}
      <div className="admin-picker-control">
        {open && (
          <Search
            size={17}
            className="admin-picker-search-icon"
            aria-hidden="true"
          />
        )}
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={searchLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={`${id}-options`}
          aria-autocomplete="list"
          aria-activedescendant={
            open && active >= 0 ? `${id}-option-${active}` : undefined
          }
          autoComplete="off"
          disabled={!ready}
          value={open ? q : display}
          title={!open ? display : undefined}
          placeholder={
            open
              ? `Search ${label.toLowerCase()}…`
              : `Select ${label.toLowerCase()}`
          }
          className={open ? "is-searching" : ""}
          onFocus={() => show()}
          onClick={() => show()}
          onKeyDown={keys}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
            loading();
            if (!open) setOpen(true);
          }}
        />
        <div className="admin-picker-control-actions">
          {!multiple && selected.length > 0 && (
            <button
              type="button"
              disabled={!ready}
              aria-label={`Clear ${label.toLowerCase()}`}
              title={`Clear ${label.toLowerCase()}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSelected([]);
                setQ("");
              }}
            >
              <X size={16} />
            </button>
          )}
          <button
            type="button"
            disabled={!ready}
            aria-label={`${open ? "Close" : "Open"} ${label.toLowerCase()} options`}
            aria-expanded={open}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (open) setOpen(false);
              else {
                show();
                input.current?.focus();
              }
            }}
          >
            <ChevronDown size={18} className={open ? "is-open" : ""} />
          </button>
        </div>
        {open && (
          <div className={`admin-picker-popover${above ? " is-above" : ""}`}>
            <div
              className="admin-picker-result-status"
              role="status"
              aria-live="polite"
            >
              {busy ? (
                <>
                  <LoaderCircle size={15} className="spin" />
                  Loading options…
                </>
              ) : problem ? (
                "Options could not be loaded"
              ) : (
                `${total ?? 0} matches${pages > 1 ? ` · Page ${page} of ${pages}` : ""}`
              )}
            </div>
            {problem && (
              <div className="admin-picker-error">
                <AdminFeedback problem={problem} />
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    loading();
                    setRetry((value) => value + 1);
                  }}
                >
                  Retry options
                </button>
              </div>
            )}
            <div
              id={`${id}-options`}
              className="admin-picker-options"
              role="listbox"
              aria-label={`${label} options`}
              aria-multiselectable={multiple || undefined}
              aria-busy={busy}
            >
              {!busy &&
                !problem &&
                rows.map((row, index) => {
                  const chosen = selectedIds.has(row.id);
                  const unavailable =
                    multiple && !chosen && selected.length >= 100;
                  return (
                    <button
                      key={row.id}
                      id={`${id}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={chosen}
                      aria-disabled={unavailable || undefined}
                      disabled={unavailable}
                      tabIndex={-1}
                      className={active === index ? "is-highlighted" : ""}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setActive(index)}
                      onClick={() => choose(row)}
                    >
                      <span className="admin-picker-option-copy">
                        <strong>{row.translations.en.name}</strong>
                        {row.translations.zhCN && (
                          <small lang="zh-CN">
                            {row.translations.zhCN.name}
                          </small>
                        )}
                      </span>
                      {chosen && <Check size={17} aria-hidden="true" />}
                    </button>
                  );
                })}
            </div>
            {!busy && !problem && !rows.length && (
              <p className="admin-picker-empty">
                No matching active {label.toLowerCase()}.
              </p>
            )}
            {!problem && pages > 1 && (
              <div className="admin-picker-pagination">
                <button
                  type="button"
                  aria-label="Previous options"
                  disabled={busy || page <= 1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    loading();
                    setPage((value) => value - 1);
                  }}
                >
                  Previous
                </button>
                <span>
                  {page} / {pages}
                </span>
                <button
                  type="button"
                  aria-label="Next options"
                  disabled={busy || page >= pages}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    loading();
                    setPage((value) => value + 1);
                  }}
                >
                  Next
                </button>
              </div>
            )}
            {multiple && (
              <p className="admin-picker-multi-help">
                Select multiple categories. Click a selected option again to
                remove it.
              </p>
            )}
          </div>
        )}
      </div>
      {multiple && selected.length > 0 && (
        <div className="admin-picker-chips">
          {selected.map((item) => (
            <div className="admin-picker-selection" key={item.id}>
              <span>{item.label ?? "Loading selected record…"}</span>
              <button
                type="button"
                disabled={!ready}
                title={`Remove ${item.label ?? "selected category"}`}
                aria-label={`Remove ${item.label ?? "selected category"}`}
                onClick={() =>
                  setSelected((items) =>
                    items.filter((value) => value.id !== item.id),
                  )
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}
