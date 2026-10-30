import { query } from "../db";
import { parseCsv } from "../csv";

export type ReviewImportSummary = {
  imported: number;
  duplicates: number;
  failedRows: number;
  skippedEmpty: number;
  rejectedInvalid: number;
  errors: { row: number; error: string }[];
};

// Shared by the import route and the dev seeder, so seeded reviews take exactly the
// path an owner's upload does. The caller checks the business exists and the file size.
// Throws only when the file cannot be parsed; row problems are counted in the summary.
export async function importReviewsCsv(businessId: number, csvText: string): Promise<ReviewImportSummary> {
  const rows = parseCsv(csvText);

  let imported = 0, duplicates = 0, failedRows = 0;
  const errors: { row: number; error: string }[] = [];
  let skippedEmpty = 0;
  let rejectedInvalid = 0;

  for (const [index, row] of rows.entries()) {
    const ratingText = row.rating.trim();
    const text = row.text;
    const reviewedAt = row.reviewed_at.trim();
    const authorName = row.author_name?.trim() || null;

    if (!ratingText && !text.trim() && !reviewedAt && !authorName && !row.source_review_id && !row.source_url) {
      skippedEmpty += 1;
      continue;
    }

    if (!ratingText || !text.trim()) {
      rejectedInvalid += 1;
      if (errors.length < 20) errors.push({ row: index + 2, error: "Invalid rating, text, date or source URL" });
      continue;
    }

    const rating = Number(ratingText);
    const date = new Date(reviewedAt);
    const dateValid = /^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(reviewedAt) &&
      !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === reviewedAt.slice(0, 10);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !dateValid ||
        text.length > 10000 || (row.source_review_id?.length ?? 0) > 256 ||
        row.source_url && (!/^https?:\/\//i.test(row.source_url) || row.source_url.length > 2000)) {
      rejectedInvalid += 1;
      if (errors.length < 20) errors.push({ row: index + 2, error: "Invalid rating, text, date or source URL" });
      continue;
    }

    try {
    const result = await query<{ inserted: boolean }>(
      `INSERT INTO reviews
      (business_id, source, source_review_id, rating, author_name, text, reviewed_at, source_url)
      VALUES ($1, 'manual', $6, $2, $3, $4, $5, $7)
      ON CONFLICT (business_id, source, identity_key) DO UPDATE
      SET source_url = COALESCE(reviews.source_url, EXCLUDED.source_url)
      RETURNING (xmax = 0) AS inserted`,
      [businessId, rating, authorName, text, date.toISOString(), row.source_review_id || null, row.source_url || null]
    );
    if (result.rows[0].inserted) imported += 1; else duplicates += 1;
    } catch { failedRows++; if (errors.length < 20) errors.push({ row: index + 2, error: "Storage failure; retry this file safely" }); }
  }

  return { imported, duplicates, failedRows, skippedEmpty, rejectedInvalid, errors };
}
