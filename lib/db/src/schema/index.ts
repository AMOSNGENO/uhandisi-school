import {
  mysqlTable,
  int,
  varchar,
  text,
  datetime,
  boolean,
  mysqlEnum,
  mediumtext,
  bigint,
  double,
} from "drizzle-orm/mysql-core";

// Keep in sync with the CREATE TABLE statements in ../setup.ts.

export const usersTable = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 190 }).notNull().unique(),
  phone: varchar("phone", { length: 30 }),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["student", "instructor", "admin"]).notNull().default("student"),
  active: boolean("active").notNull().default(true),
  createdAt: datetime("created_at").notNull(),
});

export const sessionsTable = mysqlTable("sessions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  userId: int("user_id").notNull(),
  expiresAt: datetime("expires_at").notNull(),
});

export const coursesTable = mysqlTable("courses", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 190 }).notNull(),
  category: varchar("category", { length: 120 }).notNull(),
  description: text("description").notNull(),
  price: int("price").notNull().default(0),
  paymentModel: mysqlEnum("payment_model", ["free", "paid", "lipa_pole_pole"]).notNull().default("lipa_pole_pole"),
  accent: varchar("accent", { length: 20 }).notNull().default("#1f6f5c"),
  imageUrl: varchar("image_url", { length: 255 }).notNull().default(""),
  instructor: varchar("instructor", { length: 120 }).notNull().default(""),
  instructorRole: varchar("instructor_role", { length: 120 }).notNull().default(""),
  planName: varchar("plan_name", { length: 60 }).notNull().default("Flex"),
  planAmountPerDay: int("plan_amount_per_day").notNull().default(100),
  planDescription: varchar("plan_description", { length: 255 }).notNull().default(""),
  published: boolean("published").notNull().default(true),
  // Rich "About this course" HTML from the admin editor.
  overviewHtml: mediumtext("overview_html"),
  // Set when imported from Moodle (its course id).
  moodleId: int("moodle_id"),
  // Certificate template for this course; null = the default template (or the built-in design).
  certificateTemplateId: int("certificate_template_id"),
  createdAt: datetime("created_at").notNull(),
});

export const modulesTable = mysqlTable("modules", {
  id: int("id").autoincrement().primaryKey(),
  courseId: int("course_id").notNull(),
  title: varchar("title", { length: 190 }).notNull(),
  description: text("description").notNull(),
  order: int("sort_order").notNull().default(1),
  unlockAmount: int("unlock_amount").notNull().default(0),
  lessonCount: int("lesson_count").notNull().default(0),
  duration: varchar("duration", { length: 30 }).notNull().default(""),
  // Set when imported from Moodle, e.g. "section:12".
  moodleRef: varchar("moodle_ref", { length: 40 }),
});

export const lessonsTable = mysqlTable("lessons", {
  id: int("id").autoincrement().primaryKey(),
  moduleId: int("module_id").notNull(),
  title: varchar("title", { length: 190 }).notNull(),
  contentHtml: mediumtext("content_html").notNull(),
  // page | file | url | package (IMS content package or SCORM zip)
  kind: varchar("kind", { length: 20 }).notNull().default("page"),
  externalUrl: varchar("external_url", { length: 1000 }),
  fileName: varchar("file_name", { length: 255 }),
  fileType: varchar("file_type", { length: 120 }),
  fileSize: bigint("file_size", { mode: "number" }),
  // Private storage: a file name under uploads/private, or a folder under uploads/packages.
  storageKey: varchar("storage_key", { length: 100 }),
  packageEntry: varchar("package_entry", { length: 500 }),
  packageToc: mediumtext("package_toc"),
  // Set when imported from Moodle, e.g. "cm:57" or "chapter:9", with the imported file's content hash.
  moodleRef: varchar("moodle_ref", { length: 40 }),
  moodleHash: varchar("moodle_hash", { length: 40 }),
  order: int("sort_order").notNull().default(1),
  createdAt: datetime("created_at").notNull(),
  updatedAt: datetime("updated_at").notNull(),
});

export const enrollmentsTable = mysqlTable("enrollments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  courseId: int("course_id").notNull(),
  // Set when an admin enrols someone with the whole course unlocked (scholarship, staff).
  fullAccess: boolean("full_access").notNull().default(false),
  createdAt: datetime("created_at").notNull(),
});

