const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

function parseDataUriMedia(dataUri) {
  if (typeof dataUri !== 'string' || !dataUri.startsWith('data:')) {
    return null;
  }

  const matches = dataUri.match(/^data:([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+);base64,(.+)$/);
  if (!matches || matches.length !== 3) {
    return null;
  }

  const mimeType = matches[1].toLowerCase();
  const [category, rawSubtype = 'bin'] = mimeType.split('/');
  if (!['image', 'audio', 'video'].includes(category)) {
    return null;
  }

  const buffer = Buffer.from(matches[2], 'base64');
  const subtype = rawSubtype || 'bin';
  const extension = subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/gi, '');

  return {
    fileType: category,
    mimeType,
    buffer,
    extension: extension || 'bin',
  };
}

function parseDataUriImage(dataUri) {
  const parsed = parseDataUriMedia(dataUri);
  return parsed?.fileType === 'image' ? parsed : null;
}

async function storeImageDataUri({
  userId,
  dataUri,
  purpose = 'upload',
}) {
  const parsed = parseDataUriImage(dataUri);
  if (!parsed) {
    return null;
  }

  return storeParsedImage({
    userId,
    parsed,
    purpose,
  });
}

async function storeMediaDataUri({
  userId,
  dataUri,
  purpose = 'upload',
}) {
  const parsed = parseDataUriMedia(dataUri);
  if (!parsed) {
    return null;
  }

  return storeParsedMedia({
    userId,
    parsed,
    purpose,
  });
}

function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

function shouldRequireCloudinary() {
  return `${process.env.REQUIRE_CLOUDINARY_STORAGE || 'false'}`.toLowerCase() === 'true';
}

async function uploadImageToCloudinary({
  resourceType = 'image',
  fileType = 'image',
  userId,
  dataUri,
  extension,
  purpose,
  mimeType,
  fileSize,
}) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder = (process.env.CLOUDINARY_FOLDER || 'altera').replace(/^\/+|\/+$/g, '');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const publicId = `${purpose}_${userId || 'anon'}_${Date.now()}`;
  const signature = signCloudinaryParams({
    folder,
    public_id: publicId,
    timestamp,
  }, apiSecret);

  const formData = new FormData();
  formData.append('file', dataUri);
  formData.append('api_key', apiKey);
  formData.append('timestamp', timestamp);
  formData.append('folder', folder);
  formData.append('public_id', publicId);
  formData.append('signature', signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    {
      method: 'POST',
      body: formData,
    },
  );

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'Cloudinary upload failed');
  }

  if (!payload.secure_url) {
    throw new Error('Cloudinary upload succeeded without secure_url');
  }

  await db.query(
    `INSERT INTO media_uploads (
       id, user_id, file_name, file_type, file_size, storage_url, mime_type
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      uuidv4(),
      userId,
      `${publicId}.${extension}`,
      fileType,
      fileSize ?? null,
      payload.secure_url,
      mimeType || (payload.format ? `${fileType}/${payload.format}` : null),
    ],
  );

  return payload.secure_url;
}

async function storeParsedImage({
  userId,
  parsed,
  purpose = 'upload',
}) {
  return storeParsedMedia({
    userId,
    parsed,
    purpose,
  });
}

function getCloudinaryResourceType(fileType) {
  if (fileType === 'image') return 'image';
  if (fileType === 'video' || fileType === 'audio') return 'video';
  return 'raw';
}

async function storeParsedMedia({
  userId,
  parsed,
  purpose = 'upload',
}) {
  if (!isCloudinaryConfigured()) {
    if (shouldRequireCloudinary()) {
      throw new Error('Cloudinary storage is required but not configured.');
    }
    return storeMediaInDatabase({
      userId,
      purpose,
      parsed,
    });
  }

  try {
    return await uploadImageToCloudinary({
      resourceType: getCloudinaryResourceType(parsed.fileType),
      fileType: parsed.fileType,
      userId,
      dataUri: parsedToDataUri(parsed),
      extension: parsed.extension,
      purpose,
      mimeType: parsed.mimeType,
      fileSize: parsed.buffer.length,
    });
  } catch (error) {
    if (shouldRequireCloudinary()) {
      throw error;
    }

    console.error('[Cloudinary Upload] Falling back to database storage:', error.message);
    return storeMediaInDatabase({
      userId,
      purpose,
      parsed,
    });
  }
}

function parsedToDataUri(parsed) {
  return `data:${parsed.mimeType};base64,${parsed.buffer.toString('base64')}`;
}

function signCloudinaryParams(params, apiSecret) {
  const parts = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);

  return crypto
    .createHash('sha1')
    .update(`${parts.join('&')}${apiSecret}`)
    .digest('hex');
}

async function storeMediaInDatabase({
  userId,
  purpose,
  parsed,
}) {
  const id = uuidv4();
  const fileName = `${userId || 'anon'}_${purpose}_${Date.now()}.${parsed.extension}`;
  const storageUrl = `/media/${id}`;

  await db.query(
    `INSERT INTO media_uploads (
       id, user_id, file_name, file_type, file_size, storage_url, mime_type, storage_blob
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      userId,
      fileName,
      parsed.fileType,
      parsed.buffer.length,
      storageUrl,
      parsed.mimeType,
      parsed.buffer,
    ],
  );

  return storageUrl;
}

async function getStoredMedia(id) {
  return db.queryOne(
    `SELECT id, file_name, file_type, file_size, storage_url, mime_type, storage_blob
     FROM media_uploads
     WHERE id = $1`,
    [id],
  );
}

module.exports = {
  isCloudinaryConfigured,
  parsedToDataUri,
  parseDataUriMedia,
  parseDataUriImage,
  shouldRequireCloudinary,
  storeParsedMedia,
  storeParsedImage,
  storeMediaDataUri,
  storeImageDataUri,
  getStoredMedia,
};
