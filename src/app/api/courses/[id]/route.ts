import { readJson, withUser } from '@/lib/api/handler';
import { getCourse, updateCourse } from '@/lib/domain/courses';
import { createCourseSchema } from '@/lib/domain/validation';
import { NotFoundError } from '@/lib/domain/tasks';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export const GET = withUser(async ({ user, params }) => {
  const found = await getCourse(user.id, params.id!);
  if (!found) throw new NotFoundError('Course');
  return found;
});

export const PATCH = withUser(async ({ request, user, params }) => {
  const input = createCourseSchema.partial().extend({ archived: z.boolean().optional() }).parse(await readJson(request));
  return { course: await updateCourse(user.id, params.id!, input, `user:${user.id}`) };
});
