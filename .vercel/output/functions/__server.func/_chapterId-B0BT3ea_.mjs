import { i as __toESM } from "./_runtime.mjs";
import { n as require_jsx_runtime } from "./_libs/radix-ui__react-context+react.mjs";
import { n as require_react } from "./_libs/@radix-ui/react-compose-refs+[...].mjs";
import { a as ImagePlus, l as ChevronLeft, o as Download, r as Trash2, s as ChevronUp, u as ChevronDown } from "./_libs/lucide-react.mjs";
import { a as PAGE_WIDTHS, c as cn, f as selectedIds, h as useStudio, l as countLabel, m as stripFreshness, n as FORMAT_HINT, o as SEAMS, p as slugify, r as IMAGE_ACCEPT, s as buttonClass, t as Button, u as extensionFor } from "./_ssr/store-cm1zIiwn.mjs";
import { b as useNavigate, y as Link } from "./_libs/@tanstack/react-router+[...].mjs";
import { a as InlineTitle, i as ConfirmButton, n as Route, o as Segment } from "./_ssr/router-DQl6ei5w.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/_chapterId-B0BT3ea_.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var emptyUrls = [];
function ChapterStudio({ projectId, chapterId }) {
	const project = useStudio((state) => state.projects.find((item) => item.id === projectId));
	const chapter = useStudio((state) => state.chapters.find((item) => item.id === chapterId));
	const panels = useStudio((state) => state.panels);
	const thumbs = useStudio((state) => state.thumbs);
	const stripUrls = useStudio((state) => state.stripUrls[chapterId] ?? emptyUrls);
	const selectedMap = useStudio((state) => state.selected);
	const job = useStudio((state) => state.job);
	const loadMedia = useStudio((state) => state.loadMedia);
	const addImages = useStudio((state) => state.addImages);
	const renameChapter = useStudio((state) => state.renameChapter);
	const deleteChapter = useStudio((state) => state.deleteChapter);
	const setChapterOptions = useStudio((state) => state.setChapterOptions);
	const removePanel = useStudio((state) => state.removePanel);
	const movePanel = useStudio((state) => state.movePanel);
	const placePanel = useStudio((state) => state.placePanel);
	const toggleSelected = useStudio((state) => state.toggleSelected);
	const selectAll = useStudio((state) => state.selectAll);
	const selectNone = useStudio((state) => state.selectNone);
	const display = useStudio((state) => state.display);
	const clearStrip = useStudio((state) => state.clearStrip);
	const navigate = useNavigate();
	const [pane, setPane] = (0, import_react.useState)("panels");
	const [dragOver, setDragOver] = (0, import_react.useState)(false);
	const [dragId, setDragId] = (0, import_react.useState)(null);
	const [canDrag, setCanDrag] = (0, import_react.useState)(false);
	const inputRef = (0, import_react.useRef)(null);
	const pageRef = (0, import_react.useRef)(null);
	const busy = job?.chapterId === chapterId;
	const list = (0, import_react.useMemo)(() => panels.filter((panel) => panel.chapterId === chapterId).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt), [panels, chapterId]);
	const checked = selectedIds({
		panels,
		selected: selectedMap
	}, chapterId);
	const checkedSet = (0, import_react.useMemo)(() => new Set(checked), [checked]);
	const extras = chapter?.strip ? checked.filter((id) => !chapter.strip?.panelIds.includes(id)) : [];
	const freshness = chapter ? stripFreshness(chapter, panels) : "empty";
	const panelKey = list.map((panel) => panel.id).join(",");
	const stripKey = chapter?.strip?.createdAt ?? 0;
	(0, import_react.useEffect)(() => {
		setCanDrag(window.matchMedia("(pointer: fine)").matches);
	}, []);
	(0, import_react.useEffect)(() => {
		loadMedia(chapterId);
	}, [
		loadMedia,
		chapterId,
		panelKey,
		stripKey
	]);
	(0, import_react.useEffect)(() => {
		const block = (event) => event.preventDefault();
		window.addEventListener("dragover", block);
		window.addEventListener("drop", block);
		return () => {
			window.removeEventListener("dragover", block);
			window.removeEventListener("drop", block);
		};
	}, []);
	(0, import_react.useEffect)(() => {
		const onPaste = (event) => {
			const files = [...event.clipboardData?.files ?? []];
			if (files.length === 0) return;
			event.preventDefault();
			addImages(chapterId, files);
		};
		window.addEventListener("paste", onPaste);
		return () => window.removeEventListener("paste", onPaste);
	}, [addImages, chapterId]);
	if (!project || !chapter || chapter.projectId !== projectId) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh max-w-3xl flex-col px-5 pt-8",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/",
				className: "font-display text-lg",
				children: "Inkstrip"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "mt-10 font-display text-3xl",
				children: "This chapter is gone."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/",
				className: "mt-6 text-sm text-muted",
				children: "Back to projects"
			})
		]
	});
	function takeFiles(files) {
		const list = [...files ?? []];
		if (list.length === 0) return;
		addImages(chapterId, list);
	}
	async function runDisplay(mode) {
		if (!await display(chapterId, mode)) return;
		setPane("page");
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (window.matchMedia("(min-width: 48rem)").matches) pageRef.current?.scrollIntoView({
			behavior: reduce ? "auto" : "smooth",
			block: "start"
		});
		else window.scrollTo({
			top: 0,
			behavior: reduce ? "auto" : "smooth"
		});
	}
	const progress = job && job.total > 0 ? Math.round(job.done / job.total * 100) : 8;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "min-h-dvh",
		onDragEnter: () => setDragOver(true),
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-bg px-3 sm:px-5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/p/$projectId",
					params: { projectId },
					className: "press focus-ring inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-muted hover:text-fg",
					"aria-label": `Back to ${project.title}`,
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, { className: "size-5" })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "min-w-0 flex-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(InlineTitle, {
						value: chapter.title,
						onSave: (value) => void renameChapter(chapter.id, value),
						className: "font-display text-lg text-fg"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "truncate text-xs text-subtle",
						children: project.title
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "sticky top-14 z-10 grid grid-cols-2 gap-1 border-b border-border bg-bg p-2 md:hidden",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: cn("press focus-ring h-10 rounded-sm text-sm", pane === "panels" ? "bg-bg-subtle text-fg" : "text-muted"),
					onClick: () => setPane("panels"),
					children: "Panels"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: cn("press focus-ring h-10 rounded-sm text-sm", pane === "page" ? "bg-bg-subtle text-fg" : "text-muted"),
					onClick: () => setPane("page"),
					children: "Display"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "md:flex",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: cn("studio-aside border-border md:border-r", pane === "panels" ? "block" : "hidden md:block", dragOver && "bg-bg-elevated"),
					onDragOver: (event) => {
						event.preventDefault();
						setDragOver(true);
					},
					onDragLeave: () => setDragOver(false),
					onDrop: (event) => {
						event.preventDefault();
						setDragOver(false);
						if (event.dataTransfer.files.length > 0) takeFiles(event.dataTransfer.files);
					},
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-col gap-4 p-4",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: buttonClass({
										className: "w-full",
										variant: busy ? "secondary" : "primary"
									}),
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ImagePlus, { className: "size-4" }),
										"Add images",
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											ref: inputRef,
											type: "file",
											accept: IMAGE_ACCEPT,
											multiple: true,
											disabled: busy,
											className: "sr-only",
											onChange: (event) => {
												takeFiles(event.target.files);
												event.target.value = "";
											}
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "text-sm text-muted",
									children: [
										"Opens the photo library on a phone, or files on a computer. ",
										FORMAT_HINT,
										". You can also drop or paste."
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Segment, {
									label: "Page width",
									value: chapter.width,
									options: PAGE_WIDTHS.map((width) => ({
										value: width,
										label: String(width)
									})),
									onChange: (width) => void setChapterOptions(chapter.id, { width })
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Segment, {
									label: "Seam",
									value: chapter.seam,
									options: SEAMS.map((seam) => ({
										value: seam.value,
										label: seam.label
									})),
									onChange: (seam) => void setChapterOptions(chapter.id, { seam })
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Segment, {
									label: "File",
									value: chapter.format,
									options: [{
										value: "image/jpeg",
										label: "JPG"
									}, {
										value: "image/png",
										label: "PNG"
									}],
									onChange: (format) => void setChapterOptions(chapter.id, { format })
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex items-center justify-between gap-3 text-sm",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
										className: "text-muted tabular-nums",
										children: [
											checked.length,
											" of ",
											list.length,
											" checked"
										]
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "flex gap-2",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											className: "focus-ring rounded-sm text-fg",
											onClick: () => selectAll(chapter.id),
											children: "All"
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											className: "focus-ring rounded-sm text-muted",
											onClick: () => selectNone(chapter.id),
											children: "None"
										})]
									})]
								})
							]
						}),
						list.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: cn("mx-4 mb-4 rounded-xl border border-dashed border-border px-4 py-10 text-center", dragOver && "border-fg"),
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "font-display text-2xl text-fg",
								children: "Drop panels here"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-2 text-sm text-muted",
								children: "Top to bottom becomes the reading order."
							})]
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
							className: "flex flex-col gap-2 px-4 pb-4",
							children: list.map((panel, index) => {
								const on = checkedSet.has(panel.id);
								return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
									draggable: canDrag,
									onDragStart: (event) => {
										event.dataTransfer.setData("text/plain", panel.id);
										event.dataTransfer.effectAllowed = "move";
										setDragId(panel.id);
									},
									onDragEnd: () => setDragId(null),
									onDragOver: (event) => event.preventDefault(),
									onDrop: (event) => {
										event.preventDefault();
										event.stopPropagation();
										const from = event.dataTransfer.getData("text/plain") || dragId;
										if (from) placePanel(chapter.id, from, panel.id);
										setDragId(null);
										setDragOver(false);
									},
									className: cn("flex items-center gap-3 rounded-lg border border-border bg-bg p-2", on && "bg-bg-subtle", dragId === panel.id && "opacity-50"),
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											"aria-pressed": on,
											"aria-label": on ? `Uncheck ${panel.name}` : `Check ${panel.name}`,
											onClick: () => toggleSelected(chapter.id, panel.id),
											className: cn("focus-ring grid size-11 shrink-0 place-items-center rounded-sm border text-sm tabular-nums", on ? "border-accent bg-accent text-accent-fg" : "border-border text-muted"),
											children: String(index + 1).padStart(2, "0")
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											className: "focus-ring min-w-0 flex-1 text-left",
											onClick: () => toggleSelected(chapter.id, panel.id),
											children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
												className: "flex items-center gap-3",
												children: [thumbs[panel.id] ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
													src: thumbs[panel.id],
													alt: "",
													className: "h-16 w-12 rounded-sm bg-paper object-cover object-top"
												}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "h-16 w-12 rounded-sm bg-paper" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
													className: "min-w-0",
													children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
														className: "block truncate text-sm text-fg",
														children: panel.name
													}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
														className: "mt-1 block text-xs text-subtle tabular-nums",
														children: [
															panel.width,
															" × ",
															panel.height
														]
													})]
												})]
											})
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "flex shrink-0 flex-col",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												type: "button",
												className: "focus-ring grid size-8 place-items-center text-muted disabled:opacity-30",
												"aria-label": "Move up",
												disabled: index === 0 || busy,
												onClick: () => void movePanel(panel.id, -1),
												children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronUp, { className: "size-4" })
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												type: "button",
												className: "focus-ring grid size-8 place-items-center text-muted disabled:opacity-30",
												"aria-label": "Move down",
												disabled: index === list.length - 1 || busy,
												onClick: () => void movePanel(panel.id, 1),
												children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronDown, { className: "size-4" })
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											type: "button",
											className: "focus-ring grid size-11 place-items-center text-subtle hover:text-danger",
											"aria-label": `Remove ${panel.name}`,
											disabled: busy,
											onClick: () => void removePanel(panel.id),
											children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, { className: "size-4" })
										})
									]
								}, panel.id);
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "safe-b sticky bottom-0 border-t border-border bg-bg p-3",
							children: busy ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-fg",
								"aria-live": "polite",
								children: job?.label
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "mt-2 h-1 overflow-hidden rounded-full bg-bg-subtle",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "h-full bg-accent",
									style: { width: `${progress}%` }
								})
							})] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-col gap-2",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
										disabled: checked.length < 2,
										onClick: () => void runDisplay("replace"),
										children: ["Display", checked.length >= 2 ? ` ${checked.length}` : ""]
									}),
									chapter.strip && extras.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
										variant: "secondary",
										onClick: () => void runDisplay("append"),
										children: [
											"Add ",
											extras.length,
											" below"
										]
									}) : null,
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "text-xs text-subtle",
										children: "Display rebuilds the page from the checked photos, in this order. Add below keeps the current page and stitches newly checked photos underneath."
									})
								]
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "px-4 pb-6",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ConfirmButton, {
								title: `Delete ${chapter.title}?`,
								description: "Photos in this chapter are removed from this device.",
								confirmLabel: "Delete chapter",
								onConfirm: () => {
									deleteChapter(chapter.id).then(() => navigate({
										to: "/p/$projectId",
										params: { projectId }
									}));
								},
								className: "press focus-ring text-sm text-subtle hover:text-danger",
								children: "Delete chapter"
							})
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					ref: pageRef,
					className: cn("min-w-0 flex-1", pane === "page" ? "block" : "hidden md:block"),
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex flex-wrap items-center gap-3 px-4 py-4 sm:px-8",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "min-w-0 flex-1",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
									className: "font-display text-2xl text-fg",
									children: "Display"
								}), chapter.strip ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "mt-1 text-sm text-muted tabular-nums",
									children: [
										chapter.strip.width,
										" × ",
										chapter.strip.totalHeight.toLocaleString(),
										" ·",
										" ",
										countLabel(chapter.strip.panelIds.length, "photo"),
										chapter.strip.parts.length > 1 ? ` · ${chapter.strip.parts.length} parts` : ""
									]
								}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "mt-1 text-sm text-muted",
									children: "The stitched chapter shows up here."
								})]
							}), chapter.strip && stripUrls.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
								variant: "secondary",
								onClick: () => downloadStrip(project.title, chapter.title, chapter.format, stripUrls),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Download, { className: "size-4" }), "Save"]
							}) : null]
						}),
						freshness === "stale" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "px-4 pb-4 text-sm text-muted sm:px-8",
							children: "Order or settings changed. Display again to update the page."
						}) : null,
						chapter.strip && stripUrls.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "bg-bg px-0 pb-16 md:px-8 md:pb-20",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
								className: "mx-auto w-full max-w-md bg-paper text-ink md:sheet-shadow",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
									className: "flex items-baseline justify-between gap-3 px-4 py-4",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
										className: "font-display text-xl",
										children: chapter.title
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "truncate text-xs text-ink/60",
										children: project.title
									})]
								}), stripUrls.map((url, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
									src: url,
									alt: `${chapter.title}, part ${index + 1} of ${stripUrls.length}`,
									width: chapter.strip?.width,
									height: chapter.strip?.parts[index]?.height,
									className: "block h-auto w-full"
								}, chapter.strip?.parts[index]?.blobId ?? url))]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "mx-auto mt-4 flex w-full max-w-md justify-end px-4 md:px-0",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									type: "button",
									className: "focus-ring text-sm text-subtle hover:text-fg",
									onClick: () => void clearStrip(chapter.id),
									children: "Clear page"
								})
							})]
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "px-4 pb-16 sm:px-8",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "mx-auto flex min-h-80 w-full max-w-md flex-col justify-end bg-paper px-5 py-8 text-ink",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "text-xs tracking-widest uppercase text-ink/50",
										children: "Empty page"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
										className: "mt-3 font-display text-3xl",
										children: "Nothing stitched yet."
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
										className: "mt-3 max-w-xs text-sm text-ink/70",
										children: "Check at least two photos, then press Display. Add more later and stitch them into the same chapter."
									})
								]
							})
						})
					]
				})]
			})
		]
	});
}
function downloadStrip(project, chapter, format, urls) {
	const base = `${slugify(project)}-${slugify(chapter)}`;
	const ext = extensionFor(format);
	urls.forEach((url, index) => {
		const name = urls.length === 1 ? `${base}.${ext}` : `${base}-part-${String(index + 1).padStart(2, "0")}.${ext}`;
		window.setTimeout(() => {
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = name;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
		}, index * 400);
	});
}
function ChapterPage() {
	const { projectId, chapterId } = Route.useParams();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChapterStudio, {
		projectId,
		chapterId
	});
}
//#endregion
export { ChapterPage as component };
