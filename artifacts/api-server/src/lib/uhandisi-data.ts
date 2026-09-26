export type PaymentStatus =
  | "pending"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded";

export type UhandisiModule = {
  id: number;
  title: string;
  description: string;
  order: number;
  unlockAmount: number;
  unlocked: boolean;
  lessonCount: number;
  duration: string;
  status: "locked" | "unlocked" | "complete";
};

export type UhandisiCourse = {
  id: number;
  title: string;
  category: string;
  description: string;
  price: number;
  paymentModel: "free" | "paid" | "lipa_pole_pole";
  lessonCount: number;
  enrolledCount: number;
  accent: string;
  imageUrl: string;
  instructor: string;
  instructorRole: string;
  paymentPlan: {
    name: string;
    amountPerDay: number;
    description: string;
  };
  modules: UhandisiModule[];
};

export type UhandisiPayment = {
  id: number;
  courseTitle: string;
  courseId: number;
  amount: number;
  status: PaymentStatus;
  date: string;
  phoneNumber: string;
  receipt: string | null;
  checkoutRequestId: string | null;
};

const now = new Date();
const daysAgo = (days: number) => {
  const date = new Date(now);
  date.setDate(date.getDate() - days);
  return date.toISOString();
};

export const courses: UhandisiCourse[] = [
  {
    id: 1,
    title: "Data Analytics",
    category: "Data & technology",
    description:
      "Build practical data skills with Excel, SQL, Power BI, and Python through real Kenyan business examples.",
    price: 2800,
    paymentModel: "lipa_pole_pole",
    lessonCount: 34,
    enrolledCount: 184,
    accent: "#d88c29",
    imageUrl: "/images/data-analytics.svg",
    instructor: "Miriam Wanjiku",
    instructorRole: "Data analyst & educator",
    paymentPlan: {
      name: "Flex",
      amountPerDay: 100,
      description: "Pay from KSh100 a day and unlock each milestone as you go.",
    },
    modules: [
      {
        id: 101,
        title: "Introduction to Data Analytics",
        description: "Understand the data mindset and how organizations use evidence to make better decisions.",
        order: 1,
        unlockAmount: 200,
        unlocked: true,
        lessonCount: 5,
        duration: "1h 45m",
        status: "complete",
      },
      {
        id: 102,
        title: "Excel for Data Analysis",
        description: "Turn everyday spreadsheets into clear, decision-ready analysis.",
        order: 2,
        unlockAmount: 400,
        unlocked: true,
        lessonCount: 8,
        duration: "3h 20m",
        status: "unlocked",
      },
      {
        id: 103,
        title: "SQL Fundamentals",
        description: "Ask better questions of your data with the foundations of SQL.",
        order: 3,
        unlockAmount: 800,
        unlocked: false,
        lessonCount: 7,
        duration: "2h 50m",
        status: "locked",
      },
      {
        id: 104,
        title: "Power BI Dashboards",
        description: "Create dashboards that make a story obvious at a glance.",
        order: 4,
        unlockAmount: 1500,
        unlocked: false,
        lessonCount: 8,
        duration: "4h 10m",
        status: "locked",
      },
      {
        id: 105,
        title: "Python for Data Analysis",
        description: "Use Python to automate repeatable analysis and explore larger datasets.",
        order: 5,
        unlockAmount: 2200,
        unlocked: false,
        lessonCount: 6,
        duration: "3h 40m",
        status: "locked",
      },
    ],
  },
  {
    id: 2,
    title: "Digital Marketing",
    category: "Business & growth",
    description:
      "Learn how to grow a business online with content, social media, and simple performance tracking.",
    price: 1800,
    paymentModel: "lipa_pole_pole",
    lessonCount: 26,
    enrolledCount: 126,
    accent: "#5e4b8b",
    imageUrl: "/images/digital-marketing.svg",
    instructor: "Brian Otieno",
    instructorRole: "Growth strategist",
    paymentPlan: {
      name: "Standard",
      amountPerDay: 200,
      description: "A steady KSh200/day plan for consistent progress.",
    },
    modules: [
      {
        id: 201,
        title: "Your Digital Foundation",
        description: "Set up the channels and goals that make digital marketing work for you.",
        order: 1,
        unlockAmount: 200,
        unlocked: true,
        lessonCount: 5,
        duration: "1h 30m",
        status: "unlocked",
      },
      {
        id: 202,
        title: "Content That Converts",
        description: "Plan content that earns attention and turns it into action.",
        order: 2,
        unlockAmount: 600,
        unlocked: false,
        lessonCount: 7,
        duration: "2h 40m",
        status: "locked",
      },
      {
        id: 203,
        title: "Social Media Systems",
        description: "Build a simple, repeatable system for staying visible online.",
        order: 3,
        unlockAmount: 1100,
        unlocked: false,
        lessonCount: 8,
        duration: "3h 10m",
        status: "locked",
      },
      {
        id: 204,
        title: "Measure & Improve",
        description: "Use a few meaningful numbers to make smarter marketing decisions.",
        order: 4,
        unlockAmount: 1800,
        unlocked: false,
        lessonCount: 6,
        duration: "2h 20m",
        status: "locked",
      },
    ],
  },
  {
    id: 3,
    title: "Professional Communication",
    category: "Career skills",
    description:
      "Communicate with more clarity and confidence in interviews, meetings, and everyday work.",
    price: 0,
    paymentModel: "free",
    lessonCount: 18,
    enrolledCount: 248,
    accent: "#5b9c85",
    imageUrl: "/images/communication.svg",
    instructor: "Amina Hassan",
    instructorRole: "Career coach",
    paymentPlan: {
      name: "Free",
      amountPerDay: 0,
      description: "Start learning immediately. No payment required.",
    },
    modules: [
      {
        id: 301,
        title: "Clarity at Work",
        description: "Make your ideas easier to understand and act on.",
        order: 1,
        unlockAmount: 0,
        unlocked: true,
        lessonCount: 6,
        duration: "1h 20m",
        status: "unlocked",
      },
      {
        id: 302,
        title: "Confident Conversations",
        description: "Handle difficult conversations with calm and purpose.",
        order: 2,
        unlockAmount: 0,
        unlocked: true,
        lessonCount: 6,
        duration: "1h 50m",
        status: "unlocked",
      },
      {
        id: 303,
        title: "Standout Interviews",
        description: "Tell your story in a way that connects your experience to the role.",
        order: 3,
        unlockAmount: 0,
        unlocked: true,
        lessonCount: 6,
        duration: "1h 40m",
        status: "unlocked",
      },
    ],
  },
];

