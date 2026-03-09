import { z } from "zod";
import { VALIDATION } from "./config";

// Deck Project Schemas
export const CreateDeckProjectSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(VALIDATION.TITLE_MAX_LENGTH, `Title must be less than ${VALIDATION.TITLE_MAX_LENGTH} characters`),
  description: z
    .string()
    .max(VALIDATION.DESCRIPTION_MAX_LENGTH, `Description must be less than ${VALIDATION.DESCRIPTION_MAX_LENGTH} characters`)
    .optional(),
  content: z
    .string()
    .min(1, "Content is required")
    .max(VALIDATION.CONTENT_MAX_LENGTH, `Content must be less than ${VALIDATION.CONTENT_MAX_LENGTH} characters`),
  theme: z.string().default("default"),
});

export type CreateDeckProjectInput = z.infer<typeof CreateDeckProjectSchema>;

export const UpdateDeckProjectSchema = CreateDeckProjectSchema.partial();
export type UpdateDeckProjectInput = z.infer<typeof UpdateDeckProjectSchema>;

// Slide Schemas
export const CreateSlideSchema = z.object({
  title: z
    .string()
    .min(1, "Slide title is required")
    .max(VALIDATION.SLIDE_TITLE_MAX_LENGTH, `Title must be less than ${VALIDATION.SLIDE_TITLE_MAX_LENGTH} characters`),
  subtitle: z
    .string()
    .max(150, "Subtitle must be less than 150 characters")
    .optional(),
  bullets: z
    .array(
      z
        .string()
        .min(1, "Bullet cannot be empty")
        .max(VALIDATION.BULLET_MAX_LENGTH, `Bullet must be less than ${VALIDATION.BULLET_MAX_LENGTH} characters`)
    )
    .max(VALIDATION.SLIDE_BULLETS_MAX, `Maximum ${VALIDATION.SLIDE_BULLETS_MAX} bullets per slide`)
    .default([]),
  notes: z
    .string()
    .max(VALIDATION.NOTES_MAX_LENGTH, `Notes must be less than ${VALIDATION.NOTES_MAX_LENGTH} characters`)
    .optional(),
  order: z.number().int().min(0),
});

export type CreateSlideInput = z.infer<typeof CreateSlideSchema>;

export const UpdateSlideSchema = CreateSlideSchema.partial();
export type UpdateSlideInput = z.infer<typeof UpdateSlideSchema>;

// Caption Schemas
export const CaptionPackageSchema = z.object({
  blogTitle: z.string().optional(),
  blogMeta: z.string().optional(),
  blogIntro: z.string().optional(),
  blogSections: z.string().optional(),
  blogTags: z.string().optional(),
  xSingle1: z.string().optional(),
  xSingle2: z.string().optional(),
  xSingle3: z.string().optional(),
  xThread: z.string().optional(),
});

export type CaptionPackageInput = z.infer<typeof CaptionPackageSchema>;

// Gemini Response Schemas
export const GeneratedSlideSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  bullets: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const GeneratedDeckSchema = z.object({
  slides: z.array(GeneratedSlideSchema),
  notes: z.string().optional(),
});

// Render Job Schemas
export const RenderJobSchema = z.object({
  deckId: z.string(),
  format: z.enum(["pdf", "pptx", "png"]).default("pdf"),
});

export type RenderJobInput = z.infer<typeof RenderJobSchema>;

// Theme Schemas
export const ThemeSchema = z.object({
  primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
  secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
  background: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
  text: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid color format"),
});

export type ThemeInput = z.infer<typeof ThemeSchema>;
