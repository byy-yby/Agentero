/**
 * Compile state and actions for .tex files in the file tree.
 * Manages engine detection, busy state, and compilation lifecycle.
 */

import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	flushTextEditor,
	getTextEditorPending,
} from "@/components/viewer/text-editor-pending";
import { commands } from "@/lib/core/bindings";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import { openTexPdfBesideSource } from "@/lib/workspace/actions";

export type LatexEngine = {
	id: string;
	label: string;
	path: string | null;
};

export type TexCompileActions = {
	engines: LatexEngine[];
	enginesLoading: boolean;
	selectedEngine: string | null;
	selectEngine: (id: string) => void;
	compileTex: (texPath: string, vaultPath: string) => Promise<void>;
	compilingPath: string | null;
	isTexFile: (path: string) => boolean;
};

export function useTexCompile(): TexCompileActions {
	const [engines, setEngines] = useState<LatexEngine[]>([]);
	const [enginesLoading, setEnginesLoading] = useState(false);
	const [selectedEngine, setSelectedEngine] = useState<string | null>(null);
	const [compilingPath, setCompilingPath] = useState<string | null>(null);
	const unlistenRef = useRef<(() => void) | null>(null);
	// Once the user explicitly picks an engine, never overwrite their choice
	// on subsequent engine-list refreshes (mount, vault switch, etc.).
	const userPickedRef = useRef(false);

	// Load engines on mount.
	useEffect(() => {
		setEnginesLoading(true);
		commands
			.detectLatexEngines()
			.then((res) => {
				if (res.ok && res.data) {
					setEngines(res.data);
					// First-time default: only seed if the user has not picked yet.
					if (res.data.length > 0 && !userPickedRef.current) {
						setSelectedEngine(res.data[0].id);
					}
				}
			})
			.catch(() => {
				// Silently ignore — button won't show if no engines found.
			})
			.finally(() => setEnginesLoading(false));

		listen<{ line: string }>("compile:log", () => {
			// Drain log events; log UI can be added later.
		}).then((unlisten) => {
			unlistenRef.current = unlisten;
		});

		return () => {
			unlistenRef.current?.();
		};
	}, []);

	const selectEngine = useCallback((id: string) => {
		userPickedRef.current = true;
		setSelectedEngine(id);
	}, []);

	const compileTex = useCallback(
		async (texPath: string, _vaultPath: string) => {
			const engine = selectedEngine;
			if (!engine) {
				notifyError("请先选择一个 LaTeX 引擎");
				return;
			}

			setCompilingPath(texPath);

			try {
				// Flush any pending edits in the open CodeMirror .tex editor before
				// reading the file from disk. The editor's own autosave debounces
				// by ~800ms, so a click within that window would otherwise compile
				// the previous on-disk version and the PDF would not reflect the
				// current edits. We delegate to the editor's own flush handler so
				// `lastSavedRef` and the disk-conflict guard stay consistent — a
				// bypass would leave the baseline stale and trip a false conflict
				// on the next autosave.
				if (getTextEditorPending(texPath) !== null) {
					const flushed = await flushTextEditor(texPath);
					if (!flushed) {
						notifyError("保存 .tex 文件失败，未编译");
						return;
					}
				}

				const res = await commands.compileTex(texPath, engine);

				// ApiResult wraps errors as .error (not .ok === false).
				if (res.error) {
					notifyError(res.error?.message ?? "编译失败");
					return;
				}

				const result = res.data;
				if (result?.pdfPath) {
					// Always open the PDF when one was produced — LaTeX engines
					// frequently emit a partial PDF even on engine errors.
					openTexPdfBesideSource(texPath, result.pdfPath);
					if (result.engineError) {
						notifyError("编译有警告，已生成 PDF，请查看日志");
					} else {
						notifySuccess("编译成功");
					}
				} else {
					notifyError("编译失败，未生成 PDF");
				}
			} catch (e) {
				notifyError(String(e));
			} finally {
				setCompilingPath(null);
			}
		},
		[selectedEngine],
	);

	/**
	 * True when `path` is a .tex file NOT under a papers/ folder.
	 */
	const isTexFile = useCallback((path: string): boolean => {
		if (!/\.tex$/i.test(path)) return false;
		const rel = path.replace(/^.*[/\\]papers[/\\]/, "papers/");
		return !rel.startsWith("papers/");
	}, []);

	return {
		engines,
		enginesLoading,
		selectedEngine,
		selectEngine,
		compileTex,
		compilingPath,
		isTexFile,
	};
}
