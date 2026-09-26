import { ApiError } from '@/lib/auth';

export const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/gif,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

/** Uploads an image or PDF (admins only) and returns its public URL. */
export async function uploadFile(file: Blob): Promise<string> {
  if (file.size > MAX_BYTES) throw new ApiError(413, 'That file is over 10 MB. Use a smaller one.');
  const res = await fetch('/api/admin/uploads', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || 'Upload failed. Try again.');
  return (data as { url: string }).url;
}
