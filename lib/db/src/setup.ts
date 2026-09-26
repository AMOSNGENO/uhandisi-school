import { randomBytes } from "node:crypto";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { hashPassword } from "./password";

// Plain SQL instead of drizzle-kit push so it works on MariaDB (XAMPP) as well as MySQL 8.
// Keep in sync with ./schema/index.ts.
const tables = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    phone VARCHAR(30) NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('student','instructor','admin') NOT NULL DEFAULT 'student',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    expires_at DATETIME NOT NULL,
    INDEX (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS courses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(190) NOT NULL,
    category VARCHAR(120) NOT NULL,
    description TEXT NOT NULL,
    price INT NOT NULL DEFAULT 0,
    payment_model ENUM('free','paid','lipa_pole_pole') NOT NULL DEFAULT 'lipa_pole_pole',
    accent VARCHAR(20) NOT NULL DEFAULT '#1f6f5c',
    image_url VARCHAR(255) NOT NULL DEFAULT '',
    instructor VARCHAR(120) NOT NULL DEFAULT '',
    instructor_role VARCHAR(120) NOT NULL DEFAULT '',
    plan_name VARCHAR(60) NOT NULL DEFAULT 'Flex',
    plan_amount_per_day INT NOT NULL DEFAULT 100,
    plan_description VARCHAR(255) NOT NULL DEFAULT '',
    published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS modules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    course_id INT NOT NULL,
    title VARCHAR(190) NOT NULL,
    description TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 1,
    unlock_amount INT NOT NULL DEFAULT 0,
    lesson_count INT NOT NULL DEFAULT 0,
    duration VARCHAR(30) NOT NULL DEFAULT '',
    INDEX (course_id),
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS lessons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    module_id INT NOT NULL,
    title VARCHAR(190) NOT NULL,
    content_html MEDIUMTEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX (module_id),
    FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS enrollments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    course_id INT NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE KEY user_course (user_id, course_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    course_id INT NOT NULL,
    amount INT NOT NULL,
    status ENUM('pending','completed','failed','cancelled','refunded') NOT NULL DEFAULT 'pending',
    phone_number VARCHAR(30) NOT NULL,
    receipt VARCHAR(60) NULL,
    checkout_request_id VARCHAR(80) NULL,
    created_at DATETIME NOT NULL,
    INDEX (user_id),
    INDEX (checkout_request_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

type SeedModule = [title: string, description: string, unlockAmount: number, lessonCount: number, duration: string];

const seedCourses: Array<{
  title: string; category: string; description: string; price: number;
  paymentModel: "free" | "paid" | "lipa_pole_pole"; accent: string; imageUrl: string;
  instructor: string; instructorRole: string;
  plan: [name: string, amountPerDay: number, description: string];
  modules: SeedModule[];
}> = [
  {
    title: "Data Analytics", category: "Data & technology",
    description: "Build practical data skills with Excel, SQL, Power BI, and Python through real Kenyan business examples.",
    price: 2800, paymentModel: "lipa_pole_pole", accent: "#d88c29", imageUrl: "/images/data-analytics.svg",
    instructor: "Miriam Wanjiku", instructorRole: "Data analyst & educator",
    plan: ["Flex", 100, "Pay from KSh100 a day and unlock each milestone as you go."],
    modules: [
      ["Introduction to Data Analytics", "Understand the data mindset and how organizations use evidence to make better decisions.", 200, 5, "1h 45m"],
      ["Excel for Data Analysis", "Turn everyday spreadsheets into clear, decision-ready analysis.", 400, 8, "3h 20m"],
      ["SQL Fundamentals", "Ask better questions of your data with the foundations of SQL.", 800, 7, "2h 50m"],
      ["Power BI Dashboards", "Create dashboards that make a story obvious at a glance.", 1500, 8, "4h 10m"],
      ["Python for Data Analysis", "Use Python to automate repeatable analysis and explore larger datasets.", 2200, 6, "3h 40m"],
    ],
  },
  {
    title: "Digital Marketing", category: "Business & growth",
    description: "Learn how to grow a business online with content, social media, and simple performance tracking.",
    price: 1800, paymentModel: "lipa_pole_pole", accent: "#5e4b8b", imageUrl: "/images/digital-marketing.svg",
    instructor: "Brian Otieno", instructorRole: "Growth strategist",
    plan: ["Standard", 200, "A steady KSh200/day plan for consistent progress."],
    modules: [
      ["Your Digital Foundation", "Set up the channels and goals that make digital marketing work for you.", 200, 5, "1h 30m"],
      ["Content That Converts", "Plan content that earns attention and turns it into action.", 600, 7, "2h 40m"],
      ["Social Media Systems", "Build a simple, repeatable system for staying visible online.", 1100, 8, "3h 10m"],
      ["Measure & Improve", "Use a few meaningful numbers to make smarter marketing decisions.", 1800, 6, "2h 20m"],
    ],
  },
  {
    title: "Professional Communication", category: "Career skills",
    description: "Communicate with more clarity and confidence in interviews, meetings, and everyday work.",
    price: 0, paymentModel: "free", accent: "#5b9c85", imageUrl: "/images/communication.svg",
    instructor: "Amina Hassan", instructorRole: "Career coach",
    plan: ["Free", 0, "Start learning immediately. No payment required."],
    modules: [
      ["Clarity at Work", "Make your ideas easier to understand and act on.", 0, 6, "1h 20m"],
      ["Confident Conversations", "Handle difficult conversations with calm and purpose.", 0, 6, "1h 50m"],
      ["Standout Interviews", "Tell your story in a way that connects your experience to the role.", 0, 6, "1h 40m"],
    ],
  },
];

/**
 * Creates tables if missing, seeds sample courses into an empty database, and creates the
 * first admin account. Returns the generated admin password when one was created, so the
 * caller can show it once.
 */
// Columns added after the first release. Checked via information_schema because
// MySQL 8 has no "ADD COLUMN IF NOT EXISTS" (MariaDB does).
const addedColumns: Array<[table: string, column: string, definition: string]> = [
  ["courses", "overview_html", "MEDIUMTEXT NULL"],
];

async function addMissingColumns(pool: Pool) {
  for (const [table, column, definition] of addedColumns) {
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      [table, column],
    );
    if (rows.length === 0) await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}

export async function setupDatabase(pool: Pool): Promise<{ adminEmail: string; adminPassword: string } | null> {
  for (const sql of tables) await pool.query(sql);
  await addMissingColumns(pool);

  const [courseRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM courses");
  if (Number(courseRows[0]!.n) === 0) {
    const now = new Date();
    for (const c of seedCourses) {
      const [result] = await pool.query(
        `INSERT INTO courses (title, category, description, price, payment_model, accent, image_url, instructor, instructor_role, plan_name, plan_amount_per_day, plan_description, published, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?)`,
        [c.title, c.category, c.description, c.price, c.paymentModel, c.accent, c.imageUrl, c.instructor, c.instructorRole, ...c.plan, now],
      );
      const courseId = (result as { insertId: number }).insertId;
      for (const [i, m] of c.modules.entries()) {
        await pool.query(
          "INSERT INTO modules (course_id, title, description, sort_order, unlock_amount, lesson_count, duration) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [courseId, m[0], m[1], i + 1, m[2], m[3], m[4]],
        );
      }
    }
  }

  const [adminRows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  if (Number(adminRows[0]!.n) > 0) return null;

  const adminEmail = process.env.ADMIN_EMAIL || "admin@uhandisi.school";
  const adminPassword = process.env.ADMIN_PASSWORD || randomBytes(9).toString("base64url");
  await pool.query(
    "INSERT INTO users (name, email, password_hash, role, active, created_at) VALUES (?, ?, ?, 'admin', TRUE, ?)",
    ["Administrator", adminEmail, await hashPassword(adminPassword), new Date()],
  );
  return { adminEmail, adminPassword };
}
