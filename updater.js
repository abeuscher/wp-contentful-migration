const fs = require('fs').promises;
const path = require('path');
const contentful = require('contentful-management');
const dotenv = require('dotenv');
dotenv.config();
const client = contentful.createClient({
  accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN
});

const space = client.getSpace(process.env.CONTENTFUL_SPACE_ID);
const environment = space.then(space => space.getEnvironment('master'));

const locale = process.env.CONTENTFUL_LOCALE || 'en-US';

const LINKED_ENTRIES_CACHE_FILE = path.join(__dirname, 'linked_entries_cache.json');
const ASSET_CACHE_FILE = path.join(__dirname, 'asset_cache.json');

async function updateSEOFeaturedImages() {
  // Load the original data
  const originalData = JSON.parse(await fs.readFile(path.join(__dirname, 'data', 'exported_posts.json'), 'utf8'));
  
  // Load the linked entries cache
  const linkedEntriesCache = JSON.parse(await fs.readFile(LINKED_ENTRIES_CACHE_FILE, 'utf8'));
  
  // Load the asset cache
  const assetCache = JSON.parse(await fs.readFile(ASSET_CACHE_FILE, 'utf8'));

  for (const post of originalData.entries) {
    const seoEntryId = linkedEntriesCache[post.id].seoId;
    const featuredImageUrl = post.seo.featured_image;

    if (featuredImageUrl) {
      const filename = path.basename(featuredImageUrl);
      const assetId = Object.entries(assetCache).find(([url, id]) => path.basename(url) === filename)?.[1];

      if (assetId) {
        try {
          const entry = await environment.then(env => env.getEntry(seoEntryId));
          
          entry.fields.featured_image = {
            [locale]: {
              sys: {
                type: 'Link',
                linkType: 'Asset',
                id: assetId
              }
            }
          };

          const updatedEntry = await entry.update();
          await updatedEntry.publish();

          console.log(`Updated SEO entry ${seoEntryId} with featured image ${assetId}`);
        } catch (error) {
          console.error(`Error updating SEO entry ${seoEntryId}:`, error);
        }
      } else {
        console.warn(`No asset found for featured image URL: ${featuredImageUrl}`);
      }
    } else {
      console.warn(`No featured image URL for post ${post.id}`);
    }
  }
}

updateSEOFeaturedImages().catch(console.error);