export const paymentsTable = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  courseId: int("course_id").notNull(),
  amount: int("amount").notNull(),
  status: mysqlEnum("status", ["pending", "completed", "failed", "cancelled", "refunded"]).notNull().default("pending"),
  phoneNumber: varchar("phone_number", { length: 30 }).notNull(),
  receipt: varchar("receipt", { length: 60 }),
  checkoutRequestId: varchar("checkout_request_id", { length: 80 }),
  createdAt: datetime("created_at").notNull(),
});

export type User = typeof usersTable.$inferSelect;
export type Course = typeof coursesTable.$inferSelect;
export type Module = typeof modulesTable.$inferSelect;
export type Payment = typeof paymentsTable.$inferSelect;
export type Lesson = typeof lessonsTable.$inferSelect;

// ---------------------------------------------------------------------------------------------
// Exams and certificates (keep in sync with ../setup.ts)
// ---------------------------------------------------------------------------------------------

export const quizSettingsTable = mysqlTable("quiz_settings", {
  lessonId: int("lesson_id").primaryKey(),
  passMark: int("pass_mark").notNull().default(50),
  timeLimitMinutes: int("time_limit_minutes"),
  maxAttempts: int("max_attempts"),
  shuffle: boolean("shuffle").notNull().default(false),
  // after_submit | after_pass | never
  showAnswers: varchar("show_answers", { length: 20 }).notNull().default("after_submit"),
  requiredForCertificate: boolean("required_for_certificate").notNull().default(true),
});

export const questionsTable = mysqlTable("questions", {
  id: int("id").autoincrement().primaryKey(),
  lessonId: int("lesson_id").notNull(),
  order: int("sort_order").notNull().default(1),
  // single (one right answer) | multiple (one or more right answers, partial marks)
  type: varchar("type", { length: 20 }).notNull().default("single"),
  text: text("text").notNull(),
  points: int("points").notNull().default(1),
  explanation: text("explanation"),
});

export const questionOptionsTable = mysqlTable("question_options", {
  id: int("id").autoincrement().primaryKey(),
  questionId: int("question_id").notNull(),
  order: int("sort_order").notNull().default(1),
  text: text("text").notNull(),
  isCorrect: boolean("is_correct").notNull().default(false),
});

export const quizAttemptsTable = mysqlTable("quiz_attempts", {
  id: int("id").autoincrement().primaryKey(),
  lessonId: int("lesson_id").notNull(),
  userId: int("user_id").notNull(),
  startedAt: datetime("started_at").notNull(),
  deadline: datetime("deadline"),
  submittedAt: datetime("submitted_at"),
  layout: mediumtext("layout").notNull(),
  answers: mediumtext("answers"),
  scorePoints: double("score_points"),
  maxPoints: double("max_points"),
  percent: double("percent"),
  passed: boolean("passed"),
  review: mediumtext("review"),
});

export const certificatesTable = mysqlTable("certificates", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  userId: int("user_id").notNull(),
  courseId: int("course_id").notNull(),
  studentName: varchar("student_name", { length: 120 }).notNull(),
  courseTitle: varchar("course_title", { length: 190 }).notNull(),
  percent: double("percent"),
  // auto (earned by passing the exams) | admin (issued by hand)
  issuedBy: varchar("issued_by", { length: 20 }).notNull().default("auto"),
  issuedAt: datetime("issued_at").notNull(),
  revokedAt: datetime("revoked_at"),
});

export type Question = typeof questionsTable.$inferSelect;
export type QuestionOption = typeof questionOptionsTable.$inferSelect;
export type QuizAttempt = typeof quizAttemptsTable.$inferSelect;
export type Certificate = typeof certificatesTable.$inferSelect;

export const certificateTemplatesTable = mysqlTable("certificate_templates", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  // pdf | image
  kind: varchar("kind", { length: 10 }).notNull(),
  // File name in uploads/private.
  storageKey: varchar("storage_key", { length: 100 }).notNull(),
  // Page size in PDF points (1/72 inch).
  pageWidth: double("page_width").notNull(),
  pageHeight: double("page_height").notNull(),
  // JSON list of text fields placed on the page.
  fields: mediumtext("fields").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: datetime("created_at").notNull(),
});

export type CertificateTemplate = typeof certificateTemplatesTable.$inferSelect;
