import { n as require_jsx_runtime } from "../_libs/radix-ui__react-context+react.mjs";
import { t as X } from "../_libs/lucide-react.mjs";
import { n as clsx, t as cva } from "../_libs/class-variance-authority+clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
import { a as DialogOverlay, i as DialogDescription, n as DialogClose, o as DialogPortal, r as DialogContent, s as DialogTitle, t as Dialog } from "../_libs/@radix-ui/react-dialog+[...].mjs";
import { t as create } from "../_libs/zustand.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/store-cm1zIiwn.js
var import_jsx_runtime = require_jsx_runtime();
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
function cleanTitle(value, fallback) {
	return value.trim().replace(/\s+/g, " ").slice(0, 80) || fallback;
}
function countLabel(count, singular, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
}
function formatDay(timestamp) {
	return new Date(timestamp).toLocaleDateString(void 0, {
		month: "short",
		day: "numeric",
		year: "numeric"
	});
}
function slugify(value) {
	return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";
}
function uid() {
	return crypto.randomUUID();
}
var buttonVariants = cva("press focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium disabled:pointer-events-none disabled:opacity-40", {
	variants: {
		variant: {
			primary: "bg-accent text-accent-fg hover:brightness-95",
			secondary: "border border-border bg-bg-subtle text-fg hover:bg-bg-elevated",
			ghost: "text-fg hover:bg-bg-subtle",
			danger: "text-danger hover:bg-danger/10"
		},
		size: {
			md: "h-11 rounded-sm px-4 text-sm",
			sm: "h-10 rounded-sm px-3 text-sm",
			icon: "size-11 rounded-sm"
		}
	},
	defaultVariants: {
		variant: "primary",
		size: "md"
	}
});
function buttonClass({ className, variant, size }) {
	return cn(buttonVariants({
		variant,
		size
	}), className);
}
function Button({ className, variant, size, type = "button", ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type,
		className: buttonClass({
			className,
			variant,
			size
		}),
		...props
	});
}
function Modal({ open, onOpenChange, title, description, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dialog, {
		open,
		onOpenChange,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogPortal, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogOverlay, { className: "overlay-in fixed inset-0 z-40 bg-ink/70" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogContent, {
			className: "modal-in modal-panel fixed top-1/2 left-1/2 z-50 rounded-xl border border-border bg-bg-elevated p-4",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-start justify-between gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogTitle, {
						className: "font-display text-2xl text-fg",
						children: title
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogClose, {
						className: "press focus-ring rounded-sm p-2 text-muted hover:text-fg",
						"aria-label": "Close",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "size-4" })
					})]
				}),
				description ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogDescription, {
					className: "mt-2 text-sm text-muted",
					children: description
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogDescription, {
					className: "sr-only",
					children: title
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-5",
					children
				})
			]
		})] })
	});
}
var DB_NAME = "inkstrip";
var DB_VERSION = 1;
var dbPromise = null;
function request(req) {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? /* @__PURE__ */ new Error("Storage request failed"));
	});
}
function transactionDone(tx) {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? /* @__PURE__ */ new Error("Storage request failed"));
		tx.onabort = () => reject(tx.error ?? /* @__PURE__ */ new Error("Storage request aborted"));
	});
}
function openDb() {
	if (typeof indexedDB === "undefined") return Promise.reject(/* @__PURE__ */ new Error("This browser cannot store projects."));
	if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
		const open = indexedDB.open(DB_NAME, DB_VERSION);
		open.onupgradeneeded = () => {
			const db = open.result;
			if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
			if (!db.objectStoreNames.contains("chapters")) db.createObjectStore("chapters", { keyPath: "id" }).createIndex("by_project", "projectId");
			if (!db.objectStoreNames.contains("panels")) db.createObjectStore("panels", { keyPath: "id" }).createIndex("by_chapter", "chapterId");
			if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
		};
		open.onsuccess = () => {
			const db = open.result;
			db.onclose = () => {
				dbPromise = null;
			};
			db.onversionchange = () => {
				db.close();
				dbPromise = null;
			};
			resolve(db);
		};
		open.onerror = () => {
			dbPromise = null;
			reject(open.error ?? /* @__PURE__ */ new Error("Could not open storage."));
		};
	});
	return dbPromise;
}
async function loadLibrary() {
	const tx = (await openDb()).transaction([
		"projects",
		"chapters",
		"panels"
	], "readonly");
	const projects = await request(tx.objectStore("projects").getAll());
	const chapters = await request(tx.objectStore("chapters").getAll());
	const panels = await request(tx.objectStore("panels").getAll());
	await transactionDone(tx);
	return {
		projects,
		chapters,
		panels
	};
}
async function putRecords(input) {
	const names = [
		"projects",
		"chapters",
		"panels"
	].filter((name) => (input[name]?.length ?? 0) > 0);
	if (names.length === 0) return;
	const tx = (await openDb()).transaction(names, "readwrite");
	for (const name of names) {
		const store = tx.objectStore(name);
		for (const record of input[name] ?? []) store.put(record);
	}
	await transactionDone(tx);
}
async function putBlobs(entries) {
	if (entries.length === 0) return;
	const tx = (await openDb()).transaction("blobs", "readwrite");
	const store = tx.objectStore("blobs");
	for (const entry of entries) store.put(entry.blob, entry.id);
	await transactionDone(tx);
}
async function getBlob(id) {
	const tx = (await openDb()).transaction("blobs", "readonly");
	const blob = await request(tx.objectStore("blobs").get(id));
	await transactionDone(tx);
	return blob;
}
async function removeRecords(input) {
	const names = [
		"projects",
		"chapters",
		"panels",
		"blobs"
	].filter((name) => (input[name]?.length ?? 0) > 0);
	if (names.length === 0) return;
	const tx = (await openDb()).transaction(names, "readwrite");
	for (const name of names) {
		const store = tx.objectStore(name);
		for (const id of input[name] ?? []) store.delete(id);
	}
	await transactionDone(tx);
}
function storageMessage(error) {
	if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")) return "This device is out of space for more photos. Remove a chapter or try fewer images.";
	if (error instanceof Error && error.message) return error.message;
	return "Something went wrong while saving.";
}
function planStrip(frames, targetWidth, gap, limits) {
	const safeGap = Math.max(0, Math.round(gap));
	const requested = Math.max(1, Math.round(targetWidth));
	if (frames.length === 0) return {
		width: requested,
		totalHeight: 0,
		parts: []
	};
	const minWidth = Math.min(320, requested);
	const measure = (width) => {
		const maxH = Math.max(1, Math.min(limits.maxSide, Math.floor(limits.maxArea / width)) - safeGap);
		return frames.map((frame) => {
			const sw = Math.max(1, frame.sw);
			const sh = Math.max(1, frame.sh);
			let drawW = width;
			let drawH = Math.max(1, Math.round(sh * (width / sw)));
			if (drawH > maxH) {
				drawH = maxH;
				drawW = Math.max(1, Math.min(width, Math.round(drawH * (sw / sh))));
			}
			return {
				id: frame.id,
				drawW,
				drawH,
				x: Math.round((width - drawW) / 2)
			};
		});
	};
	let width = requested;
	let panels = measure(width);
	const stacked = (items) => items.reduce((sum, item) => sum + item.drawH, 0) + safeGap * Math.max(0, items.length - 1);
	while (width > minWidth) {
		const height = stacked(panels);
		if (!(height > limits.maxSide || width * height > limits.maxArea)) break;
		const next = Math.max(minWidth, Math.floor(width * .85));
		if (next === width) break;
		width = next;
		panels = measure(width);
	}
	const fits = (height) => height <= limits.maxSide && width * height <= limits.maxArea;
	const parts = [];
	let current = [];
	let height = 0;
	for (let index = 0; index < panels.length; index += 1) {
		const panel = panels[index];
		if (!panel) continue;
		const gapBefore = current.length > 0 ? safeGap : 0;
		const next = height + gapBefore + panel.drawH;
		const padded = next + (index === panels.length - 1 ? 0 : safeGap);
		if (current.length > 0 && !fits(padded)) {
			parts.push({
				height,
				panels: current
			});
			current = [panel];
			height = panel.drawH;
		} else {
			current = [...current, panel];
			height = next;
		}
	}
	if (current.length > 0) parts.push({
		height,
		panels: current
	});
	for (let index = 0; index < parts.length - 1; index += 1) {
		const part = parts[index];
		if (!part) continue;
		parts[index] = {
			...part,
			height: part.height + safeGap
		};
	}
	const totalHeight = parts.reduce((sum, part) => sum + part.height, 0);
	return {
		width,
		totalHeight,
		parts
	};
}
var PAGE_WIDTHS = [
	640,
	800,
	1080
];
var SEAMS = [
	{
		value: 0,
		label: "Flush"
	},
	{
		value: 8,
		label: "Tight"
	},
	{
		value: 24,
		label: "Air"
	}
];
var PAPER = "#f3efe6";
var EXTENSIONS = [
	"jpg",
	"jpeg",
	"jpe",
	"jfif",
	"pjpeg",
	"pjp",
	"png",
	"gif",
	"webp",
	"avif",
	"apng",
	"bmp",
	"dib",
	"tif",
	"tiff",
	"heic",
	"heif",
	"svg",
	"ico"
];
var IMAGE_ACCEPT = ["image/*", ...EXTENSIONS.map((ext) => `.${ext}`)].join(",");
var FORMAT_HINT = "JPG, JPEG, PNG, WEBP, GIF, AVIF, BMP, TIFF, HEIC, HEIF, and SVG";
function isImageFile(file) {
	if (file.type.startsWith("image/")) return true;
	const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
	return EXTENSIONS.includes(ext);
}
function deviceLimits() {
	if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) return {
		maxSide: 8192,
		maxArea: 16e6
	};
	return {
		maxSide: 16384,
		maxArea: 32e6
	};
}
async function decodeBlob(blob) {
	if (typeof createImageBitmap === "function") try {
		const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
		if (bitmap.width > 0 && bitmap.height > 0) return {
			width: bitmap.width,
			height: bitmap.height,
			source: bitmap,
			close: () => bitmap.close()
		};
		bitmap.close();
	} catch {}
	const url = URL.createObjectURL(blob);
	try {
		const img = await new Promise((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(/* @__PURE__ */ new Error("decode"));
			el.src = url;
		});
		if (!img.naturalWidth || !img.naturalHeight) throw new Error("decode");
		return {
			width: img.naturalWidth,
			height: img.naturalHeight,
			source: img,
			close: () => URL.revokeObjectURL(url)
		};
	} catch (error) {
		URL.revokeObjectURL(url);
		throw error;
	}
}
async function makeThumb(source, width, height) {
	const thumbWidth = 240;
	const fullHeight = Math.max(1, Math.round(height * (thumbWidth / Math.max(1, width))));
	const canvas = document.createElement("canvas");
	canvas.width = thumbWidth;
	canvas.height = Math.min(fullHeight, 360);
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Could not prepare a preview.");
	ctx.fillStyle = PAPER;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(source, 0, 0, thumbWidth, fullHeight);
	const blob = await canvasToBlob(canvas, "image/jpeg", .82);
	canvas.width = 0;
	canvas.height = 0;
	return blob;
}
async function stitchChapter(frames, options, onProgress) {
	const plan = planStrip(frames.map((frame) => ({
		id: frame.id,
		sw: frame.sw,
		sh: frame.sh
	})), options.width, options.gap, deviceLimits());
	const byId = new Map(frames.map((frame) => [frame.id, frame]));
	const parts = [];
	const total = plan.parts.reduce((sum, part) => sum + part.panels.length, 0);
	let done = 0;
	for (let index = 0; index < plan.parts.length; index += 1) {
		const part = plan.parts[index];
		if (!part) continue;
		const decoded = [];
		try {
			for (const panel of part.panels) {
				const frame = byId.get(panel.id);
				if (!frame) throw new Error("A panel disappeared while stitching.");
				onProgress?.(done, total, `Reading ${done + 1} of ${total}`);
				const image = await decodeBlob(frame.blob);
				decoded.push({
					panel,
					image
				});
				done += 1;
				await yieldToPaint();
			}
			onProgress?.(done, total, plan.parts.length > 1 ? `Drawing part ${index + 1}` : "Drawing the page");
			const blob = await renderPart({
				width: plan.width,
				part,
				images: decoded,
				gap: options.gap,
				isLastPart: index === plan.parts.length - 1,
				format: options.format
			});
			parts.push({
				blob,
				height: part.height
			});
		} finally {
			for (const item of decoded) item.image.close();
		}
	}
	return {
		width: plan.width,
		totalHeight: plan.totalHeight,
		parts
	};
}
async function renderPart(input) {
	const canvas = document.createElement("canvas");
	canvas.width = input.width;
	canvas.height = Math.max(1, input.part.height);
	const ctx = canvas.getContext("2d", { alpha: false });
	if (!ctx) throw new Error("Could not draw the page.");
	ctx.fillStyle = PAPER;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	const gap = Math.max(0, Math.round(input.gap));
	let y = 0;
	input.part.panels.forEach((panel, index) => {
		const image = input.images.find((item) => item.panel.id === panel.id)?.image;
		if (!image) throw new Error("A panel could not be drawn.");
		ctx.drawImage(image.source, panel.x, y, panel.drawW, panel.drawH);
		y += panel.drawH;
		if (!(index === input.part.panels.length - 1 && input.isLastPart)) y += gap;
	});
	const blob = await canvasToBlob(canvas, input.format, input.format === "image/jpeg" ? .92 : void 0);
	canvas.width = 0;
	canvas.height = 0;
	return blob;
}
function canvasToBlob(canvas, type, quality) {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(/* @__PURE__ */ new Error("The stitched page was too large to export on this device."));
		}, type, quality);
	});
}
function yieldToPaint() {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}
var urls = /* @__PURE__ */ new Map();
function blobUrl(id, blob) {
	const existing = urls.get(id);
	if (existing) return existing;
	const url = URL.createObjectURL(blob);
	urls.set(id, url);
	return url;
}
function revokeBlobUrl(id) {
	const url = urls.get(id);
	if (!url) return;
	URL.revokeObjectURL(url);
	urls.delete(id);
}
var hydratePromise = null;
function chapterPanels(panels, chapterId) {
	return panels.filter((panel) => panel.chapterId === chapterId).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}
