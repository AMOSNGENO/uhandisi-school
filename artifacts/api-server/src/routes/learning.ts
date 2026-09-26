import { Router, type IRouter } from "express";
import {
  GetCourseParams,
  GetCourseResponse,
  GetStudentDashboardResponse,
  ListCoursesResponse,
  ListStudentPaymentsResponse,
} from "@workspace/api-zod";
import {
  courses,
  findCourse,
  payments,
  totalPaidForCourse,
  withAccess,
} from "../lib/uhandisi-data";

const router: IRouter = Router();

router.get("/courses", (_req, res) => {
  const data = courses.map((course) => {
    const { instructor: _instructor, instructorRole: _instructorRole, paymentPlan: _paymentPlan, modules: _modules, ...summary } = course;
    return summary;
  });
  res.json(ListCoursesResponse.parse(data));
});

router.get("/courses/:courseId", (req, res) => {
  const params = GetCourseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const course = findCourse(params.data.courseId);
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }
  res.json(GetCourseResponse.parse(course));
});

router.get("/student/dashboard", (_req, res) => {
  const enrolled = courses.slice(0, 2).map((course) => {
    const { instructor: _instructor, instructorRole: _instructorRole, paymentPlan: _paymentPlan, modules: _modules, ...summary } = course;
    return { ...summary, progress: withAccess(course).progress };
  });
  const data = {
    studentName: "Amos",
    streakDays: 6,
    enrolledCourses: enrolled,
    featuredCourses: courses.map((course) => {
      const { instructor: _instructor, instructorRole: _instructorRole, paymentPlan: _paymentPlan, modules: _modules, ...summary } = course;
      return summary;
    }),
    totalPaid: payments.filter((payment) => payment.status === "completed").reduce((sum, payment) => sum + payment.amount, 0),
    activeCourseCount: 2,
    completedCourseCount: 0,
  };
  res.json(GetStudentDashboardResponse.parse(data));
});

router.get("/student/payments", (_req, res) => {
  res.json(ListStudentPaymentsResponse.parse(payments));
});

export default router;