import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, siteSettingsTable } from "@workspace/db";
import { requireAdmin } from "../lib/auth";

const router: IRouter = Router();

// Images must be ones uploaded here (/api/uploads/...) or an https:// address.
const ImageUrl = z.string().trim().max(500).refine((u) => u === "" || /^\/api\/uploads\/[0-9a-f]{32}\.(png|jpg|gif|webp)$/.test(u) || /^https:\/\/\S+$/.test(u), "Upload the image again.");

// A daily payment plan for pay-as-you-go courses: how much the student aims to pay each day.
const Plan = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,20}$/, "Plan ids are short lowercase words."),
  name: z.string().trim().min(1, "Give every plan a name.").max(30),
  // M-Pesa payments here start at KSh 100, so plans do too.
  amountPerDay: z.number().int().min(100, "A plan must be at least KSh 100 a day.").max(100000),
});
export type PaymentPlan = z.infer<typeof Plan>;

// Every setting, its type and default. Add new ones here.
const Settings = z.object({
  heroImageUrl: ImageUrl,
  // Mirror the hero photo, so people on its left end up on the right, away from the welcome text.
  heroImageFlip: z.boolean(),
  paymentPlans: z.array(Plan).min(1, "Keep at least one plan.").max(6)
    .refine((plans) => new Set(plans.map((p) => p.id)).size === plans.length, "Two plans have the same id."),
});
export type SiteSettings = z.infer<typeof Settings>;
const defaults: SiteSettings = {
  heroImageUrl: "",
  heroImageFlip: false,
  paymentPlans: [
    { id: "bronze", name: "Bronze", amountPerDay: 100 },
    { id: "silver", name: "Silver", amountPerDay: 200 },
    { id: "gold", name: "Gold", amountPerDay: 300 },
  ],
};

// Text settings are stored as they are; everything else as JSON. A bad row falls back to its default.
const encode = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));
function decode(name: keyof SiteSettings, raw: string) {
  if (typeof defaults[name] === "string") return raw;
  try { return JSON.parse(raw); } catch { return undefined; }
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const rows = await db.select().from(siteSettingsTable);
  const settings = { ...defaults } as Record<string, unknown>;
  for (const { name, value } of rows) {
    const schema = Settings.shape[name as keyof SiteSettings];
    if (!schema) continue;
    const parsed = schema.safeParse(decode(name as keyof SiteSettings, value));
    if (parsed.success) settings[name] = parsed.data;
  }
  return settings as SiteSettings;
}

// Public: the site reads these for guests too.
router.get("/site-settings", async (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.json(await getSiteSettings());
});

router.patch("/admin/site-settings", requireAdmin, async (req, res) => {
  const body = Settings.partial().strict().safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: body.error.issues[0]!.message });
  for (const [name, value] of Object.entries(body.data)) {
    await db.insert(siteSettingsTable).values({ name, value: encode(value) }).onDuplicateKeyUpdate({ set: { value: encode(value) } });
  }
  res.json(await getSiteSettings());
});

export default router;
