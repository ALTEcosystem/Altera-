require('dotenv').config();

const db = require('./src/db/database');
const {
  isCloudinaryConfigured,
  parseDataUriImage,
  storeParsedImage,
  getStoredMedia,
} = require('./src/services/media_storage');

const migrationCache = new Map();
const defaultUploadBaseUrl = 'https://altera-d57k.onrender.com';
const migrationStats = {
  missingUploadSources: [],
  skippedErrors: [],
};

function ensureCloudinaryConfigured() {
  if (!isCloudinaryConfigured()) {
    throw new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET first.',
    );
  }
}

function extractMediaId(url) {
  const match = typeof url === 'string' ? url.match(/^\/media\/([A-Za-z0-9-]+)$/) : null;
  return match ? match[1] : null;
}

function isUploadPath(url) {
  return typeof url === 'string' && (
    url.startsWith('/uploads/') ||
    /^https?:\/\/[^/]+\/uploads\//i.test(url)
  );
}

function getUploadBaseUrl() {
  return (process.env.MEDIA_MIGRATION_BASE_URL || defaultUploadBaseUrl).replace(/\/+$/g, '');
}

function resolveUploadUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  return `${getUploadBaseUrl()}${url}`;
}

async function fetchUploadPathAsParsedImage(url) {
  const response = await fetch(resolveUploadUrl(url));
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mimeType.startsWith('image/')) {
    throw new Error(`Fetched non-image content for ${url}: ${mimeType || 'unknown content-type'}`);
  }

  const rawExtension = mimeType.split('/')[1] || 'jpg';
  const extension = rawExtension === 'jpeg' ? 'jpg' : rawExtension.replace(/[^a-z0-9]/gi, '') || 'jpg';

  return {
    mimeType,
    buffer: Buffer.from(arrayBuffer),
    extension,
  };
}

async function resolveImageUrlToCloudinary({
  value,
  userId,
  purpose,
}) {
  if (typeof value !== 'string' || !value.trim()) {
    return value;
  }

  const normalized = value.trim();
  if (migrationCache.has(normalized)) {
    return migrationCache.get(normalized);
  }

  if (normalized.startsWith('https://res.cloudinary.com/')) {
    migrationCache.set(normalized, normalized);
    return normalized;
  }

  if (normalized.startsWith('data:image')) {
    const parsed = parseDataUriImage(normalized);
    if (!parsed) return normalized;

    const cloudinaryUrl = await storeParsedImage({
      userId,
      parsed,
      purpose,
    });
    migrationCache.set(normalized, cloudinaryUrl);
    return cloudinaryUrl;
  }

  const mediaId = extractMediaId(normalized);
  if (mediaId) {
    const storedMedia = await getStoredMedia(mediaId);
    if (!storedMedia?.storage_blob || !storedMedia?.mime_type?.startsWith('image/')) {
      migrationCache.set(normalized, normalized);
      return normalized;
    }

    const parsed = {
      mimeType: storedMedia.mime_type,
      buffer: storedMedia.storage_blob,
      extension: storedMedia.mime_type.split('/')[1] === 'jpeg'
        ? 'jpg'
        : storedMedia.mime_type.split('/')[1],
    };

    const cloudinaryUrl = await storeParsedImage({
      userId,
      parsed,
      purpose,
    });
    migrationCache.set(normalized, cloudinaryUrl);
    return cloudinaryUrl;
  }

  if (isUploadPath(normalized)) {
    try {
      const parsed = await fetchUploadPathAsParsedImage(normalized);
      const cloudinaryUrl = await storeParsedImage({
        userId,
        parsed,
        purpose,
      });
      migrationCache.set(normalized, cloudinaryUrl);
      return cloudinaryUrl;
    } catch (error) {
      migrationStats.missingUploadSources.push({
        source: normalized,
        purpose,
        userId,
        error: error.message,
      });
      migrationCache.set(normalized, normalized);
      return normalized;
    }
  }

  migrationCache.set(normalized, normalized);
  return normalized;
}

