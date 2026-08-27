import { readJson, withUser } from '@/lib/api/handler';
import { createCourse, listCourses } from '@/lib/domain/courses';
import { createCourseSchema } from '@/lib/domain/validation';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ user }) => ({ courses: await listCourses(user.id) }));

export const POST = withUser(async ({ request, user }) => {
  const input = createCourseSchema.parse(await readJson(request));
  return { course: await createCourse(user.id, input, `user:${user.id}`) };
});