export const payments: UhandisiPayment[] = [
  {
    id: 1,
    courseId: 1,
    courseTitle: "Data Analytics",
    amount: 400,
    status: "completed",
    date: daysAgo(1),
    phoneNumber: "07•• ••• 218",
    receipt: "QK82M9H2P1",
    checkoutRequestId: "ws_CO_010920261",
  },
  {
    id: 2,
    courseId: 1,
    courseTitle: "Data Analytics",
    amount: 200,
    status: "completed",
    date: daysAgo(5),
    phoneNumber: "07•• ••• 218",
    receipt: "QK72M4P8K3",
    checkoutRequestId: "ws_CO_010920260",
  },
  {
    id: 3,
    courseId: 2,
    courseTitle: "Digital Marketing",
    amount: 200,
    status: "pending",
    date: daysAgo(0),
    phoneNumber: "07•• ••• 218",
    receipt: null,
    checkoutRequestId: "ws_CO_010920262",
  },
];

export function totalPaidForCourse(courseId: number) {
  return payments
    .filter((payment) => payment.courseId === courseId && payment.status === "completed")
    .reduce((total, payment) => total + payment.amount, 0);
}

export function withAccess(course: UhandisiCourse) {
  const totalPaid = course.paymentModel === "free" ? course.price : totalPaidForCourse(course.id);
  const modules = course.modules.map((module) => {
    const unlocked = totalPaid >= module.unlockAmount;
    return {
      ...module,
      unlocked,
      status: unlocked ? module.status === "complete" ? "complete" : "unlocked" : "locked",
    } as UhandisiModule;
  });
  const next = modules.find((module) => !module.unlocked);
  const percentagePaid = course.price === 0 ? 100 : Math.min(100, (totalPaid / course.price) * 100);

  return {
    ...course,
    modules,
    progress: {
      coursePrice: course.price,
      totalPaid,
      remaining: Math.max(0, course.price - totalPaid),
      percentagePaid: Number(percentagePaid.toFixed(2)),
      unlockedModules: modules.filter((module) => module.unlocked).length,
      totalModules: modules.length,
      nextModule: next?.title ?? null,
      amountToUnlock: next ? Math.max(0, next.unlockAmount - totalPaid) : null,
    },
  };
}

export function findCourse(courseId: number) {
  const course = courses.find((item) => item.id === courseId);
  return course ? withAccess(course) : undefined;
}

export function createPendingPayment(input: {
  courseId: number;
  amount: number;
  phoneNumber: string;
}) {
  const course = courses.find((item) => item.id === input.courseId);
  if (!course) return undefined;

  const payment: UhandisiPayment = {
    id: Math.max(...payments.map((item) => item.id)) + 1,
    courseId: course.id,
    courseTitle: course.title,
    amount: input.amount,
    status: "pending",
    date: new Date().toISOString(),
    phoneNumber: input.phoneNumber,
    receipt: null,
    checkoutRequestId: `ws_CO_${Date.now()}`,
  };
  payments.unshift(payment);
  return payment;
}