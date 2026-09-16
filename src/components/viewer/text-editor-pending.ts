/**
 * Cross-component registry: `TextEditor` publishes its pending (unsaved) content
 * and its flush handler here on mount, so other subsystems can force a flush
 * before reading the file from disk.
 *
 * The editor's own debounced autosave (`AUTOSAVE_DELAY_MS = 800ms`) would
 * otherwise leave the disk stale for nearly a second after the user stops
 * typing, which silently breaks downstream readers — most visibly the LaTeX
 * compile flow, which would otherwise rebuild the PDF from the previous
 * on-disk version of the .tex file.
 *
 * We expose the editor's own `flush` so callers go through the same code path
 * the autosave timer uses. That keeps `lastSavedRef` and the disk-conflict
 * guard consistent: a flush from outside must not leave the editor's baseline
 * stale, otherwise the next autosave would falsely flag a conflict.
 */

type PendingEntry = {
	content: string;
};

const pendingByPath = new Map<string, PendingEntry>();
/** Per-path flush handler that writes pending content + updates lastSaved. */
const flushByPath = new Map<string, () => Promise<void>>();

/** Normalize the path so registry hits work across `\` and `/` separators. */
function normalize(path: string): string {
	return path.replace(/\\/g, "/");
}

export function setTextEditorPending(path: string, content: string): void {
	pendingByPath.set(normalize(path), { content });
}

export function clearTextEditorPending(path: string): void {
	pendingByPath.delete(normalize(path));
}

export function getTextEditorPending(path: string): string | null {
	return pendingByPath.get(normalize(path))?.content ?? null;
}

/** Register the editor's flush so outside callers (e.g. LaTeX compile) can
 * trigger a synchronous-equivalent write without bypassing lastSaved tracking. */
export function setTextEditorFlushHandler(
	path: string,
	flush: () => Promise<void>,
): void {
	flushByPath.set(normalize(path), flush);
}

export function clearTextEditorFlushHandler(path: string): void {
	flushByPath.delete(normalize(path));
}

/** Run the editor's flush for `path`. Resolves true when a handler ran. */
export async function flushTextEditor(path: string): Promise<boolean> {
	const handler = flushByPath.get(normalize(path));
	if (!handler) return false;
	await handler();
	return true;
}
