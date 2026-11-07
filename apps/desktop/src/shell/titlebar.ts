/**
 * Title-bar page logic. Renders one shared title bar whose look is chosen by
 * `body[data-design]` (titlebar.css). Menus are the app's real native menus; the native
 * caption buttons (with Snap layouts) are drawn by Windows to the right of this page.
 */
import type { MenuCommand, ShellBridge, WindowState, WindowStatus } from "../../../../src/lib/desktop/contract.ts";

declare global {
  interface Window {
    inkstripShell: ShellBridge;
  }
}

const shell = window.inkstripShell;
const $ = <T extends Element>(selector: string) => document.querySelector(selector) as T;
const body = document.body;
const crumbs = $<HTMLElement>(".crumbs");
const title = $<HTMLElement>(".title");
const commandText = $<HTMLElement>(".command-text");
const save = $<HTMLElement>(".save");
const saveText = $<HTMLElement>(".save-text");
const saveButton = $<HTMLButtonElement>(".save-button");
const menuButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-menu]")];
let status: WindowStatus | null = null;

function rectOf(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, height: r.height };
}

function reportMenus() {
  const rects: Record<string, { x: number; y: number; height: number }> = {};
  for (const b of menuButtons) if (b.offsetParent) rects[b.dataset.menu!] = rectOf(b);
  // Hidden menus (Minimal design) open from the menu button instead.
  const all = menuButtons.find((b) => b.dataset.menu === "all");
  for (const name of ["file", "edit", "view", "help"]) if (!rects[name] && all?.offsetParent) rects[name] = rectOf(all);
  void shell.reportMenus(rects);
}

function applyState(state: WindowState) {
  body.dataset.design = state.design;
  body.classList.toggle("maximized", state.maximized);
  body.classList.toggle("fullscreen", state.fullscreen);
  body.classList.toggle("inactive", !state.focused);
  body.classList.toggle("mica", state.mica);
  body.style.setProperty("--accent", state.accent);
  requestAnimationFrame(reportMenus);
}

const SAVE_TEXT: Record<WindowStatus["save"], string> = {
  none: "",
  saved: "Saved",
  dirty: "Unsaved changes",
  unlinked: "Not saved to a file",
  missing: "File moved or deleted",
  saving: "Saving…",
};

function applyStatus(next: WindowStatus) {
  status = next;
  const parts: string[] = ["Library"];
  if (next.project) parts.push(next.project);
  if (next.chapter) parts.push(next.chapter);
  crumbs.replaceChildren(
    ...parts.flatMap((p, i) => {
      const span = document.createElement("span");
      span.textContent = p;
      if (i === parts.length - 1) span.className = "current";
      if (i === 0) return [span];
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "›";
      sep.setAttribute("aria-hidden", "true");
      return [sep, span];
    }),
  );
  const name = next.project ? `${next.project}${next.chapter ? ` — ${next.chapter}` : ""}` : "Inkstrip Manhwa Studio";
  title.textContent = name;
  commandText.textContent = next.project ? `${next.project} — Inkstrip` : "Search commands and projects";
  save.dataset.state = next.save;
  saveText.textContent =
    next.save === "saved" && next.fileName ? `Saved · ${next.fileName}` : SAVE_TEXT[next.save];
  save.title = next.fileName ?? "";
  saveButton.hidden = next.save === "none" || next.save === "saved" || next.save === "saving";
  document.title = `${next.save === "dirty" ? "● " : ""}${name}`;
  requestAnimationFrame(reportMenus);
}

for (const button of menuButtons)
  button.addEventListener("click", () => void shell.menu(button.dataset.menu as "file", rectOf(button)));

// Arrow keys move between menu buttons, like a native menu bar.
document.addEventListener("keydown", (e) => {
  const visible = menuButtons.filter((b) => b.offsetParent);
  const i = visible.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    visible[(i + (e.key === "ArrowRight" ? 1 : visible.length - 1)) % visible.length]!.focus();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    visible[i]!.click();
  }
});

const command = (c: MenuCommand) => () => void shell.command(c);
$<HTMLButtonElement>(".command-center").addEventListener("click", command("command-palette"));
saveButton.addEventListener("click", () =>
  void shell.command(status?.save === "unlinked" || status?.save === "missing" ? "save-as" : "save"),
);
window.addEventListener("resize", () => requestAnimationFrame(reportMenus));

void shell.ready().then(({ state, status: s }) => {
  applyState(state);
  if (s) applyStatus(s);
  else
    applyStatus({ project: null, chapter: null, workspace: "library", save: "none", fileName: null, savedAt: null });
  body.classList.add("ready");
});
shell.onState(applyState);
shell.onStatus(applyStatus);
