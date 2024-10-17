const fs = require('fs');
const path = require('path');

const { 
  transformPosts, 
  getExistingAssetIds,
  ensureCacheFilesExist,
  createLinkedEntries,
  createBlogPosts
} = require('./importer');
require('dotenv').config();

const runImport = async () => {
  try {
    await ensureCacheFilesExist();
    // Step 1: Load the posts data from the exported file
    const filePath = path.join(__dirname, 'data', 'exported_posts.json');
    const rawData = fs.readFileSync(filePath);
    const data = JSON.parse(rawData);
    console.log('Posts data loaded successfully');

    // Step 2: Retrieve existing asset IDs
    console.log('Retrieving existing asset IDs...');
    const assetMap = await getExistingAssetIds(data.entries);
    console.log('Asset IDs retrieved successfully');

    // Step 3: Create linked entries (SEO, product_info, scores)
    const linkedEntriesMap = await createLinkedEntries(data.entries, assetMap);
    console.log('Linked entries created successfully');

    // Step 4: Transform posts data
    const transformedPosts = await transformPosts(data.entries, assetMap, linkedEntriesMap);
    console.log('Posts transformed successfully');

    // Step 6: Publish posts to Contentful
    await createBlogPosts(transformedPosts);
    console.log('Blog posts published successfully');

  } catch (error) {
    console.error('Error during import:', error);
  }
};

runImport();