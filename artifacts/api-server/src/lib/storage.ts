import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Request } from "express";
import yauzl from "yauzl";
import { XMLParser } from "fast-xml-parser";

// uploads/            public: editor images and course images (random names)
// uploads/private/    file resources, served only to students with access
// uploads/packages/   unpacked IMS content packages / SCORM, served only to students with access
export const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads");
export const privateDir = path.join(uploadDir, "private");
export const packagesDir = path.join(uploadDir, "packages");
for (const dir of [uploadDir, privateDir, packagesDir]) mkdirSync(dir, { recursive: true });

export class UploadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const newKey = () => randomBytes(16).toString("hex");

/** Streams the raw request body to disk without holding it in memory. Returns the byte count. */
export async function saveRequestBody(req: Request, dest: string, maxBytes: number): Promise<number> {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > maxBytes) throw new UploadError(413, `That file is over ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length;
      if (bytes > maxBytes) done(new UploadError(413, `That file is over ${Math.round(maxBytes / 1024 / 1024)} MB.`));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(req, limit, createWriteStream(dest));
  } catch (e) {
    await rm(dest, { force: true });
    throw e;
  }
  if (bytes === 0) {
    await rm(dest, { force: true });
    throw new UploadError(400, "The file was empty.");
  }
  return bytes;
}

/** Resolves a path inside `root`, or null if it would escape it. */
export function safeJoin(root: string, relative: string): string | null {
  const target = path.resolve(root, relative);
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

const MAX_ENTRIES = 10_000;
const MAX_UNPACKED = 1024 * 1024 * 1024;

/** Unpacks a zip into `dest`, refusing paths that escape it and archives that expand too far. */
export async function extractZip(zipPath: string, dest: string) {
  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.openPromise(zipPath, { lazyEntries: true, strictFileNames: false, validateEntrySizes: true });
  } catch {
    throw new UploadError(400, "That isn't a valid .zip file.");
  }
  let count = 0;
  let total = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      if (++count > MAX_ENTRIES) throw new UploadError(400, "The package has too many files (over 10,000).");
      total += entry.uncompressedSize;
      if (total > MAX_UNPACKED) throw new UploadError(400, "The package is over 1 GB once unpacked.");
      const name = entry.fileName.replace(/\\/g, "/");
      if (name.endsWith("/")) continue;
      const target = safeJoin(dest, name);
      if (!target) throw new UploadError(400, `The package contains an unsafe file path: ${name}`);
      await mkdir(path.dirname(target), { recursive: true });
      await pipeline(await zip.openReadStreamPromise(entry), createWriteStream(target));
    }
  } catch (e) {
    if (e instanceof UploadError) throw e;
    // yauzl rejects absolute and "../" paths itself.
    throw new UploadError(400, `Could not unpack the zip: ${e instanceof Error ? e.message : "unknown error"}`);
  } finally {
    zip.close();
  }
  return count;
}

export type TocItem = { title: string; href: string | null; depth: number };
export type PackageInfo = { title: string; root: string; entry: string; toc: TocItem[]; scorm: boolean };

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : (v as { "#text"?: string } | undefined)?.["#text"] ?? "";
const joinBase = (...parts: Array<string | undefined>) =>
  parts.filter(Boolean).join("/").replace(/\/{2,}/g, "/").replace(/^\.\//, "");

/**
 * Reads imsmanifest.xml (IMS Content Packaging, used by SCORM 1.2/2004 and IMS CP) and returns the
 * package's table of contents. Accepts zips that wrap everything in one top-level folder.
 */
export async function readPackage(dir: string): Promise<PackageInfo> {
  let root = "";
  if (!existsSync(path.join(dir, "imsmanifest.xml"))) {
    const entries = (await readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith("__MACOSX"));
    const only = entries.length === 1 && entries[0]!.isDirectory() ? entries[0]!.name : null;
    if (only && existsSync(path.join(dir, only, "imsmanifest.xml"))) root = only;
    else {
      // Plain website zip: fall back to its index page.
      for (const candidate of ["index.html", "index.htm", only && `${only}/index.html`]) {
        if (candidate && existsSync(path.join(dir, candidate))) {
          return { title: "", root: "", entry: candidate, toc: [{ title: "Start", href: candidate, depth: 0 }], scorm: false };
        }
      }
      throw new UploadError(400, "No imsmanifest.xml found. Upload an IMS content package or SCORM .zip.");
    }
  }

  const xml = await readFile(path.join(dir, root, "imsmanifest.xml"), "utf8");
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    isArray: (name) => ["organization", "item", "resource", "file"].includes(name),
  }).parse(xml);
  const manifest = parsed.manifest;
  if (!manifest) throw new UploadError(400, "imsmanifest.xml has no <manifest> element.");

  const resourcesNode = manifest.resources ?? {};
  const resources = new Map<string, { href: string; scorm: boolean }>();
  for (const r of asArray(resourcesNode.resource) as Array<Record<string, string>>) {
    if (!r["@_identifier"] || !r["@_href"]) continue;
    resources.set(r["@_identifier"], {
      href: joinBase(manifest["@_base"], resourcesNode["@_base"], r["@_base"], r["@_href"]),
      scorm: /sco/i.test(r["@_scormtype"] || r["@_scormType"] || ""),
    });
  }

  const orgs = asArray(manifest.organizations?.organization) as Array<Record<string, unknown>>;
  const org = orgs.find((o) => o["@_identifier"] === manifest.organizations?.["@_default"]) ?? orgs[0];
  const toc: TocItem[] = [];
  let scorm = false;
  const walk = (items: unknown, depth: number) => {
    for (const item of asArray(items) as Array<Record<string, unknown>>) {
      const res = resources.get(String(item["@_identifierref"] ?? ""));
      const params = String(item["@_parameters"] ?? "");
      if (res?.scorm) scorm = true;
      toc.push({ title: text(item.title) || "Untitled", href: res ? res.href + params : null, depth });
      walk(item.item, depth + 1);
    }
  };
  if (org) walk(org.item, 0);
  // Packages without organizations: list their resources directly.
  if (toc.length === 0) for (const [id, r] of resources) toc.push({ title: id, href: r.href, depth: 0 });

  const entry = toc.find((t) => t.href)?.href;
  if (!entry) throw new UploadError(400, "The manifest doesn't point to any content to show.");
  const title = text(org?.title) || text(manifest.metadata?.lom?.general?.title?.string) || "";
  return { title, root, entry, toc, scorm };
}

export async function removeStored(kind: string | null, key: string | null) {
  if (!key || !/^[0-9a-f]{32}(\.[a-z0-9]+)?$/.test(key)) return;
  const target = kind === "package" ? path.join(packagesDir, key) : path.join(privateDir, key);
  await rm(target, { recursive: true, force: true });
}
