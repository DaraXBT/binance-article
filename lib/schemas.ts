import { z } from "zod";
import { VALIDATION } from "./config";

export const IllustrationStyleSchema = z.enum(['pixel-art', 'fantasy-animation', 'lab-notes']);

export const GenerateRequestSchema = z.object({
  articleContent: z.string().min(10, 'Article content is required'),
  slideCount: z.number().int().min(1).max(15).default(1),
  illustrationStyle: IllustrationStyleSchema.default('pixel-art'),
  mode: z.enum(['text', 'url', 'prompt']).optional().default('text'),
});

export type DeckGenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const ImageGenerationModeSchema = z.enum(['missing', 'failed']);
export const ImageGenerationStatusSchema = z.enum(['pending', 'generated', 'failed']);
export const DeckStatusSchema = z.enum(['draft', 'queued', 'generating', 'ready', 'rendering', 'failed']);
export const JobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export const JobKindSchema = z.enum(['generate', 'generate_images', 'render']);

export const GenerateImagesRequestSchema = z.object({
  illustrationStyle: IllustrationStyleSchema.default('pixel-art'),
  mode: ImageGenerationModeSchema.optional().default('missing'),
});

export type GenerateImagesRequest = z.infer<typeof GenerateImagesRequestSchema>;
export type ImageGenerationMode = z.infer<typeof ImageGenerationModeSchema>;
export type ImageGenerationStatus = z.infer<typeof ImageGenerationStatusSchema>;
export type DeckStatus = z.infer<typeof DeckStatusSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type JobKind = z.infer<typeof JobKindSchema>;

export interface SlideContent {
  id?: string;
  title: string;
  subtitle?: string;
  bulletPoints: string[];
  notes?: string;
  order: number;
}

// Deck Project Schemas
export const CreateDeckProjectSchema = z.object({
  title: z
    .string()
    .trim()
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
  illustrationStyle: IllustrationStyleSchema.default('pixel-art'),
});

export type CreateDeckProjectInput = z.infer<typeof CreateDeckProjectSchema>;
export const UpdateDeckProjectSchema = z.object({
  title: CreateDeckProjectSchema.shape.title.optional(),
  description: CreateDeckProjectSchema.shape.description.optional(),
  content: CreateDeckProjectSchema.shape.content.optional(),
  theme: z.string().optional(),
  status: DeckStatusSchema.optional(),
});
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

export const CreateSlideRequestSchema = CreateSlideSchema.omit({ order: true }).extend({
  order: z.number().int().min(0).optional(),
});

export type CreateSlideRequest = z.infer<typeof CreateSlideRequestSchema>;

export const UpdateSlideSchema = CreateSlideSchema.partial();
export type UpdateSlideInput = z.infer<typeof UpdateSlideSchema>;
export type SlideUpdateRequest = UpdateSlideInput;

export type DeckSlide = {
  id: string;
  deckId: string;
  title: string;
  subtitle: string | null;
  bullets: string[];
  bulletPoints: string[];
  notes: string | null;
  imageUrl: string | null;
  imageStatus: ImageGenerationStatus;
  imageError: string | null;
  imagePrompt: string | null;
  order: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type JobLogEntry = {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'success';
  meta?: Record<string, unknown>;
};

export type JobSummary = {
  id: string;
  deckId: string;
  workspaceId: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  logs: JobLogEntry[];
  errorCode?: string | null;
  error?: string | null;
  articleRevisionId: string;
  runId?: string | null;
  result?: unknown;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type DeckDetailResponse = {
  id: string;
  status: DeckStatus;
  title: string;
  description?: string | null;
  content?: string;
  theme?: string | null;
  illustrationStyle?: string | null;
  slides: DeckSlide[];
  captions: CaptionPackage | null;
  lastJob?: JobSummary | null;
};

export const WorkspaceRecoverSchema = z.object({
  accessKey: z.string().min(1, 'Access key is required'),
});

export type WorkspaceRecoverRequest = z.infer<typeof WorkspaceRecoverSchema>;

// Caption Schemas
export const CaptionPackageSchema = z.object({
  blogTitle: z.string().optional(),
  blogMeta: z.string().optional(),
  blogIntro: z.string().optional(),
  blogSections: z.array(z.string()).optional(),
  blogTags: z.array(z.string()).optional(),
  xSingle1: z.string().optional(),
  xSingle2: z.string().optional(),
  xSingle3: z.string().optional(),
  xThread: z.string().optional(),
});

export type CaptionPackageInput = z.infer<typeof CaptionPackageSchema>;
export type CaptionPackage = CaptionPackageInput;

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
