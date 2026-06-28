import { z } from "zod";

export const prioritySchema = z.enum(["urgent", "high", "normal"]);

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата должна быть в формате YYYY-MM-DD");

export const createCategorySchema = z.object({
  name: z.string().min(1, "name не может быть пустым"),
  color: z.string().optional(),
  environmentId: z.string().min(1, "environmentId обязателен"),
});

export const updateCategorySchema = z
  .object({
    name: z.string().min(1).optional(),
    color: z.string().optional(),
  })
  .refine((d) => d.name !== undefined || d.color !== undefined, {
    message: "Нужно указать name или color",
  });

export const createTaskSchema = z.object({
  title: z.string().min(1, "title не может быть пустым"),
  description: z.string().optional(),
  columnId: z.string().min(1, "columnId обязателен"),
  categoryId: z.string().optional(),
  priority: prioritySchema.optional(),
  startDate: dateSchema.optional(),
  plannedDate: dateSchema.optional(),
});

export const epicTaskSchema = z.object({
  environmentId: z.string().min(1, "environmentId обязателен"),
  epicName: z.string().min(1, "epicName не может быть пустым"),
  columnName: z.string().min(1, "columnName не может быть пустым"),
  title: z.string().min(1, "title не может быть пустым"),
  description: z.string().optional(),
  priority: prioritySchema.optional(),
  plannedDate: dateSchema.optional(),
  epicColor: z.string().optional(),
});
