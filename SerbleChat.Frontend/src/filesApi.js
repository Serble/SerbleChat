// Files API – https://api.files.serble.net
// Handles file uploads, authentication, and limits management

const BASE = import.meta.env.VITE_SERBLE_FILES_API_URL ?? 'https://api.files.serble.net';

export const FILES_OAUTH_URL = 'https://serble.net/oauth/authorize';
export const FILES_CLIENT_ID = import.meta.env.VITE_FILES_CLIENT_ID;
export const FILES_REDIRECT_URI = `${window.location.origin}/files-callback`;

/**
 * Get the files API auth token from client options
 */
export function getFilesAuthToken(clientOptions) {
  return clientOptions?.filesApiToken || null;
}

/**
 * Build headers for authenticated Files API requests
 */
function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res) {
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const err = new Error(typeof data === 'string' ? data : JSON.stringify(data));
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Account (Files API) ───────────────────────────────────────────────────────

/**
 * POST /account – authenticate with Files API using OAuth code
 */
export async function filesAuthenticateWithCode(code) {
  const res = await fetch(`${BASE}/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return handle(res); // returns { accessToken: string }
}

/**
 * GET /account – get current Files API user info (requires auth)
 */
export async function filesGetAccount(token) {
  const res = await fetch(`${BASE}/account`, {
    headers: authHeaders(token),
  });
  return handle(res); // returns FilesUser { id, username, isAdmin, isBanned, isSpecial }
}

// ── Files ──────────────────────────────────────────────────────────────────

/**
 * GET /files – list uploaded files for the current user (requires auth)
 */
export async function filesListFiles(token) {
  const res = await fetch(`${BASE}/files`, {
    headers: authHeaders(token),
  });
  return handle(res); // returns UploadedFile[]
}

/**
 * POST /files – request upload for a new file
 * Returns upload URL and fields for S3-style multipart upload, or direct response
 */
export async function filesCreateFile(fileName, fileSize, expirationHours, token) {
  const res = await fetch(`${BASE}/files`, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileName,
      fileSize,
      expirationHours: expirationHours || null,
    }),
  });
  return handle(res); // returns FileCreateResponse { file, uploadUrl, uploadFields }
}

/**
 * GET /files/:id – download a file
 */
export async function filesGetFile(fileId, token) {
  const res = await fetch(`${BASE}/files/${encodeURIComponent(fileId)}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    const err = new Error('Failed to fetch file');
    err.status = res.status;
    throw err;
  }
  return res.blob();
}

/**
 * DELETE /files/:id – delete an uploaded file
 */
export async function filesDeleteFile(fileId, token) {
  const res = await fetch(`${BASE}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  return handle(res);
}

// ── Limits ─────────────────────────────────────────────────────────────────

/**
 * GET /limits – get account limits (can be called without auth)
 */
export async function filesGetLimits(token) {
  const res = await fetch(`${BASE}/limits`, {
    headers: authHeaders(token),
  });
  return handle(res); // returns AccountLimits
}

/**
 * GET /limits/usage – get current storage usage (requires auth)
 */
export async function filesGetUsage(token) {
  const res = await fetch(`${BASE}/limits/usage`, {
    headers: authHeaders(token),
  });
  return handle(res); // returns AccountUsage { usedStorage }
}

// ── Upload helpers ───────────────────────────────────────────────────────────

/**
 * Upload a file to the upload URL provided by filesCreateFile
 * Supports both S3-style multipart and direct upload
 */
export async function filesUploadBlob(uploadUrl, uploadFields, fileBlob, fileName) {
  const formData = new FormData();

  // If uploadFields provided, add them (S3-style)
  if (uploadFields && typeof uploadFields === 'object') {
    for (const [key, value] of Object.entries(uploadFields)) {
      formData.append(key, value);
    }
  }

  // Append the actual file
  formData.append('file', fileBlob, fileName);

  const res = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = new Error('File upload failed');
    err.status = res.status;
    throw err;
  }

  // S3-style uploads may return empty response or XML, not JSON
  // Just return success indicator
  return { success: true };
}

/**
 * Helper: format bytes to human-readable size
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
