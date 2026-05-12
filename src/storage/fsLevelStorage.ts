import { normalizeLevelConfig, parseLevelIdFromFileName, levelFileNameForId } from "../domain/levelTypes";
import type { LevelConfigData } from "../domain/levelTypes";

export interface LoadedLevelFile {
  fileName: string;
  /** Undefined until first save for newly created in-memory levels */
  fileHandle?: FileSystemFileHandle;
  data: LevelConfigData;
  /** 上次「已对齐磁盘/导入」的 JSON，用于判断是否与当前编辑内容一致 */
  baselineJson: string;
}

const LEVEL_GLOB = /^level_\d+\.json$/i;

export function serializeLevelJson(data: LevelConfigData): string {
  return JSON.stringify(data, null, 2);
}

export function isLevelDirty(row: LoadedLevelFile): boolean {
  return serializeLevelJson(row.data) !== row.baselineJson;
}

export async function readTextFile(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

export async function writeTextFile(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(new Blob([text], { type: "application/json" }));
  await writable.close();
}

export async function loadLevelsFromDirectory(dir: FileSystemDirectoryHandle): Promise<LoadedLevelFile[]> {
  const out: LoadedLevelFile[] = [];
  const iter = (
    dir as unknown as {
      entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
    }
  ).entries();
  for await (const [name, handle] of iter) {
    if (handle.kind !== "file" || !LEVEL_GLOB.test(name)) {
      continue;
    }
    const fh = handle as FileSystemFileHandle;
    const text = await readTextFile(fh);
    let data: LevelConfigData | null = null;
    try {
      data = normalizeLevelConfig(JSON.parse(text));
    } catch {
      data = null;
    }
    if (!data) {
      continue;
    }
    out.push({ fileName: name, fileHandle: fh, data, baselineJson: serializeLevelJson(data) });
  }
  out.sort((a, b) => parseLevelIdFromFileName(a.fileName) - parseLevelIdFromFileName(b.fileName));
  return out;
}

export async function getFileHandleByName(
  dir: FileSystemDirectoryHandle,
  name: string,
  options?: FileSystemGetFileOptions,
): Promise<FileSystemFileHandle> {
  return dir.getFileHandle(name, options);
}

export async function removeFile(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  await dir.removeEntry(name);
}

export function nextLevelIdFromFiles(files: LoadedLevelFile[]): number {
  if (files.length === 0) {
    return 1;
  }
  return Math.max(...files.map((f) => parseLevelIdFromFileName(f.fileName))) + 1;
}

async function fileExistsInDirectory(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** Save level to disk; handles Id rename (delete old + create new). Returns new fileName. */
export async function persistLevel(
  dir: FileSystemDirectoryHandle,
  entry: LoadedLevelFile,
  previousFileName: string,
): Promise<{ fileName: string; fileHandle: FileSystemFileHandle }> {
  const targetName = levelFileNameForId(entry.data.Id);
  const json = serializeLevelJson(entry.data);

  if (previousFileName === targetName && entry.fileHandle) {
    await writeTextFile(entry.fileHandle, json);
    return { fileName: targetName, fileHandle: entry.fileHandle };
  }

  if (previousFileName !== targetName && (await fileExistsInDirectory(dir, targetName))) {
    throw new Error(`目标文件已存在：${targetName}`);
  }

  const newHandle = await getFileHandleByName(dir, targetName, { create: true });
  await writeTextFile(newHandle, json);

  if (previousFileName && previousFileName !== targetName) {
    try {
      await removeFile(dir, previousFileName);
    } catch {
      /* ignore */
    }
  }

  return { fileName: targetName, fileHandle: newHandle };
}
