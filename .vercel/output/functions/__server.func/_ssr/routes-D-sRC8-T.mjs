import { i as __toESM } from "../_runtime.mjs";
import { n as require_jsx_runtime } from "../_libs/radix-ui__react-context+react.mjs";
import { n as require_react } from "../_libs/@radix-ui/react-compose-refs+[...].mjs";
import { c as ChevronRight, i as Plus } from "../_libs/lucide-react.mjs";
import { d as formatDay, h as useStudio, i as Modal, l as countLabel, t as Button } from "./store-cm1zIiwn.mjs";
import { b as useNavigate, y as Link } from "../_libs/@tanstack/react-router+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-D-sRC8-T.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function Library() {
	const projects = useStudio((state) => state.projects);
	const chapters = useStudio((state) => state.chapters);
	const createProject = useStudio((state) => state.createProject);
	const navigate = useNavigate();
	const [open, setOpen] = (0, import_react.useState)(false);
	const [title, setTitle] = (0, import_react.useState)("");
	const [saving, setSaving] = (0, import_react.useState)(false);
	const ordered = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
	async function onCreate(event) {
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		try {
			const created = await createProject(title);
			setTitle("");
			setOpen(false);
			await navigate({
				to: "/p/$projectId/c/$chapterId",
				params: {
					projectId: created.projectId,
					chapterId: created.chapterId
				}
			});
		} finally {
			setSaving(false);
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 pt-8 pb-16",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs font-medium tracking-widest text-subtle uppercase",
				children: "Studio"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-3 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "font-display text-4xl text-fg sm:text-5xl",
					children: "Inkstrip"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 max-w-md text-muted",
					children: "Stitch photos into a tall vertical manhwa. Projects and chapters stay on this device."
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
					className: "w-full shrink-0 sm:w-auto",
					onClick: () => setOpen(true),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, { className: "size-4" }), "New project"]
				})]
			}),
			ordered.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rise mt-14 rounded-xl border border-border bg-bg-elevated p-5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageStack, {}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "mt-6 font-display text-3xl text-fg",
						children: "A long page, panel by panel."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 max-w-md text-muted",
						children: "Create a project, open Chapter 1, and stack as many photos as the chapter needs. Display stitches only the ones you check."
					})
				]
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-10 flex flex-col gap-3",
				children: ordered.map((project) => {
					const count = chapters.filter((chapter) => chapter.projectId === project.id).length;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
						className: "rise",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
							to: "/p/$projectId",
							params: { projectId: project.id },
							className: "focus-ring flex items-center gap-4 rounded-xl border border-border bg-bg-elevated p-4 hover:border-muted",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "hidden h-14 w-1 shrink-0 rounded-full bg-paper sm:block",
									"aria-hidden": true
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "min-w-0 flex-1",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "block truncate font-display text-2xl text-fg",
										children: project.title
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "mt-1 block text-sm text-muted tabular-nums",
										children: [
											countLabel(count, "chapter"),
											" · Updated ",
											formatDay(project.updatedAt)
										]
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "size-5 shrink-0 text-subtle" })
							]
						})
					}, project.id);
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-10 text-sm text-subtle",
				children: "Photos never leave this browser."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Modal, {
				open,
				onOpenChange: setOpen,
				title: "New project",
				description: "Chapter 1 is created with it, ready for photos.",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					onSubmit: (event) => void onCreate(event),
					className: "flex flex-col gap-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "flex flex-col gap-2 text-sm text-muted",
						children: ["Title", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							autoFocus: true,
							value: title,
							onChange: (event) => setTitle(event.target.value),
							placeholder: "Night Market",
							className: "field",
							maxLength: 80
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						disabled: saving,
						children: saving ? "Creating…" : "Create chapter 1"
					})]
				})
			})
		]
	});
}
function PageStack() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "relative h-24 w-16",
		"aria-hidden": true,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute top-2 left-3 h-20 w-14 rounded-sm bg-bg-subtle" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute top-1 left-1.5 h-20 w-14 rounded-sm border border-border bg-bg" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "absolute top-0 left-0 flex h-20 w-14 flex-col gap-1 rounded-sm bg-paper p-1.5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "h-2 w-full bg-ink" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "h-6 w-full bg-ink/80" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "h-4 w-full bg-ink/70" })
				]
			})
		]
	});
}
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Library, {});
}
//#endregion
export { Home as component };
