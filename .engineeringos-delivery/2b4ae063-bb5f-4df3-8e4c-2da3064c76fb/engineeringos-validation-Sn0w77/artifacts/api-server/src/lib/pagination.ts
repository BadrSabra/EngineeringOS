import type { Request } from "express";

export type Pagination = {
  page: number;
  pageSize: number;
  offset: number;
};

/**
 * Parse pagination at the HTTP boundary. Do not silently clamp malformed
 * values: clients need a stable 400 instead of an unexpectedly expensive or
 * empty query.
 */
export function parsePagination(
  req: Request,
  options: { defaultPageSize?: number; maxPageSize?: number } = {},
): Pagination {
  const defaultPageSize = options.defaultPageSize ?? 50;
  const maxPageSize = options.maxPageSize ?? 200;
  const rawPage = req.query.page;
  const rawPageSize = req.query.pageSize ?? req.query.limit;
  const page = rawPage === undefined ? 1 : Number(rawPage);
  const pageSize = rawPageSize === undefined ? defaultPageSize : Number(rawPageSize);

  if (!Number.isSafeInteger(page) || page < 1) {
    throw new Error("page must be a positive integer");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > maxPageSize) {
    throw new Error(`pageSize must be an integer between 1 and ${maxPageSize}`);
  }
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) {
    throw new Error("page is too large");
  }
  return { page, pageSize, offset };
}