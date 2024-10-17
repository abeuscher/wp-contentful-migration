const path = require('path');
const fs = require('fs').promises;
const contentful = require('contentful-management');
const dotenv = require('dotenv');
dotenv.config();

const client = contentful.createClient({
  accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN
});

const ASSET_CACHE_FILE = path.join(__dirname, 'asset_cache.json');
const LINKED_ENTRIES_CACHE_FILE = path.join(__dirname, 'linked_entries_cache.json');
const BLOG_POSTS_CACHE_FILE = path.join(__dirname, 'blog_posts_cache.json');

const space = client.getSpace(process.env.CONTENTFUL_SPACE_ID);
const environment = space.then(space => space.getEnvironment('master'));

const locale = process.env.CONTENTFUL_LOCALE || 'en-US';

const uploadImages = async (posts) => {
  const allImages = posts.flatMap(post => post.photos.map(photo => photo.image));
  const uploadedAssets = {};

  for (const image of allImages) {
    if (uploadedAssets[image.url]) {
      continue; // Skip if already uploaded
    }

    try {
      const existingAsset = await environment.then(env => 
        env.getAssets({ 'fields.file.url[match]': image.url })
      );

      if (existingAsset.items.length > 0) {
        uploadedAssets[image.url] = existingAsset.items[0].sys.id;
      } else {
        const asset = await environment.then(env => env.createAsset({
          fields: {
            title: { [locale]: image.title || 'Untitled' },
            file: {
              [locale]: {
                contentType: 'image/jpeg',
                fileName: image.filename || 'image.jpg',
                upload: image.url
              }
            }
          }
        }));

        const processedAsset = await asset.processForAllLocales();
        const publishedAsset = await processedAsset.publish();

        uploadedAssets[image.url] = publishedAsset.sys.id;
      }

      // Add a delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error uploading image ${image.url}:`, error);
    }
  }

  return uploadedAssets;
};
const rateLimitedOperation = async (operation, retryDelay = 1000, maxRetries = 5) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error.name === 'RateLimitExceededError' && attempt < maxRetries - 1) {
        console.log(`Rate limit exceeded. Retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        retryDelay *= 2; // Exponential backoff
      } else {
        throw error;
      }
    }
  }
};

const createLinkedEntries = async (posts, assetMap) => {
  let linkedEntriesMap = {};

  // Try to load the cache file
  try {
    const cacheData = await fs.readFile(LINKED_ENTRIES_CACHE_FILE, 'utf8');
    linkedEntriesMap = JSON.parse(cacheData);
    console.log('Loaded linked entries cache from file');
  } catch (error) {
    console.log('No existing linked entries cache found or error reading cache');
  }

  const convertToISODate = (dateString) => {
    if (!dateString) return null;
    const [month, day, year] = dateString.split('/');
    return `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  for (const post of posts) {
    if (linkedEntriesMap[post.id]) {
      console.log(`Skipping linked entries creation for post ${post.id} (already in cache)`);
      continue;
    }

    let featuredImageId = null;
    if (post.seo.featured_image) {
      const filename = path.basename(post.seo.featured_image);
      featuredImageId = Object.entries(assetMap).find(([url, id]) => path.basename(url) === filename)?.[1];
    }

    const seoEntry = await environment.then(env => env.createEntry('seo', {
      fields: {
        title: { [locale]: post.seo.title },
        og_title: { [locale]: post.seo.og_title },
        description: { [locale]: post.seo.description },
        featured_image: featuredImageId 
          ? { [locale]: { sys: { type: 'Link', linkType: 'Asset', id: featuredImageId } } }
          : { [locale]: null },
        link: { [locale]: post.seo.link }
      }
    }));
    await seoEntry.publish();

    const productInfoEntry = await environment.then(env => env.createEntry('productInfo', {
      fields: {
        title: { [locale]: `Product Info for ${post.title}` }, // Added name field
        product_type: { [locale]: post.product_info.product_type },
        brand: { [locale]: post.product_info.brand },
        strain: { [locale]: post.product_info.strain },
        price: { [locale]: post.product_info.price },
        cost: { [locale]: parseFloat(post.product_info.cost) || 0 },
        weight: { [locale]: parseFloat(post.product_info.weight) || 0 },
        listed_thc_percentage: { [locale]: parseFloat(post.product_info.listed_thc_percentage) || 0 },
        package_date: { [locale]: convertToISODate(post.product_info.package_date) },
        purchase_date: { [locale]: convertToISODate(post.product_info.purchase_date) },
        dispensary: { [locale]: post.product_info.dispensary }
      }
    }));
    await productInfoEntry.publish();

    const scoresEntry = await environment.then(env => env.createEntry('scores', {
      fields: {
        title: { [locale]: `Scores for ${post.title}` }, // Added name field
        strength: { [locale]: parseInt(post.scores.strength) || 0 },
        strength_notes: { [locale]: post.scores.strength_notes },
        taste: { [locale]: parseInt(post.scores.taste) || 0 },
        taste_notes: { [locale]: post.scores.taste_notes },
        quality: { [locale]: parseInt(post.scores.quality) || 0 },
        quality_notes: { [locale]: post.scores.quality_notes },
        overall_score: { [locale]: parseInt(post.scores.overall_score) || 0 },
        overall_notes: { [locale]: post.scores.overall_notes }
      }
    }));
    await scoresEntry.publish();

    linkedEntriesMap[post.id] = {
      seoId: seoEntry.sys.id,
      productInfoId: productInfoEntry.sys.id,
      scoresId: scoresEntry.sys.id
    };

    // Save the updated linkedEntriesMap to the cache file after each post
    try {
      await fs.writeFile(LINKED_ENTRIES_CACHE_FILE, JSON.stringify(linkedEntriesMap, null, 2));
      console.log(`Updated linked entries cache saved for post ${post.id}`);
    } catch (error) {
      console.error('Error writing linked entries cache to file:', error);
    }
  }

  return linkedEntriesMap;
};

const transformPosts = (posts, assetMap, linkedEntriesMap) => posts.map(post => ({
  title: post.title,
  date: post.date,
  excerpt: post.excerpt,
  slug: post.slug || post.title.toLowerCase().replace(/\s+/g, '-'),
  template_name: post.template_name, // Changed from templateName to template_name
  seo: { sys: { type: 'Link', linkType: 'Entry', id: linkedEntriesMap[post.id].seoId } },
  product_info: { sys: { type: 'Link', linkType: 'Entry', id: linkedEntriesMap[post.id].productInfoId } }, // Changed from productInfo to product_info
  short_review: post.review.short_review, // Changed from shortReview to short_review
  long_review: post.review.long_review, // Changed from longReview to long_review
  photos: post.photos
    .filter(photo => photo.image && photo.image.url) // Filter out photos with missing image or URL
    .map(photo => {
      const filename = path.basename(photo.image.url);
      const assetId = Object.entries(assetMap).find(([url, id]) => path.basename(url) === filename)?.[1];
      return assetId ? {
        sys: { type: 'Link', linkType: 'Asset', id: assetId }
      } : null;
    })
    .filter(Boolean),
  scores: { sys: { type: 'Link', linkType: 'Entry', id: linkedEntriesMap[post.id].scoresId } },
  previous_post: post.navigation.previous_post, // Changed from previousPost to previous_post
  next_post: post.navigation.next_post // Changed from nextPost to next_post
}));

const getExistingAssetIds = async (posts) => {
  let assetMap = {};

  // Try to load the cache file
  try {
    const cacheData = await fs.readFile(ASSET_CACHE_FILE, 'utf8');
    assetMap = JSON.parse(cacheData);
    console.log('Loaded asset cache from file');
  } catch (error) {
    console.log('No existing asset cache found or error reading cache');
  }

  const allImageUrls = posts.flatMap(post => 
    post.photos.map(photo => photo.image?.url).filter(Boolean)
  );
  const uniqueImageUrls = [...new Set(allImageUrls)];
  const newUrls = uniqueImageUrls.filter(url => !assetMap[url]);

  for (const url of newUrls) {
    try {
      if (!url) {
        console.warn('Encountered an undefined or null URL');
        continue;
      }

      const filename = path.basename(url);
      const assets = await environment.then(env => 
        env.getAssets({
          'fields.file.fileName': filename,
          limit: 1
        })
      );

      if (assets.items.length > 0) {
        assetMap[url] = assets.items[0].sys.id;
      } else {
        console.warn(`No asset found for filename: ${filename}`);
      }

      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error retrieving asset for URL ${url}:`, error);
    }
  }

  // Save the updated assetMap to the cache file
  try {
    await fs.writeFile(ASSET_CACHE_FILE, JSON.stringify(assetMap, null, 2));
    console.log('Updated asset cache saved to file');
  } catch (error) {
    console.error('Error writing asset cache to file:', error);
  }

  return assetMap;
};
const createBlogPosts = async (transformedPosts) => {
  const RATE_LIMIT_DELAY = 2000; // 2 seconds between requests
  const MAX_RETRIES = 5;

  // Load cache
  let blogPostsCache = {};
  try {
    const cacheData = await fs.readFile(BLOG_POSTS_CACHE_FILE, 'utf8');
    blogPostsCache = JSON.parse(cacheData);
    console.log('Loaded blog posts cache from file');
  } catch (error) {
    console.log('No existing blog posts cache found or error reading cache');
  }

  const createPostWithRetry = async (post, retryCount = 0) => {
    if (blogPostsCache[post.slug]) {
      console.log(`Skipping blog post creation for ${post.title} (already in cache)`);
      return;
    }

    try {
      const entry = await environment.then(env => env.createEntry('reviewPost', {
        fields: {
          title: { [locale]: post.title },
          date: { [locale]: post.date },
          excerpt: { [locale]: post.excerpt },
          slug: { [locale]: post.slug },
          template_name: { [locale]: post.template_name },
          seo: { [locale]: post.seo },
          product_info: { [locale]: post.product_info },
          short_review: { [locale]: post.short_review },
          long_review: { [locale]: post.long_review },
          photos: { [locale]: post.photos },
          scores: { [locale]: post.scores },
          previous_post: { [locale]: post.previous_post },
          next_post: { [locale]: post.next_post }
        }
      }));
      await entry.publish();
      console.log(`Created and published blog post: ${post.title}`);
      
      // Update cache
      blogPostsCache[post.slug] = entry.sys.id;
      await fs.writeFile(BLOG_POSTS_CACHE_FILE, JSON.stringify(blogPostsCache, null, 2));
    } catch (error) {
      if (error.name === 'RateLimitExceededError' && retryCount < MAX_RETRIES) {
        const delay = RATE_LIMIT_DELAY * (retryCount + 1);
        console.warn(`Rate limit exceeded. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return createPostWithRetry(post, retryCount + 1);
      } else {
        console.error(`Failed to create blog post: ${post.title}`, error);
      }
    }
  };

  for (const post of transformedPosts) {
    await createPostWithRetry(post);
    // Add a delay between each post creation to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
  }
};

const ensureCacheFilesExist = async () => {
  const files = [ASSET_CACHE_FILE, LINKED_ENTRIES_CACHE_FILE, BLOG_POSTS_CACHE_FILE];

  for (const file of files) {
    try {
      await fs.access(file);
      console.log(`Cache file ${path.basename(file)} already exists`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`Cache file ${path.basename(file)} does not exist, creating it...`);
        try {
          await fs.writeFile(file, JSON.stringify({}, null, 2));
          console.log(`Empty cache file ${path.basename(file)} created successfully`);
        } catch (writeError) {
          console.error(`Error creating cache file ${path.basename(file)}:`, writeError);
        }
      } else {
        console.error(`Error checking cache file ${path.basename(file)}:`, error);
      }
    }
  }
};
module.exports = {
  uploadImages,
  createLinkedEntries,
  ensureCacheFilesExist,
  getExistingAssetIds,
  transformPosts,
  createBlogPosts,
  rateLimitedOperation
};