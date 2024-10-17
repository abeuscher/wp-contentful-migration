const contentful = require('contentful-management');
const dotenv = require('dotenv');
dotenv.config();

const client = contentful.createClient({
  accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN
});

async function deleteAllEntries() {
  try {
    const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
    const environment = await space.getEnvironment('master');

    let hasMoreEntries = true;
    while (hasMoreEntries) {
      const entries = await environment.getEntries({ limit: 1000 });
      
      if (entries.items.length === 0) {
        hasMoreEntries = false;
        console.log('All entries have been deleted.');
        break;
      }

      console.log(`Deleting batch of ${entries.items.length} entries...`);

      for (const entry of entries.items) {
        if (entry.isPublished()) {
          await entry.unpublish();
        }
        await entry.delete();
        console.log(`Deleted entry: ${entry.sys.id}`);
      }
    }
  } catch (error) {
    console.error('Error deleting entries:', error);
  }
}

// CAUTION: Uncomment the line below only when you're absolutely sure you want to delete all entries
deleteAllEntries();