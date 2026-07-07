import '@fastify/multipart'; // FastifyRequest tip kengaytmalari (isMultipart, parts)
import { FastifyRequest } from 'fastify';
import { AppException } from '../exceptions/app.exception';

export interface UploadedFile {
  fieldname: string;
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

export interface MultipartPayload {
  files: UploadedFile[];
  fields: Record<string, string>;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** @fastify/multipart so'rovini fayllar + maydonlarga ajratadi */
export async function parseMultipart(
  req: FastifyRequest,
  options: { maxFiles?: number; imagesOnly?: boolean } = {},
): Promise<MultipartPayload> {
  const { maxFiles = 5, imagesOnly = true } = options;
  if (!req.isMultipart()) {
    throw AppException.validation('So‘rov multipart/form-data bo‘lishi kerak');
  }
  const files: UploadedFile[] = [];
  const fields: Record<string, string> = {};
  const parts = req.parts();
  for await (const part of parts) {
    if (part.type === 'file') {
      if (files.length >= maxFiles) {
        throw AppException.validation(`Maksimal ${maxFiles} ta fayl yuklash mumkin`);
      }
      if (imagesOnly && !ALLOWED_IMAGE_TYPES.has(part.mimetype)) {
        throw AppException.validation(
          `Fayl turi qo‘llab-quvvatlanmaydi: ${part.mimetype}. Faqat JPEG/PNG/WebP`,
        );
      }
      files.push({
        fieldname: part.fieldname,
        filename: part.filename,
        mimetype: part.mimetype,
        buffer: await part.toBuffer(),
      });
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { files, fields };
}
