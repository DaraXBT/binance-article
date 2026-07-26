import type {
  DeckStatus,
  ImageGenerationStatus,
} from '@/lib/schemas';
import type { AppDatabase } from '@/server/db/client';

export interface DeckProjectRecord {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  content: string;
  theme: string;
  customTheme: unknown;
  illustrationStyle: string;
  status: DeckStatus;
  generationRevision: number;
  lastCompletedRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SlideRecord {
  id: string;
  deckId: string;
  title: string;
  subtitle: string | null;
  bullets: unknown;
  notes: string | null;
  imageUrl: string | null;
  imageStatus: ImageGenerationStatus;
  imageError: string | null;
  imagePrompt: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CaptionRecord {
  id: string;
  deckId: string;
  blogTitle: string | null;
  blogMeta: string | null;
  blogIntro: string | null;
  blogSections: unknown;
  blogTags: unknown;
  xSingle1: string | null;
  xSingle2: string | null;
  xSingle3: string | null;
  xThread: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RenderAssetRecord {
  id: string;
  deckId: string;
  filename: string;
  format: 'pdf' | 'pptx' | 'png';
  mimeType: string;
  filePath: string;
  fileSize: number | null;
  storageProvider: string;
  jobId: string | null;
  createdAt: Date;
}

export interface DeckBundle {
  deck: DeckProjectRecord;
  slides: SlideRecord[];
  captions: CaptionRecord | null;
  renderAssets: RenderAssetRecord[];
}

export interface GeneratedSlideWrite {
  id: string;
  title: string;
  subtitle: string | null;
  bullets: string[];
  notes: string | null;
  imagePrompt: string | null;
  order: number;
}

export interface GeneratedCaptionWrite {
  blogTitle: string | null;
  blogMeta: string | null;
  blogIntro: string | null;
  blogSections: string[];
  blogTags: string[];
  xSingle1: string | null;
  xSingle2: string | null;
  xSingle3: string | null;
  xThread: string | null;
}

export type ReorderSlidesResult = 'updated' | 'not_found' | 'invalid';

export interface ArticleRepository {
  createDeck(input: {
    id: string;
    workspaceId: string;
    title: string;
    content: string;
    description: string | null;
    illustrationStyle: string;
    status: 'draft';
    now: Date;
  }): Promise<DeckProjectRecord>;
  createDeckIdempotently(input: {
    id: string;
    workspaceId: string;
    title: string;
    content: string;
    description: string | null;
    illustrationStyle: string;
    status: 'draft';
    now: Date;
  }): Promise<DeckProjectRecord | null>;
  listDecks(workspaceId: string, limit: number): Promise<Array<DeckProjectRecord & {
    _count: { slides: number };
  }>>;
  findDeck(workspaceId: string, deckId: string): Promise<DeckProjectRecord | null>;
  getDeckBundle(workspaceId: string, deckId: string): Promise<DeckBundle | null>;
  updateDeck(input: {
    deckId: string;
    workspaceId: string;
    data: Partial<{
      title: string;
      description: string;
      theme: string;
      status: DeckStatus;
      content: string;
    }>;
    now: Date;
  }): Promise<DeckProjectRecord | null>;
  deleteDeck(workspaceId: string, deckId: string): Promise<DeckProjectRecord | null>;
  replaceGeneratedContent(input: {
    deckId: string;
    workspaceId: string;
    revision: number;
    slides: GeneratedSlideWrite[];
    captionId: string;
    captions: GeneratedCaptionWrite;
    now: Date;
  }): Promise<{ applied: boolean; currentRevision: number } | null>;
  beginGenerationRevision(input: {
    deckId: string;
    workspaceId: string;
    now: Date;
  }): Promise<DeckProjectRecord | null>;
  markDeckStatus(input: {
    deckId: string;
    workspaceId: string;
    status: DeckStatus;
    expectedGenerationRevision?: number;
    now: Date;
  }): Promise<DeckProjectRecord | null>;
  getDeckWithSlides(workspaceId: string, deckId: string): Promise<{
    deck: DeckProjectRecord;
    slides: SlideRecord[];
  } | null>;
  markSlidesImagePending(input: {
    workspaceId: string;
    deckId: string;
    slideIds: string[];
    now: Date;
  }): Promise<number>;
  markSlideImageFailed(input: {
    workspaceId: string;
    deckId: string;
    slideId: string;
    message: string;
    now: Date;
  }): Promise<SlideRecord | null>;
  markSlideImageGenerated(input: {
    workspaceId: string;
    deckId: string;
    slideId: string;
    imageUrl: string;
    now: Date;
  }): Promise<SlideRecord | null>;
  createSlide(input: {
    id: string;
    workspaceId: string;
    deckId: string;
    title: string;
    subtitle: string | null;
    bullets: string[];
    notes: string | null;
    order?: number;
    now: Date;
  }): Promise<SlideRecord | null>;
  updateSlide(input: {
    workspaceId: string;
    deckId: string;
    slideId: string;
    update: Partial<{
      title: string;
      subtitle: string;
      bullets: string[];
      notes: string;
    }>;
    now: Date;
  }): Promise<SlideRecord | null>;
  reorderSlides(input: {
    workspaceId: string;
    deckId: string;
    slideOrder: Array<{ id: string; order: number }>;
    now: Date;
  }): Promise<ReorderSlidesResult>;
  deleteSlide(input: {
    workspaceId: string;
    deckId: string;
    slideId: string;
    now: Date;
  }): Promise<boolean>;
  createRenderAsset(input: {
    id: string;
    deckId: string;
    filename: string;
    filePath: string;
    format: 'png' | 'pptx' | 'pdf';
    mimeType: string;
    jobId: string | null;
    now: Date;
  }): Promise<RenderAssetRecord>;
  getRenderAssets(deckId: string): Promise<RenderAssetRecord[]>;
  getCaptions(deckId: string): Promise<CaptionRecord | null>;
}

function json(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('Article JSON value is not serializable.');
  return serialized;
}

function rows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${label} query returned invalid data.`);
  return value as Record<string, unknown>[];
}

function first<T>(value: unknown, label: string): T | null {
  const row = rows(value, label)[0];
  if (row === undefined) return null;
  if (!row || typeof row !== 'object') throw new Error(`${label} query returned invalid data.`);
  return row as T;
}

function required<T>(value: unknown, label: string): T {
  const record = first<T>(value, label);
  if (!record) throw new Error(`${label} write did not return a row.`);
  return record;
}

function nullableText(value: string | undefined): string | null {
  return value ?? null;
}

export function createArticleRepository(database: AppDatabase): ArticleRepository {
  return {
    async createDeck(input) {
      const result = await database.$client`
        INSERT INTO "DeckProject" (
          "id", "workspaceId", "title", "description", "content", "theme",
          "customTheme", "illustrationStyle", "status", "generationRevision",
          "lastCompletedRevision", "createdAt", "updatedAt"
        ) VALUES (
          ${input.id}, ${input.workspaceId}, ${input.title}, ${input.description},
          ${input.content}, 'default', NULL, ${input.illustrationStyle},
          'draft'::"DeckStatus", 0, 0, ${input.now}, ${input.now}
        )
        RETURNING *
      `;
      return required<DeckProjectRecord>(result, 'Article');
    },

    async createDeckIdempotently(input) {
      const result = await database.$client`
        INSERT INTO "DeckProject" (
          "id", "workspaceId", "title", "description", "content", "theme",
          "customTheme", "illustrationStyle", "status", "generationRevision",
          "lastCompletedRevision", "createdAt", "updatedAt"
        ) VALUES (
          ${input.id}, ${input.workspaceId}, ${input.title}, ${input.description},
          ${input.content}, 'default', NULL, ${input.illustrationStyle},
          'draft'::"DeckStatus", 0, 0, ${input.now}, ${input.now}
        )
        ON CONFLICT ("id") DO UPDATE
        SET "id" = EXCLUDED."id"
        WHERE "DeckProject"."workspaceId" = EXCLUDED."workspaceId"
          AND "DeckProject"."title" = EXCLUDED."title"
          AND "DeckProject"."description" IS NOT DISTINCT FROM EXCLUDED."description"
          AND "DeckProject"."content" = EXCLUDED."content"
          AND "DeckProject"."illustrationStyle" = EXCLUDED."illustrationStyle"
        RETURNING *
      `;
      return first<DeckProjectRecord>(result, 'Article');
    },

    async listDecks(workspaceId, limit) {
      const result = await database.$client`
        SELECT deck.*, COUNT(slide."id")::integer AS "slideCount"
        FROM "DeckProject" AS deck
        LEFT JOIN "Slide" AS slide ON slide."deckId" = deck."id"
        WHERE deck."workspaceId" = ${workspaceId}
        GROUP BY deck."id"
        ORDER BY deck."updatedAt" DESC, deck."id" DESC
        LIMIT ${limit}
      `;
      return rows(result, 'Article list').map((row) => {
        const slideCount = Number(row.slideCount);
        if (!Number.isSafeInteger(slideCount) || slideCount < 0) {
          throw new Error('Article list query returned invalid data.');
        }
        const { slideCount: _slideCount, ...deck } = row;
        return {
          ...(deck as unknown as DeckProjectRecord),
          _count: { slides: slideCount },
        };
      });
    },

    async findDeck(workspaceId, deckId) {
      const result = await database.$client`
        SELECT * FROM "DeckProject"
        WHERE "id" = ${deckId} AND "workspaceId" = ${workspaceId}
        LIMIT 1
      `;
      return first<DeckProjectRecord>(result, 'Article');
    },

    async getDeckBundle(workspaceId, deckId) {
      const [deckRows, slideRows, captionRows, assetRows] = await database.$client.transaction(
        (transaction) => [
          transaction`
            SELECT * FROM "DeckProject"
            WHERE "id" = ${deckId} AND "workspaceId" = ${workspaceId}
            LIMIT 1
          `,
          transaction`
            SELECT slide.*
            FROM "Slide" AS slide
            INNER JOIN "DeckProject" AS deck ON deck."id" = slide."deckId"
            WHERE slide."deckId" = ${deckId} AND deck."workspaceId" = ${workspaceId}
            ORDER BY slide."order" ASC, slide."id" ASC
          `,
          transaction`
            SELECT caption.*
            FROM "CaptionPackage" AS caption
            INNER JOIN "DeckProject" AS deck ON deck."id" = caption."deckId"
            WHERE caption."deckId" = ${deckId} AND deck."workspaceId" = ${workspaceId}
            LIMIT 1
          `,
          transaction`
            SELECT asset.*
            FROM "RenderAsset" AS asset
            INNER JOIN "DeckProject" AS deck ON deck."id" = asset."deckId"
            WHERE asset."deckId" = ${deckId} AND deck."workspaceId" = ${workspaceId}
            ORDER BY asset."createdAt" DESC, asset."id" DESC
          `,
        ],
        { isolationLevel: 'ReadCommitted' },
      );
      const deck = first<DeckProjectRecord>(deckRows, 'Article');
      if (!deck) return null;
      return {
        deck,
        slides: rows(slideRows, 'Slide') as unknown as SlideRecord[],
        captions: first<CaptionRecord>(captionRows, 'Caption'),
        renderAssets: rows(assetRows, 'Render asset') as unknown as RenderAssetRecord[],
      };
    },

    async updateDeck(input) {
      const data = input.data;
      const result = await database.$client`
        UPDATE "DeckProject"
        SET
          "title" = CASE WHEN ${data.title !== undefined} THEN ${data.title ?? ''} ELSE "title" END,
          "description" = CASE WHEN ${data.description !== undefined}
            THEN ${nullableText(data.description)} ELSE "description" END,
          "theme" = CASE WHEN ${data.theme !== undefined} THEN ${data.theme ?? ''} ELSE "theme" END,
          "status" = CASE WHEN ${data.status !== undefined}
            THEN ${data.status ?? 'draft'}::"DeckStatus" ELSE "status" END,
          "content" = CASE WHEN ${data.content !== undefined} THEN ${data.content ?? ''} ELSE "content" END,
          "updatedAt" = ${input.now}
        WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
        RETURNING *
      `;
      return first<DeckProjectRecord>(result, 'Article');
    },

    async deleteDeck(workspaceId, deckId) {
      const result = await database.$client`
        DELETE FROM "DeckProject"
        WHERE "id" = ${deckId} AND "workspaceId" = ${workspaceId}
        RETURNING *
      `;
      return first<DeckProjectRecord>(result, 'Article');
    },

    async replaceGeneratedContent(input) {
      const result = await database.$client`
        WITH candidate AS MATERIALIZED (
          SELECT "id", "generationRevision"
          FROM "DeckProject"
          WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
          FOR UPDATE
        ), matching_revision AS MATERIALIZED (
          SELECT * FROM candidate
          WHERE "generationRevision" = ${input.revision}
        ), deleted_slides AS (
          DELETE FROM "Slide" AS slide
          USING matching_revision
          WHERE slide."deckId" = matching_revision."id"
          RETURNING slide."id"
        ), inserted_slides AS (
          INSERT INTO "Slide" (
            "id", "deckId", "title", "subtitle", "bullets", "notes", "imageUrl",
            "imageStatus", "imageError", "imagePrompt", "order", "createdAt", "updatedAt"
          )
          SELECT
            item."id", matching_revision."id", item."title", item."subtitle",
            item."bullets", item."notes", NULL, 'pending'::"SlideImageStatus", NULL,
            item."imagePrompt", item."order", ${input.now}, ${input.now}
          FROM matching_revision
          CROSS JOIN jsonb_to_recordset(${json(input.slides)}::jsonb) AS item(
            "id" text, "title" text, "subtitle" text, "bullets" jsonb,
            "notes" text, "imagePrompt" text, "order" integer
          )
          RETURNING "id"
        ), upserted_caption AS (
          INSERT INTO "CaptionPackage" (
            "id", "deckId", "blogTitle", "blogMeta", "blogIntro", "blogSections",
            "blogTags", "xSingle1", "xSingle2", "xSingle3", "xThread",
            "createdAt", "updatedAt"
          )
          SELECT
            ${input.captionId}, matching_revision."id", ${input.captions.blogTitle},
            ${input.captions.blogMeta}, ${input.captions.blogIntro},
            ${json(input.captions.blogSections)}::jsonb,
            ${json(input.captions.blogTags)}::jsonb,
            ${input.captions.xSingle1}, ${input.captions.xSingle2},
            ${input.captions.xSingle3}, ${input.captions.xThread}, ${input.now}, ${input.now}
          FROM matching_revision
          ON CONFLICT ("deckId") DO UPDATE SET
            "blogTitle" = EXCLUDED."blogTitle",
            "blogMeta" = EXCLUDED."blogMeta",
            "blogIntro" = EXCLUDED."blogIntro",
            "blogSections" = EXCLUDED."blogSections",
            "blogTags" = EXCLUDED."blogTags",
            "xSingle1" = EXCLUDED."xSingle1",
            "xSingle2" = EXCLUDED."xSingle2",
            "xSingle3" = EXCLUDED."xSingle3",
            "xThread" = EXCLUDED."xThread",
            "updatedAt" = EXCLUDED."updatedAt"
          RETURNING "deckId"
        ), updated_deck AS (
          UPDATE "DeckProject" AS deck
          SET
            "status" = 'ready'::"DeckStatus",
            "lastCompletedRevision" = ${input.revision},
            "updatedAt" = ${input.now}
          FROM matching_revision
          WHERE deck."id" = matching_revision."id"
            AND (SELECT count(*) FROM inserted_slides) = ${input.slides.length}
            AND EXISTS (SELECT 1 FROM upserted_caption)
          RETURNING deck."generationRevision"
        )
        SELECT
          EXISTS (SELECT 1 FROM updated_deck) AS "applied",
          candidate."generationRevision" AS "currentRevision"
        FROM candidate
      `;
      const row = first<{ applied?: unknown; currentRevision?: unknown }>(
        result,
        'Generated article replacement',
      );
      if (!row) return null;
      const currentRevision = Number(row.currentRevision);
      if (typeof row.applied !== 'boolean' || !Number.isSafeInteger(currentRevision)) {
        throw new Error('Generated article replacement query returned invalid data.');
      }
      return { applied: row.applied, currentRevision };
    },

    async beginGenerationRevision(input) {
      const result = await database.$client`
        UPDATE "DeckProject"
        SET
          "generationRevision" = "generationRevision" + 1,
          "status" = 'queued'::"DeckStatus",
          "updatedAt" = ${input.now}
        WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
        RETURNING *
      `;
      return first<DeckProjectRecord>(result, 'Article');
    },

    async markDeckStatus(input) {
      const result = await database.$client`
        UPDATE "DeckProject"
        SET "status" = ${input.status}::"DeckStatus", "updatedAt" = ${input.now}
        WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
          AND (${input.expectedGenerationRevision === undefined}
            OR "generationRevision" = ${input.expectedGenerationRevision ?? -1})
        RETURNING *
      `;
      return first<DeckProjectRecord>(result, 'Article');
    },

    async getDeckWithSlides(workspaceId, deckId) {
      const [deckRows, slideRows] = await database.$client.transaction(
        (transaction) => [
          transaction`
            SELECT * FROM "DeckProject"
            WHERE "id" = ${deckId} AND "workspaceId" = ${workspaceId}
            LIMIT 1
          `,
          transaction`
            SELECT slide.* FROM "Slide" AS slide
            INNER JOIN "DeckProject" AS deck ON deck."id" = slide."deckId"
            WHERE slide."deckId" = ${deckId} AND deck."workspaceId" = ${workspaceId}
            ORDER BY slide."order" ASC, slide."id" ASC
          `,
        ],
        { isolationLevel: 'ReadCommitted' },
      );
      const deck = first<DeckProjectRecord>(deckRows, 'Article');
      return deck
        ? { deck, slides: rows(slideRows, 'Slide') as unknown as SlideRecord[] }
        : null;
    },

    async markSlidesImagePending(input) {
      if (input.slideIds.length === 0) return 0;
      const result = await database.$client`
        WITH requested AS (
          SELECT value AS "id"
          FROM jsonb_array_elements_text(${json(input.slideIds)}::jsonb)
        )
        UPDATE "Slide" AS slide
        SET
          "imageStatus" = 'pending'::"SlideImageStatus",
          "imageError" = NULL,
          "updatedAt" = ${input.now}
        FROM "DeckProject" AS deck, requested
        WHERE slide."id" = requested."id"
          AND slide."deckId" = ${input.deckId}
          AND deck."id" = slide."deckId"
          AND deck."workspaceId" = ${input.workspaceId}
        RETURNING slide."id"
      `;
      return rows(result, 'Slide image').length;
    },

    async markSlideImageFailed(input) {
      const result = await database.$client`
        UPDATE "Slide" AS slide
        SET
          "imageUrl" = NULL,
          "imageStatus" = 'failed'::"SlideImageStatus",
          "imageError" = ${input.message},
          "updatedAt" = ${input.now}
        FROM "DeckProject" AS deck
        WHERE slide."id" = ${input.slideId}
          AND slide."deckId" = ${input.deckId}
          AND deck."id" = slide."deckId"
          AND deck."workspaceId" = ${input.workspaceId}
        RETURNING slide.*
      `;
      return first<SlideRecord>(result, 'Slide image');
    },

    async markSlideImageGenerated(input) {
      const result = await database.$client`
        UPDATE "Slide" AS slide
        SET
          "imageUrl" = ${input.imageUrl},
          "imageStatus" = 'generated'::"SlideImageStatus",
          "imageError" = NULL,
          "updatedAt" = ${input.now}
        FROM "DeckProject" AS deck
        WHERE slide."id" = ${input.slideId}
          AND slide."deckId" = ${input.deckId}
          AND deck."id" = slide."deckId"
          AND deck."workspaceId" = ${input.workspaceId}
        RETURNING slide.*
      `;
      return first<SlideRecord>(result, 'Slide image');
    },

    async createSlide(input) {
      const requestedOrder = input.order ?? 2_147_483_647;
      const [deckRows, , , insertedRows] = await database.$client.transaction(
        (transaction) => [
          transaction`
            SELECT "id" FROM "DeckProject"
            WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
            FOR UPDATE
          `,
          transaction`
            WITH bounds AS (
              SELECT count(*)::integer AS "total"
              FROM "Slide" WHERE "deckId" = ${input.deckId}
            )
            UPDATE "Slide"
            SET "order" = "order" + (SELECT "total" FROM bounds) + 1000
            WHERE "deckId" = ${input.deckId}
              AND "order" >= LEAST(GREATEST(${requestedOrder}, 0), (SELECT "total" FROM bounds))
              AND EXISTS (
                SELECT 1 FROM "DeckProject"
                WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
              )
            RETURNING "id"
          `,
          transaction`
            WITH bounds AS (
              SELECT count(*)::integer AS "total"
              FROM "Slide" WHERE "deckId" = ${input.deckId}
            )
            UPDATE "Slide"
            SET "order" = "order" - (SELECT "total" FROM bounds) - 1000 + 1
            WHERE "deckId" = ${input.deckId}
              AND "order" >= LEAST(GREATEST(${requestedOrder}, 0), (SELECT "total" FROM bounds))
                + (SELECT "total" FROM bounds) + 1000
              AND EXISTS (
                SELECT 1 FROM "DeckProject"
                WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
              )
            RETURNING "id"
          `,
          transaction`
            INSERT INTO "Slide" (
              "id", "deckId", "title", "subtitle", "bullets", "notes", "imageUrl",
              "imageStatus", "imageError", "imagePrompt", "order", "createdAt", "updatedAt"
            )
            SELECT
              ${input.id}, ${input.deckId}, ${input.title}, ${input.subtitle},
              ${json(input.bullets)}::jsonb, ${input.notes}, NULL,
              'pending'::"SlideImageStatus", NULL, NULL,
              LEAST(GREATEST(${requestedOrder}, 0), (
                SELECT count(*)::integer FROM "Slide" WHERE "deckId" = ${input.deckId}
              )),
              ${input.now}, ${input.now}
            WHERE EXISTS (
              SELECT 1 FROM "DeckProject"
              WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
            )
            RETURNING *
          `,
          transaction`
            UPDATE "DeckProject" SET "updatedAt" = ${input.now}
            WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
            RETURNING "id"
          `,
        ],
        { isolationLevel: 'Serializable' },
      );
      if (rows(deckRows, 'Article').length === 0) return null;
      return first<SlideRecord>(insertedRows, 'Slide');
    },

    async updateSlide(input) {
      const update = input.update;
      const result = await database.$client`
        WITH updated_slide AS (
          UPDATE "Slide" AS slide
          SET
            "title" = CASE WHEN ${update.title !== undefined}
              THEN ${update.title ?? ''} ELSE slide."title" END,
            "subtitle" = CASE WHEN ${update.subtitle !== undefined}
              THEN ${nullableText(update.subtitle)} ELSE slide."subtitle" END,
            "bullets" = CASE WHEN ${update.bullets !== undefined}
              THEN ${json(update.bullets ?? [])}::jsonb ELSE slide."bullets" END,
            "notes" = CASE WHEN ${update.notes !== undefined}
              THEN ${nullableText(update.notes)} ELSE slide."notes" END,
            "updatedAt" = ${input.now}
          FROM "DeckProject" AS deck
          WHERE slide."id" = ${input.slideId}
            AND slide."deckId" = ${input.deckId}
            AND deck."id" = slide."deckId"
            AND deck."workspaceId" = ${input.workspaceId}
          RETURNING slide.*
        ), touched_deck AS (
          UPDATE "DeckProject" AS deck
          SET "updatedAt" = ${input.now}
          FROM updated_slide
          WHERE deck."id" = updated_slide."deckId"
          RETURNING deck."id"
        )
        SELECT updated_slide.* FROM updated_slide
        INNER JOIN touched_deck ON touched_deck."id" = updated_slide."deckId"
      `;
      return first<SlideRecord>(result, 'Slide');
    },

    async reorderSlides(input) {
      const orderJson = json(input.slideOrder);
      const [deckRows, , finalRows, validityRows] = await database.$client.transaction(
        (transaction) => [
          transaction`
            SELECT "id" FROM "DeckProject"
            WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
            FOR UPDATE
          `,
          transaction`
            WITH requested AS (
              SELECT * FROM jsonb_to_recordset(${orderJson}::jsonb)
                AS item("id" text, "order" integer)
            ), validity AS (
              SELECT
                EXISTS (
                  SELECT 1 FROM "DeckProject"
                  WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
                )
                AND (SELECT count(*) FROM requested) =
                  (SELECT count(*) FROM "Slide" WHERE "deckId" = ${input.deckId})
                AND NOT EXISTS (
                  SELECT 1 FROM requested
                  LEFT JOIN "Slide" AS slide
                    ON slide."id" = requested."id" AND slide."deckId" = ${input.deckId}
                  WHERE slide."id" IS NULL
                ) AS "valid"
            )
            UPDATE "Slide" AS slide
            SET "order" = requested."order" +
              (SELECT count(*) FROM "Slide" WHERE "deckId" = ${input.deckId}) + 1000
            FROM requested, validity
            WHERE slide."id" = requested."id"
              AND slide."deckId" = ${input.deckId}
              AND validity."valid"
              AND EXISTS (
                SELECT 1 FROM "DeckProject"
                WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
              )
            RETURNING slide."id"
          `,
          transaction`
            WITH requested AS (
              SELECT * FROM jsonb_to_recordset(${orderJson}::jsonb)
                AS item("id" text, "order" integer)
            )
            UPDATE "Slide" AS slide
            SET "order" = requested."order", "updatedAt" = ${input.now}
            FROM requested
            WHERE slide."id" = requested."id" AND slide."deckId" = ${input.deckId}
              AND slide."order" >= 1000
              AND EXISTS (
                SELECT 1 FROM "DeckProject"
                WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
              )
            RETURNING slide."id"
          `,
          transaction`
            WITH requested AS (
              SELECT * FROM jsonb_to_recordset(${orderJson}::jsonb)
                AS item("id" text, "order" integer)
            )
            SELECT
              EXISTS (
                SELECT 1 FROM "DeckProject"
                WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
              )
              AND (SELECT count(*) FROM requested) =
                (SELECT count(*) FROM "Slide" WHERE "deckId" = ${input.deckId})
              AND NOT EXISTS (
                SELECT 1 FROM requested
                LEFT JOIN "Slide" AS slide
                  ON slide."id" = requested."id" AND slide."deckId" = ${input.deckId}
                WHERE slide."id" IS NULL
              ) AS "valid"
          `,
          transaction`
            UPDATE "DeckProject" SET "updatedAt" = ${input.now}
            WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
            RETURNING "id"
          `,
        ],
        { isolationLevel: 'Serializable' },
      );
      if (rows(deckRows, 'Article').length === 0) return 'not_found';
      const validity = first<{ valid?: unknown }>(validityRows, 'Slide reorder');
      if (validity?.valid !== true) return 'invalid';
      if (rows(finalRows, 'Slide reorder').length !== input.slideOrder.length) return 'invalid';
      return 'updated';
    },

    async deleteSlide(input) {
      const [deckRows, deletedRows] = await database.$client.transaction(
        (transaction) => [
          transaction`
            SELECT "id" FROM "DeckProject"
            WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
            FOR UPDATE
          `,
          transaction`
            WITH deleted_slide AS (
              DELETE FROM "Slide"
              WHERE "id" = ${input.slideId} AND "deckId" = ${input.deckId}
                AND EXISTS (
                  SELECT 1 FROM "DeckProject"
                  WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
                )
              RETURNING *
            ), touched_deck AS (
              UPDATE "DeckProject" SET "updatedAt" = ${input.now}
              WHERE "id" = ${input.deckId} AND EXISTS (SELECT 1 FROM deleted_slide)
              RETURNING "id"
            )
            SELECT deleted_slide.* FROM deleted_slide
            INNER JOIN touched_deck ON touched_deck."id" = deleted_slide."deckId"
          `,
          transaction`
            WITH ranked AS (
              SELECT slide."id",
                row_number() OVER (ORDER BY slide."order", slide."id") - 1 AS "normalized"
              FROM "Slide" AS slide
              INNER JOIN "DeckProject" AS deck ON deck."id" = slide."deckId"
              WHERE slide."deckId" = ${input.deckId}
                AND deck."workspaceId" = ${input.workspaceId}
            )
            UPDATE "Slide" AS slide
            SET "order" = ranked."normalized" +
              (SELECT count(*) FROM "Slide" WHERE "deckId" = ${input.deckId}) + 1000
            FROM ranked WHERE slide."id" = ranked."id"
            RETURNING slide."id"
          `,
          transaction`
            UPDATE "Slide"
            SET "order" = "order" -
              (SELECT count(*) FROM "Slide" WHERE "deckId" = ${input.deckId}) - 1000,
              "updatedAt" = ${input.now}
            WHERE "deckId" = ${input.deckId} AND "order" >= 1000
              AND EXISTS (
                SELECT 1 FROM "DeckProject"
                WHERE "id" = ${input.deckId} AND "workspaceId" = ${input.workspaceId}
              )
            RETURNING "id"
          `,
        ],
        { isolationLevel: 'Serializable' },
      );
      if (rows(deckRows, 'Article').length === 0) return false;
      return rows(deletedRows, 'Slide').length === 1;
    },

    async createRenderAsset(input) {
      const result = await database.$client`
        INSERT INTO "RenderAsset" (
          "id", "deckId", "filename", "format", "mimeType", "filePath",
          "fileSize", "storageProvider", "jobId", "createdAt"
        ) VALUES (
          ${input.id}, ${input.deckId}, ${input.filename}, ${input.format}::"AssetFormat",
          ${input.mimeType}, ${input.filePath}, NULL, 'r2', ${input.jobId}, ${input.now}
        )
        RETURNING *
      `;
      return required<RenderAssetRecord>(result, 'Render asset');
    },

    async getRenderAssets(deckId) {
      const result = await database.$client`
        SELECT * FROM "RenderAsset"
        WHERE "deckId" = ${deckId}
        ORDER BY "createdAt" DESC, "id" DESC
      `;
      return rows(result, 'Render asset') as unknown as RenderAssetRecord[];
    },

    async getCaptions(deckId) {
      const result = await database.$client`
        SELECT * FROM "CaptionPackage" WHERE "deckId" = ${deckId} LIMIT 1
      `;
      return first<CaptionRecord>(result, 'Caption');
    },
  };
}
