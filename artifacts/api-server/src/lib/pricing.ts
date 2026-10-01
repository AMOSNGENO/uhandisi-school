// Pay-as-you-go pricing: the course price is spread over its lessons, in course order, and each payment opens
// the lessons it reaches.
//
// - A lesson's price is the admin's override, or an even share of what the course price leaves after overrides.
// - Lessons sit end to end: lesson n "starts at" the total price of the lessons before it.
// - It opens once those are paid for plus one opening step (normally the smallest daily plan, KSh 100) towards
//   it. So paying KSh 100 always opens something, and a student is never more than one lesson ahead of what
//   they have paid. A lesson priced 0 opens as soon as everything before it is paid.

export type LessonForPricing = { id: number; moduleId: number; title: string; kind: string; priceOverride: number | null };

export type PricedLesson = LessonForPricing & {
  price: number;
  /** True when the price is the automatic share, false when an admin set it. */
  auto: boolean;
  startsAt: number;
  endsAt: number;
  /** Total paid on the course at which this lesson opens. */
  opensAt: number;
};

export function priceLessons(coursePrice: number, lessons: LessonForPricing[], openStep: number): PricedLesson[] {
  const fixed = lessons.reduce((sum, l) => sum + (l.priceOverride ?? 0), 0);
  const autoCount = lessons.filter((l) => l.priceOverride === null).length;
  const pool = Math.max(0, coursePrice - fixed);
  const base = autoCount ? Math.floor(pool / autoCount) : 0;
  let leftover = autoCount ? pool - base * autoCount : 0;
  let total = 0;
  return lessons.map((l) => {
    let price: number;
    if (l.priceOverride === null) {
      // Whole shillings: the first lessons take the odd shillings so the prices add up exactly.
      price = base + (leftover > 0 ? 1 : 0);
      if (leftover > 0) leftover--;
    } else price = l.priceOverride;
    const startsAt = total;
    total += price;
    return { ...l, price, auto: l.priceOverride === null, startsAt, endsAt: total, opensAt: startsAt + Math.min(price, openStep) };
  });
}

export type LessonAccess = {
  unlocked: boolean;
  /** How much of this lesson's price is covered by what the student has paid. */
  paidTowards: number;
  /** How much more the student must pay to open it (0 once open). */
  amountToOpen: number;
};

export type AccessRule = "open" | "pay-as-you-go" | "pay-in-full";

export function lessonAccess(lesson: PricedLesson, paid: number, rule: AccessRule, coursePrice: number): LessonAccess {
  if (rule === "open") return { unlocked: true, paidTowards: lesson.price, amountToOpen: 0 };
  if (rule === "pay-in-full") {
    const unlocked = paid >= coursePrice;
    return { unlocked, paidTowards: unlocked ? lesson.price : 0, amountToOpen: Math.max(0, coursePrice - paid) };
  }
  return {
    unlocked: paid >= lesson.opensAt,
    paidTowards: Math.min(lesson.price, Math.max(0, paid - lesson.startsAt)),
    amountToOpen: Math.max(0, lesson.opensAt - paid),
  };
}

/** Days to pay off the rest at a plan's daily amount. */
export const daysToFinish = (remaining: number, amountPerDay: number) => (remaining <= 0 ? 0 : Math.ceil(remaining / Math.max(1, amountPerDay)));