async function migrateSimpleColumn({
  label,
  table,
  idColumn = 'id',
  ownerColumn,
  valueColumn,
  purpose,
}) {
  const rows = await db.queryMany(
    `SELECT ${idColumn} AS id, ${ownerColumn} AS owner_id, ${valueColumn} AS value
     FROM ${table}
     WHERE ${valueColumn} IS NOT NULL`,
    [],
  );

  let updatedCount = 0;
  for (const row of rows) {
    const nextValue = await resolveImageUrlToCloudinary({
      value: row.value,
      userId: row.owner_id,
      purpose,
    });

    if (nextValue !== row.value) {
      await db.query(
        `UPDATE ${table} SET ${valueColumn} = $1 WHERE ${idColumn} = $2`,
        [nextValue, row.id],
      );
      updatedCount += 1;
      console.log(`[migrate] ${label} ${row.id} updated`);
    }
  }

  return updatedCount;
}

async function migratePostMediaUrls() {
  const rows = await db.queryMany(
    `SELECT id, user_id, media_urls
     FROM posts
     WHERE media_urls IS NOT NULL`,
    [],
  );

  let updatedCount = 0;
  for (const row of rows) {
    const currentUrls = Array.isArray(row.media_urls) ? row.media_urls : [];
    if (currentUrls.length === 0) continue;

    const nextUrls = [];
    let changed = false;

    for (const url of currentUrls) {
      const nextUrl = await resolveImageUrlToCloudinary({
        value: url,
        userId: row.user_id,
        purpose: 'post',
      });
      nextUrls.push(nextUrl);
      if (nextUrl !== url) {
        changed = true;
      }
    }

    if (changed) {
      await db.query(
        'UPDATE posts SET media_urls = $1 WHERE id = $2',
        [nextUrls, row.id],
      );
      updatedCount += 1;
      console.log(`[migrate] post ${row.id} updated`);
    }
  }

  return updatedCount;
}

async function main() {
  ensureCloudinaryConfigured();
  await db.initialize();

  const summary = {
    users_avatar_url: await migrateSimpleColumn({
      label: 'user avatar',
      table: 'users',
      ownerColumn: 'id',
      valueColumn: 'avatar_url',
      purpose: 'avatar',
    }),
    users_cover_url: await migrateSimpleColumn({
      label: 'user cover',
      table: 'users',
      ownerColumn: 'id',
      valueColumn: 'cover_url',
      purpose: 'cover',
    }),
    ai_profiles_avatar: await migrateSimpleColumn({
      label: 'ai avatar',
      table: 'ai_profiles',
      ownerColumn: 'user_id',
      valueColumn: 'avatar',
      purpose: 'avatar',
    }),
    posts_media_urls: await migratePostMediaUrls(),
    stories_media_url: await migrateSimpleColumn({
      label: 'story media',
      table: 'stories',
      ownerColumn: 'user_id',
      valueColumn: 'media_url',
      purpose: 'story',
    }),
    messages_media_url: await migrateSimpleColumn({
      label: 'message media',
      table: 'messages',
      ownerColumn: 'sender_id',
      valueColumn: 'media_url',
      purpose: 'dm',
    }),
    missing_upload_sources: migrationStats.missingUploadSources.length,
    skipped_errors: migrationStats.skippedErrors.length,
  };

  console.log('\nMigration complete.');
  console.log(JSON.stringify(summary, null, 2));
  if (migrationStats.missingUploadSources.length > 0) {
    console.log('\nMissing upload sources:');
    console.log(JSON.stringify(migrationStats.missingUploadSources, null, 2));
  }
  await db.close();
}

main().catch(async (error) => {
  console.error('[migrate_images_to_cloudinary]', error);
  try {
    await db.close();
  } catch (_) {
    // ignore shutdown errors
  }
  process.exit(1);
});
