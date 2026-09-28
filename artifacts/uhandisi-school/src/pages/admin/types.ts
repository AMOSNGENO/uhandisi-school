import type { Role } from '@/lib/auth';

export type PaymentModel = 'free' | 'paid' | 'lipa_pole_pole';
export type ActivityKind = 'page' | 'file' | 'url' | 'package' | 'quiz';

export type AdminModule = {
  id: number; courseId: number; title: string; description: string; order: number; unlockAmount: number;
  lessonCount: number; duration: string; lessonTotal?: number;
};
export type AdminCourse = {
  id: number; title: string; category: string; description: string; price: number; paymentModel: PaymentModel;
  accent: string; imageUrl: string; instructor: string; instructorRole: string; planName: string; planAmountPerDay: number;
  planDescription: string; published: boolean; overviewHtml: string; certificateTemplateId?: number | null; enrolledCount?: number; modules: AdminModule[];
};
export type CourseFields = Omit<AdminCourse, 'id' | 'modules' | 'enrolledCount'>;
export type AdminActivity = {
  id: number; moduleId: number; title: string; kind: ActivityKind; contentHtml: string; order: number;
  externalUrl: string | null; fileName: string | null; fileType: string | null; fileSize: number | null;
  packageEntry: string | null; hasUpload: boolean; packageItems: number;
};
export type AdminUser = {
  id: number; name: string; email: string; phone: string | null; role: Role; active: boolean; createdAt: string; enrolments: number;
};
export type Participant = {
  userId: number; name: string; email: string; phone: string | null; role: Role; active: boolean;
  fullAccess: boolean; enrolledAt: string; paid: number;
};
export type AdminPayment = {
  id: number; userId: number; courseTitle: string; amount: number; status: string; date: string; phoneNumber: string;
  receipt: string | null; checkoutRequestId: string | null; studentName?: string; studentEmail?: string;
};
export type Stats = {
  users: { total: number; students: number; admins: number }; courses: { total: number; published: number };
  payments: { revenue: number; pending: number; completed: number }; enrollments: number; recentPayments: AdminPayment[];
};
export type Category = { name: string; courses: number; published: number };
