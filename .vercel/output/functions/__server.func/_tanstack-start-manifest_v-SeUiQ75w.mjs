//#region node_modules/.nitro/vite/services/ssr/assets/_tanstack-start-manifest_v-SeUiQ75w.js
var tsrStartManifest = () => ({ routes: {
	__root__: {
		filePath: "/workspace/src/routes/__root.tsx",
		children: [
			"/",
			"/p/$projectId/",
			"/p/$projectId/c/$chapterId"
		],
		preloads: [
			"/assets/index-BqpUlPbf.js",
			"/assets/rolldown-runtime-CbXtAM7H.js",
			"/assets/store-BQH6hlmI.js",
			"/assets/preload-helper-dnXYZVIA.js"
		],
		scripts: [{ attrs: {
			type: "module",
			async: !0,
			src: "/assets/index-BqpUlPbf.js"
		} }]
	},
	"/": {
		filePath: "/workspace/src/routes/index.tsx",
		children: void 0,
		preloads: ["/assets/routes-CcAuMtX0.js", "/assets/plus-Dzoq7lo1.js"]
	},
	"/p/$projectId/": {
		filePath: "/workspace/src/routes/p/$projectId/index.tsx",
		children: void 0,
		preloads: [
			"/assets/_projectId-BlXme5IG.js",
			"/assets/trash-2-DLna4wIx.js",
			"/assets/plus-Dzoq7lo1.js"
		]
	},
	"/p/$projectId/c/$chapterId": {
		filePath: "/workspace/src/routes/p/$projectId/c/$chapterId.tsx",
		children: void 0,
		preloads: ["/assets/_chapterId-CSzYMU-A.js", "/assets/trash-2-DLna4wIx.js"]
	}
} });
//#endregion
export { tsrStartManifest };
