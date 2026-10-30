import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { searchCommands, type WorkspaceCommand } from "@/lib/studio/pro/commands";

/** Find and run an existing tool, panel or document action by name. */
export function ProCommandPalette({
  open,
  onOpenChange,
  commands,
  onRun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: WorkspaceCommand[];
  onRun: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    list = useId(),
    input = useRef<HTMLInputElement>(null),
    results = useMemo(() => searchCommands(commands, query), [commands, query]),
    current = results[Math.min(active, results.length - 1)];
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => {
    if (current)
      document.getElementById(`${list}-${current.id}`)?.scrollIntoView({ block: "nearest" });
  }, [current, list]);
  const run = (command: WorkspaceCommand | undefined) => {
    if (!command || command.disabled) return;
    onOpenChange(false);
    onRun(command.id);
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Commands"
      description="Search tools, panels and document actions available in this workspace."
      layerClassName="pro-command-dialog"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        input.current?.focus();
      }}
    >
      <input
        ref={input}
        className="field pro-command-search"
        type="search"
        role="combobox"
        aria-label="Search commands"
        aria-expanded="true"
        aria-controls={list}
        aria-activedescendant={current ? `${list}-${current.id}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="Brush, layers, undo…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          const last = results.length - 1;
          const next =
            e.key === "ArrowDown"
              ? Math.min(last, active + 1)
              : e.key === "ArrowUp"
                ? Math.max(0, active - 1)
                : e.key === "Home" && e.ctrlKey
                  ? 0
                  : e.key === "End" && e.ctrlKey
                    ? last
                    : undefined;
          if (next !== undefined) {
            e.preventDefault();
            setActive(Math.max(0, next));
          } else if (e.key === "Enter") {
            e.preventDefault();
            run(current);
          }
        }}
      />
      <ul id={list} className="pro-command-list" role="listbox" aria-label="Commands">
        {results.map((command, index) => (
          <li
            key={command.id}
            id={`${list}-${command.id}`}
            role="option"
            aria-selected={command === current}
            aria-disabled={command.disabled || undefined}
            data-command={command.id}
            onPointerMove={() => setActive(index)}
            onClick={() => run(command)}
          >
            <span className="pro-command-group">{command.group}</span>
            <span className="pro-command-label">{command.label}</span>
            {command.disabled ? <span className="pro-command-note">Unavailable now</span> : null}
            {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
          </li>
        ))}
      </ul>
      {results.length ? null : (
        <p className="pro-command-empty" role="status">
          No matching command. Every tool remains in the tool rail.
        </p>
      )}
    </Modal>
  );
}