function selectedIds(state, chapterId) {
	const ids = chapterPanels(state.panels, chapterId).map((panel) => panel.id);
	const explicit = state.selected[chapterId];
	if (!explicit) return ids;
	const known = new Set(ids);
	return explicit.filter((id) => known.has(id));
}
function stripFreshness(chapter, panels) {
	if (!chapter.strip) return "empty";
	const ordered = chapterPanels(panels, chapter.id).filter((panel) => chapter.strip?.panelIds.includes(panel.id)).map((panel) => panel.id);
	const samePanels = ordered.length === chapter.strip.panelIds.length && ordered.every((id, index) => id === chapter.strip?.panelIds[index]);
	const sameSettings = chapter.width === chapter.strip.widthSetting && chapter.seam === chapter.strip.seam && chapter.format === chapter.strip.format;
	return samePanels && sameSettings ? "current" : "stale";
}
function nextChapterTitle(chapters) {
	const numbers = chapters.map((chapter) => {
		const match = /^Chapter (\d+)$/.exec(chapter.title);
		return match ? Number(match[1]) : 0;
	});
	return `Chapter ${Math.max(0, ...numbers, 0) + 1}`;
}
function withTimestamps(projects, chapters, projectId, chapterId) {
	const now = Date.now();
	return {
		now,
		projects: projects.map((project) => project.id === projectId ? {
			...project,
			updatedAt: now
		} : project),
		chapters: chapters.map((chapter) => chapter.id === chapterId ? {
			...chapter,
			updatedAt: now
		} : chapter)
	};
}
var useStudio = create((set, get) => ({
	ready: false,
	projects: [],
	chapters: [],
	panels: [],
	thumbs: {},
	stripUrls: {},
	selected: {},
	job: null,
	banner: null,
	hydrate: () => {
		if (get().ready) return Promise.resolve();
		if (!hydratePromise) hydratePromise = (async () => {
			try {
				set({
					...await loadLibrary(),
					ready: true
				});
			} catch (error) {
				set({
					ready: true,
					banner: storageMessage(error)
				});
			}
		})();
		return hydratePromise;
	},
	dismissBanner: () => set({ banner: null }),
	createProject: async (title) => {
		const now = Date.now();
		const project = {
			id: uid(),
			title: cleanTitle(title, "Untitled project"),
			createdAt: now,
			updatedAt: now
		};
		const chapter = {
			id: uid(),
			projectId: project.id,
			title: "Chapter 1",
			createdAt: now,
			updatedAt: now,
			width: 800,
			seam: 0,
			format: "image/jpeg",
			strip: null
		};
		await putRecords({
			projects: [project],
			chapters: [chapter]
		});
		set((state) => ({
			projects: [project, ...state.projects],
			chapters: [...state.chapters, chapter]
		}));
		return {
			projectId: project.id,
			chapterId: chapter.id
		};
	},
	renameProject: async (id, title) => {
		const project = get().projects.find((item) => item.id === id);
		if (!project) return;
		const next = {
			...project,
			title: cleanTitle(title, project.title),
			updatedAt: Date.now()
		};
		await putRecords({ projects: [next] });
		set((state) => ({ projects: state.projects.map((item) => item.id === id ? next : item) }));
	},
	deleteProject: async (id) => {
		const chapters = get().chapters.filter((chapter) => chapter.projectId === id);
		const chapterIds = new Set(chapters.map((chapter) => chapter.id));
		const panels = get().panels.filter((panel) => chapterIds.has(panel.chapterId));
		const blobs = [...panels.flatMap((panel) => [panel.blobId, panel.thumbId]), ...chapters.flatMap((chapter) => chapter.strip?.parts.map((part) => part.blobId) ?? [])];
		blobs.forEach(revokeBlobUrl);
		await removeRecords({
			projects: [id],
			chapters: chapters.map((chapter) => chapter.id),
			panels: panels.map((panel) => panel.id),
			blobs
		});
		set((state) => ({
			projects: state.projects.filter((project) => project.id !== id),
			chapters: state.chapters.filter((chapter) => chapter.projectId !== id),
			panels: state.panels.filter((panel) => !chapterIds.has(panel.chapterId))
		}));
	},
	createChapter: async (projectId) => {
		const project = get().projects.find((item) => item.id === projectId);
		if (!project) throw new Error("That project is gone.");
		const now = Date.now();
		const siblings = get().chapters.filter((chapter) => chapter.projectId === projectId);
		const chapter = {
			id: uid(),
			projectId,
			title: nextChapterTitle(siblings),
			createdAt: now,
			updatedAt: now,
			width: 800,
			seam: 0,
			format: "image/jpeg",
			strip: null
		};
		const nextProject = {
			...project,
			updatedAt: now
		};
		await putRecords({
			projects: [nextProject],
			chapters: [chapter]
		});
		set((state) => ({
			projects: state.projects.map((item) => item.id === projectId ? nextProject : item),
			chapters: [...state.chapters, chapter]
		}));
		return chapter.id;
	},
	renameChapter: async (id, title) => {
		const chapter = get().chapters.find((item) => item.id === id);
		if (!chapter) return;
		const next = {
			...chapter,
			title: cleanTitle(title, chapter.title),
			updatedAt: Date.now()
		};
		const project = get().projects.find((item) => item.id === chapter.projectId);
		const nextProject = project ? {
			...project,
			updatedAt: next.updatedAt
		} : null;
		await putRecords({
			chapters: [next],
			projects: nextProject ? [nextProject] : []
		});
		set((state) => ({
			chapters: state.chapters.map((item) => item.id === id ? next : item),
			projects: nextProject ? state.projects.map((item) => item.id === nextProject.id ? nextProject : item) : state.projects
		}));
	},
	deleteChapter: async (id) => {
		const chapter = get().chapters.find((item) => item.id === id);
		if (!chapter) return;
		const panels = get().panels.filter((panel) => panel.chapterId === id);
		const blobs = [...panels.flatMap((panel) => [panel.blobId, panel.thumbId]), ...chapter.strip?.parts.map((part) => part.blobId) ?? []];
		blobs.forEach(revokeBlobUrl);
		await removeRecords({
			chapters: [id],
			panels: panels.map((panel) => panel.id),
			blobs
		});
		const touched = withTimestamps(get().projects, get().chapters, chapter.projectId);
		const project = touched.projects.find((item) => item.id === chapter.projectId);
		if (project) await putRecords({ projects: [project] });
		set((state) => ({
			projects: touched.projects,
			chapters: state.chapters.filter((item) => item.id !== id),
			panels: state.panels.filter((panel) => panel.chapterId !== id),
			selected: {
				...state.selected,
				[id]: void 0
			}
		}));
	},
	setChapterOptions: async (id, patch) => {
		const chapter = get().chapters.find((item) => item.id === id);
		if (!chapter) return;
		const next = {
			...chapter,
			...patch,
			updatedAt: Date.now()
		};
		await putRecords({ chapters: [next] });
		set((state) => ({ chapters: state.chapters.map((item) => item.id === id ? next : item) }));
	},
	addImages: async (chapterId, files) => {
		if (get().job) {
			set({ banner: "Wait for the current stitch to finish." });
			return;
		}
		const chapter = get().chapters.find((item) => item.id === chapterId);
		if (!chapter) return;
		const images = files.filter(isImageFile);
		const rejected = files.length - images.length;
		if (images.length === 0) {
			set({ banner: rejected > 0 ? "Those files are not images. Choose JPG, PNG, WEBP, or another photo format." : "Choose one or more photos." });
			return;
		}
		set({
			job: {
				chapterId,
				done: 0,
				total: images.length,
				label: "Adding photos"
			},
			banner: null
		});
		const failed = [];
		const made = [];
		let order = chapterPanels(get().panels, chapterId).reduce((max, panel) => Math.max(max, panel.order), -1) + 1;
		try {
			for (let index = 0; index < images.length; index += 1) {
				const file = images[index];
				if (!file) continue;
				set({ job: {
					chapterId,
					done: index,
					total: images.length,
					label: `Adding ${index + 1} of ${images.length}`
				} });
				try {
					const decoded = await decodeBlob(file);
					try {
						const thumb = await makeThumb(decoded.source, decoded.width, decoded.height);
						const blobId = uid();
						const thumbId = uid();
						await putBlobs([{
							id: blobId,
							blob: file
						}, {
							id: thumbId,
							blob: thumb
						}]);
						made.push({
							id: uid(),
							chapterId,
							name: file.name || "Panel",
							mime: file.type || "application/octet-stream",
							width: decoded.width,
							height: decoded.height,
							blobId,
							thumbId,
							order,
							createdAt: Date.now()
						});
						order += 1;
					} finally {
						decoded.close();
					}
				} catch {
					failed.push(file.name || "a photo");
				}
			}
			if (made.length > 0) {
				const touched = withTimestamps(get().projects, get().chapters, chapter.projectId, chapterId);
				const nextChapter = touched.chapters.find((item) => item.id === chapterId);
				const nextProject = touched.projects.find((item) => item.id === chapter.projectId);
				await putRecords({
					panels: made,
					chapters: nextChapter ? [nextChapter] : [],
					projects: nextProject ? [nextProject] : []
				});
				const thumbs = { ...get().thumbs };
				for (const panel of made) {
					const thumb = await getBlob(panel.thumbId);
					if (thumb) thumbs[panel.id] = blobUrl(panel.thumbId, thumb);
				}
				set((state) => {
					const explicit = state.selected[chapterId];
					const selected = explicit ? [...explicit, ...made.map((panel) => panel.id)] : void 0;
					return {
						panels: [...state.panels, ...made],
						chapters: nextChapter ? state.chapters.map((item) => item.id === chapterId ? nextChapter : item) : state.chapters,
						projects: nextProject ? state.projects.map((item) => item.id === nextProject.id ? nextProject : item) : state.projects,
						thumbs,
						selected: {
							...state.selected,
							[chapterId]: selected
						}
					};
				});
			}
			const notes = [];
			if (made.length > 0) notes.push(`Added ${made.length} ${made.length === 1 ? "photo" : "photos"}.`);
			if (failed.length > 0) notes.push(`Could not read ${failed.slice(0, 3).join(", ")}. Export HEIC or unusual files as JPG or PNG.`);
			if (rejected > 0) notes.push("Skipped files that were not images.");
			set({ banner: notes.join(" ") || null });
		} catch (error) {
			set({ banner: storageMessage(error) });
		} finally {
			set({ job: null });
		}
	},
	removePanel: async (id) => {
		const panel = get().panels.filter((item) => item.id === id)[0];
		if (!panel) return;
		revokeBlobUrl(panel.blobId);
		revokeBlobUrl(panel.thumbId);
		await removeRecords({
			panels: [panel.id],
			blobs: [panel.blobId, panel.thumbId]
		});
		const remaining = chapterPanels(get().panels.filter((item) => item.id !== id), panel.chapterId).map((item, index) => ({
			...item,
			order: index
		}));
		const chapter = get().chapters.find((item) => item.id === panel.chapterId);
		const touched = chapter ? withTimestamps(get().projects, get().chapters, chapter.projectId, chapter.id) : null;
		const nextChapter = touched?.chapters.find((item) => item.id === panel.chapterId);
		const nextProject = chapter ? touched?.projects.find((item) => item.id === chapter.projectId) : void 0;
		await putRecords({
			panels: remaining,
			chapters: nextChapter ? [nextChapter] : [],
			projects: nextProject ? [nextProject] : []
		});
		set((state) => {
			const panels = state.panels.filter((item) => item.id !== id).map((item) => remaining.find((next) => next.id === item.id) ?? item);
			const thumbs = { ...state.thumbs };
			delete thumbs[id];
			const explicit = state.selected[panel.chapterId];
			return {
				panels,
				thumbs,
				chapters: nextChapter ? state.chapters.map((item) => item.id === panel.chapterId ? nextChapter : item) : state.chapters,
				projects: nextProject ? state.projects.map((item) => item.id === nextProject.id ? nextProject : item) : state.projects,
				selected: {
					...state.selected,
					[panel.chapterId]: explicit?.filter((panelId) => panelId !== id)
				}
			};
		});
	},
	movePanel: async (id, direction) => {
		const panel = get().panels.find((item) => item.id === id);
		if (!panel) return;
		const list = chapterPanels(get().panels, panel.chapterId);
		const index = list.findIndex((item) => item.id === id);
		const target = index + direction;
		if (index < 0 || target < 0 || target >= list.length) return;
		const [item] = list.splice(index, 1);
		if (!item) return;
		list.splice(target, 0, item);
		await commitOrder(panel.chapterId, list, set, get);
	},
	placePanel: async (chapterId, fromId, toId) => {
		if (fromId === toId) return;
		const list = chapterPanels(get().panels, chapterId);
		const from = list.findIndex((item) => item.id === fromId);
		const to = list.findIndex((item) => item.id === toId);
		if (from < 0 || to < 0) return;
		const [item] = list.splice(from, 1);
		if (!item) return;
		list.splice(to, 0, item);
		await commitOrder(chapterId, list, set, get);
	},
	toggleSelected: (chapterId, panelId) => {
		const current = selectedIds(get(), chapterId);
		const next = current.includes(panelId) ? current.filter((id) => id !== panelId) : [...current, panelId];
		set((state) => ({ selected: {
			...state.selected,
			[chapterId]: next
		} }));
	},
	selectAll: (chapterId) => {
		set((state) => ({ selected: {
			...state.selected,
			[chapterId]: void 0
		} }));
	},
	selectNone: (chapterId) => {
		set((state) => ({ selected: {
			...state.selected,
			[chapterId]: []
		} }));
	},
	display: async (chapterId, mode) => {
		if (get().job) {
			set({ banner: "Wait for the current stitch to finish." });
			return false;
		}
		const chapter = get().chapters.find((item) => item.id === chapterId);
		if (!chapter) return false;
		const panels = chapterPanels(get().panels, chapterId);
		const checked = new Set(selectedIds(get(), chapterId));
		const idSet = mode === "append" && chapter.strip ? /* @__PURE__ */ new Set([...chapter.strip.panelIds, ...checked]) : checked;
		const chosen = panels.filter((panel) => idSet.has(panel.id));
		if (mode === "replace" && chosen.length < 2) {
			set({ banner: "Check at least two photos, then press Display." });
			return false;
		}
		if (chosen.length < 2) {
			set({ banner: "Add another photo before stitching." });
			return false;
		}
		set({
			job: {
				chapterId,
				done: 0,
				total: chosen.length,
				label: "Preparing the page"
			},
			banner: null
		});
		try {
			const frames = [];
			for (const panel of chosen) {
				const blob = await getBlob(panel.blobId);
				if (!blob) throw new Error(`Missing photo: ${panel.name}`);
				frames.push({
					id: panel.id,
					sw: panel.width,
					sh: panel.height,
					blob
				});
			}
			const result = await stitchChapter(frames, {
				width: chapter.width,
				gap: chapter.seam,
				format: chapter.format
			}, (done, total, label) => set({ job: {
				chapterId,
				done,
				total,
				label
			} }));
			const partRecords = result.parts.map((part) => ({
				blobId: uid(),
				height: part.height,
				blob: part.blob
			}));
			await putBlobs(partRecords.map((part) => ({
				id: part.blobId,
				blob: part.blob
			})));
			const strip = {
				width: result.width,
				totalHeight: result.totalHeight,
				parts: partRecords.map((part) => ({
					blobId: part.blobId,
					height: part.height
				})),
				panelIds: chosen.map((panel) => panel.id),
				widthSetting: chapter.width,
				seam: chapter.seam,
				format: chapter.format,
				createdAt: Date.now()
			};
			const oldParts = chapter.strip?.parts ?? [];
			oldParts.forEach((part) => revokeBlobUrl(part.blobId));
			if (oldParts.length > 0) await removeRecords({ blobs: oldParts.map((part) => part.blobId) });
			const touched = withTimestamps(get().projects, get().chapters, chapter.projectId, chapterId);
			const nextChapter = touched.chapters.find((item) => item.id === chapterId);
			if (!nextChapter) return false;
			const saved = {
				...nextChapter,
				strip
			};
			const nextProject = touched.projects.find((item) => item.id === chapter.projectId);
			await putRecords({
				chapters: [saved],
				projects: nextProject ? [nextProject] : []
			});
			const urlsForStrip = partRecords.map((part) => blobUrl(part.blobId, part.blob));
			const widthNote = result.width === chapter.width ? "" : ` Drawn at ${result.width}px wide so the full height fits this device.`;
			const partNote = result.parts.length > 1 ? ` Saved as ${result.parts.length} continuous parts.` : "";
			set((state) => ({
				chapters: state.chapters.map((item) => item.id === chapterId ? saved : item),
				projects: nextProject ? state.projects.map((item) => item.id === nextProject.id ? nextProject : item) : state.projects,
				stripUrls: {
					...state.stripUrls,
					[chapterId]: urlsForStrip
				},
				banner: `Stitched ${chosen.length} photos.${partNote}${widthNote}`
			}));
			return true;
		} catch (error) {
			set({ banner: storageMessage(error) });
			return false;
		} finally {
			set({ job: null });
		}
	},
	clearStrip: async (chapterId) => {
		const chapter = get().chapters.find((item) => item.id === chapterId);
		if (!chapter?.strip) return;
		chapter.strip.parts.forEach((part) => revokeBlobUrl(part.blobId));
		await removeRecords({ blobs: chapter.strip.parts.map((part) => part.blobId) });
		const next = {
			...chapter,
			strip: null,
			updatedAt: Date.now()
		};
		await putRecords({ chapters: [next] });
		set((state) => ({
			chapters: state.chapters.map((item) => item.id === chapterId ? next : item),
			stripUrls: {
				...state.stripUrls,
				[chapterId]: []
			}
		}));
	},
	loadMedia: async (chapterId) => {
		const panels = chapterPanels(get().panels, chapterId);
		const thumbs = { ...get().thumbs };
		for (const panel of panels) {
			if (thumbs[panel.id]) continue;
			const blob = await getBlob(panel.thumbId);
			if (blob) thumbs[panel.id] = blobUrl(panel.thumbId, blob);
		}
		const chapter = get().chapters.find((item) => item.id === chapterId);
		const stripUrls = [];
		if (chapter?.strip) for (const part of chapter.strip.parts) {
			const blob = await getBlob(part.blobId);
			if (blob) stripUrls.push(blobUrl(part.blobId, blob));
		}
		set((state) => ({
			thumbs,
			stripUrls: {
				...state.stripUrls,
				[chapterId]: stripUrls
			}
		}));
	}
}));
async function commitOrder(chapterId, list, set, get) {
	const ordered = list.map((panel, index) => ({
		...panel,
		order: index
	}));
	const chapter = get().chapters.find((item) => item.id === chapterId);
	const touched = chapter ? withTimestamps(get().projects, get().chapters, chapter.projectId, chapterId) : null;
	const nextChapter = touched?.chapters.find((item) => item.id === chapterId);
	const nextProject = chapter ? touched?.projects.find((item) => item.id === chapter.projectId) : void 0;
	await putRecords({
		panels: ordered,
		chapters: nextChapter ? [nextChapter] : [],
		projects: nextProject ? [nextProject] : []
	});
	const byId = new Map(ordered.map((panel) => [panel.id, panel]));
	set((state) => ({
		panels: state.panels.map((panel) => byId.get(panel.id) ?? panel),
		chapters: nextChapter ? state.chapters.map((item) => item.id === chapterId ? nextChapter : item) : state.chapters,
		projects: nextProject ? state.projects.map((item) => item.id === nextProject.id ? nextProject : item) : state.projects
	}));
}
function extensionFor(format) {
	return format === "image/png" ? "png" : "jpg";
}
//#endregion
export { PAGE_WIDTHS as a, cn as c, formatDay as d, selectedIds as f, useStudio as h, Modal as i, countLabel as l, stripFreshness as m, FORMAT_HINT as n, SEAMS as o, slugify as p, IMAGE_ACCEPT as r, buttonClass as s, Button as t, extensionFor as u };
