import { i as __toESM } from "./_runtime.mjs";
import { n as require_jsx_runtime } from "./_libs/radix-ui__react-context+react.mjs";
import { n as require_react } from "./_libs/@radix-ui/react-compose-refs+[...].mjs";
import { c as ChevronRight, i as Plus, l as ChevronLeft, r as Trash2 } from "./_libs/lucide-react.mjs";
import { h as useStudio, l as countLabel, t as Button } from "./_ssr/store-cm1zIiwn.mjs";
import { b as useNavigate, y as Link } from "./_libs/@tanstack/react-router+[...].mjs";
import { a as InlineTitle, i as ConfirmButton, r as Route$1, s as Wordmark } from "./_ssr/router-DQl6ei5w.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/_projectId-CsyR4Pb4.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function ProjectView({ projectId }) {
	const project = useStudio((state) => state.projects.find((item) => item.id === projectId));
	const allChapters = useStudio((state) => state.chapters);
	const chapters = (0, import_react.useMemo)(() => allChapters.filter((chapter) => chapter.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt), [allChapters, projectId]);
	const panels = useStudio((state) => state.panels);
	const renameProject = useStudio((state) => state.renameProject);
	const deleteProject = useStudio((state) => state.deleteProject);
	const createChapter = useStudio((state) => state.createChapter);
	const deleteChapter = useStudio((state) => state.deleteChapter);
	const navigate = useNavigate();
	const [creating, setCreating] = (0, import_react.useState)(false);
	if (!project) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh max-w-3xl flex-col px-5 pt-8",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Wordmark, {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "mt-10 font-display text-3xl",
				children: "This project is gone."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/",
				className: "focus-ring mt-6 inline-flex h-11 items-center text-sm text-muted",
				children: "Back to projects"
			})
		]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 pt-6 pb-16",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-between gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
					to: "/",
					className: "press focus-ring inline-flex h-11 items-center gap-1 rounded-sm text-sm text-muted",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, { className: "size-4" }), "Projects"]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ConfirmButton, {
					title: "Delete project?",
					description: "Every chapter and photo in this project is removed from this device.",
					confirmLabel: "Delete project",
					onConfirm: () => {
						deleteProject(project.id).then(() => navigate({ to: "/" }));
					},
					className: "press focus-ring inline-flex h-11 items-center gap-2 rounded-sm px-2 text-sm text-subtle hover:text-danger",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, { className: "size-4" }), "Delete"]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(InlineTitle, {
				value: project.title,
				onSave: (value) => void renameProject(project.id, value),
				className: "mt-4 font-display text-4xl text-fg"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted",
				children: "Chapters are stitched separately, then read top to bottom."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-8",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
					disabled: creating,
					onClick: () => {
						setCreating(true);
						createChapter(project.id).then((chapterId) => navigate({
							to: "/p/$projectId/c/$chapterId",
							params: {
								projectId: project.id,
								chapterId
							}
						})).finally(() => setCreating(false));
					},
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, { className: "size-4" }), creating ? "Creating…" : "New chapter"]
				})
			}),
			chapters.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-10 text-muted",
				children: "No chapters yet. Start with one and add photos inside it."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
				className: "mt-8 flex flex-col gap-3",
				children: chapters.map((chapter, index) => {
					const count = panels.filter((panel) => panel.chapterId === chapter.id).length;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "flex items-stretch gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
							to: "/p/$projectId/c/$chapterId",
							params: {
								projectId: project.id,
								chapterId: chapter.id
							},
							className: "focus-ring flex min-w-0 flex-1 items-center gap-4 rounded-xl border border-border bg-bg-elevated p-4 hover:border-muted",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "w-10 shrink-0 font-display text-2xl text-subtle tabular-nums",
									children: String(index + 1).padStart(2, "0")
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "min-w-0 flex-1",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "block truncate font-display text-xl text-fg",
										children: chapter.title
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "mt-1 block text-sm text-muted",
										children: [countLabel(count, "photo"), chapter.strip ? " · page ready" : " · not stitched"]
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "size-5 shrink-0 text-subtle" })
							]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ConfirmButton, {
							title: `Delete ${chapter.title}?`,
							description: "Photos in this chapter are removed from this device.",
							confirmLabel: "Delete chapter",
							onConfirm: () => void deleteChapter(chapter.id),
							className: "press focus-ring rounded-xl border border-border px-3 text-subtle hover:text-danger",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "sr-only",
								children: ["Delete ", chapter.title]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, { className: "size-4" })]
						})]
					}, chapter.id);
				})
			})
		]
	});
}
function ProjectPage() {
	const { projectId } = Route$1.useParams();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProjectView, { projectId });
}
//#endregion
export { ProjectPage as component };
