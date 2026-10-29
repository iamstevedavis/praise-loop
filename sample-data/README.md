# Sample data

Example files for trying PraiseLoop with realistic content. `csv/` holds review
exports you can upload through the app's CSV import, one file per business or
business type, named after the business (`<business-name>.csv`).

**Everything here is invented.** The reviews and reviewer names are fictional and
only exist to exercise the app. Never publish a post made from sample reviews,
and never mix real customer reviews into these files. Real reviews belong in the
owner's own import, not in the repository.

## CSV format

Required columns: `rating` (1-5), `text`, `reviewed_at` (ISO 8601). Optional:
`author_name`, `source_review_id`, `source_url`. The sample files fill
`source_review_id` with a `sample-<business>-NNN` id so a re-import is
recognised as duplicates instead of adding rows. Limits: 1 MB, 1000 rows; see
[docs/features.md](../docs/features.md#csv-review-import).

## Files

| File | Business |
|---|---|
| `csv/hespeler-powder-coating.csv` | Hespeler Powder Coating, Cambridge, ON: sandblasting, powder coating and machine shop (24 reviews, ratings 2-5) |
