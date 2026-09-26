import {
  mysqlTable,
  int,
  varchar,
  text,
  datetime,
  boolean,
  mysqlEnum,
  mediumtext,
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
});

export const lessonsTable = mysqlTable("lessons", {
  id: int("id").autoincrement().primaryKey(),
  moduleId: int("module_id").notNull(),
  title: varchar("title", { length: 190 }).notNull(),
  contentHtml: mediumtext("content_html").notNull(),
  order: int("sort_order").notNull().default(1),
  createdAt: datetime("created_at").notNull(),
  updatedAt: datetime("updated_at").notNull(),
});

export const enrollmentsTable = mysqlTable("enrollments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull(),
  courseId: int("course_id").notNull(),
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
