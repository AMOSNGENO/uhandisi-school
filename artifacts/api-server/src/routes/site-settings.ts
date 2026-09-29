import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, siteSettingsTable } from "@workspace/db";
import { requireAdmin } from "../lib/auth";

const router: IRouter = Router();

// Images must be ones uploaded here (/api/uploads/...) or an https:// address.
const ImageUrl = z.string().trim().max(500).refine((u) => u === "" || /^\/api\/uploads\/[0-9a-f]{32}\.(png|jpg|gif|webp)$/.test(u) || /^https:\/\/\S+$/.test(u), "Upload the image again.");

// Every setting, its type and default. Add new ones here.
const Settings = z.object({
  heroImageUrl: ImageUrl,
  // Mirror the hero photo, so people on its left end up on the right, away from the welcome text.
  heroImageFlip: z.boolean(),
});
type SiteSettings = z.infer<typeof Settings>;
const defaults: SiteSettings = { heroImageUrl: "", heroImageFlip: false };

// Values are stored as text; booleans as "true"/"false". A bad row falls back to its default.
async function readSettings(): Promise<SiteSettings> {
  const rows = await db.select().from(siteSettingsTable);
  const settings = { ...defaults } as Record<string, unknown>;
  for (const { name, value } of rows) {
    const schema = Settings.shape[name as keyof SiteSettings];
    if (!schema) continue;
    const parsed = schema.safeParse(typeof defaults[name as keyof SiteSettings] === "boolean" ? value === "true" : value);
    if (parsed.success) settings[name] = parsed.data;
  }
  return settings as SiteSettings;
}

// Public: the site reads these for guests too.
router.get("/site-settings", async (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.json(await readSettings());
});

router.patch("/admin/site-settings", requireAdmin, async (req, res) => {
  const body = Settings.partial().strict().safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.issues[0]!.message });
  for (const [name, value] of Object.entries(body.data)) {
    await db.insert(siteSettingsTable).values({ name, value: String(value) }).onDuplicateKeyUpdate({ set: { value: String(value) } });
  }
  res.json(await readSettings());
});

export default router;
